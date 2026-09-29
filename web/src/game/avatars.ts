import { Rectangle, Texture } from "pixi.js";
import type { AvatarSpec } from "../net/protocol";
import { CELL_H, CELL_W, FEET_Y, drawSheet, type Look } from "./art/characters";
import { HAIR, PANTS, SHIRT, SKIN } from "./palette";

// Procedural pixel-art avatars. One small canvas per distinct look (4 directions x
// 3 frames); all frames share one GPU texture and are cached by look key.
// The painting itself lives in ./art/characters (pure canvas, no PixiJS).
export { CELL_H, CELL_W, FEET_Y };

export type AvatarFrames = Texture[][]; // [dir][frame]; dirs: 0 down, 1 left, 2 right, 3 up

const cache = new Map<string, AvatarFrames>();

export function avatarKey(a: AvatarSpec) {
  return `${a.sk}-${a.hs}-${a.hc}-${a.sh}-${a.pa}`;
}

function lookOf(a: AvatarSpec): Look {
  return { skin: SKIN[a.sk] ?? SKIN[0], hair: HAIR[a.hc] ?? HAIR[0], hairStyle: a.hs, shirt: SHIRT[a.sh] ?? SHIRT[0], pants: PANTS[a.pa] ?? PANTS[0] };
}

export function avatarFrames(a: AvatarSpec): AvatarFrames {
  const key = avatarKey(a);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * 3;
  canvas.height = CELL_H * 4;
  drawSheet(canvas.getContext("2d", { willReadFrequently: true })!, lookOf(a));
  const base = Texture.from(canvas);
  base.source.scaleMode = "nearest";
  const frames: AvatarFrames = [];
  for (let dir = 0; dir < 4; dir++) {
    frames.push([]);
    for (let f = 0; f < 3; f++) {
      frames[dir].push(new Texture({ source: base.source, frame: new Rectangle(f * CELL_W, dir * CELL_H, CELL_W, CELL_H) }));
    }
  }
  cache.set(key, frames);
  return frames;
}

/** Draws the full 4-direction x 3-frame sheet (used by docs/asset generation). */
export function drawAvatarSheet(canvas: HTMLCanvasElement, a: AvatarSpec) {
  canvas.width = CELL_W * 3;
  canvas.height = CELL_H * 4;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSheet(ctx, lookOf(a));
}

/** Draws one standing frame (used by the avatar editor UI). */
export function drawAvatarPreview(canvas: HTMLCanvasElement, a: AvatarSpec, dir = 0) {
  const sheet = document.createElement("canvas");
  drawAvatarSheet(sheet, a);
  canvas.width = CELL_W;
  canvas.height = CELL_H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, CELL_W, CELL_H);
  ctx.drawImage(sheet, 0, dir * CELL_H, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
}
