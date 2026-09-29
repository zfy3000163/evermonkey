/**
 * Live end-to-end check against a real Evernote / 印象笔记 account.
 *
 *   npm run test:live
 *
 * Credentials are read from the environment, falling back to ~/.evernote/.env
 * (the layout the evernote_connector.py helper already uses). Nothing is
 * hard-coded, and the NoteStore URL is left to be auto-discovered so that path
 * is covered too.
 *
 * Creates notes titled `__evermonkey_selftest__` and permanently deletes them
 * afterwards, including when a check fails. It does not touch anything else.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const Evernote = require(path.join(ROOT, "node_modules/evernote"));
const { EvernoteClient } = require(path.join(ROOT, "out/src/everapi.js"));
const Converter = require(path.join(ROOT, "out/src/converterplus.js")).default;
const { parseFrontMatter, serializeFrontMatter } = require(path.join(ROOT, "out/src/metadata.js"));

const TITLE = "__evermonkey_selftest__";
const CONTENT_CLASS = "michalyao.vscode.evermonkey";

function loadEnvFile() {
  const file = path.join(os.homedir(), ".evernote", ".env");
  if (!fs.existsSync(file)) {
    return {};
  }
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const at = trimmed.indexOf("=");
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return values;
}

const fileEnv = loadEnvFile();
const TOKEN = process.env.EV_TOKEN || process.env.EVERNOTE_TOKEN || fileEnv.EVERNOTE_TOKEN;
const NOTE_STORE_URL = process.env.EV_URL || fileEnv.EVERNOTE_NOTESTORE_URL || "";

if (!TOKEN) {
  console.error(
    "No token found.\n" +
    "  Set EV_TOKEN, or put EVERNOTE_TOKEN=<your developer token> in\n" +
    "  " + path.join(os.homedir(), ".evernote", ".env")
  );
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? " -- " + detail : ""}`);
  }
}

function rawNoteStore() {
  return new Evernote.Client({ token: TOKEN, sandbox: false, china: true })
    .getNoteStore(NOTE_STORE_URL || undefined);
}

/** Permanently removes every note this script may have created. */
async function cleanup() {
  try {
    const store = rawNoteStore();
    const found = await store.findNotesMetadata({ words: `intitle:"${TITLE}"` }, 0, 50, { includeTitle: true });
    for (const note of (found.notes || [])) {
      if (note.title !== TITLE) continue;
      await store.deleteNote(note.guid);
      await store.expungeNote(note.guid);
      console.log(`  removed test note ${note.guid}`);
    }
  } catch (error) {
    console.log(`  cleanup warning: ${error.parameter || error.message}`);
  }
}

async function main() {
  const client = new EvernoteClient({ token: TOKEN, region: "china", contentClass: CONTENT_CLASS });

  console.log("\n== routing and identity ==");
  check("routes to app.yinxiang.com (the sandbox:false trap)",
    client.serviceHost === "app.yinxiang.com", client.serviceHost);

  const user = await client.getUser();
  console.log(`  account: ${user.username}  shard=${user.shardId}  id=${user.id}`);
  check("getUser returns a username", typeof user.username === "string" && user.username.length > 0);
  check("getUser returns a shardId", typeof user.shardId === "string" && user.shardId.length > 0);

  console.log("\n== account lookups (NoteStore URL auto-discovery) ==");
  const notebooks = await client.listNotebooks();
  console.log(`  notebooks: ${notebooks.map(n => n.name).join(", ") || "(none)"}`);
  check("listNotebooks works", Array.isArray(notebooks));
  const discovered = await new EvernoteClient({ token: TOKEN, region: "china" }).listNotebooks();
  check("UserStore-discovered NoteStore URL works", discovered.length === notebooks.length);
  check("listTags works", Array.isArray(await client.listTags()));

  const defaultNotebook = await client.getDefaultNotebook();
  const notebookGuid = (defaultNotebook && defaultNotebook.guid) || (notebooks[0] && notebooks[0].guid);
  check("resolved a notebook", !!notebookGuid);

  await cleanup();

  console.log("\n== publish flow, as the extension performs it ==");
  const converter = new Converter({ highlightTheme: "github", markdownTheme: "github.css" });
  const tmpFile = path.join(os.tmpdir(), "evermonkey-selftest.md");
  const body = "# Self test\n\nSome *markdown*:\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n\n中文内容 🎉\n";
  // CRLF on purpose: this is what broke the original parser.
  fs.writeFileSync(tmpFile, "---\r\ntitle: " + TITLE + "\r\ntags: evermonkey-selftest\r\nnotebook: \r\n---\r\n\r\n" + body.replace(/\n/g, "\r\n"), "utf8");

  function writeBack(text, guid, updated) {
    const parsed = parseFrontMatter(text);
    Object.assign(parsed.metadata, { guid, updated, notebookGuid });
    const header = serializeFrontMatter(parsed.metadata, "\r\n");
    const next = parsed.hasHeader ? header + text.slice(parsed.headerLength) : header + "\r\n" + text;
    fs.writeFileSync(tmpFile, next, "utf8");
    return next;
  }

  let text = fs.readFileSync(tmpFile, "utf8");
  let parsed = parseFrontMatter(text);
  check("CRLF header parsed", parsed.metadata.title === TITLE, JSON.stringify(parsed.metadata));
  check("body survived the CRLF header", parsed.body.indexOf("# Self test") === 0);

  const created = await client.createNote({
    title: TITLE, notebookGuid,
    content: await converter.toEnml(parsed.body),
    tagNames: parsed.metadata.tags
  });
  console.log(`  created guid=${created.guid}`);
  check("createNote returned a guid", !!created.guid);
  check("contentClass applied", !!created.attributes && created.attributes.contentClass === CONTENT_CLASS);

  text = writeBack(text, created.guid, String(created.updated));
  parsed = parseFrontMatter(text);
  check("guid written back to the file", parsed.metadata.guid === created.guid);
  check("updated written back to the file", parsed.metadata.updated === String(created.updated));
  check("body unchanged by the write-back", parsed.body.indexOf("# Self test") === 0);
  check("no lone LF introduced", text.replace(/\r\n/g, "").indexOf("\n") === -1);

  const fetched = await client.getNoteContent(created.guid);
  check("server returns our ENML", fetched.content.indexOf("<en-note>") >= 0);
  check("markdown round-trips out of the server copy", converter.toMd(fetched.content) === parsed.body);

  console.log("\n== second publish must update, not duplicate ==");
  const meta = await client.findNoteByGuid(parsed.metadata.guid);
  check("findNoteByGuid returns metadata without content", !!meta && !meta.content);
  check("stored updated matches the file", String(meta.updated) === parsed.metadata.updated);

  await new Promise(r => setTimeout(r, 1100)); // `updated` is server time; leave a gap
  const updated = await client.updateNote({
    guid: meta.guid, title: TITLE, notebookGuid,
    content: await converter.toEnml(parsed.body + "\nAppended on the second publish.\n"),
    tagNames: parsed.metadata.tags
  });
  check("updateNote keeps the same guid", updated.guid === created.guid);
  check("updateNote advanced `updated`", updated.updated > created.updated);
  text = writeBack(text, updated.guid, String(updated.updated));
  parsed = parseFrontMatter(text);
  check("second publish edited in place",
    converter.toMd((await client.getNoteContent(updated.guid)).content).indexOf("Appended on the second publish.") >= 0);
  check("no duplicate created", (await client.findUniqueNoteByTitle(TITLE, notebookGuid)).guid === created.guid);

  console.log("\n== guard rails ==");
  const stale = await client.findNoteByGuid(parsed.metadata.guid);
  check("a stale `updated` triggers the overwrite prompt", stale.updated > Number(parsed.metadata.updated) - 60000);
  check("a fresh `updated` does not", !(stale.updated > Number(parsed.metadata.updated)));
  check("findNoteByGuid returns null for a missing note", (await client.findNoteByGuid("ffffffff-ffff-ffff-ffff-ffffffffffff")) === null);
  check("findUniqueNoteByTitle returns null when nothing matches", (await client.findUniqueNoteByTitle("__no_such_note__", notebookGuid)) === null);
  check("findUniqueNoteByTitle does not cross notebooks", (await client.findUniqueNoteByTitle(TITLE, "ffffffff-ffff-ffff-ffff-ffffffffffff")) === null);

  console.log("\n== attachments ==");
  const crypto = require("crypto");
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001" + "0d0a2db40000000049454e44ae426082", "hex");
  const png2 = Buffer.concat([png, Buffer.from("89504e47", "hex")]);
  const hashOf = b => crypto.createHash("md5").update(b).digest();
  const media = b => `<en-media type="image/png" hash="${hashOf(b).toString("hex")}"/>`;
  const attachmentOf = (b, name) => ({
    mime: "image/png",
    data: { body: b, size: b.length, bodyHash: hashOf(b) },
    attributes: { fileName: name, attachment: true, timestamp: Date.now() }
  });

  await client.updateNote({
    guid: created.guid, title: TITLE, notebookGuid,
    content: await converter.toEnml(parsed.body + "\n" + media(png) + "\n"),
    tagNames: parsed.metadata.tags,
    resources: [attachmentOf(png, "dot.png")]
  });
  const attached = await client.findNoteByGuid(created.guid);
  check("attachment is reported on the note", !!attached.resources && attached.resources.length === 1);

  await client.updateNote({
    guid: created.guid, title: TITLE, notebookGuid,
    content: await converter.toEnml(parsed.body),
    tagNames: parsed.metadata.tags
  });
  const afterOmit = await client.findNoteByGuid(created.guid);
  check("omitting `resources` preserves existing attachments",
    !!afterOmit.resources && afterOmit.resources.length === 1);

  const carried = await client.getNoteResources(created.guid);
  const carriedBody = carried.resources && carried.resources[0] && carried.resources[0].data && carried.resources[0].data.body;
  check("getNoteResources returns real bytes (not null bodies)",
    !!carriedBody && Buffer.from(carriedBody).length === png.length);

  await client.updateNote({
    guid: created.guid, title: TITLE, notebookGuid,
    content: await converter.toEnml(parsed.body + "\n" + media(png) + "\n" + media(png2) + "\n"),
    tagNames: parsed.metadata.tags,
    resources: [attachmentOf(png2, "dot2.png")].concat(carried.resources || [])
  });
  const merged = await client.findNoteByGuid(created.guid);
  check("merging local + server attachments keeps both",
    !!merged.resources && merged.resources.length === 2,
    JSON.stringify((merged.resources || []).map(r => r.attributes && r.attributes.fileName)));

  const mergedBytes = await client.getNoteResources(created.guid);
  const lengths = (mergedBytes.resources || [])
    .map(r => (r.data && r.data.body ? Buffer.from(r.data.body).length : 0)).sort((a, b) => a - b);
  check("both attachments have intact bytes",
    JSON.stringify(lengths) === JSON.stringify([png.length, png2.length].sort((a, b) => a - b)),
    JSON.stringify(lengths));

  console.log("\n== cleanup ==");
  await cleanup();
  fs.unlinkSync(tmpFile);
  check("test notes removed from the account", (await client.findNoteByGuid(created.guid)) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async error => {
  console.error("\nHARNESS ERROR:", error && (error.parameter || error.message || JSON.stringify(error)));
  try {
    await cleanup();
  } catch (e) {
    console.error("cleanup after failure also failed:", e && e.message);
  }
  process.exit(2);
});