import * as vscode from "vscode";
import { Region } from "./everapi";
import { ConverterOptions } from "./converterplus";

/**
 * Every accessor here reads the configuration on demand.
 *
 * The original code captured `vscode.workspace.getConfiguration("evermonkey")`
 * at module load, so a token entered through the settings UI was invisible
 * until VS Code was restarted.
 */

const TOKEN_SECRET_KEY = "evermonkey.token";
const CONTENT_CLASS = "michalyao.vscode.evermonkey";

export interface TokenSetup {
  token: string;
  region: Region;
  noteStoreUrl: string;
  contentClass?: string;
}

export function getConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("evermonkey");
}

export function inferRegionFromUrl(url: string): Region | undefined {
  if (!url) {
    return undefined;
  }
  if (url.indexOf("yinxiang") >= 0) {
    return "china";
  }
  if (url.indexOf("evernote.com") >= 0) {
    return "international";
  }
  return undefined;
}

export function getRegion(): Region {
  const configured = getConfiguration().get<string>("region");
  if (configured === "china" || configured === "international") {
    return configured;
  }
  // An account configured before `region` existed is still identifiable from
  // the NoteStore URL it was given.
  const inferred = inferRegionFromUrl(getNoteStoreUrl());
  return inferred || "china";
}

export function getNoteStoreUrl(): string {
  return (getConfiguration().get<string>("noteStoreUrl") || "").trim();
}

export function getContentClass(): string | undefined {
  return getConfiguration().get<boolean>("noteReadonly") ? CONTENT_CLASS : undefined;
}

export function getRecentNotesCount(): number {
  return getConfiguration().get<number>("recentNotesCount") || 10;
}

export function getMaxNoteCount(): number {
  return getConfiguration().get<number>("maxNoteCount") || 50;
}

export function getShowTips(): boolean {
  return getConfiguration().get<boolean>("showTips") !== false;
}

export function getAttachmentsFolder(): string {
  return getConfiguration().get<string>("attachmentsFolder") || "";
}

export function getUploadFolder(): string {
  return getConfiguration().get<string>("uploadFolder") || "";
}

export function getConverterOptions(): ConverterOptions {
  const config = getConfiguration();
  return {
    highlightTheme: config.get<string>("highlightTheme") || undefined,
    markdownTheme: config.get<string>("markdownTheme") || undefined,
    fontFamily: config.get<string[]>("fontFamily") || undefined,
    fontSize: config.get<string>("fontSize") || undefined,
    codeFontFamily: config.get<string[]>("codeFontFamily") || undefined,
    codeFontSize: config.get<string>("codeFontSize") || undefined
  };
}

/**
 * The developer token grants full account access, so it lives in the OS
 * keychain rather than in settings.json (which Settings Sync would replicate).
 *
 * A token left in `evermonkey.token` by an older version is migrated on first
 * read and then cleared.
 */
export async function getToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await context.secrets.get(TOKEN_SECRET_KEY);
  if (stored) {
    return stored;
  }
  const legacy = (getConfiguration().get<string>("token") || "").trim();
  if (legacy) {
    await context.secrets.store(TOKEN_SECRET_KEY, legacy);
    await getConfiguration().update("token", undefined, vscode.ConfigurationTarget.Global);
    return legacy;
  }
  return undefined;
}

export async function storeToken(context: vscode.ExtensionContext, token: string): Promise<void> {
  await context.secrets.store(TOKEN_SECRET_KEY, token);
}

export async function clearToken(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(TOKEN_SECRET_KEY);
}

/** Everything needed to construct an EvernoteClient, or undefined if unconfigured. */
export async function getTokenSetup(context: vscode.ExtensionContext): Promise<TokenSetup | undefined> {
  const token = await getToken(context);
  if (!token) {
    return undefined;
  }
  return {
    token,
    region: getRegion(),
    noteStoreUrl: getNoteStoreUrl(),
    contentClass: getContentClass()
  };
}