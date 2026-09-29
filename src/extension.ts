import * as child_process from "child_process";
import * as path from "path";
import * as util from "util";
import * as vscode from "vscode";
import * as _ from "lodash";
import {
  getAttachmentsFolder,
  getMaxNoteCount,
  getRecentNotesCount,
  getRegion,
  getShowTips,
  getUploadFolder
} from "./config";
import {
  ensureTags,
  getClient,
  getConverter,
  getUser,
  listNotebooks,
  listTagNames,
  loadTagNames,
  requireClient,
  resetState
} from "./account";
import { configureToken } from "./auth";
import * as attachments from "./attachments";
import { EvernoteNote, WEB_HOST } from "./everapi";
import { emptyMetadata, serializeFrontMatter } from "./metadata";
import { consumeInternalSave, forgetNote, publishCurrentFile, rememberNote, resolveNoteGuid } from "./noteSync";
import { initReporting, reportError } from "./report";
import {
  clientNoteUrl,
  exists,
  guessMime,
  hash,
  makeDir,
  makeTempDir,
  readFile,
  webNoteUrl,
  writeFile
} from "./myutil";

const TIP_BACK = "back...";

/** Notebook guid -> note metadata, refreshed by `Ever sync`. */
let notesMap: { [notebookGuid: string]: EvernoteNote[] } | undefined;
let selectedNotebookGuid: string | undefined;
let showTips = true;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Opens http(s)/file URIs through VS Code, and custom schemes via the OS. */
function openExternal(target: string): void {
  if (/^https?:/i.test(target)) {
    vscode.env.openExternal(vscode.Uri.parse(target));
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    // `env.openExternal` rejects protocol handlers such as `evernote://`.
    openWithShell(target);
    return;
  }
  vscode.env.openExternal(vscode.Uri.file(target));
}

function openWithShell(target: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  try {
    child_process.spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch (error) {
    reportError(error);
  }
}

/** Resolves the configured attachments folder against the extension's storage. */
function folderForAttachments(context: vscode.ExtensionContext): string {
  const configured = getAttachmentsFolder();
  if (!configured) {
    return path.join(context.globalStorageUri.fsPath, "attachments");
  }
  return path.isAbsolute(configured)
    ? configured
    : path.join(context.globalStorageUri.fsPath, configured);
}

/** Reads the current guid/updated for the buffer, wherever it has been published. */
async function accountDetailsForActiveNote(context: vscode.ExtensionContext, doc: vscode.TextDocument) {
  const guid = resolveNoteGuid(doc);
  if (!guid) {
    vscode.window.showWarningMessage("This note has not been published to Evernote yet.");
    return undefined;
  }
  const user = await getUser(context);
  if (!user || user.id === undefined || !user.shardId) {
    vscode.window.showWarningMessage("Cannot resolve your Evernote account details.");
    return undefined;
  }
  return { guid, userId: user.id, shardId: user.shardId };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Loads the notebook list, syncing the account first if that has not happened. */
async function loadNotebooks(context: vscode.ExtensionContext) {
  if (!notesMap) {
    await syncAccount(context);
  }
  const notebooks = await listNotebooks(context);
  return notebooks.length > 0 ? notebooks : undefined;
}

async function navToNote(context: vscode.ExtensionContext): Promise<void> {
  try {
    const notebooks = await loadNotebooks(context);
    if (!notebooks) {
      return;
    }
    const chosen = await vscode.window.showQuickPick(notebooks.map(notebook => notebook.name));
    if (!chosen) {
      return;
    }
    const notebook = notebooks.find(item => item.name === chosen);
    selectedNotebookGuid = notebook.guid;

    const noteList = (notesMap && notesMap[notebook.guid]) || [];
    if (noteList.length === 0) {
      vscode.window.showInformationMessage("Cannot open an empty notebook.");
      return navToNote(context);
    }
    const chosenNote = await vscode.window.showQuickPick(noteList.map(note => note.title).concat(TIP_BACK));
    if (!chosenNote) {
      return;
    }
    if (chosenNote === TIP_BACK) {
      return navToNote(context);
    }
    const match = noteList.find(note => note.title === chosenNote);
    if (match) {
      await openNote(context, match.guid);
    }
  } catch (error) {
    reportError(error);
  }
}

async function syncAccount(context: vscode.ExtensionContext): Promise<void> {
  const client = await requireClient(context);
  if (!client) {
    return;
  }
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Synchronizing your Evernote account..."
      },
      async () => {
        await ensureTags(context);
        const notebooks = await listNotebooks(context);
        const allMetas = await Promise.all(
          notebooks.map(notebook => client.listAllNoteMetadatas(notebook.guid, getMaxNoteCount()))
        );
        notesMap = _.groupBy(_.flatten(allMetas.map(meta => meta.notes)), "notebookGuid");
      }
    );
    vscode.window.setStatusBarMessage("Synchronizing succeeded!", 3000);
  } catch (error) {
    reportError(error);
  }
}

async function attachToNote(): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const doc = editor.document;
    let filepath = await vscode.window.showInputBox({
      placeHolder: "Full path of your attachment:",
      ignoreFocusOut: true
    });
    if (!filepath) {
      return;
    }
    const uploadFolder = getUploadFolder();
    if (uploadFolder) {
      if (await exists(uploadFolder)) {
        filepath = path.join(uploadFolder, filepath);
      }
    } else {
      vscode.window.showWarningMessage(
        "Attachments upload folder not set, you may have to use an absolute file path."
      );
    }

    const fileName = path.basename(filepath);
    const mime = guessMime(fileName);
    const data = await readFile(filepath);
    const md5 = hash(data);
    attachments.add(doc, filepath, {
      mime,
      data: { body: data, size: data.length, bodyHash: md5 },
      attributes: { fileName, attachment: true, timestamp: Date.now() }
    });

    // The media tag references the resource by its body hash. The upload itself
    // happens on the next publish.
    const position = editor.selection.active;
    await editor.edit(edit => {
      edit.insert(
        position,
        util.format('<en-media type="%s" hash="%s"></en-media>', mime, Buffer.from(md5).toString("hex"))
      );
    });
    vscode.window.showInformationMessage(
      `${fileName} attached; it will be uploaded on the next publish.`
    );
  } catch (error) {
    reportError(error);
  }
}

async function removeAttachment(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const doc = editor.document;
  const local = attachments.list(doc);
  if (local.length === 0) {
    vscode.window.showInformationMessage("No local attachment to remove.");
    return;
  }
  const chosen = await vscode.window.showQuickPick(
    local.map(item => item.attachment.attributes.fileName)
  );
  if (!chosen) {
    return;
  }
  attachments.remove(doc, chosen);
  vscode.window.showInformationMessage(`${chosen} will no longer be uploaded.`);
}

async function listResources(context: vscode.ExtensionContext): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const doc = editor.document;
    const local = attachments.list(doc);

    let serverResources: any[] = [];
    const guid = resolveNoteGuid(doc);
    if (guid) {
      const client = await getClient(context);
      if (client) {
        // Metadata only: the bodies are fetched one at a time, on demand, when
        // the user actually opens one.
        const note = await client.findNoteByGuid(guid);
        serverResources = (note && (note.resources as any[])) || [];
      }
    }

    const serverNames = serverResources.map(resource => "(server) " + resource.attributes.fileName);
    const localNames = local.map(item => "(local) " + item.attachment.attributes.fileName);
    if (serverNames.length === 0 && localNames.length === 0) {
      vscode.window.showInformationMessage("No resource to show.");
      return;
    }

    const chosen = await vscode.window.showQuickPick(serverNames.concat(localNames));
    if (!chosen) {
      return;
    }
    if (chosen.startsWith("(server) ")) {
      const name = chosen.substring("(server) ".length);
      const resource = serverResources.find(item => item.attributes.fileName === name);
      await openServerResource(context, resource);
      return;
    }
    const name = chosen.substring("(local) ".length);
    const item = local.find(entry => entry.attachment.attributes.fileName === name);
    if (item && item.sourcePath) {
      openExternal(item.sourcePath);
    }
  } catch (error) {
    reportError(error);
  }
}

async function openServerResource(context: vscode.ExtensionContext, resource: any): Promise<void> {
  const client = await getClient(context);
  if (!client || !resource) {
    return;
  }
  try {
    const full = await client.getResource(resource.guid);
    const fileName = full.attributes.fileName;
    const folder = folderForAttachments(context);
    if (!(await exists(folder))) {
      await makeDir(folder);
    }
    const tmpDir = await makeTempDir(path.join(folder, "evermonkey-"));
    const filepath = path.join(tmpDir, fileName);
    await writeFile(filepath, full.data.body);
    openExternal(filepath);
  } catch (error) {
    reportError(error);
  }
}

async function newNote(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: "markdown" });
  attachments.init(doc);
  const editor = await vscode.window.showTextDocument(doc);
  const header = serializeFrontMatter(emptyMetadata(), "\n") + "\n";
  await editor.edit(edit => edit.insert(new vscode.Position(0, 0), header));
  // Put the cursor right after "title: " so the user can start typing.
  const titlePosition = new vscode.Position(1, "title: ".length);
  editor.selection = new vscode.Selection(titlePosition, titlePosition);
}

async function searchNote(context: vscode.ExtensionContext): Promise<void> {
  try {
    const client = await requireClient(context);
    if (!client) {
      return;
    }
    const query = await vscode.window.showInputBox({
      placeHolder: "Use Evernote Search Grammar to search notes."
    });
    if (!query) {
      return;
    }
    const result = await client.searchNote(query, getMaxNoteCount());
    if (!result.notes || result.notes.length === 0) {
      vscode.window.showInformationMessage("No note matched your search.");
      return;
    }
    const notebooks = await listNotebooks(context);
    const labelled = result.notes.map(note => {
      const notebook = notebooks.find(item => item.guid === note.notebookGuid);
      return `${notebook ? notebook.name : "?"}>>${note.title}`;
    });
    const chosen = await vscode.window.showQuickPick(labelled);
    if (!chosen) {
      return;
    }
    const title = chosen.substring(chosen.indexOf(">>") + 2);
    const match = result.notes.find(note => note.title === title);
    if (match) {
      await openNote(context, match.guid);
    }
  } catch (error) {
    reportError(error);
  }
}

async function openRecentNotes(context: vscode.ExtensionContext): Promise<void> {
  try {
    const client = await requireClient(context);
    if (!client) {
      return;
    }
    const result = await client.listRecentNotes(getRecentNotesCount());
    if (!result.notes || result.notes.length === 0) {
      vscode.window.showInformationMessage("No recent note found.");
      return;
    }
    const chosen = await vscode.window.showQuickPick(result.notes.map(note => note.title));
    if (!chosen) {
      return;
    }
    const match = result.notes.find(note => note.title === chosen);
    if (match) {
      await openNote(context, match.guid);
    }
  } catch (error) {
    reportError(error);
  }
}

/**
 * Opens a note from the server into an in-memory Markdown buffer whose header
 * carries the guid, which is what lets a later publish update that note instead
 * of creating a duplicate.
 */
async function openNote(context: vscode.ExtensionContext, noteGuid: string): Promise<void> {
  try {
    const client = await getClient(context);
    if (!client) {
      return;
    }
    const note = await client.getNoteContent(noteGuid);
    const tagNames = await resolveTagNames(context, note.tagGuids);
    const notebooks = await listNotebooks(context);
    const notebook = notebooks.find(item => item.guid === note.notebookGuid);

    const doc = await vscode.workspace.openTextDocument({ language: "markdown" });
    const editor = await vscode.window.showTextDocument(doc);
    attachments.init(doc);
    rememberNote(doc, note);

    const header = serializeFrontMatter({
      title: note.title,
      tags: tagNames,
      notebook: notebook ? notebook.name : "",
      notebookGuid: note.notebookGuid,
      guid: note.guid,
      updated: note.updated !== undefined ? String(note.updated) : undefined,
      extra: {}
    }, "\n") + "\n";
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), header + getConverter().toMd(note.content)));
  } catch (error) {
    reportError(error);
  }
}

async function resolveTagNames(context: vscode.ExtensionContext, tagGuids: string[]): Promise<string[]> {
  return loadTagNames(context, tagGuids || []);
}

async function openNoteInClient(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const details = await accountDetailsForActiveNote(context, editor.document);
  if (details) {
    openExternal(clientNoteUrl(details.shardId, details.userId, details.guid));
  }
}

async function openNoteInBrowser(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const details = await accountDetailsForActiveNote(context, editor.document);
  if (details) {
    openExternal(webNoteUrl(WEB_HOST[getRegion()], details.shardId, details.userId, details.guid));
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  showTips = getShowTips();
  initReporting(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("evermonkey")) {
        // Drop the client, converter and account caches so a newly entered
        // token, theme or region takes effect without a window reload.
        resetState();
        notesMap = undefined;
        selectedNotebookGuid = undefined;
        showTips = getShowTips();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => {
      forgetNote(doc);
      attachments.forget(doc);
    })
  );

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => alertToUpdate(doc)));

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      ["plaintext", { scheme: "untitled", language: "markdown" }],
      {
        async provideCompletionItems(doc, position) {
          if (position.line === 2) {
            // `tags:`
            return listTagNames().map(tag => new vscode.CompletionItem(tag));
          }
          if (position.line === 3) {
            // `notebook:`
            const notebooks = await listNotebooks(context);
            return notebooks.map(notebook => new vscode.CompletionItem(notebook.name));
          }
          return [];
        }
      }
    )
  );

  registerCommand(context, "extension.navToNote", () => navToNote(context));
  registerCommand(context, "extension.publishNote", () => publishCurrentFile(context));
  registerCommand(context, "extension.configureToken", () => configureToken(context));
  // Kept so existing keybindings and docs that mention `ever token` keep working.
  registerCommand(context, "extension.openDevPage", () => configureToken(context));
  registerCommand(context, "extension.sync", () => syncAccount(context));
  registerCommand(context, "extension.newNote", () => newNote());
  registerCommand(context, "extension.searchNote", () => searchNote(context));
  registerCommand(context, "extension.openRecentNotes", () => openRecentNotes(context));
  registerCommand(context, "extension.attachToNote", () => attachToNote());
  registerCommand(context, "extension.listResources", () => listResources(context));
  registerCommand(context, "extension.openNoteInBrowser", () => openNoteInBrowser(context));
  registerCommand(context, "extension.removeAttachment", () => removeAttachment());
  registerCommand(context, "extension.viewInEverClient", () => openNoteInClient(context));

  promptForTokenIfNeeded(context);
}

async function promptForTokenIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  let configured = false;
  try {
    configured = !!(await getClient(context));
  } catch (error) {
    // A stored token that can no longer build a client: fall through to the prompt.
    console.error(error);
  }
  if (configured) {
    return;
  }
  const CONFIGURE = "Configure token";
  const choice = await vscode.window.showInformationMessage(
    "Evernote token not set. Run 'Ever token' to configure it.",
    CONFIGURE
  );
  if (choice === CONFIGURE) {
    await vscode.commands.executeCommand("extension.configureToken");
  }
}

function registerCommand(
  context: vscode.ExtensionContext,
  id: string,
  handler: (...args: any[]) => any
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(id, (...args: any[]) =>
      Promise.resolve(handler(...args)).catch(reportError)
    )
  );
}

function alertToUpdate(doc: vscode.TextDocument): void {
  if (!showTips) {
    return;
  }
  // The publish write-back saves the file itself; telling the user to publish
  // right after a publish would be nonsense.
  if (consumeInternalSave(doc)) {
    return;
  }
  const option = "Ignore";
  vscode.window
    .showWarningMessage("Saving locally does not sync the remote. Use 'Ever publish'.", option)
    .then(result => {
      if (result === option) {
        showTips = false;
      }
    });
}

export function deactivate(): void { }