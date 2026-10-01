import { blob, dark, light, mix, px, rgb, type Ctx } from "./pixel";

// Companion pets: small 3/4-view critters that trot after their owner. Drawn by code, like
// everything else; nothing is traced or extracted from any game.
// Content is 14 x 14 px inside a 16 x 16 cell (1 px outline margin). Rows: down, left, right, up;
// columns: idle, step A, step B.
export const PET_W = 16;
export const PET_H = 16;
export const PET_FEET_Y = 14;

export const PET_KINDS = ["none", "cat", "dog", "bunny", "fox", "chick", "slime", "owl", "axolotl"] as const;
export type PetKind = (typeof PET_KINDS)[number];

const EYE = "#241c34";
const SHADOW = "rgba(40,24,90,0.30)";

type R = (x: number, y: number, w: number, h: number, c: string) => void;

interface Quad {
  body: string;
  belly: string;
  accent: string; // ears / spots
  inner: string; // inner ear
  nose: string;
  ear: "point" | "flop" | "long";
  tail: "long" | "short" | "puff" | "bushy";
  muzzle: boolean;
}

const QUADS: Record<string, Quad> = {
  cat: { body: "#e8964a", belly: "#f8e2c4", accent: "#c26a2c", inner: "#f4a0a8", nose: "#e86878", ear: "point", tail: "long", muzzle: false },
  dog: { body: "#c99560", belly: "#f2dfc2", accent: "#7a4f30", inner: "#7a4f30", nose: "#2e2238", ear: "flop", tail: "short", muzzle: true },
  bunny: { body: "#f1eef8", belly: "#ffffff", accent: "#d8d2e8", inner: "#f6a8b8", nose: "#f0889c", ear: "long", tail: "puff", muzzle: false },
  fox: { body: "#e66a2a", belly: "#fff4e4", accent: "#4a2c2a", inner: "#4a2c2a", nose: "#2e2238", ear: "point", tail: "bushy", muzzle: true },
};

function legs(r: R, q: Quad, xs: number[], frame: number) {
  const c = dark(q.body, 0.18);
  xs.forEach((x, i) => {
    const up = (frame === 1 && i % 2 === 0) || (frame === 2 && i % 2 === 1);
    r(x, 11, 2, up ? 1 : 2, i < 2 ? q.body : c);
  });
}

function quadFront(r: R, q: Quad, frame: number, back: boolean) {
  const bob = 0;
  r(3, 13, 8, 1, SHADOW);
  legs(r, q, [4, 8], frame);
  // body
  r(3, 8 + bob, 8, 4, q.body);
  r(3, 11 + bob, 8, 1, dark(q.body, 0.2));
  if (!back) r(5, 9 + bob, 4, 2, q.belly);
  // tail
  if (back) {
    switch (q.tail) {
      case "long": r(6, 9, 2, 3, q.body); r(6, 7, 1, 2, q.body); break;
      case "short": r(6, 10, 2, 2, q.body); break;
      case "puff": r(5, 9, 4, 3, "#ffffff"); r(6, 9, 2, 1, light("#ffffff")); break;
      case "bushy": r(5, 8, 4, 4, q.body); r(5, 11, 4, 1, q.belly); break;
    }
  } else if (q.tail === "long") r(11, 6, 1, 4, q.body);
  else if (q.tail === "bushy") { r(11, 7, 2, 3, q.body); r(12, 7, 1, 1, q.belly); }
  // ears (behind the head)
  switch (q.ear) {
    case "point":
      r(2, 1, 3, 3, q.body); r(9, 1, 3, 3, q.body);
      r(2, 0, 2, 1, q.body); r(10, 0, 2, 1, q.body);
      if (!back) { r(3, 2, 1, 1, q.inner); r(10, 2, 1, 1, q.inner); }
      break;
    case "long":
      r(3, -1, 2, 5, q.body); r(9, -1, 2, 5, q.body);
      if (!back) { r(4, 0, 1, 3, q.inner); r(9, 0, 1, 3, q.inner); }
      break;
    case "flop":
      break;
  }
  // head
  r(3, 3, 8, 1, q.body);
  r(2, 4, 10, 4, q.body);
  r(3, 8, 8, 1, dark(q.body, 0.12));
  r(3, 4, 3, 1, light(q.body, 0.22));
  if (q.ear === "flop") { r(1, 4, 2, 4, q.accent); r(11, 4, 2, 4, q.accent); }
  if (back) return;
  if (q.muzzle) r(5, 6, 4, 2, q.belly);
  r(4, 5, 1, 2, EYE);
  r(9, 5, 1, 2, EYE);
  r(6, 6, 2, 1, q.nose);
  r(3, 7, 1, 1, mix(q.body, "#ff7c86", 0.45));
  r(10, 7, 1, 1, mix(q.body, "#ff7c86", 0.45));
}

function quadSide(r: R, q: Quad, frame: number) {
  r(2, 13, 10, 1, SHADOW);
  // tail (behind the body)
  switch (q.tail) {
    case "long": r(12, 4, 1, 5, q.body); r(11, 8, 2, 1, q.body); break;
    case "short": r(12, 6, 2, 2, q.body); break;
    case "puff": r(11, 7, 3, 3, "#ffffff"); break;
    case "bushy": r(11, 5, 3, 5, q.body); r(12, 9, 2, 1, q.belly); r(13, 5, 1, 1, q.belly); break;
  }
  // legs: front pair and back pair swing in opposite phase
  const f = frame === 1 ? -1 : frame === 2 ? 1 : 0;
  r(4 + f, 11, 2, 2, q.body);
  r(9 - f, 11, 2, 2, dark(q.body, 0.18));
  // body
  r(4, 7, 8, 4, q.body);
  r(4, 10, 8, 1, dark(q.body, 0.2));
  r(5, 9, 5, 1, q.belly);
  r(5, 7, 5, 1, light(q.body, 0.2));
  // ears
  if (q.ear === "point") { r(3, 0, 3, 3, q.body); r(4, 1, 1, 1, q.inner); }
  if (q.ear === "long") { r(4, -1, 2, 4, q.body); r(4, 0, 1, 2, q.inner); }
  // head (facing left)
  r(1, 2, 6, 1, q.body);
  r(0, 3, 7, 4, q.body);
  r(1, 7, 6, 1, dark(q.body, 0.12));
  r(2, 3, 3, 1, light(q.body, 0.22));
  if (q.ear === "flop") r(4, 3, 2, 4, q.accent);
  if (q.muzzle) { r(-1, 5, 3, 2, q.belly); r(-1, 5, 1, 1, q.nose); }
  else r(0, 5, 1, 1, q.nose);
  r(2, 4, 1, 2, EYE);
}

function chick(r: R, ctx: Ctx, ox: number, oy: number, dir: number, frame: number) {
  const body = "#ffd84a", wing = "#f2b52e", beak = "#f08a2c";
  const hop = frame === 1 ? -1 : 0;
  r(3, 13, 8, 1, SHADOW);
  r(5, 11, 1, 2, beak); r(8, 11, 1, 2, beak);
  if (frame === 2) r(8, 12, 2, 1, beak); else r(4, 12, 2, 1, beak);
  blob(ctx, ox + 1 + 7, oy + 1 + 7.5 + hop, 5, 4.5, body, null);
  r(5, 3 + hop, 4, 1, light(body, 0.3));
  r(6, 2 + hop, 2, 1, body); // tuft
  if (dir === 3) { r(3, 7 + hop, 2, 3, wing); r(9, 7 + hop, 2, 3, wing); return; }
  if (dir === 1) {
    r(7, 7 + hop, 3, 3, wing);
    r(4, 6 + hop, 1, 2, EYE);
    r(1, 7 + hop, 2, 1, beak);
    return;
  }
  r(2, 8 + hop, 2, 2, wing); r(10, 8 + hop, 2, 2, wing);
  r(5, 6 + hop, 1, 2, EYE); r(8, 6 + hop, 1, 2, EYE);
  r(6, 8 + hop, 2, 1, beak);
}

function slime(r: R, ctx: Ctx, ox: number, oy: number, dir: number, frame: number) {
  const body = "#3fc9a6";
  const squish = frame === 1 ? 1 : frame === 2 ? -1 : 0; // wider + shorter, then taller
  const rx = 6 + squish * 0.6, ry = 4.5 - squish * 0.8;
  r(2, 13, 10, 1, SHADOW);
  blob(ctx, ox + 1 + 7, oy + 1 + 12.5 - ry, rx, ry, body, null);
  r(Math.round(7 - rx), 12, Math.round(rx * 2), 1, dark(body, 0.25));
  const top = Math.round(12.5 - ry * 2) + 1;
  r(4, top + 1, 2, 1, light(body, 0.6));
  r(4, top + 2, 1, 1, light(body, 0.45));
  if (dir === 3) return;
  const ey = Math.round(12.5 - ry) - 1;
  if (dir === 1) { r(3, ey, 1, 2, EYE); r(6, ey, 1, 2, EYE); return; }
  r(5, ey, 1, 2, EYE); r(9, ey, 1, 2, EYE);
  r(6, ey + 2, 3, 1, dark(body, 0.45));
}

function owl(r: R, ctx: Ctx, ox: number, oy: number, dir: number, frame: number) {
  const body = "#8c6a4e", belly = "#e8d4b0", feet = "#f0b040";
  const hop = frame === 1 ? -1 : 0;
  r(3, 13, 8, 1, SHADOW);
  r(5, 12, 1, 1, feet); r(8, 12, 1, 1, feet);
  blob(ctx, ox + 1 + 7, oy + 1 + 7.5 + hop, 5, 5, body, null);
  r(3, 2 + hop, 2, 2, body); r(9, 2 + hop, 2, 2, body); // tufts
  if (dir === 3) { r(4, 7 + hop, 6, 1, dark(body, 0.2)); r(5, 9 + hop, 4, 1, dark(body, 0.2)); return; }
  if (dir === 1) {
    r(2, 5 + hop, 3, 3, "#ffffff"); r(2, 6 + hop, 1, 1, EYE);
    r(1, 8 + hop, 1, 1, feet);
    r(7, 7 + hop, 4, 4, dark(body, 0.18));
    return;
  }
  r(5, 9 + hop, 4, 3, belly);
  r(3, 5 + hop, 3, 3, "#ffffff"); r(8, 5 + hop, 3, 3, "#ffffff");
  r(4, 6 + hop, 1, 1, EYE); r(9, 6 + hop, 1, 1, EYE);
  r(6, 8 + hop, 2, 1, feet);
}

function axolotl(r: R, ctx: Ctx, ox: number, oy: number, dir: number, frame: number) {
  const body = "#f7a8c4", gill = "#e8507e", belly = "#ffd6e4";
  const f = frame === 1 ? -1 : frame === 2 ? 1 : 0;
  r(2, 13, 10, 1, SHADOW);
  if (dir === 1) {
    r(4 + f, 11, 2, 2, body); r(9 - f, 11, 2, 2, dark(body, 0.15));
    r(10, 8, 4, 2, body); r(13, 7, 1, 2, gill); // tail
    blob(ctx, ox + 1 + 7.5, oy + 1 + 9, 4.5, 2.5, body, null);
    blob(ctx, ox + 1 + 4, oy + 1 + 5.5, 4, 3.5, body, null);
    r(4, 1, 1, 2, gill); r(6, 2, 1, 2, gill); r(7, 4, 2, 1, gill);
    r(2, 5, 1, 1, EYE); r(0, 7, 2, 1, dark(body, 0.35));
    return;
  }
  r(4, 11, 2, frame === 1 ? 1 : 2, body); r(8, 11, 2, frame === 2 ? 1 : 2, body);
  blob(ctx, ox + 1 + 7, oy + 1 + 9.5, 4, 2.5, body, null);
  if (dir === 3) r(6, 11, 2, 2, body);
  // gills: three fronds a side
  r(0, 3, 2, 1, gill); r(0, 5, 2, 1, gill); r(1, 7, 2, 1, gill);
  r(12, 3, 2, 1, gill); r(12, 5, 2, 1, gill); r(11, 7, 2, 1, gill);
  blob(ctx, ox + 1 + 7, oy + 1 + 5.5, 5, 3.5, body, null);
  r(4, 3, 3, 1, light(body, 0.3));
  if (dir === 3) return;
  r(9 - 4, 9, 4, 2, belly);
  r(4, 5, 1, 2, EYE); r(9, 5, 1, 2, EYE);
  r(6, 7, 2, 1, dark(body, 0.4));
}

export function drawPet(ctx: Ctx, ox: number, oy: number, dir: number, frame: number, kind: number) {
  const name = PET_KINDS[kind];
  const r: R = (x, y, w, h, c) => px(ctx, ox + 1 + x, oy + 1 + y, w, h, c);
  const q = QUADS[name];
  if (q) {
    if (dir === 1) quadSide(r, q, frame);
    else quadFront(r, q, frame, dir === 3);
    return;
  }
  if (name === "chick") chick(r, ctx, ox, oy, dir, frame);
  else if (name === "slime") slime(r, ctx, ox, oy, dir, frame);
  else if (name === "owl") owl(r, ctx, ox, oy, dir, frame);
  else if (name === "axolotl") axolotl(r, ctx, ox, oy, dir, frame);
}

/** 1 px outline around opaque pixels of one cell, tinted by the neighbouring colour. */
function outline(ctx: Ctx, cx: number, cy: number) {
  const img = ctx.getImageData(cx, cy, PET_W, PET_H);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < PET_W && y < PET_H && src[(y * PET_W + x) * 4 + 3] >= 200 ? (y * PET_W + x) * 4 : -1);
  const [dr, dg, db] = rgb("#120e1c");
  for (let y = 0; y < PET_H; y++)
    for (let x = 0; x < PET_W; x++) {
      const i = (y * PET_W + x) * 4;
      if (src[i + 3] >= 200) continue;
      const n = [at(x, y + 1), at(x - 1, y), at(x + 1, y), at(x, y - 1)].find((v) => v >= 0);
      if (n === undefined) continue;
      d[i] = src[n] + (dr - src[n]) * 0.7;
      d[i + 1] = src[n + 1] + (dg - src[n + 1]) * 0.7;
      d[i + 2] = src[n + 2] + (db - src[n + 2]) * 0.7;
      d[i + 3] = 255;
    }
  ctx.putImageData(img, cx, cy);
}

/** Draws the 3 x 4 sheet of one pet (rows: down, left, right, up). */
export function drawPetSheet(ctx: Ctx, kind: number) {
  const tmp = document.createElement("canvas");
  tmp.width = PET_W;
  tmp.height = PET_H;
  const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
  for (let f = 0; f < 3; f++) {
    for (const dir of [0, 1, 3]) drawPet(ctx, f * PET_W, dir * PET_H, dir, f, kind);
    tctx.clearRect(0, 0, PET_W, PET_H);
    drawPet(tctx, 0, 0, 1, f, kind);
    ctx.save();
    ctx.translate(f * PET_W + PET_W, 2 * PET_H);
    ctx.scale(-1, 1);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }
  for (let row = 0; row < 4; row++) for (let f = 0; f < 3; f++) outline(ctx, f * PET_W, row * PET_H);
}
