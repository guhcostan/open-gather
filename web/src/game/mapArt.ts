import { Texture, type Renderer } from "pixi.js";
import type { MapData } from "../net/protocol";
import { bakeMapCanvas } from "./art/tiles";

/** Bakes the whole static map into one texture: a single draw call for the background. */
export function bakeMap(_renderer: Renderer, map: MapData): Texture {
  const tex = Texture.from(bakeMapCanvas(map));
  tex.source.scaleMode = "nearest";
  return tex;
}
