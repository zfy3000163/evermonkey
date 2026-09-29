import * as assert from "assert";
import Converter from "../../src/converterplus";

const MAGIC = "%EVERMONKEY%";

function decodeMagic(enml: string): string | undefined {
  const begin = enml.indexOf("<!--" + MAGIC);
  if (begin < 0) {
    return undefined;
  }
  const from = begin + ("<!--" + MAGIC).length;
  const to = enml.indexOf(MAGIC + "-->", from);
  return Buffer.from(enml.substring(from, to), "base64").toString("utf-8");
}

const CORPUS: { [name: string]: string } = {
  "headings and prose": "# Title\n\nSome *emphasis* and a [link](https://example.com).\n",
  "fenced code": "```js\nconst a = 1;\nif (a) { console.log(a); }\n```\n",
  "table": "| a | b |\n| - | - |\n| 1 | 2 |\n",
  "todo items": "- [ ] buy milk\n- [x] call mom\n",
  "notation": "H~2~O and E = mc^2^ and :smile:\n",
  "inline code": "Use `npm install` first.\n",
  "blockquote and list": "> quoted\n\n1. one\n2. two\n",
  "leading indented code": "    indented code block\n    second line\n",
  "unicode": "# 印象笔记\n\n中文内容，含 emoji 🎉\n"
};

describe("Converter", () => {
  const converter = new Converter({ highlightTheme: "github", markdownTheme: "github.css" });

  it("wraps the output in an ENML document", async () => {
    const enml = await converter.toEnml("hello\n");
    assert.ok(enml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(enml.indexOf("<en-note>") >= 0);
    assert.ok(enml.trimEnd().endsWith("</en-note>"));
  });

  it("embeds the exact markdown so the round trip is lossless", async () => {
    for (const name of Object.keys(CORPUS)) {
      const markdown = CORPUS[name];
      const enml = await converter.toEnml(markdown);
      assert.strictEqual(decodeMagic(enml), markdown, `magic payload mismatch for: ${name}`);
      assert.strictEqual(converter.toMd(enml), markdown, `round trip mismatch for: ${name}`);
    }
  });

  it("still renders when the theme files cannot be read", async () => {
    const unstyled = new Converter({ highlightTheme: "no-such-theme", markdownTheme: "no-such-theme.css" });
    const enml = await unstyled.toEnml("hello\n");
    // Degrades to unstyled output rather than failing the publish.
    assert.ok(enml.indexOf("<en-note>") >= 0);
    assert.strictEqual(unstyled.toMd(enml), "hello\n");
  });

  it("falls back to HTML conversion for notes written elsewhere", () => {
    const markdown = converter.toMd("<en-note><div>Hello from the client</div></en-note>");
    assert.ok(markdown.indexOf("Hello from the client") >= 0, `unexpected: ${markdown}`);
  });

  it("normalises en-todo elements for notes written elsewhere", () => {
    assert.strictEqual(converter.todoFix('<en-todo checked="true"/> done'), "[x]  done");
    assert.strictEqual(converter.todoFix("<en-todo/> pending"), "[ ]  pending");
    assert.strictEqual(converter.todoFix('<en-todo checked="false"/> open'), "[ ]  open");
  });

  it("returns an empty string for empty input", () => {
    assert.strictEqual(converter.toMd(""), "");
  });
});

describe("ENML empty elements", () => {
  const converter = new Converter({ highlightTheme: "github", markdownTheme: "github.css" });

  /** The service rejects a note whose en-media/en-todo is not empty. */
  const EMPTY_TAG = /<en-(?:media|todo)\b[^>]*?\/>/g;
  const PAIRED_TAG = /<en-(?:media|todo)\b[^>]*?>[\s\S]*?<\/en-(?:media|todo)>/g;

  async function paragraphOf(markdown: string): Promise<string> {
    const enml = await converter.toEnml(markdown);
    const start = enml.indexOf("<en-note>") + "<en-note>".length;
    const body = enml.substring(start, enml.indexOf("</en-note>")).replace(/<!--[\s\S]*?-->/, "");
    const match = /<p[^>]*>([\s\S]*?)<\/p>/.exec(body);
    return match ? match[1] : body;
  }

  it("emits a self-closing en-media without swallowing the text after it", async () => {
    const html = await paragraphOf('a <en-media type="image/png" hash="zz"/> b');
    assert.strictEqual(html.match(PAIRED_TAG), null, "en-media must not become a paired element");
    assert.deepStrictEqual(html.match(EMPTY_TAG), ['<en-media type="image/png" hash="zz"/>']);
    assert.ok(html.indexOf("a ") >= 0 && html.indexOf(" b") >= 0, `surrounding text lost: ${html}`);
  });

  it("accepts the paired form too", async () => {
    const html = await paragraphOf('a <en-media type="image/png" hash="zz"></en-media> b');
    assert.deepStrictEqual(html.match(EMPTY_TAG), ['<en-media type="image/png" hash="zz"/>']);
    assert.ok(html.indexOf(" b") >= 0, `surrounding text lost: ${html}`);
  });

  it("emits self-closing en-todo for a hand-written tag", async () => {
    const html = await paragraphOf('x <en-todo checked="true"/> y');
    assert.strictEqual(html.match(PAIRED_TAG), null, "en-todo must not become a paired element");
    assert.deepStrictEqual(html.match(EMPTY_TAG), ['<en-todo checked="true"/>']);
    assert.ok(html.indexOf(" y") >= 0, `surrounding text lost: ${html}`);
  });

  it("keeps the inliner's style attribute off ENML elements", async () => {
    const html = await paragraphOf('a <en-media type="image/png" hash="zz"/> b\n\n- [ ] task');
    assert.strictEqual(/<en-(?:media|todo)[^>]*\sstyle=/.test(html), false,
      `style leaked onto an ENML element: ${html}`);
  });

  it("still round-trips the original markdown", async () => {
    for (const markdown of [
      'a <en-media type="image/png" hash="zz"/> b',
      'x <en-todo checked="true"/> y',
      'a <en-media type="image/png" hash="zz"></en-media> b'
    ]) {
      assert.strictEqual(converter.toMd(await converter.toEnml(markdown)), markdown);
    }
  });
});