import { spawn } from "node:child_process";
import { launch, joinAs, sleep, waitFor } from "./lib.mjs";
process.env.OG_APP = process.env.OG_API = "http://127.0.0.1:18080";
const b = await launch();
try {
  const r = await fetch("http://127.0.0.1:18080/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Admin", avatar: {} }) });
  const cookie = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  const u = await joinAs(b, "Admin", { cookie });
  await u.page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent === "Editar escritório")?.click());
  await waitFor(() => u.page.$(".editor"), { what: "editor" });
  const info = await u.page.evaluate(() => { const v = window.__og.view; const r = v.app.canvas.getBoundingClientRect(); return { rect: [r.left, r.top, r.width, r.height], cam: [v.camX, v.camY, v.S], top: document.elementFromPoint(400, 300)?.className }; });
  console.log(JSON.stringify(info));
  const p = await u.page.evaluate(() => { const v = window.__og.view; const r = v.app.canvas.getBoundingClientRect(); return { x: r.left + v.camX + (35 * 16 + 8) * v.S, y: r.top + v.camY + (20 * 16 + 8) * v.S }; });
  console.log("target px", p, "tile", await u.page.evaluate((p) => window.__og.view.screenToTile(p.x, p.y), p));
  console.log("elementFromPoint", await u.page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.className, p));
  await u.page.mouse.move(p.x, p.y); await u.page.mouse.down(); await u.page.mouse.move(p.x, p.y + 20); await u.page.mouse.up();
  console.log("wall row 20:", await u.page.evaluate(() => window.__og.view.map.walls[20].slice(30, 40)), u.logs);
} finally { await b.close(); }
