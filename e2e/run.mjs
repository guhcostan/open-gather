// Self-contained acceptance runner: fresh SQLite DB, production-style static serving,
// real Chrome (fake camera/mic) and a real LiveKit server. Usage: node run.mjs [scenario ...]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// TILEWORK_EXTERNAL_URL=http://127.0.0.1:8080 runs the scenarios against an already running stack (for example
// the Docker Compose one). Scenarios that restart the server or spawn the local binary are skipped there.
const EXTERNAL = process.env.TILEWORK_EXTERNAL_URL ?? "";
const PORT = process.env.TILEWORK_TEST_PORT ?? "18080";
process.env.TILEWORK_APP = process.env.TILEWORK_API = EXTERNAL || `http://127.0.0.1:${PORT}`;
process.env.TILEWORK_LK_HTTP ??= "http://127.0.0.1:7880";

const all = ["proximity", "consent", "rooms", "access", "editor", "social", "admin", "a11y", "security", "resilience", "features", "spotlight", "movement", "presence", "offices"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : EXTERNAL ? ["proximity", "consent", "rooms"] : all;

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (p) => new Promise((res) => { const s = net.connect(p, "127.0.0.1"); s.on("connect", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });

if (!process.env.SKIP_BUILD && !EXTERNAL) {
  console.log("# building web + server");
  execFileSync("pnpm", ["build"], { cwd: path.join(root, "web"), stdio: "inherit" });
  execFileSync("go", ["build", "-o", "../bin/tilework", "./cmd/tilework"], { cwd: path.join(root, "server"), stdio: "inherit" });
}

if (!EXTERNAL && !(await portOpen(7880))) {
  console.log("# starting livekit-server --dev");
  children.push(spawn("livekit-server", ["--dev", "--bind", "127.0.0.1"], { stdio: "ignore" }));
  for (let i = 0; i < 50 && !(await portOpen(7880)); i++) await sleep(200);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tilework-e2e-"));
const ctx = { dir, server: null, async startServer() {
  const child = spawn(path.join(root, "bin/tilework"), [], {
    env: { ...process.env, TILEWORK_ENV: "dev", TILEWORK_ADDR: `127.0.0.1:${PORT}`, TILEWORK_DB: path.join(dir, "e2e.db"), TILEWORK_STATIC_DIR: path.join(root, "web/dist"),
      TILEWORK_ALLOWED_ORIGINS: `127.0.0.1:${PORT}`, LIVEKIT_URL: "ws://127.0.0.1:7880", LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret",
      TILEWORK_JOIN_RATE: "5000", TILEWORK_MEDIA_TOKEN_TTL_SECONDS: process.env.TILEWORK_MEDIA_TOKEN_TTL_SECONDS ?? "20", TILEWORK_MEDIA_RECONCILE_SECONDS: process.env.TILEWORK_MEDIA_RECONCILE_SECONDS ?? "3" },
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
if (!EXTERNAL) await ctx.startServer();
console.log("# server logs:", path.join(dir, "server.log"));

let ok = true;
try {
  // Bootstrap the office admin (the first member of an office becomes admin).
  const r = await fetch(process.env.TILEWORK_API + "/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Admin", avatar: { sk: 2, hs: 2, hc: 0, sh: 6, pa: 0 } }) });
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
