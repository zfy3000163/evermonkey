import Converter from "./converterplus";
import type { Attachment } from "./attachments";

/** Shares the same resource shape and MD5 reference used by Ever attach. */
export async function prepareMermaidNote(
  converter: Converter,
  markdown: string,
  render: (source: string) => Promise<Attachment>,
  progress: (line: number) => void = () => {}
): Promise<{ content: string; resources: Attachment[] }> {
  const resources: Attachment[] = [];
  const seen = new Set<string>();
  const content = await converter.toEnml(markdown, {
    renderMermaid: async (source, line) => {
      progress(line);
      try {
        const resource = await render(source);
        const hash = resource.data.bodyHash.toString("hex");
        if (!seen.has(hash)) { resources.push(resource); seen.add(hash); }
        return `<en-media type="image/png" hash="${hash}"></en-media>`;
      } catch (error) {
        throw new Error(`Mermaid block at body line ${line}: ${error.message || error}`);
      }
    }
  });
  return { content, resources };
}
