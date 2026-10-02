// Invites, administrator-only actions and production-mode safety. HTTP-level checks (no browser needed).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, summary, resetChecks, API } from "../lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const post = (p, body, cookie) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: "tilework_session=" + cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie")?.split(";")[0].split("=")[1];

export async function run(ctx) {
  resetChecks();
  // 1. Only admins can mint invites.
  const anon = await post("/api/invites", {});
  check("anonymous callers cannot create invites", anon.status === 401, "status " + anon.status);
  const mj = await post("/api/join", { name: "Membro", avatar: {} });
  const memberCookie = cookieOf(mj);
  const asMember = await post("/api/invites", { role: "member" }, memberCookie);
  check("a member cannot create invites (admin-only action enforced by the server)", asMember.status === 403, "status " + asMember.status);
  const asAdmin = await post("/api/invites", { role: "member", maxUses: 2, hours: 1 }, ctx.adminCookie);
  const inv = await asAdmin.json();
  check("an admin can create an invite", asAdmin.status === 200 && typeof inv.token === "string" && inv.token.length >= 30);

  // 2. Invite semantics: role, use limit, invalid token
  const j1 = await post("/api/join", { name: "Conv1", avatar: {}, invite: inv.token });
  const j2 = await post("/api/join", { name: "Conv2", avatar: {}, invite: inv.token });
  const j3 = await post("/api/join", { name: "Conv3", avatar: {}, invite: inv.token });
  check("invite works for its allowed number of uses only", j1.status === 200 && j2.status === 200 && j3.status === 403, [j1.status, j2.status, j3.status].join("/"));
  const bad = await post("/api/join", { name: "X", avatar: {}, invite: "not-a-real-token" });
  check("an unknown invite is rejected", bad.status === 403);
  const me = await (await fetch(API + "/api/me", { headers: { Cookie: "tilework_session=" + cookieOf(j1) } })).json();
  check("invited user gets the role stored in the invite (member)", me.role === "member" && me.authenticated);
  const admInv = await (await post("/api/invites", { role: "admin", maxUses: 1, hours: 1 }, ctx.adminCookie)).json();
  const ja = await post("/api/join", { name: "SegundoAdmin", avatar: {}, invite: admInv.token });
  const meA = await (await fetch(API + "/api/me", { headers: { Cookie: "tilework_session=" + cookieOf(ja) } })).json();
  check("an admin invite creates an administrator", meA.role === "admin");

  // 3. Input validation
  const longName = await post("/api/join", { name: "N".repeat(500), avatar: { sk: 999, hs: -4 } });
  const lm = await (await fetch(API + "/api/me", { headers: { Cookie: "tilework_session=" + cookieOf(longName) } })).json();
  check("names are bounded and avatar fields are clamped server-side", lm.name.length <= 24 && lm.avatar.sk === 0 && lm.avatar.hs === 0, JSON.stringify({ n: lm.name.length, av: lm.avatar }));
  const huge = await fetch(API + "/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(100000) });
  check("oversized request bodies are rejected", huge.status === 400, "status " + huge.status);

  // 4. Production mode refuses insecure configuration
  const bin = path.join(root, "bin/tilework");
  const tries = [
    ["no LiveKit keys", { TILEWORK_ENV: "production" }],
    ["default dev key", { TILEWORK_ENV: "production", LIVEKIT_URL: "wss://x.example", LIVEKIT_API_KEY: "devkey", LIVEKIT_API_SECRET: "secret" }],
    ["ws:// media URL", { TILEWORK_ENV: "production", LIVEKIT_URL: "ws://x.example", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s".repeat(40), TILEWORK_ALLOWED_ORIGINS: "x.example" }],
  ];
  for (const [what, env] of tries) {
    const r = spawnSync(bin, [], { env: { PATH: process.env.PATH, TILEWORK_DB: path.join(ctx.dir, "prod-check.db"), ...env }, timeout: 5000 });
    check("production refuses to start: " + what, r.status === 2, "exit " + r.status);
  }
  const prodJoin = spawnSync(bin, ["-invite", "member"], { env: { PATH: process.env.PATH, TILEWORK_DB: path.join(ctx.dir, "cli-invite.db") }, encoding: "utf8" });
  check("CLI can mint a bootstrap invite (-invite)", prodJoin.status === 0 && prodJoin.stdout.startsWith("/?invite="), prodJoin.stdout.trim().slice(0, 20) + "…");
  const bk = path.join(ctx.dir, "backup.db");
  const b = spawnSync(bin, ["-backup", bk], { env: { PATH: process.env.PATH, TILEWORK_DB: path.join(ctx.dir, "e2e.db") }, encoding: "utf8" });
  check("online backup (VACUUM INTO) works while the server is running", b.status === 0, b.stdout.trim() || b.stderr.trim());
  return summary();
}
