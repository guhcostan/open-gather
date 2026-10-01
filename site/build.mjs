// Static site generator for the landing page and documentation.
// Input : ../docs/*.md, ../docs/decisions/*.md, ../deploy/README.md, src/*, assets/*
// Output: dist/ (deployed to GitHub Pages). Page links are relative, so the site works under a
// project sub-path such as /open-gather/; canonical, social and sitemap URLs use SITE.
// Also writes what search engines and AI assistants read: sitemap.xml, llms.txt, llms-full.txt,
// a Markdown copy of every doc page (docs/<slug>.md), JSON-LD and a 404 page.
// Check the output with: node check.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Marked } from "marked";

const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, "..");
const DOCS = path.join(REPO_ROOT, "docs");
const OUT = path.join(HERE, "dist");
export const REPO = "https://github.com/guhcostan/open-gather";
export const SITE = "https://guhcostan.github.io/open-gather/";
const BASE_PATH = new URL(SITE).pathname;
const DEMO = "https://office.152-67-49-137.sslip.io";
const IMAGE = { url: SITE + "assets/banner.png", width: 1280, height: 640, alt: "Open Gather: pixel-art avatars in a lightweight, open source virtual office" };
const SUMMARY = "Open source (AGPL-3.0), self-hosted 2D virtual office with pixel-art avatars, proximity audio and video, meeting rooms, screen sharing and chat. Built with Go, PixiJS and LiveKit to be cheap to host.";

const NAV = [
  { group: "Get started", items: [["overview", "Overview", "overview.md"], ["getting-started", "Getting started", "getting-started.md"], ["self-hosting", "Self-hosting", "../deploy/README.md"], ["faq", "FAQ", "faq.md"]] },
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
  { group: "Community", items: [["contributing", "Contributing", "contributing.md"], ["gauntlet", "The gauntlet loop", "gauntlet.md"]] },
];
// Hand-written descriptions for the pages people search for; the rest use their first paragraph.
const DESCRIPTIONS = {
  overview: "What Open Gather is: an open source, self-hosted 2D virtual office with proximity audio and video, built to be light on CPU, RAM, GPU and bandwidth.",
  "getting-started": "Run Open Gather locally in minutes: Go, Node.js with pnpm and LiveKit, one dev script, every environment variable and how to run the tests.",
  "self-hosting": "Self-host Open Gather with Docker Compose: HTTPS through Caddy, a LiveKit SFU, invite-only joins, firewall ports, backups and a public demo mode.",
  faq: "Answers about Open Gather: what it is, how it relates to Gather, cost, self-hosting, capacity, privacy, browsers, phones and how to contribute.",
  architecture: "How Open Gather is built: an authoritative Go world server with a spatial grid, SQLite in WAL mode, a PixiJS client and a LiveKit SFU for media.",
  "proximity-and-media": "How proximity conversations form in Open Gather: hysteresis, small groups, no chains, isolated rooms, scoped LiveKit tokens and revocation.",
  "privacy-and-security": "What Open Gather stores and never stores, how media access is enforced by the server and the SFU, and the security limits still open.",
  status: "Open Gather status and roadmap: what has been tested in real browsers and on a public host, what was measured locally and what has not been run.",
};
const PAGES = NAV.flatMap((g) => g.items.map(([slug, title, file]) => ({ slug, title: title.replace(/^\d+ · /, ""), file, group: g.group, src: path.resolve(DOCS, file) })));
const byFile = new Map(PAGES.map((p) => [p.src, p.slug]));
const docUrl = (slug, root) => root + "docs/" + (slug === "overview" ? "" : slug + "/");
const docPath = (slug) => "docs/" + (slug === "overview" ? "" : slug + "/");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s) => s.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_\x60]/g, "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1)).replace(/[\s,;:.(-]+$/, "") + "…");
const ldScript = (obj) => "<script type=\"application/ld+json\">" + JSON.stringify(obj).replace(/</g, "\\u003c") + "</script>\n";

// Links in Markdown sources: other doc pages become site URLs, other repository files become
// GitHub URLs (they do not exist on the site), everything else is left alone.
function linkTarget(href, srcFile, root) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
  const i = href.indexOf("#");
  const file = i < 0 ? href : href.slice(0, i), hash = i < 0 ? "" : href.slice(i);
  const abs = path.resolve(path.dirname(srcFile), file);
  if (byFile.has(abs)) return docUrl(byFile.get(abs), root) + hash;
  // Some sources link a doc page by file name only (decisions/0001-x.md as 0001-x.md, or the reverse).
  const bySlug = /^([\w-]+)\.md$/.exec(path.basename(file));
  if (!fs.existsSync(abs) && bySlug && PAGES.some((p) => p.slug === bySlug[1])) return docUrl(bySlug[1], root) + hash;
  const rel = path.relative(REPO_ROOT, abs);
  if (rel.startsWith("..")) return href;
  const kind = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? "tree" : "blob";
  return REPO + "/" + kind + "/main/" + rel.split(path.sep).join("/") + hash;
}

function describe(p, src) {
  if (DESCRIPTIONS[p.slug]) return DESCRIPTIONS[p.slug];
  const para = src.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !/^(#|>|-|\*|\||~~~|\x60\x60\x60|<|\d+\.)/.test(s)) ?? "";
  let d = plain(para);
  if (p.group === "Decisions") d = "Open Gather design decision, " + p.title + ": " + d;
  if (d.length < 50) d += " Part of the Open Gather docs, an open source, self-hosted virtual office.";
  return clip(d, 158);
}

function lastModified(file) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function faqEntries(src) {
  return src.split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.indexOf("\n");
    return { q: chunk.slice(0, nl).trim(), a: chunk.slice(nl + 1).trim() };
  });
}

// The Markdown copies (docs/<slug>.md, llms-full.txt) are read outside the repository, so their
// relative links become absolute site or GitHub URLs.
const absoluteLinks = (md, srcFile) => md.replace(/(\]\()([^)\s]+)(\))/g, (m, a, href, b) => a + linkTarget(href, srcFile, SITE) + b);

function render(mdText, root, srcFile) {
  const toc = [];
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slugify(html);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: unesc(html.replace(/<[^>]+>/g, "")) });
        return depth === 1 ? "<h1>" + html + "</h1>\n" : "<h" + depth + " id=\"" + id + "\"><a class=\"anchor\" href=\"#" + id + "\" aria-label=\"Link to section\">#</a>" + html + "</h" + depth + ">\n";
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        href = linkTarget(href, srcFile, root);
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
    (active === "home" ? "<a href=\"#features\">Features</a><a href=\"#how\">How it works</a><a href=\"#faq\">FAQ</a>" : "") +
    "<a href=\"" + root + "docs/\"" + (active === "docs" ? " aria-current=\"page\"" : "") + ">Docs</a>" +
    "<a class=\"gh\" href=\"" + REPO + "\" rel=\"noopener\">" + GH + "<span>GitHub</span></a></nav></div></header>";
}
function footer(root) {
  return "<footer class=\"site-footer\"><div class=\"wrap\"><p>Open Gather is free software under the <a href=\"" + REPO + "/blob/main/LICENSE\">AGPL-3.0</a>. All pixel art is drawn by this project's own code.</p>" +
    "<p class=\"fine\">\"Open Gather\" is a provisional name. This project has no affiliation with, and is not endorsed by, the original Gather product.</p>" +
    "<p class=\"fine\"><a href=\"" + root + "docs/\">Docs</a> · <a href=\"" + root + "docs/faq/\">FAQ</a> · <a href=\"" + REPO + "\">Source</a> · <a href=\"" + REPO + "/issues\">Issues</a> · <a href=\"" + root + "llms.txt\">llms.txt</a> · <a href=\"" + REPO + "/stargazers\">Star on GitHub</a></p></div></footer>";
}
function shell({ title, description, root, urlPath, type = "website", body, bodyClass = "", active = "docs", ld = [], markdown, noindex = false }) {
  const url = urlPath == null ? null : SITE + urlPath;
  return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + esc(title) + "</title>\n<meta name=\"description\" content=\"" + esc(description) + "\">\n" +
    (url ? "<link rel=\"canonical\" href=\"" + url + "\">\n" : "") +
    (noindex ? "<meta name=\"robots\" content=\"noindex\">\n" : "") +
    "<meta name=\"color-scheme\" content=\"dark\">\n<meta name=\"theme-color\" content=\"#1b1830\">\n" +
    "<meta property=\"og:type\" content=\"" + type + "\">\n<meta property=\"og:site_name\" content=\"Open Gather\">\n" +
    "<meta property=\"og:title\" content=\"" + esc(title) + "\">\n<meta property=\"og:description\" content=\"" + esc(description) + "\">\n" +
    (url ? "<meta property=\"og:url\" content=\"" + url + "\">\n" : "") +
    "<meta property=\"og:image\" content=\"" + IMAGE.url + "\">\n<meta property=\"og:image:width\" content=\"" + IMAGE.width + "\">\n<meta property=\"og:image:height\" content=\"" + IMAGE.height + "\">\n<meta property=\"og:image:alt\" content=\"" + esc(IMAGE.alt) + "\">\n" +
    "<meta name=\"twitter:card\" content=\"summary_large_image\">\n<meta name=\"twitter:title\" content=\"" + esc(title) + "\">\n<meta name=\"twitter:description\" content=\"" + esc(description) + "\">\n<meta name=\"twitter:image\" content=\"" + IMAGE.url + "\">\n<meta name=\"twitter:image:alt\" content=\"" + esc(IMAGE.alt) + "\">\n" +
    (markdown ? "<link rel=\"alternate\" type=\"text/markdown\" href=\"" + markdown + "\" title=\"Markdown source\">\n" : "") +
    "<link rel=\"icon\" href=\"" + root + "assets/logo.svg\" type=\"image/svg+xml\">\n<link rel=\"stylesheet\" href=\"" + root + "style.css\">\n" +
    ld.map(ldScript).join("") + "</head>\n<body class=\"" + bodyClass + "\" data-root=\"" + root + "\">\n" +
    "<a class=\"skip\" href=\"#main\">Skip to content</a>\n" + header(root, active) + "\n" + body + "\n" + footer(root) + "\n" +
    "<script src=\"" + root + "site.js\" defer></script>\n</body>\n</html>\n";
}

const WEBSITE = { "@type": "WebSite", name: "Open Gather", url: SITE };

function docPage(p, index) {
  const root = p.slug === "overview" ? "../" : "../../";
  const src = fs.readFileSync(p.src, "utf8");
  const { html, toc } = render(src, root, p.src);
  const prev = PAGES[index - 1], next = PAGES[index + 1];
  const side = NAV.map((g) => "<div class=\"side-group\"><h4>" + g.group + "</h4><ul>" + g.items.map(([slug, title]) => "<li><a href=\"" + docUrl(slug, root) + "\"" + (slug === p.slug ? " aria-current=\"page\"" : "") + ">" + esc(title.replace(/^\d+ · /, "")) + "</a></li>").join("") + "</ul></div>").join("");
  const tocHtml = toc.length ? "<aside class=\"toc\" aria-label=\"On this page\"><h4>On this page</h4><ul>" + toc.map((t) => "<li class=\"d" + t.depth + "\"><a href=\"#" + t.id + "\">" + esc(t.text) + "</a></li>").join("") + "</ul></aside>" : "<aside class=\"toc\"></aside>";
  const repoPath = path.relative(REPO_ROOT, p.src).split(path.sep).join("/");
  const body = "<div class=\"wrap docs\"><button class=\"side-toggle\" type=\"button\" aria-expanded=\"false\">Menu</button>" +
    "<nav class=\"sidebar\" aria-label=\"Documentation\"><div class=\"search\"><input id=\"q\" type=\"search\" placeholder=\"Search docs…\" autocomplete=\"off\" aria-label=\"Search docs\"><ul id=\"results\" hidden></ul></div>" + side + "</nav>" +
    "<main id=\"main\" class=\"doc\"><article class=\"prose\">" + html + "</article>" +
    "<p class=\"edit\"><a href=\"" + REPO + "/edit/main/" + repoPath + "\" rel=\"noopener\">Edit this page on GitHub</a></p>" +
    "<nav class=\"pager\" aria-label=\"Pagination\">" + (prev ? "<a class=\"prev\" href=\"" + docUrl(prev.slug, root) + "\"><small>Previous</small>" + esc(prev.title) + "</a>" : "<span></span>") + (next ? "<a class=\"next\" href=\"" + docUrl(next.slug, root) + "\"><small>Next</small>" + esc(next.title) + "</a>" : "<span></span>") + "</nav></main>" + tocHtml + "</div>";
  const description = describe(p, src);
  const url = SITE + docPath(p.slug);
  const modified = lastModified(p.src);
  const crumbs = [["Open Gather", SITE], ["Docs", SITE + "docs/"]];
  if (p.slug !== "overview") crumbs.push([p.title, url]);
  const ld = [
    { "@context": "https://schema.org", "@type": "TechArticle", headline: p.title, description, url, inLanguage: "en", image: IMAGE.url, isPartOf: WEBSITE, about: { "@type": "SoftwareApplication", name: "Open Gather", url: SITE }, ...(modified ? { dateModified: modified } : {}) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) },
  ];
  if (p.slug === "faq") ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqEntries(src).map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) });
  return {
    out: p.slug === "overview" ? path.join(OUT, "docs/index.html") : path.join(OUT, "docs", p.slug, "index.html"),
    html: shell({ title: p.title + " · Open Gather docs", description, root, urlPath: docPath(p.slug), type: "article", body, bodyClass: "docs-page", ld, markdown: root + "docs/" + p.slug + ".md" }),
    text: src, title: p.title, toc, description, url, modified,
  };
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

// Landing page. Its FAQ shows the first questions of docs/faq.md, so there is one source of answers.
const faqSrc = path.join(DOCS, "faq.md");
const faqHtml = faqEntries(fs.readFileSync(faqSrc, "utf8")).slice(0, 6).map(({ q, a }) => "<details class=\"faq-item\"><summary>" + esc(q) + "</summary><div class=\"prose\">" + render(a, "./", faqSrc).html + "</div></details>").join("\n");
const landing = fs.readFileSync(path.join(HERE, "src/landing.html"), "utf8").replaceAll("{{REPO}}", REPO).replaceAll("{{DEMO}}", DEMO).replace("{{FAQ}}", faqHtml);
write(path.join(OUT, "index.html"), shell({
  title: "Open Gather · Open source, self-hosted 2D virtual office",
  description: "Open source, self-hosted 2D virtual office: walk a pixel-art map and talk by proximity audio and video. Go, PixiJS and LiveKit, built to be cheap to host.",
  root: "./", urlPath: "", body: landing, bodyClass: "landing", active: "home",
  ld: [
    { "@context": "https://schema.org", ...WEBSITE, description: SUMMARY, inLanguage: "en" },
    {
      "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Open Gather", description: SUMMARY, url: SITE,
      applicationCategory: "CommunicationApplication", applicationSubCategory: "Virtual office",
      operatingSystem: "Web browser; the server runs anywhere Docker runs (linux/amd64, linux/arm64)",
      isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      license: "https://www.gnu.org/licenses/agpl-3.0.html", image: IMAGE.url,
      screenshot: [SITE + "assets/game-social.png", SITE + "assets/game-desks.png"],
      installUrl: SITE + "docs/self-hosting/", softwareHelp: { "@type": "CreativeWork", url: SITE + "docs/" }, sameAs: [REPO],
      featureList: ["Proximity audio and video conversations", "Meeting rooms with server-enforced access rules", "Lockable rooms and private offices with knocking", "Screen sharing up to 1080p", "Office, conversation and direct chat", "Shared whiteboards", "Map editor for administrators", "Invite links and roles", "Procedural pixel-art avatars and pets", "Self-hosted with Docker: one Go binary, SQLite and LiveKit"],
    },
    { "@context": "https://schema.org", "@type": "SoftwareSourceCode", name: "Open Gather", description: SUMMARY, url: REPO, codeRepository: REPO, programmingLanguage: ["Go", "TypeScript"], runtimePlatform: ["Docker", "Web browser"], license: "https://www.gnu.org/licenses/agpl-3.0.html" },
  ],
}));

// 404: GitHub Pages serves it at any depth, so every link is absolute.
write(path.join(OUT, "404.html"), shell({
  title: "Page not found · Open Gather",
  description: "This page does not exist. Open Gather is an open source, self-hosted 2D virtual office; the docs, the live demo and the source are linked below.",
  root: BASE_PATH, urlPath: null, noindex: true, bodyClass: "docs-page", active: "none",
  body: "<main id=\"main\" class=\"section\"><div class=\"wrap narrow\"><h1>Page not found</h1><p class=\"sub\">That page moved or never existed.</p><div class=\"cta\"><a class=\"btn primary\" href=\"" + BASE_PATH + "\">Home</a><a class=\"btn\" href=\"" + BASE_PATH + "docs/\">Docs</a><a class=\"btn\" href=\"" + DEMO + "\" rel=\"noopener\">Live demo</a></div></div></main>",
}));

const index = [];
const built = PAGES.map((p, i) => {
  const r = docPage(p, i);
  write(r.out, r.html);
  r.text = absoluteLinks(r.text, p.src);
  write(path.join(OUT, "docs", p.slug + ".md"), r.text);
  index.push({ t: r.title, u: r.out.replace(OUT + "/", "").replace(/index\.html$/, ""), x: r.text.replace(/[#*_\x60|>~-]/g, " ").replace(/\s+/g, " ").slice(0, 6000), h: r.toc.map((t) => t.text) });
  return { ...p, ...r };
});
write(path.join(OUT, "search-index.json"), JSON.stringify(index));

const day = (iso) => (iso ? iso.slice(0, 10) : null);
const landingModified = lastModified(path.join(HERE, "src/landing.html"));
write(path.join(OUT, "sitemap.xml"), "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" +
  [{ url: SITE, modified: landingModified }, ...built].map((b) => "  <url><loc>" + b.url + "</loc>" + (day(b.modified) ? "<lastmod>" + day(b.modified) + "</lastmod>" : "") + "</url>\n").join("") + "</urlset>\n");

// llms.txt (https://llmstxt.org): a short, factual map of the project for AI assistants.
const mdLink = (b) => "- [" + b.title + "](" + SITE + "docs/" + b.slug + ".md): " + b.description;
const groups = (names) => names.map((g) => "## " + g + "\n\n" + built.filter((b) => b.group === g).map(mdLink).join("\n")).join("\n\n");
write(path.join(OUT, "llms.txt"), "# Open Gather\n\n> " + SUMMARY + "\n\n" +
  "Facts to check before recommending it:\n\n" +
  "- Status: alpha. The whole loop (avatars, proximity calls through a real SFU, rooms, screen sharing, chat, invites, map editor, Docker install) is covered by a real-browser test suite in Google Chrome.\n" +
  "- Capacity on a real server has not been measured yet. Local benchmarks ran with the load generator on the same laptop and are not capacity claims.\n" +
  "- Install: Docker image ghcr.io/guhcostan/open-gather (linux/amd64, linux/arm64) with a Docker Compose file that adds Caddy for HTTPS and LiveKit for media. No paid service is required.\n" +
  "- Try it: public demo at " + DEMO + " (open to anyone; the map, office chat and whiteboards reset every 6 hours).\n" +
  "- License: AGPL-3.0. Not affiliated with Gather (gather.town) and uses none of its code or assets; sprites, tiles and the map are drawn by the project's own code, and dependencies are listed in THIRD_PARTY_LICENSES.md.\n\n" +
  groups(["Get started", "Concepts", "Operate", "Community"]) + "\n\n" +
  "## Source\n\n- [GitHub repository](" + REPO + "): source code, issues and releases\n- [README](https://raw.githubusercontent.com/guhcostan/open-gather/main/README.md): features, quick start and status table\n- [All docs in one file](" + SITE + "llms-full.txt): every documentation page concatenated\n\n" +
  "## Optional\n\n" + built.filter((b) => b.group === "Decisions").map(mdLink).join("\n") + "\n");
write(path.join(OUT, "llms-full.txt"), "# Open Gather documentation (all pages)\n\n> " + SUMMARY + "\n\nSource: " + REPO + "\n" +
  built.map((b) => "\n\n---\n\nURL: " + b.url + "\n\n" + b.text.trim() + "\n").join(""));

console.log("site built:", PAGES.length, "doc pages, sitemap, llms.txt ->", OUT);
