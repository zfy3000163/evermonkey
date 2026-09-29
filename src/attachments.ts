import * as vscode from "vscode";

export interface AttachmentData {
  body: Buffer;
  size: number;
  bodyHash: Buffer;
}

export interface Attachment {
  mime: string;
  data: AttachmentData;
  attributes: {
    fileName: string;
    attachment: boolean;
    timestamp: number;
  };
  /** Only present on attachments that came back from the server. */
  guid?: string;
}

export interface LocalAttachment {
  /** Absolute path the attachment was read from, for local ones. */
  sourcePath?: string;
  attachment: Attachment;
}

/**
 * Attachments staged for the current session, keyed by document uri.
 *
 * These are files the user added with `Ever attach` that have not been uploaded
 * yet; publishing merges them into the note's resources.
 */
const cache = new Map<string, LocalAttachment[]>();

function key(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

export function init(doc: vscode.TextDocument): void {
  if (!cache.has(key(doc))) {
    cache.set(key(doc), []);
  }
}

export function list(doc: vscode.TextDocument): LocalAttachment[] {
  return cache.get(key(doc)) || [];
}

export function add(doc: vscode.TextDocument, sourcePath: string, attachment: Attachment): void {
  init(doc);
  cache.get(key(doc)).push({ sourcePath, attachment });
}

export function remove(doc: vscode.TextDocument, fileName: string): boolean {
  const current = cache.get(key(doc));
  if (!current) {
    return false;
  }
  const index = current.findIndex(item => item.attachment.attributes.fileName === fileName);
  if (index < 0) {
    return false;
  }
  current.splice(index, 1);
  return true;
}

export function clear(doc: vscode.TextDocument): void {
  cache.set(key(doc), []);
}

export function forget(doc: vscode.TextDocument): void {
  cache.delete(key(doc));
}

/** The resource payloads to send with a create/update. */
export function resources(doc: vscode.TextDocument): Attachment[] {
  return list(doc).map(item => item.attachment);
}