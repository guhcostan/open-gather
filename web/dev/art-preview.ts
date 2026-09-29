// Dev-only page: renders the procedural art without a server.
// Open /dev/art-preview.html under Vite (pnpm exec vite). e2e/export-art.mjs reads window.artExport
// to write the sprite sheets and the baked map used by the README and the website.
import { bakeMapCanvas } from "../src/game/art/tiles";
import { CELL_H, CELL_W, drawSheet } from "../src/game/art/characters";
import { HAIR, PANTS, SHIRT, SKIN } from "../src/game/palette";
import map from "./default-map.json";

const params = new URLSearchParams(location.search);
const scale = Number(params.get("s") ?? 4);

// name, skin, hair style, hair colour, shirt, pants  (indexes into palette.ts)
const CAST: [string, number, number, number, number, number][] = [
  ["marina", 2, 1, 0, 4, 1],
  ["bruno", 4, 5, 4, 1, 7],
  ["carla", 0, 4, 3, 6, 3],
  ["diego", 1, 3, 6, 5, 0],
  ["elisa", 3, 0, 7, 2, 4],
  ["fabio", 5, 2, 1, 0, 2],
];
const extra: [string, number, number, number, number, number][] = [
  ["short-blue", 1, 0, 1, 4, 1],
  ["long-blond", 0, 1, 3, 2, 5],
  ["cap-green", 2, 5, 2, 3, 6],
  ["bun-plum", 3, 4, 7, 6, 4],
];

const sheets: Record<string, string> = {};
const host = document.getElementById("sheets")!;
for (const [name, sk, hs, hc, sh, pa] of [...CAST, ...extra]) {
  const c = document.createElement("canvas");
  c.width = CELL_W * 3;
  c.height = CELL_H * 4;
  drawSheet(c.getContext("2d", { willReadFrequently: true })!, { skin: SKIN[sk], hairStyle: hs, hair: HAIR[hc], shirt: SHIRT[sh], pants: PANTS[pa] });
  sheets[name] = c.toDataURL("image/png");
  c.style.width = c.width * scale + "px";
  host.appendChild(c);
}
const mc = bakeMapCanvas({ ...(map as object), tile: 16, solid: [] } as never);
mc.style.width = mc.width * (scale / 2) + "px";
mc.id = "map";
document.getElementById("map")!.replaceWith(mc);
(window as unknown as { artExport: unknown }).artExport = { sheets, map: mc.toDataURL("image/png") };
(window as unknown as { ready: boolean }).ready = true;
