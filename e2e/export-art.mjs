// Writes the sprite sheets and the baked office map to site/assets from the art code.
// Needs only the Vite dev server (cd web && pnpm exec vite --port 5180); no game server.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const URL = process.env.ART_PREVIEW_URL ?? "http://127.0.0.1:5180/dev/art-preview.html";
const OUT = path.resolve(import.meta.dirname, "../site/assets");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-first-run"],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForFunction("window.ready === true", { timeout: 15000 });
const art = await page.evaluate(() => window.artExport);
const save = (name, url) => fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(",")[1], "base64"));
for (const [name, url] of Object.entries(art.sheets)) save("sheet-" + name + ".png", url);
save("map.png", art.map);
await browser.close();
console.log("exported", Object.keys(art.sheets).length, "sheets and the map to", OUT);
