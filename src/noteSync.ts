import * as path from "path";
import * as vscode from "vscode";
import { getConverter, getNotebookName, requireClient, resolveNotebookGuid } from "./account";
import * as attachments from "./attachments";
import { EvernoteClient, EvernoteNote } from "./everapi";
import { NoteMetadata, parseFrontMatter, resolveTitle, serializeFrontMatter } from "./metadata";
import { reportError } from "./report";

/**
 * One-way sync: the local Markdown file is the source of truth.
 *
 * The link to the remote note is the `guid` in the front matter, written back
 * after the first successful create. That replaces the old approach of
 * searching the account by `intitle:"<title>"`, which was ambiguous (any note
 * with that title, in any notebook) and could silently create duplicates.
 */

interface SessionNote {
  guid: string;
  updated?: number;
  notebookGuid?: string;
  title?: string;
}

/** Notes opened from the server, and buffers that have no file to write back to. */
const sessionNotes = new Map<string, SessionNote>();

function key(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

export function rememberNote(doc: vscode.TextDocument, note: EvernoteNote): void {
  sessionNotes.set(key(doc), {
    guid: note.guid,
    updated: note.updated,
    notebookGuid: note.notebookGuid,
    title: note.title
  });
}

export function forgetNote(doc: vscode.TextDocument): void {
  sessionNotes.delete(key(doc));
}

function isFileBacked(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === "file";
}

/**
 * Saves performed by the write-back below must not trigger the "this did not
 * sync" tip, which would fire immediately after a successful publish.
 */
const internalSaves = new Map<string, number>();
const INTERNAL_SAVE_WINDOW_MS = 5000;

/** True when the save event for this document came from our own write-back. */
export function consumeInternalSave(doc: vscode.TextDocument): boolean {
  const savedAt = internalSaves.get(key(doc));
  if (savedAt === undefined) {
    return false;
  }
  internalSaves.delete(key(doc));
  return Date.now() - savedAt < INTERNAL_SAVE_WINDOW_MS;
}

/**
 * The remote guid for a document: the front matter first (a real file, or a
 * note opened from the server whose generated header carries the guid), then
 * any in-memory record for an unsaved buffer.
 */
export function resolveNoteGuid(doc: vscode.TextDocument): string | undefined {
  const fromFrontMatter = parseFrontMatter(doc.getText()).metadata.guid;
  if (fromFrontMatter) {
    return fromFrontMatter;
  }
  const session = sessionNotes.get(key(doc));
  return session ? session.guid : undefined;
}

let warnedAboutUntitled = false;

function warnAboutUntitled(): void {
  if (warnedAboutUntitled) {
    return;
  }
  warnedAboutUntitled = true;
  vscode.window.showWarningMessage(
    "This buffer has no file on disk, so the note id cannot be saved. Publishing again in this " +
    "window will update the same note, but after you close it a new note will be created."
  );
}

/** Pushes the active Markdown document to Evernote. */
export async function publishCurrentFile(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a Markdown file first.");
    return;
  }
  const doc = editor.document;
  if (doc.languageId !== "markdown") {
    vscode.window.showWarningMessage("Ever publish works on Markdown files only.");
    return;
  }
  const client = await requireClient(context);
  if (!client) {
    return;
  }

  try {
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const fileBacked = isFileBacked(doc);
    const parsed = parseFrontMatter(doc.getText());
    const meta = parsed.metadata;

    const title = await resolveNoteTitle(meta, doc, fileBacked);
    if (!title) {
      return;
    }
    meta.title = title;

    const content = await getConverter().toEnml(parsed.body);

    const notebookGuid = await resolveNotebookGuid(context, meta);
    if (!notebookGuid) {
      vscode.window.showInformationMessage("Publish cancelled: no notebook selected.");
      return;
    }
    meta.notebookGuid = notebookGuid;
    const notebookName = await getNotebookName(context, notebookGuid);
    if (notebookName) {
      meta.notebook = notebookName;
    }

    const session = sessionNotes.get(key(doc));
    let guid = meta.guid || (session && session.guid);
    const lastSeenUpdated = meta.updated || (session && session.updated !== undefined ? String(session.updated) : undefined);

    let existing: EvernoteNote | null = null;
    if (guid) {
      existing = await client.findNoteByGuid(guid);
      if (!existing) {
        // Deleted in the Evernote client or on another device: fall through to
        // a create rather than failing, and let the write-back fix the guid.
        guid = undefined;
      }
    }

    if (!existing && !guid && !meta.guid) {
      // Files written before the header carried a `guid` would otherwise create
      // a duplicate of a note that already exists. Adopt an unambiguous match.
      const candidate = await client.findUniqueNoteByTitle(title, notebookGuid);
      if (candidate) {
        existing = await client.findNoteByGuid(candidate.guid);
        if (existing) {
          vscode.window.setStatusBarMessage(
            `Linking this file to the existing note "${candidate.title}".`,
            4000
          );
        }
      }
    }

    if (existing && lastSeenUpdated && existing.updated && existing.updated > Number(lastSeenUpdated)) {
      const OVERWRITE = "Overwrite";
      const choice = await vscode.window.showWarningMessage(
        `"${existing.title}" changed on the server since your last push. Overwriting discards those changes.`,
        { modal: true },
        OVERWRITE
      );
      if (choice !== OVERWRITE) {
        return;
      }
    }

    const note = existing
      ? await updateNote(client, existing, meta, content, notebookGuid, attachments.resources(doc))
      : await client.createNote({
        title,
        notebookGuid,
        content,
        tagNames: meta.tags,
        resources: attachments.resources(doc)
      });

    meta.guid = note.guid;
    meta.updated = note.updated !== undefined ? String(note.updated) : undefined;
    rememberNote(doc, note);
    attachments.clear(doc);

    if (fileBacked) {
      await writeBack(doc, meta, eol);
    } else {
      warnAboutUntitled();
    }

    vscode.window.setStatusBarMessage(`Pushed "${title}" to ${notebookName || "Evernote"}.`, 4000);
  } catch (error) {
    reportError(error, "Publish failed");
  }
}

async function resolveNoteTitle(
  meta: NoteMetadata,
  doc: vscode.TextDocument,
  fileBacked: boolean
): Promise<string | undefined> {
  const fallback = fileBacked ? path.basename(doc.fileName, path.extname(doc.fileName)) : undefined;
  const resolved = resolveTitle(meta, fallback);
  if (resolved) {
    return resolved;
  }
  const entered = await vscode.window.showInputBox({
    prompt: "This note needs a title",
    placeHolder: "Note title",
    ignoreFocusOut: true
  });
  const trimmed = (entered || "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Sends the update, being careful with attachments.
 *
 * Verified against the live service:
 *   - omitting `resources` entirely leaves the note's existing attachments
 *     untouched, so the common case (no new attachments) does no extra work;
 *   - passing `resources` *replaces* the whole set, so when there is a new
 *     local attachment the server's own resources have to be carried along or
 *     they would be silently dropped;
 *   - passing `resources: []` wipes them, so an empty array is never sent.
 */
async function updateNote(
  client: EvernoteClient,
  existing: EvernoteNote,
  meta: NoteMetadata,
  content: string,
  notebookGuid: string,
  localResources: any[]
): Promise<EvernoteNote> {
  let resources: any[] | undefined;
  if (localResources.length === 0) {
    resources = undefined;
  } else if (existing.resources && existing.resources.length > 0) {
    const full = await client.getNoteResources(existing.guid);
    resources = localResources.concat(full.resources || []);
  } else {
    resources = localResources;
  }
  return client.updateNote({
    guid: existing.guid,
    title: meta.title,
    notebookGuid,
    content,
    tagNames: meta.tags,
    resources
  });
}

/**
 * Writes the updated header back into the file.
 *
 * This goes through a `WorkspaceEdit` rather than `fs`: writing the file
 * directly would race the editor buffer and could drop edits made while the
 * network round-trip was in flight.
 */
async function writeBack(doc: vscode.TextDocument, meta: NoteMetadata, eol: string): Promise<void> {
  const parsed = parseFrontMatter(doc.getText());
  const header = serializeFrontMatter(meta, eol);
  const range = parsed.hasHeader
    ? new vscode.Range(doc.positionAt(0), doc.positionAt(parsed.headerLength))
    : new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
  const text = parsed.hasHeader ? header : header + eol;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, range, text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showWarningMessage(
      "The note was published but its front matter could not be updated, so the next publish " +
      "may create a duplicate. Make sure the file is editable and try again."
    );
    return;
  }
  internalSaves.set(key(doc), Date.now());
  await doc.save();
}