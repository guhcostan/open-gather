// Static site generator for the landing page and documentation.
// Input : ../docs/*.md, ../docs/decisions/*.md, src/*, assets/*
// Output: dist/ (deployed to GitHub Pages). Every link is relative, so the site
// works under a project sub-path such as /open-gather/.
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";

const HERE = import.meta.dirname;
const DOCS = path.resolve(HERE, "../docs");
const OUT = path.join(HERE, "dist");
export const REPO = "https://github.com/guhcostan/open-gather";

const NAV = [
  { group: "Get started", items: [["overview", "Overview", "overview.md"], ["getting-started", "Getting started", "getting-started.md"]] },
  { group: "Concepts", items: [["architecture", "Architecture", "architecture.md"], ["proximity-and-media", "Proximity and media", "proximity-and-media.md"], ["art-style", "Art style", "art-style.md"], ["protocol", "WebSocket protocol", "protocol.md"]] },
  { group: "Operate", items: [["privacy-and-security", "Privacy and security", "privacy-and-security.md"], ["efficiency-and-benchmarks", "Efficiency and benchmarks", "efficiency-and-benchmarks.md"], ["benchmark-results", "Benchmark results", "benchmark-results.md"], ["status", "Status and roadmap", "status.md"]] },
  {
    group: "Decisions",
    items: fs.readdirSync(path.join(DOCS, "decisions")).filter((f) => f.endsWith(".md")).sort().map((f) => {
      const slug = f.replace(/\.md$/, "");
      const title = fs.readFileSync(path.join(DOCS, "decisions", f), "utf8").match(/^# (.+)$/m)[1];
      return [slug, title, "decisions/" + f];
    }),
  },
  { group: "Community", items: [["contributing", "Contributing", "contributing.md"]] },
];
const PAGES = NAV.flatMap((g) => g.items.map(([slug, title, file]) => ({ slug, title, file, group: g.group })));
const bySlug = new Map(PAGES.map((p) => [p.slug, p]));
const docUrl = (slug, root) => root + "docs/" + (slug === "overview" ? "" : slug + "/");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function render(mdText, root) {
  const toc = [];
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slugify(html);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: html.replace(/<[^>]+>/g, "") });
        return depth === 1 ? "<h1>" + html + "</h1>\n" : "<h" + depth + " id=\"" + id + "\"><a class=\"anchor\" href=\"#" + id + "\" aria-label=\"Link to section\">#</a>" + html + "</h" + depth + ">\n";
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const m = /^(?:\.\/)?(?:decisions\/)?([\w-]+)\.md(#.*)?$/.exec(href);
        if (m && bySlug.has(m[1])) href = docUrl(m[1], root) + (m[2] ?? "");
        const ext = /^https?:/.test(href);
        return "<a href=\"" + esc(href) + "\"" + (title ? " title=\"" + esc(title) + "\"" : "") + (ext ? " rel=\"noopener\"" : "") + ">" + text + "</a>";
      },
      code({ text, lang }) {
        return "<div class=\"code\"><button class=\"copy\" type=\"button\" aria-label=\"Copy code\">Copy</button><pre><code" + (lang ? " class=\"language-" + esc(lang) + "\"" : "") + ">" + esc(text) + "</code></pre></div>\n";
      },
      table({ header, rows }) {
        const cell = (c, tag) => "<" + tag + (c.align ? " style=\"text-align:" + c.align + "\"" : "") + ">" + this.parser.parseInline(c.tokens) + "</" + tag + ">";
        return "<div class=\"table-wrap\"><table><thead><tr>" + header.map((c) => cell(c, "th")).join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c) => cell(c, "td")).join("") + "</tr>").join("") + "</tbody></table></div>\n";
      },
    },
  });
  return { html: md.parse(mdText), toc };
}

const ICON = "<svg class=\"logo\" viewBox=\"0 0 16 16\" width=\"28\" height=\"28\" shape-rendering=\"crispEdges\" aria-hidden=\"true\"><rect width=\"16\" height=\"16\" rx=\"3\" fill=\"#241f42\"/><rect x=\"5\" y=\"2\" width=\"6\" height=\"2\" fill=\"#3a2a1c\"/><rect x=\"5\" y=\"4\" width=\"6\" height=\"4\" fill=\"#e8b98f\"/><rect x=\"6\" y=\"5\" width=\"1\" height=\"2\" fill=\"#1d1a2b\"/><rect x=\"9\" y=\"5\" width=\"1\" height=\"2\" fill=\"#1d1a2b\"/><rect x=\"4\" y=\"8\" width=\"8\" height=\"5\" fill=\"#3cc9b0\"/><rect x=\"5\" y=\"13\" width=\"2\" height=\"2\" fill=\"#4a5a7a\"/><rect x=\"9\" y=\"13\" width=\"2\" height=\"2\" fill=\"#4a5a7a\"/></svg>";
const GH = "<svg viewBox=\"0 0 16 16\" width=\"18\" height=\"18\" aria-hidden=\"true\" fill=\"currentColor\"><path d=\"M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0z\"/></svg>";

function header(root, active) {
  return "<header class=\"site-header\"><div class=\"wrap bar\">" +
    "<a class=\"brand\" href=\"" + root + "\">" + ICON + "<span>Open Gather</span></a>" +
    "<nav class=\"main-nav\" aria-label=\"Main\">" +
    (active === "home" ? "<a href=\"#features\">Features</a><a href=\"#how\">How it works</a><a href=\"#status\">Status</a>" : "") +
    "<a href=\"" + root + "docs/\"" + (active === "docs" ? " aria-current=\"page\"" : "") + ">Docs</a>" +
    "<a class=\"gh\" href=\"" + REPO + "\" rel=\"noopener\">" + GH + "<span>GitHub</span></a></nav></div></header>";
}
function footer(root) {
  return "<footer class=\"site-footer\"><div class=\"wrap\"><p>Open Gather is free software under the <a href=\"" + REPO + "/blob/main/LICENSE\">AGPL-3.0</a>. All code and pixel art are original to this project.</p>" +
    "<p class=\"fine\">\"Open Gather\" is a provisional name. This project has no affiliation with, and is not endorsed by, the original Gather product.</p>" +
    "<p class=\"fine\"><a href=\"" + root + "docs/\">Docs</a> · <a href=\"" + REPO + "\">Source</a> · <a href=\"" + REPO + "/issues\">Issues</a></p></div></footer>";
}
function shell({ title, description, root, active, body, bodyClass = "", scripts = "" }) {
  return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + esc(title) + "</title>\n<meta name=\"description\" content=\"" + esc(description) + "\">\n<meta name=\"color-scheme\" content=\"dark\">\n" +
    "<meta property=\"og:title\" content=\"" + esc(title) + "\">\n<meta property=\"og:description\" content=\"" + esc(description) + "\">\n<meta property=\"og:image\" content=\"" + root + "assets/banner.png\">\n<meta name=\"twitter:card\" content=\"summary_large_image\">\n" +
    "<link rel=\"icon\" href=\"" + root + "assets/logo.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"" + root + "style.css\">\n</head>\n<body class=\"" + bodyClass + "\" data-root=\"" + root + "\">\n" +
    "<a class=\"skip\" href=\"#main\">Skip to content</a>\n" + header(root, active) + "\n" + body + "\n" + footer(root) + "\n" +
    "<script src=\"" + root + "site.js\" defer></script>\n" + scripts + "</body>\n</html>\n";
}

function docPage(p, index) {
  const root = p.slug === "overview" ? "../" : "../../";
  const src = fs.readFileSync(path.join(DOCS, p.file), "utf8");
  const { html, toc } = render(src, root);
  const prev = PAGES[index - 1], next = PAGES[index + 1];
  const side = NAV.map((g) => "<div class=\"side-group\"><h4>" + g.group + "</h4><ul>" + g.items.map(([slug, title]) => "<li><a href=\"" + docUrl(slug, root) + "\"" + (slug === p.slug ? " aria-current=\"page\"" : "") + ">" + esc(title.replace(/^\d+ · /, "")) + "</a></li>").join("") + "</ul></div>").join("");
  const tocHtml = toc.length ? "<aside class=\"toc\" aria-label=\"On this page\"><h4>On this page</h4><ul>" + toc.map((t) => "<li class=\"d" + t.depth + "\"><a href=\"#" + t.id + "\">" + esc(t.text) + "</a></li>").join("") + "</ul></aside>" : "<aside class=\"toc\"></aside>";
  const body = "<div class=\"wrap docs\"><button class=\"side-toggle\" type=\"button\" aria-expanded=\"false\">Menu</button>" +
    "<nav class=\"sidebar\" aria-label=\"Documentation\"><div class=\"search\"><input id=\"q\" type=\"search\" placeholder=\"Search docs…\" autocomplete=\"off\" aria-label=\"Search docs\"><ul id=\"results\" hidden></ul></div>" + side + "</nav>" +
    "<main id=\"main\" class=\"doc\"><article class=\"prose\">" + html + "</article>" +
    "<p class=\"edit\"><a href=\"" + REPO + "/edit/main/docs/" + p.file + "\" rel=\"noopener\">Edit this page on GitHub</a></p>" +
    "<nav class=\"pager\" aria-label=\"Pagination\">" + (prev ? "<a class=\"prev\" href=\"" + docUrl(prev.slug, root) + "\"><small>Previous</small>" + esc(prev.title.replace(/^\d+ · /, "")) + "</a>" : "<span></span>") + (next ? "<a class=\"next\" href=\"" + docUrl(next.slug, root) + "\"><small>Next</small>" + esc(next.title.replace(/^\d+ · /, "")) + "</a>" : "<span></span>") + "</nav></main>" + tocHtml + "</div>";
  const title = p.title.replace(/^\d+ · /, "") + " · Open Gather docs";
  const first = src.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">") && !l.startsWith("-")) ?? "";
  return { root, out: p.slug === "overview" ? path.join(OUT, "docs/index.html") : path.join(OUT, "docs", p.slug, "index.html"), html: shell({ title, description: first.replace(/[*_\x60]/g, "").slice(0, 200), root, active: "docs", body, bodyClass: "docs-page" }), text: src, title: p.title.replace(/^\d+ · /, ""), toc };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    fs.statSync(a).isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(HERE, "assets"), path.join(OUT, "assets"));
fs.copyFileSync(path.join(HERE, "src/style.css"), path.join(OUT, "style.css"));
fs.copyFileSync(path.join(HERE, "src/site.js"), path.join(OUT, "site.js"));
write(path.join(OUT, ".nojekyll"), "");

const landing = fs.readFileSync(path.join(HERE, "src/landing.html"), "utf8").replaceAll("{{REPO}}", REPO);
write(path.join(OUT, "index.html"), shell({
  title: "Open Gather · A lightweight, open source 2D virtual office",
  description: "Walk around a pixel-art office, meet teammates and talk by proximity. Open source (AGPL-3.0), built with Go, PixiJS and LiveKit, designed to be cheap to host.",
  root: "./", active: "home", body: landing, bodyClass: "landing",
}));

const index = [];
PAGES.forEach((p, i) => {
  const r = docPage(p, i);
  write(r.out, r.html);
  index.push({ t: r.title, u: r.out.replace(OUT + "/", "").replace(/index\.html$/, ""), x: r.text.replace(/[#*_\x60|>~-]/g, " ").replace(/\s+/g, " ").slice(0, 6000), h: r.toc.map((t) => t.text) });
});
write(path.join(OUT, "search-index.json"), JSON.stringify(index));
console.log("site built:", PAGES.length, "doc pages ->", OUT);
