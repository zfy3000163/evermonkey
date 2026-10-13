import * as cheerio from "cheerio";
import * as hljs from "highlight.js";
import * as inlineCss from "inline-css";
import * as MarkdownIt from "markdown-it";
import * as mdSub from "markdown-it-sub";
import * as mdSup from "markdown-it-sup";
import * as mdEmoji from "markdown-it-emoji";
import * as mdEnmlTodo from "markdown-it-enml-todo";
import markdownItGithubToc from "markdown-it-github-toc";
import * as path from "path";
import * as fs from "fs";
import * as toMarkdown from "to-markdown";
import * as util from "util";

/**
 * This module imports nothing from `vscode`, so the whole markdown -> ENML
 * pipeline is unit testable in plain node.
 */

const MARKDOWN_THEME_PATH = path.join(__dirname, "../../themes");
const HIGHLIGHT_THEME_PATH = path.join(__dirname, "../../node_modules/highlight.js/styles");
const DEFAULT_HIGHLIGHT_THEME = "github";
const DEFAULT_MARKDOWN_THEME = "github.css";
const MAGIC_SPELL = "%EVERMONKEY%";

const OVERRIDE_FONT_FAMILY = `
.markdown-body {
  font-family: %s !important;
}`;

const OVERRIDE_FONT_SIZE = `
.markdown-body {
  font-size: %s !important;
}`;

const OVERRIDE_CODE_FONT_FAMILY = `
.hljs {
  font-family: %s !important;
}`;

const OVERRIDE_CODE_FONT_SIZE = `
.hljs {
  font-size: %s !important;
}`;

export interface ConverterOptions {
  highlightTheme?: string;
  markdownTheme?: string;
  fontFamily?: string[];
  fontSize?: string;
  codeFontFamily?: string[];
  codeFontSize?: string;
}

/**
 * ENML elements the DTD declares EMPTY.
 *
 * Cheerio does not know them, so a self-closing `<en-media .../>` written in
 * markdown is parsed as an *opening* tag that swallows everything up to the
 * next closing tag, and the service rejects the note with
 * `ENML_VALIDATION: The content of element type "en-media" must match "EMPTY"`.
 * The paired form round-trips correctly, so self-closing ones are rewritten
 * before rendering. This only touches the rendering copy -- the round-trip
 * payload stays the user's original markdown.
 */
const ENML_EMPTY_ELEMENTS = ["en-media", "en-todo"];

export function closeEmptyEnmlElements(markdown: string): string {
  let result = markdown;
  for (const tag of ENML_EMPTY_ELEMENTS) {
    result = result.replace(
      new RegExp(`<(${tag})((?:\\s[^>]*?)?)\\s*/>`, "gi"),
      "<$1$2></$1>"
    );
  }
  return result;
}

/**
 * Render TeX math to images.
 *
 * ENML cannot display LaTeX: there is no KaTeX/MathJax and `<style>` is
 * stripped, and base markdown-it has no math support at all. We rewrite
 * `$...$` / `\(...\)` / `$$...$$` / `\[...\]` into `<img>` tags that point at a
 * remote TeX renderer (CodeCogs), so formulas show as real typeset images in
 * Evernote. `<img src>` is declared in the ENML DTD, so the note still passes
 * validation. Trade-off: the note needs network access to the renderer when it
 * is displayed.
 */
const MATH_IMG_BASE = "https://latex.codecogs.com/png.image?";

function mathImageUrl(tex: string): string {
  return MATH_IMG_BASE + encodeURIComponent("\\dpi{200} " + tex.trim());
}

function mathImage(tex: string): string {
  return `<img src="${mathImageUrl(tex)}" alt="formula" />`;
}

function markdownItMath(md): void {
  const BS = "\\";

  // Inline `\( ... \)` -- registered before `escape` so the opener is not
  // consumed as an escaped parenthesis.
  md.inline.ruler.before("escape", "math_paren", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    const open = BS + "(";
    const close = BS + ")";
    if (!src.startsWith(open, start)) {
      return false;
    }
    const stop = src.indexOf(close, start + open.length);
    if (stop < 0 || stop >= state.posMax) {
      return false;
    }
    const content = src.slice(start + open.length, stop);
    if (!content.trim()) {
      return false;
    }
    if (!silent) {
      state.push("math_inline", "math", 0).content = content;
    }
    state.pos = stop + close.length;
    return true;
  });

  // Inline `$ ... $` -- after `backticks` so inline code keeps literal dollars.
  md.inline.ruler.after("backticks", "math_dollar", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src[start] !== "$" || src[start + 1] === "$") {
      return false;
    }
    const stop = src.indexOf("$", start + 1);
    if (stop < 0 || stop >= state.posMax) {
      return false;
    }
    const content = src.slice(start + 1, stop);
    if (!content.trim()) {
      return false;
    }
    if (!silent) {
      state.push("math_inline", "math", 0).content = content;
    }
    state.pos = stop + 1;
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) => mathImage(tokens[idx].content);

  // Block `\[ ... \]` or `$$ ... $$`.
  md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    const begin = state.bMarks[startLine] + state.tShift[startLine];
    const end = state.eMarks[startLine];
    const first = state.src.slice(begin, end);
    let open, close;
    if (first.startsWith(BS + "[")) {
      open = BS + "[";
      close = BS + "]";
    } else if (first.startsWith("$$")) {
      open = "$$";
      close = "$$";
    } else {
      return false;
    }
    let content = "";
    let lastLine = startLine;
    let found = false;
    const rest = first.slice(open.length);
    const inlineEnd = rest.indexOf(close);
    if (inlineEnd >= 0) {
      content = rest.slice(0, inlineEnd);
      found = true;
    } else {
      content = rest + "\n";
      for (lastLine = startLine + 1; lastLine < endLine; lastLine++) {
        const lineBegin = state.bMarks[lastLine] + state.tShift[lastLine];
        const lineEnd = state.eMarks[lastLine];
        const line = state.src.slice(lineBegin, lineEnd);
        const stop = line.indexOf(close);
        if (stop >= 0) {
          content += line.slice(0, stop);
          found = true;
          break;
        }
        content += line + "\n";
      }
    }
    if (!found) {
      return false;
    }
    if (silent) {
      return true;
    }
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.map = [startLine, lastLine + 1];
    token.content = content;
    state.line = lastLine + 1;
    return true;
  });

  md.renderer.rules.math_block = (tokens, idx) => `<p>${mathImage(tokens[idx].content)}</p>\n`;
}

export default class Converter {
  private md;
  private options: ConverterOptions;
  /**
   * Style sheets are read asynchronously. Holding the promise (rather than
   * assigning `this.styles` from a detached `.then`) matters once converters
   * can be created on the fly -- a publish running before the read resolves
   * would otherwise render with no CSS at all.
   */
  private stylesReady: Promise<string[]>;

  constructor(options: ConverterOptions = {}) {
    this.options = options;
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      highlight(code, lang) {
        // code highlight
        if (lang && hljs.getLanguage(lang)) {
          try {
            return `<pre class="hljs"><code>${hljs.highlight(lang, code, true).value}</code></pre>`;
          } catch (err) {}
        }
        return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
      }
    });

    // markdown-it plugin
    md.use(mdSub)
      .use(mdSup)
      .use(mdEnmlTodo)
      .use(mdEmoji)
      .use(markdownItMath)
      .use(markdownItGithubToc, {
        anchorLink: false
      });

    // Inline code class for enml style.
    const inlineCodeRule = md.renderer.rules.code_inline;
    md.renderer.rules.code_inline = (...args) => {
      const result = inlineCodeRule.call(md, ...args);
      return result.replace("<code>", '<code class="inline">');
    };
    this.md = md;
    this.stylesReady = this.loadStyles();
  }

  /**
   * A missing or misspelled theme degrades to unstyled output rather than
   * failing the publish: the note is still correct, just plain.
   */
  private loadStyles(): Promise<string[]> {
    const highlightTheme = (this.options.highlightTheme || DEFAULT_HIGHLIGHT_THEME).replace(/\s+/g, "-");
    const markdownTheme = this.options.markdownTheme || DEFAULT_MARKDOWN_THEME;
    const read = (file: string) =>
      fs.promises.readFile(file, "utf8").catch(err => {
        console.warn(`evermonkey: cannot read theme "${file}": ${err.message}`);
        return "";
      });
    return Promise.all([
      read(path.join(MARKDOWN_THEME_PATH, markdownTheme)),
      read(path.join(HIGHLIGHT_THEME_PATH, `${highlightTheme}.css`))
    ]);
  }

  async toHtml(markcontent: string): Promise<string> {
    const tokens = this.md.parse(closeEmptyEnmlElements(markcontent), {});
    const html = this.md.renderer.render(tokens, this.md.options);
    const $ = cheerio.load(html);
    await this.processStyle($);
    return $.xml();
  }

  async toEnml(markcontent: string): Promise<string> {
    const html = await this.toHtml(markcontent);
    let enml = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>';
    enml += "<!--" + MAGIC_SPELL;
    enml += Buffer.from(markcontent, "utf-8").toString("base64");
    enml += MAGIC_SPELL + "-->";
    enml += html;
    enml += "</en-note>";
    return enml;
  }

  async processStyle($): Promise<void> {
    const styles = await this.stylesReady;
    const styleHtml = this.customizeCss($, styles);
    $.root().html(styleHtml);

    // Change html classes to inline styles
    //
    // `codeBlocks: {}` disables inline-css's built-in HBS/EJS placeholders. By
    // default it treats `{{ ... }}` (and `<% ... %>`) as templating and skips
    // inlining inside them, so hljs spans in such code blocks keep their
    // `class` -- which ENML rejects with
    // `ENML_VALIDATION: Attribute "class" must be declared for element type
    // "span"`. Our markdown has no such templating, so disabling the
    // placeholders is safe and injects styles into those blocks too.
    const inlineStyleHtml = await inlineCss($.html(), {
      url: "/",
      removeStyleTags: true,
      removeHtmlSelectors: true,
      codeBlocks: {}
    });
    $.root().html(inlineStyleHtml);
    // These carry ENML-defined attributes only; the inliner's `style` is not in
    // the DTD and the service rejects attributes it does not know.
    $("en-todo, en-media, en-crypt").removeAttr("style");
  }

  customizeCss($, styles: string[]): string {
    const { fontFamily, fontSize, codeFontFamily, codeFontSize } = this.options;
    let fontFamilyCss;
    let fontSizeCss;
    let codeFontFamilyCss;
    let codeFontSizeCss;
    if (fontFamily) {
      fontFamilyCss = util.format(OVERRIDE_FONT_FAMILY, fontFamily.join(","));
    }
    if (fontSize) {
      fontSizeCss = util.format(OVERRIDE_FONT_SIZE, fontSize);
    }
    if (codeFontFamily) {
      codeFontFamilyCss = util.format(OVERRIDE_CODE_FONT_FAMILY, codeFontFamily.join(","));
    }
    if (codeFontSize) {
      codeFontSizeCss = util.format(OVERRIDE_CODE_FONT_SIZE, codeFontSize);
    }
    const overrides = [fontFamilyCss, fontSizeCss, codeFontFamilyCss, codeFontSizeCss]
      .filter(Boolean)
      .join("");
    const css = `${styles.join("")}${overrides}`;
    // inline-css throws on an empty <style> element, so the tag is omitted
    // entirely when a theme file could not be read and there are no overrides.
    const styleTag = css.trim().length > 0 ? `<style>${css}</style>` : "";
    return `${styleTag}<div class="markdown-body">${$.html()}</div>`;
  }

  toMd(enml: string): string {
    if (!enml) {
      return "";
    }
    const beginTagIndex = enml.indexOf("<en-note");
    const startIndex = enml.indexOf(">", beginTagIndex) + 1;
    const endIndex = enml.indexOf("</en-note>");
    const rawContent = enml.substring(startIndex, endIndex);
    if (rawContent.indexOf(MAGIC_SPELL) !== -1) {
      const beginMark = "<!--" + MAGIC_SPELL;
      const beginMagicIdx = rawContent.indexOf(beginMark) + beginMark.length;
      const endMagicIdx = rawContent.indexOf(MAGIC_SPELL + "-->");
      const magicString = rawContent.substring(beginMagicIdx, endMagicIdx);
      return Buffer.from(magicString, "base64").toString("utf-8");
    } else {
      const commentRegex = /<!--.*?-->/;
      const htmlStr = rawContent.replace(commentRegex, "");
      const mdtxt = toMarkdown(htmlStr);
      return this.todoFix(mdtxt);
    }
  }

  todoFix(markdown: string): string {
    return markdown.replace(/<en-todo\s+checked="true"\s*\/?>/g, "[x] ")
      .replace(/<en-todo\s+checked="false"\s*\/?>/g, "[ ] ")
      .replace(/<en-todo\s*\/?>/g, "[ ] ")
      .replace(/<\/en-todo>/g, "");
  }

}