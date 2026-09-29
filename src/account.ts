import * as vscode from "vscode";
import Converter from "./converterplus";
import { getConverterOptions, getTokenSetup } from "./config";
import {
  EvernoteClient,
  EvernoteNotebook,
  EvernoteUser
} from "./everapi";
import { NoteMetadata, sanitizeValue } from "./metadata";

/**
 * Recreatable session state: the API client, the converter and the account
 * lookups, all built lazily from the current configuration.
 *
 * `resetState()` is wired to `onDidChangeConfiguration`, which is what lets a
 * token entered in the settings UI take effect without a window reload.
 */

let client: EvernoteClient | undefined;
let converter: Converter | undefined;
let user: EvernoteUser | undefined;
let notebooks: EvernoteNotebook[] | undefined;
const tagCache: { [guid: string]: string } = {};

export function resetState(): void {
  client = undefined;
  converter = undefined;
  user = undefined;
  notebooks = undefined;
  for (const guid of Object.keys(tagCache)) {
    delete tagCache[guid];
  }
}

export function getConverter(): Converter {
  if (!converter) {
    converter = new Converter(getConverterOptions());
  }
  return converter;
}

/**
 * The client, or undefined when no token is configured. Callers that need to
 * act on the user's behalf should use `requireClient`.
 */
export async function getClient(context: vscode.ExtensionContext): Promise<EvernoteClient | undefined> {
  if (!client) {
    const setup = await getTokenSetup(context);
    if (!setup) {
      return undefined;
    }
    client = new EvernoteClient(setup);
  }
  return client;
}

const CONFIGURE_ACTION = "Configure token";

/** Same as `getClient`, but nudges the user to configure a token when missing. */
export async function requireClient(context: vscode.ExtensionContext): Promise<EvernoteClient | undefined> {
  const existing = await getClient(context);
  if (existing) {
    return existing;
  }
  const choice = await vscode.window.showWarningMessage(
    "No Evernote token is configured yet.",
    CONFIGURE_ACTION
  );
  if (choice === CONFIGURE_ACTION) {
    await vscode.commands.executeCommand("extension.configureToken");
  }
  return undefined;
}

export async function getUser(context: vscode.ExtensionContext): Promise<EvernoteUser | undefined> {
  const activeClient = await getClient(context);
  if (!activeClient) {
    return undefined;
  }
  if (!user) {
    user = await activeClient.getUser();
  }
  return user;
}

export async function listNotebooks(context: vscode.ExtensionContext): Promise<EvernoteNotebook[]> {
  const activeClient = await getClient(context);
  if (!activeClient) {
    return [];
  }
  if (!notebooks) {
    notebooks = await activeClient.listNotebooks();
  }
  return notebooks;
}

export async function ensureTags(context: vscode.ExtensionContext): Promise<void> {
  const activeClient = await getClient(context);
  if (!activeClient) {
    return;
  }
  const tags = await activeClient.listTags();
  for (const tag of tags) {
    tagCache[tag.guid] = tag.name;
  }
}

export function getTagName(guid: string): string | undefined {
  return tagCache[guid];
}

/** Known tag names, for the header completion provider. */
export function listTagNames(): string[] {
  return Object.keys(tagCache).map(guid => tagCache[guid]);
}

export async function getNotebookName(
  context: vscode.ExtensionContext,
  guid: string
): Promise<string | undefined> {
  const known = await listNotebooks(context);
  const match = known.find(notebook => notebook.guid === guid);
  return match ? match.name : undefined;
}

/** Resolves tag guids to names, fetching any that are not cached yet. */
export async function loadTagNames(context: vscode.ExtensionContext, guids: string[]): Promise<string[]> {
  if (!guids || guids.length === 0) {
    return [];
  }
  if (guids.some(guid => guid && !tagCache[guid])) {
    await ensureTags(context);
  }
  return guids.filter(guid => !!guid).map(guid => tagCache[guid] || guid);
}

/**
 * Picks the notebook a note belongs in.
 *
 * A `notebookGuid` recorded in the front matter wins, which is what stops a
 * notebook rename on the server from silently producing a duplicate notebook
 * on the next push.
 */
export async function resolveNotebookGuid(
  context: vscode.ExtensionContext,
  meta: NoteMetadata
): Promise<string | undefined> {
  const activeClient = await getClient(context);
  if (!activeClient) {
    return undefined;
  }
  const known = await listNotebooks(context);

  if (meta.notebookGuid) {
    const existing = await activeClient.findNotebook(meta.notebookGuid);
    if (existing) {
      meta.notebook = existing.name;
      return existing.guid;
    }
    // The notebook was deleted server side; fall through to name resolution.
    meta.notebookGuid = undefined;
  }

  const wanted = sanitizeValue(meta.notebook || "");
  if (wanted) {
    const match = known.find(notebook => notebook.name === wanted);
    if (match) {
      return match.guid;
    }
    const CREATE_ACTION = "Create notebook";
    const choice = await vscode.window.showWarningMessage(
      `Notebook "${wanted}" does not exist in your account.`,
      { modal: true },
      CREATE_ACTION
    );
    if (choice !== CREATE_ACTION) {
      return undefined;
    }
    const created = await activeClient.createNotebook(wanted);
    known.push(created);
    return created.guid;
  }

  // No notebook named: use the account's default notebook, falling back to
  // whatever the account has. `getDefaultNotebook` can return null for an
  // account that never picked one.
  const defaultNotebook = await activeClient.getDefaultNotebook();
  if (defaultNotebook && defaultNotebook.guid) {
    if (!known.some(notebook => notebook.guid === defaultNotebook.guid)) {
      known.push(defaultNotebook);
    }
    return defaultNotebook.guid;
  }
  if (known.length > 0) {
    return known[0].guid;
  }
  return undefined;
}