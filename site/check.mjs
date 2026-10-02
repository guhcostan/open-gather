// Checks the built site (site/dist) and the README for discoverability and broken links.
// Usage: node build.mjs && node check.mjs. Exits non-zero and lists every failure.
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const DIST = path.join(HERE, "dist");
const ROOT = path.resolve(HERE, "..");
const SITE = "https://guhcostan.github.io/tilework/";
const BASE = new URL(SITE).pathname; // "/tilework/"
const fails = [];
const fail = (file, msg) => fails.push((file ? path.relative(DIST, file) || file : "") + ": " + msg);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = fs.existsSync(DIST) ? walk(DIST) : [];
const html = files.filter((f) => f.endsWith(".html"));
if (!html.length) fail(DIST, "no HTML pages; run node build.mjs first");

const meta = (src, attr, key) => (new RegExp("<meta " + attr + "=\"" + key + "\" content=\"([^\"]*)\"").exec(src) ?? [])[1];
const urlOf = (file) => SITE + path.relative(DIST, file).replace(/index\.html$/, "");
const decode = (s) => s.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function resolveLocal(from, ref) {
  ref = decode(ref).split("#")[0].split("?")[0];
  if (!ref) return null;
  let p;
  if (ref.startsWith(BASE)) p = path.join(DIST, ref.slice(BASE.length));
  else if (ref.startsWith(SITE)) p = path.join(DIST, ref.slice(SITE.length));
  else if (ref.startsWith("/")) return "absolute path outside the site: " + ref;
  else p = path.resolve(path.dirname(from), ref);
  if (ref.endsWith("/") || (fs.existsSync(p) && fs.statSync(p).isDirectory())) p = path.join(p, "index.html");
  return fs.existsSync(p) ? null : "broken link: " + ref;
}

const titles = new Map();
const ld = new Map();
for (const f of html) {
  const src = fs.readFileSync(f, "utf8");
  if (meta(src, "property", "og:site_name") !== "Tilework") fail(f, "site brand must be Tilework");
  const is404 = path.basename(f) === "404.html";
  const title = (/<title>([^<]*)<\/title>/.exec(src) ?? [])[1];
  if (!title) fail(f, "missing <title>");
  else if (titles.has(title)) fail(f, "duplicate title with " + titles.get(title));
  else titles.set(title, path.relative(DIST, f));
  const desc = decode(meta(src, "name", "description") ?? "");
  if (desc.length < 50 || desc.length > 160) fail(f, "description length " + desc.length + " (want 50-160): " + desc);
  if (/\]\(|[*\x60\[\]]/.test(desc)) fail(f, "Markdown syntax in description: " + desc);
  const canonical = (/<link rel="canonical" href="([^"]+)"/.exec(src) ?? [])[1];
  if (!is404) {
    if (canonical !== urlOf(f)) fail(f, "canonical " + canonical + " != " + urlOf(f));
    if (meta(src, "property", "og:url") !== urlOf(f)) fail(f, "og:url missing or wrong");
  }
  const img = meta(src, "property", "og:image") ?? "";
  if (!img.startsWith("https://")) fail(f, "og:image is not absolute: " + img);
  else if (!fs.existsSync(path.join(DIST, img.slice(SITE.length)))) fail(f, "og:image file missing: " + img);
  if (!meta(src, "property", "og:image:width") || !meta(src, "property", "og:image:height")) fail(f, "og:image width/height missing");
  if (!meta(src, "name", "twitter:image")) fail(f, "twitter:image missing");
  for (const m of src.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = m[1];
    const gh = /^https:\/\/github\.com\/guhcostan\/tilework\/(?:blob|tree)\/main\/([^"#?]+)/.exec(ref);
    if (gh && !fs.existsSync(path.join(ROOT, decodeURIComponent(gh[1])))) fail(f, "GitHub link to a file that does not exist: " + gh[1]);
    if (/^(https?:|mailto:|data:|#)/.test(ref) && !ref.startsWith(SITE)) continue;
    if (is404 && !ref.startsWith("/")) { fail(f, "relative link in 404 page breaks at depth: " + ref); continue; }
    const err = resolveLocal(f, ref);
    if (err) fail(f, err);
    else if (ref.includes("#") && !ref.startsWith("#")) {
      let target = ref.startsWith(SITE) ? path.join(DIST, ref.slice(SITE.length)) : ref.startsWith(BASE) ? path.join(DIST, ref.slice(BASE.length)) : path.resolve(path.dirname(f), ref);
      target = target.split("#")[0];
      if (target.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory())) target = path.join(target, "index.html");
      const id = decode(ref.split("#")[1]);
      if (target.endsWith(".html") && !fs.readFileSync(target, "utf8").includes("id=\"" + id + "\"")) fail(f, "broken anchor: " + ref);
    }
  }
  for (const m of src.matchAll(/href="#([^"]+)"/g)) if (!src.includes("id=\"" + decode(m[1]) + "\"")) fail(f, "broken same-page anchor: #" + m[1]);
  if (/&amp;(quot|amp|lt|gt|#\d+|#x[0-9a-f]+);/i.test(src)) fail(f, "double-escaped entity (shows as &quot; etc.)");
  if (is404 && src.includes("aria-current")) fail(f, "404 page marks a nav item as current");
  const blocks = [...src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try { const v = JSON.parse(m[1]); return Array.isArray(v) ? v : [v]; } catch (e) { fail(f, "JSON-LD does not parse: " + e.message); return []; }
  });
  ld.set(f, { src, blocks, types: new Set(blocks.map((b) => b["@type"])) });
  for (const u of JSON.stringify(blocks).match(/https:\/\/[^"]+/g) ?? []) if (u.startsWith(SITE)) { const err = resolveLocal(f, u); if (err) fail(f, "JSON-LD " + err); }
}

const landing = ld.get(path.join(DIST, "index.html"));
for (const t of ["SoftwareApplication", "SoftwareSourceCode", "WebSite"]) if (!landing?.types.has(t)) fail("index.html", "JSON-LD " + t + " missing");
const faqFile = path.join(DIST, "docs/faq/index.html");
const faq = ld.get(faqFile);
if (!faq) fail(faqFile, "FAQ page missing");
else {
  const q = faq.blocks.find((b) => b["@type"] === "FAQPage")?.mainEntity?.map((e) => e.name) ?? [];
  const h2 = [...faq.src.matchAll(/<h2 [^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]).replace(/^#/, ""));
  if (!q.length || JSON.stringify(q) !== JSON.stringify(h2)) fail(faqFile, "FAQPage questions != visible H2s\n  ld: " + JSON.stringify(q) + "\n  h2: " + JSON.stringify(h2));
  if (faq.blocks.find((b) => b["@type"] === "FAQPage")?.mainEntity?.some((e) => !e.acceptedAnswer?.text || e.acceptedAnswer.text.length < 20)) fail(faqFile, "an FAQ answer is empty");
}
for (const [f, v] of ld) if (f.includes(path.sep + "docs" + path.sep) && !v.types.has("BreadcrumbList")) fail(f, "BreadcrumbList missing");
const docsIndex = ld.get(path.join(DIST, "docs/index.html"))?.src ?? "";
for (const slug of ["self-hosting", "faq"]) if (!docsIndex.includes("docs/" + slug + "/\"")) fail("docs/index.html", "sidebar has no link to " + slug);

const sitemapFile = path.join(DIST, "sitemap.xml");
if (!fs.existsSync(sitemapFile)) fail(sitemapFile, "missing");
else {
  const locs = [...fs.readFileSync(sitemapFile, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const want = html.filter((f) => path.basename(f) !== "404.html").map(urlOf).sort();
  if (JSON.stringify([...locs].sort()) !== JSON.stringify(want)) fail(sitemapFile, "URLs differ from built pages (" + locs.length + " vs " + want.length + ")");
}

const llms = path.join(DIST, "llms.txt");
if (!fs.existsSync(llms)) fail(llms, "missing");
else {
  const t = fs.readFileSync(llms, "utf8");
  if (!/^# .+\n\n> .+/.test(t) || !/\n## /.test(t)) fail(llms, "not in llms.txt shape (H1, blockquote, H2 sections)");
  for (const m of t.matchAll(/\]\((https:[^)]+)\)/g)) if (m[1].startsWith(SITE)) {
    const err = resolveLocal(llms, m[1]);
    if (err) fail(llms, err);
  }
}
const full = path.join(DIST, "llms-full.txt");
if (!fs.existsSync(full) || fs.statSync(full).size < 10000) fail(full, "missing or too small");
// Markdown read outside the site: every link must be absolute.
for (const f of [full, llms, ...files.filter((x) => x.endsWith(".md"))]) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  const refs = [...t.matchAll(/\]\(<?([^)>\s]+)/g), ...t.matchAll(/^\[[^\]]+\]:\s*<?(\S+?)>?$/gm), ...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) if (!/^(https?:|mailto:|#)/.test(ref)) fail(f, "relative link in Markdown copy: " + ref);
}
const searchFile = path.join(DIST, "search-index.json");
if (!fs.existsSync(searchFile)) fail(searchFile, "missing");
else for (const e of JSON.parse(fs.readFileSync(searchFile, "utf8"))) {
  const err = resolveLocal(path.join(DIST, "index.html"), e.u || "./");
  if (err) fail(searchFile, err);
  if (e.h.some((h) => /&(quot|amp|lt|gt|#\d+);/.test(h))) fail(searchFile, "escaped entity in headings of " + e.u);
}
for (const f of html) {
  const rel = path.relative(path.join(DIST, "docs"), f);
  if (rel.startsWith("..") || path.basename(f) === "404.html") continue;
  const md = rel === "index.html" ? "overview.md" : path.dirname(rel) + ".md";
  if (!fs.existsSync(path.join(DIST, "docs", md))) fail(f, "no Markdown copy at docs/" + md);
}

const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const head = readme.split("\n").slice(0, 30).join("\n").toLowerCase();
for (const w of ["open source", "self-hosted", "virtual office", "proximity"]) if (!head.includes(w)) fail("README.md", "first 30 lines lack \"" + w + "\"");
for (const w of ["llms.txt", "docs/faq", "star"]) if (!readme.toLowerCase().includes(w)) fail("README.md", "no mention of " + w);
for (const m of readme.matchAll(/(?:\]\(|(?:href|src)=")([^)"#\s]+)/g)) {
  const ref = m[1];
  if (/^(https?:|mailto:)/.test(ref)) continue;
  if (!fs.existsSync(path.join(ROOT, ref))) fail("README.md", "broken relative link: " + ref);
}

if (fails.length) {
  console.error(fails.length + " check(s) failed:\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("site check ok: " + html.length + " pages, sitemap, llms.txt, JSON-LD, links and README");
