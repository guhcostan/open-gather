// Slice-2 acceptance: two real browsers, movement sync, proximity conversation with real media.
import { resetChecks, rtpBytes, check, summary, launch, joinAs, waitFor, walkTo, pos, others, st, lkParticipants, metrics, sleep } from "../lib.mjs";

export async function run() {
resetChecks();
const browser = await launch();
try {
  const tag = String(Date.now() % 10000);
  const ana = await joinAs(browser, "Ana" + tag);
  const bruno = await joinAs(browser, "Bruno" + tag);
  check("both users connected", ana.id > 0 && bruno.id > 0 && ana.id !== bruno.id);

  const readRoster = () => ana.page.evaluate(() => [...window.__og.state.roster.values()].map((p) => p.n).sort());
  // The roster is pushed over the WebSocket; on a slow browser Bruno's entry can land after joinAs returns.
  await waitFor(async () => (await readRoster()).includes("Bruno" + tag), { what: "Bruno in Ana's roster" }).catch(() => {});
  const roster = await readRoster();
  check("roster shows both people", roster.includes("Ana" + tag) && roster.includes("Bruno" + tag), roster.join());

  await waitFor(async () => (await others(ana)).some((e) => e.id === bruno.id), { what: "Ana sees Bruno" });
  check("Ana sees Bruno's avatar (area of interest)", true);

  // Movement sync: Ana walks right for a while; Bruno must see it, ~within interpolation delay.
  const a0 = await pos(ana);
  await ana.page.evaluate(() => window.__og.view.setDirection(1, 0));
  await sleep(700);
  await ana.page.evaluate(() => window.__og.view.setDirection(0, 0));
  await sleep(500);
  const a1 = await pos(ana);
  const seenByBruno = (await others(bruno)).find((e) => e.id === ana.id);
  check("Ana moved right", a1.x > a0.x + 10, `${a0.x.toFixed(1)} -> ${a1.x.toFixed(1)}`);
  check("Bruno sees Ana at her real position", seenByBruno && Math.hypot(seenByBruno.x - a1.x, seenByBruno.y - a1.y) < 6, JSON.stringify(seenByBruno));

  // Dead reckoning: Bruno only receives state changes, yet must track a 2 s walk closely.
  let maxErr = 0;
  await ana.page.evaluate(() => window.__og.view.setDirection(-1, 0));
  for (let i = 0; i < 18; i++) {
    await sleep(100);
    const real = await pos(ana);
    const seen = (await others(bruno)).find((e) => e.id === ana.id);
    if (seen) maxErr = Math.max(maxErr, Math.hypot(seen.x - real.x, seen.y - real.y));
  }
  await ana.page.evaluate(() => window.__og.view.setDirection(0, 0));
  await sleep(600);
  const realEnd = await pos(ana);
  const seenEnd = (await others(bruno)).find((e) => e.id === ana.id);
  check("remote view tracks a walk from state changes only (max error while moving)", maxErr < 16, maxErr.toFixed(1) + " px");
  check("remote view converges to the exact stop position", seenEnd && Math.hypot(seenEnd.x - realEnd.x, seenEnd.y - realEnd.y) < 3, JSON.stringify([realEnd, seenEnd]));

  // Go to the social area, opt in to media, approach each other.
  await walkTo(ana, 20 * 16 + 8, 28 * 16 + 8);
  await walkTo(bruno, 26 * 16 + 8, 28 * 16 + 8);
  await Promise.all([ana, bruno].map((u) => u.page.evaluate(() => window.__og.session.setConsent(true))));
  await sleep(1200);
  check("far apart: no conversation yet", (await st(ana)).conv === null && (await st(bruno)).conv === null);

  const t0 = Date.now();
  await walkTo(bruno, 20 * 16 + 40, 28 * 16 + 8);
  await waitFor(async () => (await st(ana)).conv?.state === "live" && (await st(bruno)).conv?.state === "live", { timeout: 15000, what: "both live in conversation" });
  check("proximity conversation formed with LiveKit connected", true, `${Date.now() - t0} ms after approach`);

  await waitFor(() => ana.page.evaluate(() => window.__og.media.tiles.length === 2), { what: "2 tiles" });
  const room = await ana.page.evaluate(() => window.__og.media.currentRoom);
  await waitFor(async () => (await lkParticipants(room)).length === 2, { what: "SFU has 2 participants" });
  check("SFU room contains exactly both identities", (await lkParticipants(room)).sort().join() === [ana.id, bruno.id].sort().join());

  // real audio flowing? inbound RTP bytes on Ana's subscriber connection
  const bytes = await waitFor(async () => {
    const n = await rtpBytes(ana, "inbound", "audio");
    return n > 2000 ? n : 0;
  }, { timeout: 15000, what: "inbound audio bytes" });
  check("Ana receives real audio RTP from Bruno", bytes > 2000, `${bytes} bytes`);

  // Bruno turns on camera -> Ana gets a video tile
  await bruno.page.evaluate(() => window.__og.media.setCam(true));
  await waitFor(() => ana.page.evaluate(() => window.__og.media.tiles.some((t) => !t.local && t.cam)), { timeout: 15000, what: "Ana sees Bruno video" });
  const vb = await waitFor(async () => {
    const n = await rtpBytes(ana, "inbound", "video");
    return n > 5000 ? n : 0;
  }, { timeout: 15000, what: "inbound video bytes" });
  check("Ana receives real video RTP from Bruno", vb > 5000, `${vb} bytes`);

  // Walk away: hysteresis + dwell, then server revokes SFU access.
  const before = await metrics();
  await walkTo(bruno, 34 * 16 + 8, 28 * 16 + 8);
  await waitFor(async () => (await st(ana)).conv === null && (await st(bruno)).conv === null, { timeout: 15000, what: "conversation ends" });
  check("moving away ends the conversation for both", true);
  await sleep(1500);
  const after = await metrics();
  check("server revoked SFU access for both", after.og_media_revocations_total - before.og_media_revocations_total >= 2, `revocations +${after.og_media_revocations_total - before.og_media_revocations_total}`);
  check("SFU room is empty after leaving", (await lkParticipants(room)).length === 0);
  check("media capture stopped after leaving (mic/cam off)", (await st(ana)).mic === false && (await st(bruno)).cam === false);

  const errs = [...ana.logs, ...bruno.logs].filter((l) => !/favicon/.test(l));
  check("no console errors in either browser", errs.length === 0, errs.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
return summary();
}
