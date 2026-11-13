// Offline publish preparation. Never creates or updates an Evernote note.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Converter = require('../out/src/converterplus').default;
const { parseFrontMatter } = require('../out/src/metadata');
const { MermaidRenderer, pngDimensions } = require('../out/src/mermaidRenderer');
const { prepareMermaidNote } = require('../out/src/mermaidPublication');

(async () => {
  const [documentPath, outputDirectory] = process.argv.slice(2);
  if (!documentPath || !outputDirectory) {
    throw new Error('Usage: node scripts/verifyMermaid.js document.md output-directory');
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const markdown = parseFrontMatter(fs.readFileSync(documentPath, 'utf8')).body;
  const converter = new Converter();
  const renderer = new MermaidRenderer({ cacheDirectory: path.join(outputDirectory, 'cache') });
  const start = Date.now();
  const prepared = await prepareMermaidNote(converter, markdown, source => renderer.render(source),
    line => console.log(`Rendering block at body line ${line}`));
  assert.strictEqual(converter.toMd(prepared.content), markdown);
  const figures = prepared.resources.map((resource, index) => {
    const output = `diagram_${String(index + 1).padStart(2, '0')}.png`;
    fs.writeFileSync(path.join(outputDirectory, output), resource.data.body);
    const hash = resource.data.bodyHash.toString('hex');
    assert.ok(prepared.content.includes(`hash="${hash}"`));
    assert.strictEqual(resource.mime, 'image/png');
    assert.strictEqual(resource.attributes.attachment, false);
    return { output, hash, fileName: resource.attributes.fileName, bytes: resource.data.size,
      ...pngDimensions(resource.data.body) };
  });
  fs.writeFileSync(path.join(outputDirectory, 'converted.enml'), prepared.content);
  const report = { documentPath, elapsedMs: Date.now() - start, exactMarkdownRoundTrip: true,
    resourceCount: figures.length, inlineImageCount: (prepared.content.match(/<en-media\b/g) || []).length,
    figures };
  fs.writeFileSync(path.join(outputDirectory, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
