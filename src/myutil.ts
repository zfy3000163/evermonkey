import * as crypto from "crypto";
import * as fs from "fs";
import * as mime from "mime";

// md5 hash
export function hash(data) {
  const md5 = crypto.createHash("md5");
  md5.update(data);
  return md5.digest();
}

// guess mime type by filename, if not detected, use as text.
export function guessMime(filename: string): string {
  return mime.lookup(filename) || "text/plain";
}

export function exists(target: string): Promise<boolean> {
  return fs.promises.access(target, fs.constants.F_OK).then(() => true, () => false);
}

export function readFile(file: string): Promise<Buffer> {
  return fs.promises.readFile(file);
}

export function writeFile(file: string, data: any): Promise<void> {
  return fs.promises.writeFile(file, data);
}

export function makeDir(dir: string): Promise<string | undefined> {
  return fs.promises.mkdir(dir, { recursive: true });
}

export function makeTempDir(prefix: string): Promise<string> {
  return fs.promises.mkdtemp(prefix);
}

/**
 * Web URL for a note. The account's own `shardId` and `id` come from the
 * UserStore, so no more guessing them out of the token string.
 */
export function webNoteUrl(host: string, shardId: string, userId: number, noteGuid: string): string {
  return `${host}/shard/${shardId}/nl/${userId}/${noteGuid}/`;
}

/** `evernote:///` deep link that opens the note in the desktop client. */
export function clientNoteUrl(shardId: string, userId: number, noteGuid: string): string {
  return `evernote:///view/${userId}/${shardId}/${noteGuid}/${noteGuid}/`;
}

/**
 * EDAM error codes worth naming. Without this the user sees "Evernote error 9:
 * authenticationToken", which says nothing about what to do.
 */
const EDAM_ERROR_NAMES: { [code: number]: string } = {
  2: "BAD_DATA_FORMAT",
  3: "PERMISSION_DENIED",
  5: "DATA_REQUIRED",
  6: "LIMIT_REACHED",
  7: "QUOTA_REACHED",
  8: "INVALID_AUTH",
  9: "AUTH_EXPIRED",
  10: "DATA_CONFLICT",
  11: "ENML_VALIDATION",
  12: "SHARD_UNAVAILABLE",
  17: "UNSUPPORTED_OPERATION",
  18: "TAKEN_DOWN",
  19: "RATE_LIMIT_REACHED",
  20: "BUSINESS_SECURITY_LOGIN_REQUIRED",
  21: "DEVICE_LIMIT_REACHED"
};

/**
 * The token was rejected: regenerated in the developer page, revoked, or issued
 * for a different service than the configured region.
 */
export function isAuthError(error: any): boolean {
  if (!error) {
    return false;
  }
  if (error.errorCode === 8 || error.errorCode === 9) {
    return true;
  }
  return error.statusCode === 401 || error.statusCode === 403;
}

export function isRateLimitError(error: any): boolean {
  return !!error && error.errorCode === 19;
}

/**
 * Turns a thrift exception into something a user can act on.
 *
 * `EDAMUserException` carries `errorCode`/`parameter`; `EDAMNotFoundException`
 * carries `identifier`/`key` and no numeric code at all.
 */
export function describeEvernoteError(error: any): string {
  if (!error) {
    return "Unknown error";
  }
  if (error.statusCode && error.statusMessage) {
    return `HTTP ${error.statusCode}: ${error.statusMessage}`;
  }
  if (error.errorCode !== undefined && error.errorCode !== null) {
    const name = EDAM_ERROR_NAMES[error.errorCode] || `code ${error.errorCode}`;
    return error.parameter ? `Evernote ${name} (${error.parameter})` : `Evernote ${name}`;
  }
  if (error.identifier) {
    return `Evernote: ${error.identifier}${error.key ? ` (${error.key})` : ""}`;
  }
  if (error.message) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch (err) {
    return String(error);
  }
}