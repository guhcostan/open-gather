// Static checks for bug classes that slipped past tsc and the browser suite once.
// Run: node scripts/lint-web.mjs  (part of scripts/gauntlet.sh)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../web/src");
const rules = [
  {
    // An expression-bodied effect returns its value to React as the cleanup. Chrome 154 made
    // scrollIntoView() return a Promise and the chat panel crashed the whole UI on the next message.
    id: "effect-returns-value",
    re: /use(?:Layout|Insertion)?Effect\(\(\)\s*=>\s*(?![\s{])/g,
    fix: "give the effect a block body: useEffect(() => { ... }, deps)",
  },
  {
    // An async effect returns a Promise to React as its cleanup: the same crash.
    id: "async-effect",
    re: /use(?:Layout|Insertion)?Effect\(\s*async\b/g,
    fix: "call an async function from inside a synchronous effect",
  },
  {
    // User-visible text goes through the i18n dictionary (AGENTS.md).
    id: "inline-ui-text",
    re: /(?:aria-label|title|placeholder)="[A-Za-z][^"]*\s[^"]*"/g,
    fix: "move the string to web/src/i18n.ts and use t()",
  },
];

let bad = 0;
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f.name)) {
      const src = fs.readFileSync(p, "utf8");
      for (const r of rules) {
        for (const m of src.matchAll(r.re)) {
          const line = src.slice(0, m.index).split("\n").length;
          console.log(`${path.relative(process.cwd(), p)}:${line} ${r.id}: ${r.fix}`);
          bad++;
        }
      }
    }
  }
};
walk(root);
console.log(bad ? `${bad} problem(s)` : "web lint clean");
process.exit(bad ? 1 : 0);
