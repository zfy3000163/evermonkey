import { MERMAID_RESOURCE_PREFIX } from "./mermaidRenderer";

export function isGeneratedDiagram(resource: any): boolean {
  return /^evermonkey-mermaid-v1-[a-f0-9]{64}\.png$/.test(resource.attributes?.fileName || "") &&
    resource.attributes.fileName.startsWith(MERMAID_RESOURCE_PREFIX);
}

function bodyHash(resource: any): string | undefined {
  const hash = resource.data?.bodyHash;
  return hash ? Buffer.from(hash).toString("hex") : undefined;
}

/** Keep manual resources, remove obsolete generated PNGs, deduplicate by ENML hash. */
export function mergeNoteResources(server: any[], local: any[], content: string): any[] {
  const referenced = new Set<string>();
  const media = /<en-media\b[^>]*\bhash="([a-f0-9]{32})"/gi;
  let match: RegExpExecArray;
  while ((match = media.exec(content))) { referenced.add(match[1].toLowerCase()); }
  const seen = new Set<string>();
  return server.concat(local).filter(resource => {
    const hash = bodyHash(resource);
    if (isGeneratedDiagram(resource) && (!hash || !referenced.has(hash))) { return false; }
    if (hash && seen.has(hash)) { return false; }
    if (hash) { seen.add(hash); }
    return true;
  });
}

/** Fetch full bodies only when the resource list must be replaced. */
export async function resourcesForUpdate(
  existing: { resources?: any[] }, local: any[], content: string,
  loadResources: () => Promise<{ resources?: any[] }>
): Promise<any[] | undefined> {
  const previous = existing.resources || [];
  if (local.length === 0 && !previous.some(isGeneratedDiagram)) { return undefined; }
  if (previous.length === 0) { return mergeNoteResources([], local, content); }
  const full = await loadResources();
  return mergeNoteResources(full.resources || [], local, content);
}
