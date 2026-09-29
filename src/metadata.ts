/**
 * Front matter handling for the `---...---` header evermonkey writes at the
 * top of a note file.
 *
 * This module deliberately imports nothing from `vscode`: it is pure string
 * manipulation, so it can be unit tested in plain node.
 */

export interface NoteMetadata {
  title?: string;
  tags: string[];
  notebook?: string;
  /** Remote notebook guid. Lets a renamed notebook still resolve. */
  notebookGuid?: string;
  /** Remote note guid. The stable local file <-> remote note mapping. */
  guid?: string;
  /** Server `Note.updated` (epoch ms) as of the last successful push. */
  updated?: string;
  /** Any other key the user put in the header, preserved verbatim and in order. */
  extra: Record<string, string>;
}

export interface ParsedDocument {
  metadata: NoteMetadata;
  /** The markdown body, with the header and its single separator blank line removed. */
  body: string;
  /** UTF-16 offset just past the header's closing `---` and its EOL. 0 when absent. */
  headerLength: number;
  hasHeader: boolean;
}

/**
 * The header pattern is line-ending tolerant. It must match `\r?\n` rather than
 * normalising the input first: `headerLength` is used as a UTF-16 offset via
 * `TextDocument.positionAt`, so it has to be measured against the original text.
 */
const FRONT_MATTER_PATTERN =
  /^---[ \t]*\r?\n((?:[ \t]*[^ \t:\r\n]+[ \t]*:[^\r\n]*\r?\n)+)---[ \t]*\r?\n/;

/** Keys written in this order, ahead of anything the user added. */
export const CANONICAL_KEYS = ["title", "tags", "notebook", "notebookGuid", "guid", "updated"];

const CANONICAL = new Set(CANONICAL_KEYS);

/**
 * Header values are single-line by construction, so collapse any line break a
 * caller managed to smuggle in (a title pasted with a newline, say) rather than
 * letting it corrupt the header on the next write-back.
 */
export function sanitizeValue(value: string): string {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();
}

export function emptyMetadata(): NoteMetadata {
  return { tags: [], extra: {} };
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
}

export function parseFrontMatter(text: string): ParsedDocument {
  const absent: ParsedDocument = {
    metadata: emptyMetadata(),
    body: text,
    headerLength: 0,
    hasHeader: false
  };

  if (!text.startsWith("---")) {
    return absent;
  }
  const match = FRONT_MATTER_PATTERN.exec(text);
  if (!match) {
    // A leading `---` that is not a well formed header (a thematic break, most
    // likely) is body text, not metadata.
    return absent;
  }

  const metadata = emptyMetadata();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const key = line.substring(0, separator).trim();
    const value = sanitizeValue(line.substring(separator + 1));
    if (key.length === 0) {
      continue;
    }
    switch (key) {
      case "tags":
        metadata.tags = splitTags(value);
        break;
      case "title":
      case "notebook":
      case "notebookGuid":
      case "guid":
      case "updated":
        if (value.length > 0) {
          metadata[key] = value;
        }
        break;
      default:
        metadata.extra[key] = value;
        break;
    }
  }

  const headerLength = match[0].length;
  return {
    metadata,
    // Strip at most one separator blank line. Stripping *all* leading
    // whitespace (as the original code did) silently ate the indentation of a
    // body that starts with an indented code block.
    body: text.slice(headerLength).replace(/^[ \t]*\r?\n/, ""),
    headerLength,
    hasHeader: true
  };
}

/**
 * Renders the header. The result ends with the closing `---` and its EOL, so
 * replacing `[0, headerLength)` with it leaves whatever followed the original
 * header -- including its separator blank line -- untouched.
 */
export function serializeFrontMatter(meta: NoteMetadata, eol: string): string {
  const lines: string[] = [];
  const push = (key: string, value: string) => lines.push(`${key}: ${sanitizeValue(value)}`);

  push("title", meta.title || "");
  push("tags", meta.tags ? meta.tags.join(",") : "");
  push("notebook", meta.notebook || "");
  if (meta.notebookGuid) {
    push("notebookGuid", meta.notebookGuid);
  }
  if (meta.guid) {
    push("guid", meta.guid);
  }
  if (meta.updated) {
    push("updated", meta.updated);
  }
  for (const key of Object.keys(meta.extra || {})) {
    if (!CANONICAL.has(key)) {
      push(key, meta.extra[key]);
    }
  }
  return `---${eol}${lines.join(eol)}${eol}---${eol}`;
}

/**
 * A note needs a title. Prefer the header, fall back to the file name, and let
 * the caller prompt if neither exists -- the original code let a missing title
 * become the literal string "undefined".
 */
export function resolveTitle(meta: NoteMetadata, fileBaseName?: string): string | undefined {
  if (meta.title && meta.title.trim().length > 0) {
    return meta.title.trim();
  }
  if (fileBaseName && fileBaseName.trim().length > 0) {
    return fileBaseName.trim();
  }
  return undefined;
}