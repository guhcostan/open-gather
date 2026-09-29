// Self-contained acceptance runner: fresh SQLite DB, production-style static serving,
// real Chrome (fake camera/mic) and a real LiveKit server. Usage: node run.mjs [scenario ...]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.OG_TEST_PORT ?? "18080";
process.env.OG_APP = process.env.OG_API = `http://127.0.0.1:${PORT}`;
process.env.OG_LK_HTTP ??= "http://127.0.0.1:7880";

const all = ["proximity", "consent", "rooms", "access", "editor", "resilience"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (p) => new Promise((res) => { const s = net.connect(p, "127.0.0.1"); s.on("connect", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });

if (!process.env.SKIP_BUILD) {
  console.log("# building web + server");
  execFileSync("pnpm", ["build"], { cwd: path.join(root, "web"), stdio: "inherit" });
  execFileSync("go", ["build", "-o", "../bin/opengather", "./cmd/opengather"], { cwd: path.join(root, "server"), stdio: "inherit" });
}

if (!(await portOpen(7880))) {
  console.log("# starting livekit-server --dev");
  children.push(spawn("livekit-server", ["--dev", "--bind", "127.0.0.1"], { stdio: "ignore" }));
  for (let i = 0; i < 50 && !(await portOpen(7880)); i++) await sleep(200);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-e2e-"));
const ctx = { dir, server: null, async startServer() {
  const child = spawn(path.join(root, "bin/opengather"), [], {
    env: { ...process.env, OG_ENV: "dev", OG_ADDR: `127.0.0.1:${PORT}`, OG_DB: path.join(dir, "e2e.db"), OG_STATIC_DIR: path.join(root, "web/dist"),
      OG_ALLOWED_ORIGINS: `127.0.0.1:${PORT}`, LIVEKIT_URL: "ws://127.0.0.1:7880", LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret" },
    stdio: ["ignore", fs.openSync(path.join(dir, "server.log"), "a"), fs.openSync(path.join(dir, "server.log"), "a")],
  });
  ctx.server = child;
  for (let i = 0; i < 50 && !(await portOpen(Number(PORT))); i++) await sleep(100);
}, async stopServer() {
  if (!ctx.server) return;
  const c = ctx.server; ctx.server = null;
  const done = new Promise((r) => c.once("exit", r));
  c.kill("SIGTERM");
  await done;
} };
await ctx.startServer();
console.log("# server logs:", path.join(dir, "server.log"));

let ok = true;
try {
  // Bootstrap the office admin (the first member of an office becomes admin).
  const r = await fetch(process.env.OG_API + "/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Admin", avatar: { sk: 2, hs: 2, hc: 0, sh: 6, pa: 0 } }) });
  const cookie = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  ctx.adminCookie = cookie;
  ctx.adminId = (await r.json()).id;
  for (const name of wanted) {
    console.log(`\n== ${name} ==`);
    const mod = await import(`./scenarios/${name}.mjs`);
    const passed = await mod.run(ctx);
    ok = ok && passed;
  }
} catch (e) {
  console.error("runner error:", e);
  ok = false;
} finally {
  await ctx.stopServer();
  for (const c of children) c.kill("SIGTERM");
}
console.log(ok ? "\nALL SCENARIOS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
