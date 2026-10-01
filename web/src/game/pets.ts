import { Rectangle, Texture } from "pixi.js";
import { drawPetSheet, PET_FEET_Y, PET_H, PET_KINDS, PET_W } from "./art/pets";

// One shared texture per pet kind (4 directions x 3 frames), built on first use.
export { PET_FEET_Y, PET_H, PET_KINDS, PET_W };
export type PetFrames = Texture[][];

const cache = new Map<number, PetFrames>();

export function petFrames(kind: number): PetFrames | null {
  if (!(kind > 0 && kind < PET_KINDS.length)) return null;
  const hit = cache.get(kind);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = PET_W * 3;
  canvas.height = PET_H * 4;
  drawPetSheet(canvas.getContext("2d", { willReadFrequently: true })!, kind);
  const base = Texture.from(canvas);
  base.source.scaleMode = "nearest";
  const frames: PetFrames = [];
  for (let dir = 0; dir < 4; dir++) {
    frames.push([]);
    for (let f = 0; f < 3; f++) frames[dir].push(new Texture({ source: base.source, frame: new Rectangle(f * PET_W, dir * PET_H, PET_W, PET_H) }));
  }
  cache.set(kind, frames);
  return frames;
}

/** Draws one standing frame of a pet (avatar editor and roster). */
export function drawPetPreview(canvas: HTMLCanvasElement, kind: number, dir = 0) {
  canvas.width = PET_W;
  canvas.height = PET_H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, PET_W, PET_H);
  if (!(kind > 0 && kind < PET_KINDS.length)) return;
  const sheet = document.createElement("canvas");
  sheet.width = PET_W * 3;
  sheet.height = PET_H * 4;
  drawPetSheet(sheet.getContext("2d", { willReadFrequently: true })!, kind);
  ctx.drawImage(sheet, 0, dir * PET_H, PET_W, PET_H, 0, 0, PET_W, PET_H);
}

