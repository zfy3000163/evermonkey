import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import Converter from "../../src/converterplus";
import { prepareMermaidNote } from "../../src/mermaidPublication";
import { findBrowser, MermaidRenderer, MERMAID_RESOURCE_PREFIX, pngDimensions } from "../../src/mermaidRenderer";
import { mergeNoteResources, resourcesForUpdate } from "../../src/noteResources";
import type { Attachment } from "../../src/attachments";

function attachment(body: Buffer, generated = true): Attachment {
  return { mime: "image/png", data: { body, size: body.length, bodyHash: createHash("md5").update(body).digest() },
    attributes: { fileName: generated ? MERMAID_RESOURCE_PREFIX + "a".repeat(64) + ".png" : "manual.png", attachment: false, timestamp: 0 } };
}

describe("Mermaid publication", () => {
  const converter = new Converter();
  it("renders real fences in quotes/lists and CRLF, preserves source, and leaves examples as code", async () => {
    const markdown = [
      "# Title", "", "> ```mermaid", "> flowchart TD", "> A --> B", "> ```", "",
      "- diagram", "", "  ~~~mermaid", "  sequenceDiagram", "  A->>B: hello", "  ~~~", "",
      "````markdown", "```mermaid", "flowchart TD", "C --> D", "```", "````", "",
      "Inline `mermaid` and ordinary code:", "```js", "const mermaid = true;", "```", ""
    ].join("\r\n");
    const sources: string[] = [];
    const result = await prepareMermaidNote(converter, markdown, async source => {
      sources.push(source); return attachment(Buffer.from(source));
    });
    assert.strictEqual(sources.length, 2);
    assert.ok(sources[0].startsWith("flowchart TD\nA --> B"));
    assert.ok(sources[1].startsWith("sequenceDiagram\nA->>B"));
    assert.strictEqual((result.content.match(/<en-media\b/g) || []).length, 2);
    assert.strictEqual(converter.toMd(result.content), markdown);
    assert.ok(!/<en-media\b[^>]*style=/.test(result.content));
    assert.ok(/<pre\b/.test(result.content), "ordinary code fences remain code");
    for (const resource of result.resources) {
      assert.ok(result.content.includes(`hash="${resource.data.bodyHash.toString("hex")}"`));
    }
  });

  it("deduplicates repeated diagram resources without dropping image occurrences", async () => {
    const markdown = "```mermaid\nflowchart TD\nA-->B\n```\n\n```mermaid\nflowchart TD\nA-->B\n```\n";
    const result = await prepareMermaidNote(converter, markdown, async source => attachment(Buffer.from(source)));
    assert.strictEqual(result.resources.length, 1);
    assert.strictEqual((result.content.match(/<en-media\b/g) || []).length, 2);
  });

  it("reports failed diagram location and leaves the source unchanged", async () => {
    const markdown = "Title\n\n```mermaid\ninvalid diagram\n```\n";
    await assert.rejects(prepareMermaidNote(converter, markdown, async () => { throw new Error("Syntax error"); }), /body line 3: Syntax error/);
    assert.strictEqual(markdown, "Title\n\n```mermaid\ninvalid diagram\n```\n");
  });

  it("needs no browser for documents without Mermaid fences", async () => {
    const result = await prepareMermaidNote(converter, "hello\n", async () => { throw new Error("must not be called"); });
    assert.deepStrictEqual(result.resources, []);
    assert.strictEqual(converter.toMd(result.content), "hello\n");
  });
});

describe("Mermaid attachment merging", () => {
  it("preserves manual/server resources, prunes obsolete generated images, and prefers existing GUIDs", () => {
    const oldDiagram = attachment(Buffer.from("old diagram"));
    const newDiagram = attachment(Buffer.from("new diagram"));
    const manual = attachment(Buffer.from("manual"), false);
    const remote = { ...newDiagram, guid: "already-uploaded" };
    const content = `<en-note><en-media hash="${newDiagram.data.bodyHash.toString("hex")}" type="image/png"/></en-note>`;
    assert.deepStrictEqual(mergeNoteResources([oldDiagram, manual, remote], [newDiagram, manual], content), [manual, remote]);
  });
  it("removes the last generated resource while retaining any manual attachments", () => {
    const oldDiagram = attachment(Buffer.from("old diagram"));
    const manual = attachment(Buffer.from("manual"), false);
    assert.deepStrictEqual(mergeNoteResources([oldDiagram], [], "<en-note>no diagram</en-note>"), []);
    assert.deepStrictEqual(mergeNoteResources([oldDiagram, manual], [], "<en-note>no diagram</en-note>"), [manual]);
  });
  it("omits resources for ordinary updates and loads full server bodies when merging new images", async () => {
    const manual = attachment(Buffer.from("manual"), false);
    const diagram = attachment(Buffer.from("new diagram"));
    const existing = { resources: [{ guid: "manual-guid", attributes: manual.attributes }] };
    let loads = 0;
    const load = async () => { loads++; return { resources: [manual] }; };
    assert.strictEqual(await resourcesForUpdate(existing, [], "<en-note/>", load), undefined);
    assert.strictEqual(loads, 0);
    const content = `<en-media hash="${diagram.data.bodyHash.toString("hex")}" type="image/png"/>`;
    assert.deepStrictEqual(await resourcesForUpdate(existing, [diagram], content, load), [manual, diagram]);
    assert.strictEqual(loads, 1);
  });
  it("sends an empty resource list only when the last managed PNG is removed", async () => {
    const diagram = attachment(Buffer.from("old diagram"));
    assert.deepStrictEqual(await resourcesForUpdate({ resources: [{ attributes: diagram.attributes }] }, [],
      "<en-note/>", async () => ({ resources: [diagram] })), []);
  });
});

describe("Offline Mermaid browser rendering", function () {
  this.timeout(150000);
  let cacheDirectory: string;
  let renderer: MermaidRenderer;
  before(async function () {
    try { await findBrowser(); } catch (_) { this.skip(); }
    cacheDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evermonkey-mermaid-test-"));
    renderer = new MermaidRenderer({ cacheDirectory });
  });
  after(async () => {
    if (cacheDirectory) { await fs.promises.rm(cacheDirectory, { recursive: true, force: true }); }
  });

  it("renders the real Chinese dispatch chart to PNG and uploads it as inline ENML", async () => {
    const source = await fs.promises.readFile(path.join(__dirname, "../../../test/fixtures/mermaid/dispatch.mmd"), "utf8");
    const markdown = "```mermaid\n" + source.trimEnd() + "\n```\n";
    const result = await prepareMermaidNote(new Converter(), markdown, source => renderer.render(source));
    assert.strictEqual(result.resources.length, 1);
    const resource = result.resources[0];
    const dimensions = pngDimensions(resource.data.body);
    assert.ok(dimensions.width > 1000 && dimensions.height > 2000);
    assert.ok(resource.data.size > 50000);
    assert.strictEqual(resource.mime, "image/png");
    assert.strictEqual(resource.attributes.attachment, false);
    assert.strictEqual(new Converter().toMd(result.content), markdown);
    assert.strictEqual((result.content.match(/<en-media\b/g) || []).length, 1);
    assert.ok(!/<pre\b/.test(result.content));
  });

  it("renders sequenceDiagram and reuses the cached PNG even when the browser is unavailable", async () => {
    const source = "sequenceDiagram\nparticipant A as 源卡\nparticipant B as 目标卡\nA->>B: dispatch 数据\nB-->>A: 完成\n";
    const first = await renderer.render(source);
    assert.ok(pngDimensions(first.data.body).width > 400);
    const cached = new MermaidRenderer({ cacheDirectory, browserPath: path.join(cacheDirectory, "missing-browser") });
    const second = await cached.render(source);
    assert.ok(second.data.body.equals(first.data.body));
  });

  it("rejects invalid Mermaid syntax instead of publishing a broken image", async () => {
    await assert.rejects(renderer.render("flowchart TD\nA[unterminated"), /Parse error|Syntax error/);
  });

  it("reports an actionable error for a configured missing browser", async () => {
    await assert.rejects(findBrowser(path.join(cacheDirectory, "missing-browser")), /evermonkey.mermaid.browserPath/);
  });
});
