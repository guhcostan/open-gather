// Captures clean in-game screenshots (world only: no UI overlays, no area labels) for the README and site.
// Needs a running game server that serves the built client. Example:
//   OG_APP=http://127.0.0.1:8091 OG_API=http://127.0.0.1:8091 node screens.mjs
import path from "node:path";
import { launch, joinAs, walkTo, sleep } from "./lib.mjs";

const OUT = path.resolve(import.meta.dirname, "../site/assets");
const CAST = [
  ["Marina", { sk: 2, hs: 1, hc: 0, sh: 4, pa: 1 }],
  ["Bruno", { sk: 4, hs: 5, hc: 4, sh: 1, pa: 7 }],
  ["Carla", { sk: 0, hs: 4, hc: 3, sh: 6, pa: 3 }],
  ["Diego", { sk: 1, hs: 3, hc: 6, sh: 5, pa: 0 }],
  ["Elisa", { sk: 3, hs: 0, hc: 7, sh: 2, pa: 4 }],
];
const c8 = (n) => n * 16 + 8;
const browser = await launch();
try {
  const users = [];
  for (const [n, av] of CAST) users.push(await joinAs(browser, n, { avatar: av }));
  const [marina, bruno, carla, diego, elisa] = users;
  const clean = (u) =>
    u.page.evaluate(() => {
      const st = document.createElement("style");
      st.textContent = ".topbar,.side,.bar,.toast,.debug,.dock{display:none!important}";
      document.head.append(st);
      window.__og.view.areaLabels.forEach((l) => (l.text.alpha = 0));
      window.__og.view.banner.alpha = 0;
    });
  await clean(marina);

  await Promise.all([walkTo(marina, c8(21), c8(19)), walkTo(bruno, c8(24), c8(20)), walkTo(carla, c8(13), c8(17)), walkTo(diego, c8(24), c8(4)), walkTo(elisa, c8(9), c8(9))]);
  await marina.page.evaluate(() => window.__og.view.setDirection(1, 0));
  await sleep(120);
  await marina.page.evaluate(() => window.__og.view.setDirection(0, 0));
  await sleep(700);
  await marina.page.screenshot({ path: path.join(OUT, "game-social.png") });

  await walkTo(marina, c8(22), c8(6));
  await sleep(500);
  await marina.page.screenshot({ path: path.join(OUT, "game-desks.png") });

  await walkTo(marina, c8(9), c8(11));
  await sleep(500);
  await marina.page.screenshot({ path: path.join(OUT, "game-reception.png") });
  console.log("screens done");
} finally {
  await browser.close();
}
