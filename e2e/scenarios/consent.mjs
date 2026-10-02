// Consent, busy status and eligibility for automatic conversations.
import { check, launch, joinAs, waitFor, walkTo, st, sleep, resetChecks } from "../lib.mjs";

export async function run() {
  resetChecks();
  const browser = await launch();
  try {
    const t = String(Date.now() % 10000);
    const a = await joinAs(browser, "Cia" + t);
    const b = await joinAs(browser, "Cib" + t);
    await walkTo(a, 12 * 16 + 8, 30 * 16 + 8);
    await walkTo(b, 12 * 16 + 40, 30 * 16 + 8);

    await sleep(2500);
    check("standing next to each other WITHOUT consent: no conversation, no capture", (await st(a)).conv === null && (await st(b)).conv === null && !(await st(a)).mic);

    // consent only from A -> still no conversation (both must opt in)
    await a.page.evaluate(() => window.__tilework.session.setConsent(true));
    await sleep(2500);
    check("consent from only one side does not create a conversation", (await st(a)).conv === null && (await st(b)).conv === null);

    // B is busy and consents: busy blocks automatic entry
    await b.page.evaluate(() => { window.__tilework.session.setStatus("busy"); window.__tilework.session.setConsent(true); });
    await sleep(2500);
    check("Busy blocks automatic entry into conversations", (await st(a)).conv === null && (await st(b)).conv === null);

    await b.page.evaluate(() => window.__tilework.session.setStatus("available"));
    await waitFor(async () => (await st(a)).conv?.state === "live" && (await st(b)).conv?.state === "live", { timeout: 15000, what: "conversation after B became available" });
    check("conversation forms once both are Available and consented", true);

    await b.page.evaluate(() => window.__tilework.session.setStatus("busy"));
    await waitFor(async () => (await st(b)).conv === null, { timeout: 8000, what: "B leaves when busy" });
    // Leaving is asynchronous (the room disconnects and tracks stop); it must finish within a moment.
    const stopped = await waitFor(async () => (await st(b)).mic === false && (await b.page.evaluate(() => window.__tilework.media.room === null || window.__tilework.media.room === undefined)), { timeout: 4000, what: "capture stops" }).catch(() => false);
    check("becoming Busy leaves the conversation and stops B's capture", !!stopped);

    // Invisible: other clients no longer see the avatar; roster shows offline
    await b.page.evaluate(() => window.__tilework.session.setStatus("invisible"));
    await sleep(800);
    const seen = await a.page.evaluate((id) => window.__tilework.view.debugEntities().some((e) => e.id === id), b.id);
    const rosterSt = await a.page.evaluate((id) => window.__tilework.state.roster.get(id)?.s, b.id);
    check("Invisible hides the avatar from others and shows offline in the roster", !seen && rosterSt === "offline", "seen=" + seen + " roster=" + rosterSt);

    // Consent revoked by the user: leaves immediately
    await b.page.evaluate(() => { window.__tilework.session.setStatus("available"); });
    await waitFor(async () => (await st(b)).conv?.state === "live", { timeout: 15000, what: "rejoin" });
    await b.page.evaluate(() => window.__tilework.session.setConsent(false));
    await waitFor(async () => (await st(b)).conv === null, { timeout: 5000, what: "leave on consent off" });
    check("turning consent off leaves the conversation immediately", true);

    const errs = [...a.logs, ...b.logs];
    check("no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
  return (await import("../lib.mjs")).summary();
}
