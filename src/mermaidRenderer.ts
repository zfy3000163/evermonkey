import { execFile } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import type { Attachment } from "./attachments";

// This prefix identifies only resources managed by this renderer.
export const MERMAID_RESOURCE_PREFIX = "evermonkey-mermaid-v1-";
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

export function pngDimensions(body: Buffer): { width: number; height: number } {
  if (body.length < 33 || !body.subarray(0, 8).equals(PNG_SIGNATURE) || body.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Mermaid renderer returned an invalid PNG.");
  }
  const width = body.readUInt32BE(16), height = body.readUInt32BE(20);
  if (!width || !height || width > 16384 || height > 16384) {
    throw new Error("Mermaid PNG dimensions exceed the supported limit (16384 pixels).");
  }
  return { width, height };
}

export async function findBrowser(configured?: string): Promise<string> {
  const candidates = configured ? [configured] : process.platform === "win32" ? [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.LOCALAPPDATA || os.homedir(), "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.LOCALAPPDATA || os.homedir(), "Google/Chrome/Application/chrome.exe")
  ] : process.platform === "darwin" ? [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ] : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try { await fs.promises.access(candidate, fs.constants.X_OK); return candidate; } catch (_) {}
  }
  throw new Error("Mermaid PNG rendering needs Microsoft Edge or Chrome. Install one, or set evermonkey.mermaid.browserPath to its executable.");
}

export interface MermaidRendererOptions {
  cacheDirectory: string;
  browserPath?: string;
}

/** Offline renderer: bundled Mermaid, isolated headless browser, no shell or CDN. */
export class MermaidRenderer {
  private pending = new Map<string, Promise<Attachment>>();
  private bundle: Promise<string>;
  constructor(private options: MermaidRendererOptions) {
    this.bundle = fs.promises.readFile(path.join(__dirname, "../../resources/mermaid/mermaid.min.js"), "utf8");
    // Lazy consumer below still receives any error, without an unhandled rejection.
    this.bundle.catch(() => {});
  }

  async render(source: string): Promise<Attachment> {
    const bundle = await this.bundle;
    const digest = createHash("sha256").update("png-v1-scale2-white-yahei\0").update(bundle).update(source).digest("hex");
    let result = this.pending.get(digest);
    if (!result) {
      result = this.renderCached(source, bundle, digest);
      this.pending.set(digest, result);
      result.finally(() => this.pending.delete(digest)).catch(() => {});
    }
    return result;
  }

  private async renderCached(source: string, bundle: string, digest: string): Promise<Attachment> {
    await fs.promises.mkdir(this.options.cacheDirectory, { recursive: true });
    const fileName = MERMAID_RESOURCE_PREFIX + digest + ".png";
    const file = path.join(this.options.cacheDirectory, fileName);
    let body: Buffer;
    try { body = await fs.promises.readFile(file); pngDimensions(body); } catch (_) {
      const browser = await findBrowser(this.options.browserPath);
      const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evermonkey-mermaid-"));
      try {
        const htmlFile = path.join(temp, "render.html");
        await fs.promises.writeFile(htmlFile, rendererHtml(source, bundle), "utf8");
        const dom = await new Promise<string>((resolve, reject) => {
          execFile(browser, [
            "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            "--disable-background-networking", "--disable-extensions", "--hide-scrollbars",
            "--user-data-dir=" + path.join(temp, "profile"), "--virtual-time-budget=15000",
            "--dump-dom", pathToFileURL(htmlFile).href
          ], { windowsHide: true, timeout: 60000, maxBuffer: 48 * 1024 * 1024 }, (error, stdout) => {
            if (error) { reject(new Error(`Mermaid browser failed (${error.code || error.message}). Check evermonkey.mermaid.browserPath.`)); }
            else { resolve(stdout); }
          });
        });
        const output = /<pre id="evermonkey-result">([A-Za-z0-9+/=]+)<\/pre>/.exec(dom);
        if (!output) { throw new Error("Mermaid browser did not finish rendering within 15 seconds."); }
        const result = JSON.parse(Buffer.from(output[1], "base64").toString("utf8"));
        if (result.error) { throw new Error(result.error); }
        body = Buffer.from(result.png, "base64");
        pngDimensions(body);
        // Unique atomic writes also allow multiple extension windows to share the cache.
        const pendingFile = path.join(this.options.cacheDirectory, `${fileName}.${path.basename(temp)}.tmp`);
        try {
          await fs.promises.writeFile(pendingFile, body);
          await fs.promises.rename(pendingFile, file);
        } finally { await fs.promises.rm(pendingFile, { force: true }).catch(() => {}); }
      } finally {
        // Edge can briefly hold its profile after exiting. Rendering remains valid.
        await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
      }
    }
    return {
      mime: "image/png",
      data: { body, size: body.length, bodyHash: createHash("md5").update(body).digest() },
      attributes: { fileName, attachment: false, timestamp: Date.now() }
    };
  }
}

function rendererHtml(source: string, bundle: string): string {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">
</head><body><div id="host"></div><pre id="evermonkey-result"></pre>
<script>${bundle.replace(/<\/script/gi, "<\\/script")}</script>
<script>
(async function () {
  const output = document.getElementById('evermonkey-result');
  function finish(result) { output.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result)))); }
  try {
    mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'default',
      fontFamily:'Microsoft YaHei, Segoe UI, sans-serif',
      flowchart:{htmlLabels:false,useMaxWidth:false},sequence:{useMaxWidth:false}});
    const source = new TextDecoder().decode(Uint8Array.from(atob('${encoded}'), c => c.charCodeAt(0)));
    const rendered = await mermaid.render('evermonkey-diagram', source);
    const host = document.getElementById('host');
    host.innerHTML = rendered.svg;
    await document.fonts.ready;
    const svg = host.querySelector('svg');
    const box = svg.viewBox.baseVal;
    const width = Math.ceil(box.width || svg.getBoundingClientRect().width);
    const height = Math.ceil(box.height || svg.getBoundingClientRect().height);
    const scale = 2, padding = 12;
    if (!width || !height || (width+padding*2)*scale > 16384 || (height+padding*2)*scale > 16384 ||
        (width+padding*2)*(height+padding*2)*scale*scale > 64000000) {
      throw new Error('Diagram is too large for PNG; split it into smaller Mermaid blocks.');
    }
    svg.setAttribute('width', width); svg.setAttribute('height', height); svg.style.maxWidth = 'none';
    const image = new Image();
    const loaded = new Promise((resolve,reject) => {image.onload=resolve;image.onerror=() => reject(new Error('Unable to rasterize Mermaid SVG.'));});
    image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))));
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = (width+padding*2)*scale; canvas.height = (height+padding*2)*scale;
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,padding*scale,padding*scale,width*scale,height*scale);
    finish({png:canvas.toDataURL('image/png').split(',')[1]});
  } catch(error) { finish({error:String(error.message || error).slice(0,2000)}); }
})();
</script></body></html>`;
}
