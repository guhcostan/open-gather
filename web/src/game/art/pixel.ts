// Tiny pixel-art toolkit shared by the map and character painters.
// All art in this project is drawn by code; nothing here is copied from any game.
export type Ctx = CanvasRenderingContext2D;

export const OUT = "#1a1526"; // shared outline colour (a deep violet-black, never pure black)

export function rgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + ((1 << 24) | (c(r) << 16) | (c(g) << 8) | c(b)).toString(16).slice(1);
}
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
// Hue-shifted shading: highlights drift warm, shadows drift toward violet.
export const light = (c: string, t = 0.28) => mix(c, "#fff4d0", t);
export const dark = (c: string, t = 0.3) => mix(c, "#2c2060", t);
export const deep = (c: string, t = 0.55) => mix(c, "#1c1638", t);

export function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

/** Deterministic pseudo-random in [0,1) from integer coordinates. */
export function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 10000) / 10000;
}

/** Filled ellipse with a 1px outline, rasterised per pixel (no anti-aliasing). */
export function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, outline: string | null = OUT) {
  const put = (r: number, ry2: number, c: string) => {
    for (let y = Math.floor(cy - ry2); y <= Math.ceil(cy + ry2); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / ry2;
        if (dx * dx + dy * dy <= 1) px(ctx, x, y, 1, 1, c);
      }
  };
  if (outline) put(rx + 1, ry + 1, outline);
  put(rx, ry, fill);
}

/** Wood-like slab seen at a 3/4 angle: lit top face and darker front face, outlined. */
export function slab(ctx: Ctx, x: number, y: number, w: number, h: number, top: string, frontH: number, front = dark(top, 0.32)) {
  px(ctx, x, y, w, h, OUT);
  px(ctx, x + 1, y + 1, w - 2, h - 2 - frontH, top);
  px(ctx, x + 1, y + 1, w - 2, 1, light(top, 0.35));
  px(ctx, x + 1, y + 1, 1, h - 2 - frontH, light(top, 0.18));
  px(ctx, x + 1, y + h - 1 - frontH, w - 2, frontH, front);
  px(ctx, x + 1, y + h - 1 - frontH, w - 2, 1, dark(front, 0.15));
}
