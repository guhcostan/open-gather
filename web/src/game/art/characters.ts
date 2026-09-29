import { dark, light, mix, px, rgb, type Ctx } from "./pixel";

// Overworld characters: "chibi" proportions (the head is over half of the sprite), 3/4 view,
// three walk frames per direction. Content is 16 x 24 px inside an 18 x 26 cell (1 px outline margin).
export const CELL_W = 18;
export const CELL_H = 26;
export const FEET_Y = 24; // y of the feet line inside a cell

export interface Look {
  skin: string;
  hair: string;
  hairStyle: number; // 0 short, 1 long, 2 bald, 3 spiky, 4 bun, 5 cap
  shirt: string;
  pants: string;
}

const SHOE = "#f2f0f6"; // white sneakers
const SOLE = "#8c88a4";
const EYE = "#241c34";

type P = (x: number, y: number, w: number, h: number, c: string) => void;

// two-row sneaker: bright upper, grey sole
function shoe(R: P, x: number, y: number, w: number) {
  R(x, y, w, 1, SHOE);
  R(x, y + 1, w, 1, SOLE);
}

// Layout (content coordinates, y grows down; y < 2 is room for spikes and buns):
//   head 12 x 11 at y2..12 · torso y13..17 · legs y18..19 · sneakers y20..21 · shadow y22..23

function headFront(R: P, k: Look) {
  const sk = k.skin;
  R(4, 2, 8, 1, sk);
  R(3, 3, 10, 1, sk);
  R(2, 4, 12, 8, sk);
  R(2, 11, 12, 1, dark(sk, 0.1));
  R(3, 12, 10, 1, dark(sk, 0.24));
  R(3, 4, 3, 1, light(sk, 0.18));
}

function faceFront(R: P, k: Look) {
  const bl = mix(k.skin, "#ff7c86", 0.38);
  R(5, 8, 1, 2, EYE);
  R(10, 8, 1, 2, EYE);
  R(3, 10, 2, 1, bl);
  R(11, 10, 2, 1, bl);
}

function hairTop(R: P, k: Look) {
  const h = k.hair, hl = light(h, 0.32), hd = dark(h, 0.3);
  R(4, 1, 8, 1, h);
  R(3, 2, 10, 1, h);
  R(2, 3, 12, 2, h);
  R(5, 1, 4, 1, hl);
  R(4, 2, 3, 1, hl);
  R(2, 4, 1, 1, hd);
  R(13, 4, 1, 1, hd);
}

function hairFront(R: P, k: Look) {
  const h = k.hair, hd = dark(h, 0.3), hl = light(h, 0.32);
  switch (k.hairStyle) {
    case 2: // bald: just a shine
      R(5, 3, 3, 1, light(k.skin, 0.32));
      return;
    case 5: // cap: crown, brim and badge
      R(4, 1, 8, 1, h);
      R(3, 2, 10, 1, h);
      R(2, 3, 12, 3, h);
      R(5, 1, 4, 1, hl);
      R(4, 2, 3, 1, hl);
      R(2, 6, 12, 1, hd);
      R(3, 7, 10, 1, dark(h, 0.45));
      R(7, 3, 2, 2, "#f6f4ee");
      return;
  }
  hairTop(R, k);
  R(2, 5, 3, 2, h); // side locks
  R(11, 5, 3, 2, h);
  R(5, 5, 2, 1, h); // parted fringe
  R(9, 5, 2, 1, h);
  R(2, 6, 1, 1, hd);
  R(13, 6, 1, 1, hd);
  if (k.hairStyle === 1) {
    R(1, 5, 2, 9, h);
    R(13, 5, 2, 9, h);
    R(1, 12, 2, 2, hd);
    R(13, 12, 2, 2, hd);
  } else if (k.hairStyle === 3) {
    R(3, 0, 2, 1, h);
    R(7, -1, 2, 2, h);
    R(11, 0, 2, 1, h);
    R(7, -1, 1, 1, hl);
  } else if (k.hairStyle === 4) {
    R(5, -1, 6, 3, h);
    R(6, -1, 3, 1, hl);
    R(5, 1, 6, 1, hd);
  }
}

function torso(R: P, k: Look, x: number, w: number, collar: boolean) {
  const s = k.shirt;
  R(x, 13, w, 5, s);
  R(x, 13, w, 1, light(s, 0.3));
  R(x, 14, 1, 3, light(s, 0.15));
  R(x, 17, w, 1, dark(s, 0.32));
  R(x + w - 1, 14, 1, 3, dark(s, 0.2));
  if (collar) R(x + w / 2 - 1, 13, 2, 1, k.skin);
}

function arm(R: P, k: Look, x: number, dy = 0) {
  R(x, 14 + dy, 2, 2, dark(k.shirt, 0.14));
  R(x, 14 + dy, 2, 1, k.shirt);
  R(x, 16 + dy, 2, 1, k.skin);
}

function legsFront(R: P, k: Look, frame: number) {
  const p = k.pants;
  const lUp = frame === 1, rUp = frame === 2;
  R(5, 18, 3, lUp ? 1 : 2, p);
  R(8, 18, 3, rUp ? 1 : 2, dark(p, 0.14));
  shoe(R, 4, lUp ? 19 : 20, 4);
  shoe(R, 8, rUp ? 19 : 20, 4);
  R(5, 18, 1, 1, light(p, 0.15));
}

export function drawChar(ctx: Ctx, ox: number, oy: number, dir: number, frame: number, k: Look) {
  const R: P = (x, y, w, h, c) => px(ctx, ox + 1 + x, oy + 2 + y, w, h, c);
  R(3, 22, 10, 1, "rgba(40,24,90,0.30)");
  R(4, 23, 8, 1, "rgba(40,24,90,0.18)");

  if (dir === 0) {
    legsFront(R, k, frame);
    torso(R, k, 4, 8, true);
    arm(R, k, 2, frame === 2 ? 1 : 0);
    arm(R, k, 12, frame === 1 ? 1 : 0);
    if (k.hairStyle === 1) R(1, 5, 2, 9, k.hair), R(13, 5, 2, 9, k.hair);
    headFront(R, k);
    faceFront(R, k);
    hairFront(R, k);
  } else if (dir === 3) {
    legsFront(R, k, frame);
    torso(R, k, 4, 8, false);
    arm(R, k, 2, frame === 1 ? 1 : 0);
    arm(R, k, 12, frame === 2 ? 1 : 0);
    headFront(R, k);
    const h = k.hair, hd = dark(h, 0.3), hl = light(h, 0.32);
    if (k.hairStyle === 2) {
      R(5, 3, 3, 1, light(k.skin, 0.32));
    } else if (k.hairStyle === 5) {
      R(4, 1, 8, 1, h);
      R(3, 2, 10, 1, h);
      R(2, 3, 12, 6, h);
      R(3, 9, 10, 1, hd);
      R(5, 1, 4, 1, hl);
      R(4, 2, 3, 1, hl);
      R(6, 7, 4, 1, hd); // strap
    } else {
      R(4, 1, 8, 1, h);
      R(3, 2, 10, 1, h);
      R(2, 3, 12, 9, h);
      R(3, 12, 10, 1, hd);
      R(2, 11, 12, 1, hd);
      R(5, 1, 4, 1, hl);
      R(4, 2, 3, 1, hl);
      R(6, 5, 4, 1, hl);
      if (k.hairStyle === 1) R(1, 5, 14, 9, h), R(2, 13, 12, 1, hd);
      if (k.hairStyle === 3) R(3, 0, 2, 1, h), R(7, -1, 2, 2, h), R(11, 0, 2, 1, h);
      if (k.hairStyle === 4) R(5, -1, 6, 3, h), R(6, -1, 3, 1, hl);
    }
  } else {
    // dir 1 = facing left; dir 2 is the mirror image, produced by the caller
    const p = k.pants;
    if (frame === 0) {
      R(6, 18, 4, 2, p);
      shoe(R, 5, 20, 5);
    } else if (frame === 1) {
      R(8, 18, 3, 2, dark(p, 0.15));
      shoe(R, 8, 20, 4);
      R(4, 18, 3, 1, p);
      shoe(R, 3, 19, 4);
    } else {
      R(4, 18, 3, 2, dark(p, 0.15));
      shoe(R, 3, 20, 4);
      R(8, 18, 3, 1, p);
      shoe(R, 8, 19, 4);
    }
    torso(R, k, 5, 6, false);
    const swing = frame === 1 ? -1 : frame === 2 ? 1 : 0;
    R(6 + swing, 14, 3, 2, dark(k.shirt, 0.16));
    R(6 + swing, 14, 3, 1, k.shirt);
    R(6 + swing, 16, 3, 1, k.skin);
    const sk = k.skin;
    R(4, 2, 8, 1, sk);
    R(3, 3, 10, 1, sk);
    R(2, 4, 12, 8, sk);
    R(2, 11, 12, 1, dark(sk, 0.1));
    R(3, 12, 10, 1, dark(sk, 0.24));
    R(2, 4, 3, 1, light(sk, 0.18));
    R(4, 8, 1, 2, EYE);
    R(3, 10, 2, 1, mix(sk, "#ff7c86", 0.38));
    R(9, 7, 2, 3, dark(sk, 0.2)); // ear
    const h = k.hair, hl = light(h, 0.32), hd = dark(h, 0.3);
    if (k.hairStyle === 2) {
      R(5, 3, 3, 1, light(sk, 0.32));
    } else if (k.hairStyle === 5) {
      R(4, 1, 8, 1, h);
      R(3, 2, 10, 1, h);
      R(2, 3, 12, 3, h);
      R(5, 1, 4, 1, hl);
      R(4, 2, 3, 1, hl);
      R(0, 6, 8, 1, hd); // brim points the way we face
      R(0, 7, 6, 1, dark(h, 0.45));
      R(9, 6, 5, 3, h);
    } else {
      hairTop(R, k);
      R(8, 5, 6, 6, h); // hair falls behind the ear
      R(2, 5, 3, 1, h);
      R(12, 10, 2, 1, hd);
      if (k.hairStyle === 1) R(8, 11, 6, 4, h), R(8, 14, 6, 1, hd);
      if (k.hairStyle === 3) R(3, 0, 2, 1, h), R(7, -1, 2, 2, h), R(11, 0, 2, 1, h);
      if (k.hairStyle === 4) R(10, -1, 4, 4, h), R(10, -1, 2, 1, hl), R(10, 2, 4, 1, hd);
    }
  }
}

/**
 * Adds a 1px outline around opaque pixels, per cell so nothing bleeds between rows.
 * The outline takes a very dark version of the neighbouring colour instead of flat black,
 * which keeps hair, skin and clothes reading as separate shapes.
 */
export function outlineCell(ctx: Ctx, cx: number, cy: number) {
  const img = ctx.getImageData(cx, cy, CELL_W, CELL_H);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < CELL_W && y < CELL_H && src[(y * CELL_W + x) * 4 + 3] >= 200 ? (y * CELL_W + x) * 4 : -1);
  const [dr, dg, db] = rgb("#120e1c");
  for (let y = 0; y < CELL_H; y++)
    for (let x = 0; x < CELL_W; x++) {
      const i = (y * CELL_W + x) * 4;
      if (src[i + 3] >= 200) continue;
      const n = [at(x, y + 1), at(x - 1, y), at(x + 1, y), at(x, y - 1)].find((v) => v >= 0);
      if (n === undefined) continue;
      const t = 0.7;
      d[i] = src[n] + (dr - src[n]) * t;
      d[i + 1] = src[n + 1] + (dg - src[n + 1]) * t;
      d[i + 2] = src[n + 2] + (db - src[n + 2]) * t;
      d[i + 3] = 255;
    }
  ctx.putImageData(img, cx, cy);
}

/** Draws the whole 3x4 sheet (rows: down, left, right, up; columns: idle, step A, step B). */
export function drawSheet(ctx: Ctx, k: Look) {
  const tmp = document.createElement("canvas");
  tmp.width = CELL_W;
  tmp.height = CELL_H;
  const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
  for (let f = 0; f < 3; f++) {
    for (const dir of [0, 1, 3]) drawChar(ctx, f * CELL_W, dir * CELL_H, dir, f, k);
    // right-facing = mirrored left-facing
    tctx.clearRect(0, 0, CELL_W, CELL_H);
    drawChar(tctx, 0, 0, 1, f, k);
    ctx.save();
    ctx.translate(f * CELL_W + CELL_W, 2 * CELL_H);
    ctx.scale(-1, 1);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }
  for (let r = 0; r < 4; r++) for (let f = 0; f < 3; f++) outlineCell(ctx, f * CELL_W, r * CELL_H);
}

