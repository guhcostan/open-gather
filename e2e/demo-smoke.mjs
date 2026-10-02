// Smoke test against a deployed (public) instance using only public endpoints: demo join as member,
// a proximity call with real audio/video RTP, and which ICE path the media actually used.
// usage: TILEWORK_APP=https://office.example.com node demo-smoke.mjs
import { check, summary, resetChecks, launch, joinAs, waitFor, walkTo, st, rtpBytes, sleep } from "./lib.mjs";

const candidate = (u) => u.page.evaluate(async () => {
  const pm = window.__tilework.media.room.engine.pcManager;
  const pc = pm.subscriber?.pc ?? pm.publisher.pc;
  const stats = await pc.getStats();
  let pair = null;
  stats.forEach((s) => { if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") pair = s; });
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
  return { protocol: remote?.protocol, remoteType: remote?.candidateType, localType: local?.candidateType, rttMs: Math.round((pair.currentRoundTripTime ?? 0) * 1000) };
});

resetChecks();
const browser = await launch([], { waitEmpty: false });
try {
  const t = String(Date.now() % 10000);
  const a = await joinAs(browser, "Smoke A" + t);
  const b = await joinAs(browser, "Smoke B" + t);
  const role = await a.page.evaluate(() => window.__tilework.state.role);
  check("demo visitors join without an invite, as members", role === "member", role);
  check("the page announces the public demo", await a.page.evaluate(() => !!window.__tilework.state.demo));
  check("the demo serves the starter office with its six private offices", (await a.page.evaluate(() => window.__tilework.view.map.areas.filter((x) => x.access.mode === "office").length)) === 6);
  await walkTo(a, 22 * 16 + 8, 30 * 16 + 8);
  await walkTo(b, 24 * 16 + 8, 30 * 16 + 8);
  await Promise.all([a, b].map((u) => u.page.evaluate(() => window.__tilework.session.setConsent(true))));
  await waitFor(async () => (await st(a)).conv?.state === "live" && (await st(b)).conv?.state === "live", { timeout: 30000, what: "call live" });
  check("a proximity call connects through the public SFU", true);
  await b.page.evaluate(() => window.__tilework.media.setCam(true));
  await sleep(4000);
  const audio = await rtpBytes(a, "inbound", "audio"), video = await rtpBytes(a, "inbound", "video");
  check("real audio RTP arrives over the internet", audio > 0, audio + " bytes");
  check("real video RTP arrives over the internet", video > 0, video + " bytes");
  const c = await candidate(a);
  console.log("ICE path:", JSON.stringify(c));
  check("media uses UDP (not the TCP fallback)", c?.protocol === "udp", JSON.stringify(c));
  // the chat as a person uses it: both panels open, messages typed into the composer
  for (const u of [a, b]) { await u.page.click('.tabs button[title="Chat"]'); await u.page.waitForSelector(".composer input"); }
  const said = [];
  for (let i = 1; i <= 3; i++) {
    const msg = "smoke " + t + " #" + i;
    said.push(msg);
    await a.page.click(".composer input");
    await a.page.keyboard.type(msg);
    await a.page.keyboard.press("Enter");
    await sleep(600);
  }
  const shown = (u) => u.page.evaluate((said) => said.filter((m) => [...document.querySelectorAll(".msgs .msg span")].some((s) => s.textContent === m)).length, said);
  await waitFor(async () => (await shown(a)) === 3 && (await shown(b)) === 3, { timeout: 15000, what: "chat rendered" }).catch(() => {});
  check("chat typed in the composer renders for sender and receiver and the app stays up", (await shown(a)) === 3 && (await shown(b)) === 3 && !!(await a.page.$(".composer input")) && !!(await b.page.$(".composer input")), (await shown(a)) + "/" + (await shown(b)));
  const errs = [a, b].flatMap((u) => u.logs);
  check("no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}
process.exit(summary() ? 0 : 1);
