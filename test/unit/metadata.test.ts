import * as assert from "assert";
import {
  emptyMetadata,
  parseFrontMatter,
  resolveTitle,
  sanitizeValue,
  serializeFrontMatter
} from "../../src/metadata";

const LF = "\n";
const CRLF = "\r\n";

describe("parseFrontMatter", () => {
  it("reads a LF header", () => {
    const doc = parseFrontMatter("---\ntitle: My Note\ntags: a, b\nnotebook: Notes\n---\n\nbody\n");
    assert.strictEqual(doc.hasHeader, true);
    assert.strictEqual(doc.metadata.title, "My Note");
    assert.deepStrictEqual(doc.metadata.tags, ["a", "b"]);
    assert.strictEqual(doc.metadata.notebook, "Notes");
    assert.strictEqual(doc.body, "body\n");
  });

  it("reads a CRLF header", () => {
    // The original pattern hard-coded \n and silently failed on every Windows
    // file, turning the whole header into note body.
    const doc = parseFrontMatter("---\r\ntitle: My Note\r\ntags: a\r\nnotebook: Notes\r\n---\r\n\r\nbody\r\n");
    assert.strictEqual(doc.hasHeader, true);
    assert.strictEqual(doc.metadata.title, "My Note");
    assert.deepStrictEqual(doc.metadata.tags, ["a"]);
    assert.strictEqual(doc.metadata.notebook, "Notes");
    assert.strictEqual(doc.body, "body\r\n");
  });

  it("reports headerLength as an offset into the original text", () => {
    const text = "---\r\ntitle: T\r\n---\r\n\r\nbody";
    const doc = parseFrontMatter(text);
    assert.strictEqual(text.slice(doc.headerLength), "\r\nbody");
    assert.strictEqual(doc.headerLength, "---\r\ntitle: T\r\n---\r\n".length);
  });

  it("treats a document with no header as pure body", () => {
    const doc = parseFrontMatter("# Just a heading\n");
    assert.strictEqual(doc.hasHeader, false);
    assert.strictEqual(doc.headerLength, 0);
    assert.strictEqual(doc.body, "# Just a heading\n");
  });

  it("does not mistake a leading thematic break for a header", () => {
    const doc = parseFrontMatter("---\n\nsome prose\n");
    assert.strictEqual(doc.hasHeader, false);
    assert.strictEqual(doc.body, "---\n\nsome prose\n");
  });

  it("returns an empty tag list for an empty tags value, not a string", () => {
    const doc = parseFrontMatter("---\ntitle: T\ntags: \nnotebook: \n---\n\nbody");
    assert.deepStrictEqual(doc.metadata.tags, []);
  });

  it("keeps unknown keys in order", () => {
    const doc = parseFrontMatter("---\ntitle: T\nzeta: 1\nalpha: 2\n---\n\nbody");
    assert.deepStrictEqual(Object.keys(doc.metadata.extra), ["zeta", "alpha"]);
    assert.strictEqual(doc.metadata.extra.zeta, "1");
  });

  it("preserves the indentation of a body that starts with a code block", () => {
    // The old body extraction stripped all leading whitespace, so the markdown
    // embedded in the note differed from the file on disk.
    const doc = parseFrontMatter("---\ntitle: T\n---\n\n    indented code\n    more\n");
    assert.strictEqual(doc.body, "    indented code\n    more\n");
  });

  it("handles values containing colons and backslashes", () => {
    const doc = parseFrontMatter("---\ntitle: C:\\path\\note.md: a draft\n---\n\nbody");
    assert.strictEqual(doc.metadata.title, "C:\\path\\note.md: a draft");
  });

  it("reads the sync keys back", () => {
    const doc = parseFrontMatter("---\ntitle: T\nnotebookGuid: nb-1\nguid: note-1\nupdated: 1759123456789\n---\n\nbody");
    assert.strictEqual(doc.metadata.notebookGuid, "nb-1");
    assert.strictEqual(doc.metadata.guid, "note-1");
    assert.strictEqual(doc.metadata.updated, "1759123456789");
  });

  it("does not turn a missing title into the string 'undefined'", () => {
    const doc = parseFrontMatter("---\ntags: a\n---\n\nbody");
    assert.strictEqual(doc.metadata.title, undefined);
    assert.strictEqual(resolveTitle(doc.metadata, "from-file"), "from-file");
  });
});

describe("serializeFrontMatter", () => {
  it("emits canonical keys before extra ones", () => {
    const meta = emptyMetadata();
    meta.title = "T";
    meta.tags = ["a", "b"];
    meta.notebook = "Notes";
    meta.extra.custom = "x";
    const lines = serializeFrontMatter(meta, LF).split(LF);
    assert.deepStrictEqual(lines.slice(0, 6), ["---", "title: T", "tags: a,b", "notebook: Notes", "custom: x", "---"]);
  });

  it("omits the sync keys until they are known", () => {
    const header = serializeFrontMatter(emptyMetadata(), LF);
    assert.strictEqual(header.indexOf("guid"), -1);
    assert.strictEqual(header.indexOf("updated"), -1);
  });

  it("uses the document's own line ending", () => {
    const header = serializeFrontMatter(emptyMetadata(), CRLF);
    assert.ok(header.indexOf("\r\n") >= 0);
    assert.strictEqual(header.indexOf("\n\n"), -1);
  });

  it("neutralises a newline smuggled into a title", () => {
    const meta = emptyMetadata();
    meta.title = "line one\nline two";
    const header = serializeFrontMatter(meta, LF);
    assert.strictEqual(header.split(LF)[1], "title: line one line two");
    assert.strictEqual(parseFrontMatter(header + LF + "body").metadata.title, "line one line two");
  });

  it("round trips through parse", () => {
    const meta = emptyMetadata();
    meta.title = "T";
    meta.tags = ["a", "b"];
    meta.notebook = "Notes";
    meta.notebookGuid = "nb-1";
    meta.guid = "note-1";
    meta.updated = "1759123456789";
    meta.extra.mine = "keep me";

    const before = parseFrontMatter(serializeFrontMatter(meta, LF) + LF + "body\n");
    assert.deepStrictEqual(before.metadata, meta);
    // Fixed point: serialising the parsed result gives the same header.
    assert.strictEqual(serializeFrontMatter(before.metadata, LF), serializeFrontMatter(meta, LF));
  });

  it("is a fixed point across a re-serialisation of arbitrary input", () => {
    const original = "---\r\ntitle: T\r\ntags: a, b\r\nnotebook: N\r\nweird: value: with colon\r\n---\r\n\r\nbody\r\n";
    const first = parseFrontMatter(original);
    const rewritten = serializeFrontMatter(first.metadata, CRLF) + CRLF + first.body;
    const second = parseFrontMatter(rewritten);
    assert.deepStrictEqual(second.metadata, first.metadata);
    assert.strictEqual(second.body, first.body);
  });
});

describe("sanitizeValue", () => {
  it("collapses line breaks and trims", () => {
    assert.strictEqual(sanitizeValue("  a\r\nb  "), "a b");
  });

  it("stringifies null and undefined to an empty string", () => {
    assert.strictEqual(sanitizeValue(undefined as any), "");
    assert.strictEqual(sanitizeValue(null as any), "");
  });
});

describe("resolveTitle", () => {
  it("prefers the header title", () => {
    const meta = emptyMetadata();
    meta.title = "From header";
    assert.strictEqual(resolveTitle(meta, "from-file"), "From header");
  });

  it("falls back to the file name, then to nothing", () => {
    assert.strictEqual(resolveTitle(emptyMetadata(), "from-file"), "from-file");
    assert.strictEqual(resolveTitle(emptyMetadata()), undefined);
  });

  it("ignores a blank title", () => {
    const meta = emptyMetadata();
    meta.title = "   ";
    assert.strictEqual(resolveTitle(meta, "from-file"), "from-file");
  });
});

/**
 * Mirrors `noteSync.writeBack`, which replaces `[0, headerLength)` with the
 * serialised header and saves. Exercised here because it is the step that makes
 * a second publish update rather than duplicate, and it needs no account.
 */
describe("write-back", () => {
  function writeBack(text: string, eol: string, guid: string, updated: string): string {
    const parsed = parseFrontMatter(text);
    const meta = parsed.metadata;
    meta.guid = guid;
    meta.updated = updated;
    const header = serializeFrontMatter(meta, eol);
    return parsed.hasHeader ? header + text.slice(parsed.headerLength) : header + eol + text;
  }

  it("adds a header to a file that had none, keeping the body intact", () => {
    const original = "# Hello\n\nbody text\n";
    const parsed = parseFrontMatter(writeBack(original, LF, "note-1", "123"));
    assert.strictEqual(parsed.metadata.guid, "note-1");
    assert.strictEqual(parsed.body, original);
  });

  it("updates a CRLF file in place without touching the body", () => {
    const original = "---\r\ntitle: T\r\ntags: a\r\nnotebook: N\r\n---\r\n\r\n# Body\r\n\r\ntext\r\n";
    const result = writeBack(original, CRLF, "note-2", "456");
    const parsed = parseFrontMatter(result);
    assert.strictEqual(parsed.metadata.guid, "note-2");
    assert.strictEqual(parsed.metadata.updated, "456");
    assert.strictEqual(parsed.metadata.title, "T");
    assert.deepStrictEqual(parsed.metadata.tags, ["a"]);
    assert.strictEqual(parsed.metadata.notebook, "N");
    assert.strictEqual(parsed.body, "# Body\r\n\r\ntext\r\n");
    // The header must not introduce lone \n into a CRLF file.
    assert.strictEqual(result.replace(/\r\n/g, "").indexOf("\n"), -1);
  });

  it("is idempotent, so re-publishing the same content is a no-op", () => {
    const original = "---\r\ntitle: T\r\n---\r\n\r\nbody\r\n";
    const once = writeBack(original, CRLF, "note-3", "789");
    assert.strictEqual(writeBack(once, CRLF, "note-3", "789"), once);
  });

  it("keeps the user's own header keys", () => {
    const result = writeBack("---\ntitle: T\nmine: keep\n---\n\nbody\n", LF, "note-4", "1");
    assert.strictEqual(parseFrontMatter(result).metadata.extra.mine, "keep");
  });

  it("does not resurrect a guid the user deleted from the header", () => {
    // A file whose guid is removed should adopt/create again, not keep the old
    // one, so the round trip is driven by the file rather than by memory.
    const withGuid = writeBack("---\ntitle: T\n---\n\nbody\n", LF, "note-5", "1");
    const removed = withGuid.replace(/guid: note-5\n/, "");
    assert.strictEqual(parseFrontMatter(removed).metadata.guid, undefined);
  });
});