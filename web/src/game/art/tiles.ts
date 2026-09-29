import type { MapData, Prop } from "../../net/protocol";
import { OUT, blob, dark, hash, light, px, slab, type Ctx } from "./pixel";

export const T = 16;

// ---------- floors ----------
interface Floor {
  kind: "planks" | "carpet" | "plate" | "hatch";
  a: string;
  b: string;
  seam: string;
  edge: string;
  trim: string; // colour of the stripe on the wall face above this floor
}
// The names come from the server's map data; the look is decided here.
const FLOORS: Record<string, Floor> = {
  wood_light: { kind: "plate", a: "#f8f0be", b: "#f2e8ae", seam: "#d2c486", edge: "#b8aa68", trim: "#e8603c" },
  wood_warm: { kind: "planks", a: "#dcb658", b: "#d2ac4c", seam: "#a88434", edge: "#8a6a28", trim: "#f09030" },
  carpet_blue: { kind: "hatch", a: "#eaf2fa", b: "#dce8f4", seam: "#b4c4d8", edge: "#7890b8", trim: "#4a78d0" },
  carpet_teal: { kind: "carpet", a: "#52b0a0", b: "#4aa898", seam: "#3c9484", edge: "#2a7468", trim: "#2a9c90" },
  carpet_plum: { kind: "carpet", a: "#9a70b4", b: "#9068ac", seam: "#7c58a0", edge: "#5e4280", trim: "#8a52b0" },
  carpet_green: { kind: "carpet", a: "#62b070", b: "#5aa868", seam: "#4c9458", edge: "#367a44", trim: "#3c9c50" },
  tile_gray: { kind: "plate", a: "#d8dce8", b: "#d0d4e2", seam: "#b0b6ca", edge: "#9aa0b8", trim: "#7a7ab0" },
};

function floorTile(ctx: Ctx, f: Floor, tx: number, ty: number) {
  const x = tx * T, y = ty * T;
  if (f.kind === "planks") {
    // two wide 8px planks per tile, each with its own staggered end joint
    for (let i = 0; i < 2; i++) {
      const row = ty * 2 + i;
      const shade = hash(tx, row, 1) < 0.4 ? f.b : f.a;
      px(ctx, x, y + i * 8, T, 8, shade);
      px(ctx, x, y + i * 8, T, 1, light(shade, 0.2));
      px(ctx, x, y + i * 8 + 7, T, 1, f.seam);
      const j = Math.floor(hash(tx, row, 2) * 13) + 2;
      px(ctx, x + j, y + i * 8, 1, 8, f.seam);
      px(ctx, x + j + 1, y + i * 8 + 1, 1, 6, light(shade, 0.12));
      if (hash(tx, row, 3) < 0.35) px(ctx, x + ((j + 7) % 13) + 1, y + i * 8 + 3, 2, 1, dark(shade, 0.14));
    }
  } else if (f.kind === "carpet") {
    px(ctx, x, y, T, T, f.a);
    for (let yy = 0; yy < T; yy++)
      for (let xx = 0; xx < T; xx++) {
        if ((xx + yy) % 2 === 0 && hash(tx * T + xx, ty * T + yy, 4) < 0.5) px(ctx, x + xx, y + yy, 1, 1, f.b);
      }
    for (let i = 0; i < 3; i++) {
      const hx = Math.floor(hash(tx, ty, 10 + i) * 14), hy = Math.floor(hash(tx, ty, 20 + i) * 14);
      px(ctx, x + hx, y + hy, 2, 1, light(f.a, 0.12));
    }
  } else if (f.kind === "hatch") {
    // pale lab floor with fine diagonal hatching
    px(ctx, x, y, T, T, f.a);
    for (let yy = 0; yy < T; yy++)
      for (let xx = 0; xx < T; xx++) if ((xx + yy) % 8 === 0) px(ctx, x + xx, y + yy, 1, 1, f.b);
    px(ctx, x, y + T - 1, T, 1, f.seam);
    px(ctx, x + T - 1, y, 1, T, f.seam);
    px(ctx, x, y, T - 1, 1, "#ffffff");
    px(ctx, x, y + 1, 1, T - 3, light(f.a, 0.5));
  } else {
    // beveled plate: lit top-left edge, darker joint lines, a dot where four plates meet
    px(ctx, x, y, T, T, f.a);
    px(ctx, x, y + T - 1, T, 1, f.seam);
    px(ctx, x + T - 1, y, 1, T, f.seam);
    px(ctx, x, y, T - 1, 1, light(f.a, 0.5));
    px(ctx, x, y + 1, 1, T - 3, light(f.a, 0.3));
    px(ctx, x + T - 2, y + T - 2, 1, 1, dark(f.seam, 0.2));
    px(ctx, x + 2, y + 2, 5, 1, light(f.a, 0.35));
    px(ctx, x + 2, y + 3, 1, 3, light(f.a, 0.2));
  }
}

// ---------- walls ----------
const WALL = {
  cap: "#544c78", capHi: "#6a6294",
  cream: "#f2e6bc", creamHi: "#fff8dc", creamSeam: "#e2d2a2",
  line: "#5a4a48", wain: "#c9a86e", wainHi: "#dcc088", base: "#8c6c48",
};

function wallTile(ctx: Ctx, tx: number, ty: number, isWall: (x: number, y: number) => boolean, trim: string) {
  const x = tx * T, y = ty * T;
  const below = isWall(tx, ty + 1);
  if (!below) {
    // banded wall face: cream upper wall, coloured stripe, wooden wainscot and baseboard
    px(ctx, x, y, T, T, WALL.cream);
    px(ctx, x, y, T, 1, WALL.creamHi);
    for (const sx of [0, 8]) {
      px(ctx, x + sx, y + 1, 1, 5, WALL.creamSeam);
      px(ctx, x + sx + 1, y + 1, 1, 5, light(WALL.cream, 0.25));
    }
    px(ctx, x, y + 6, T, 1, WALL.line);
    px(ctx, x, y + 7, T, 3, trim);
    px(ctx, x, y + 7, T, 1, light(trim, 0.35));
    px(ctx, x, y + 9, T, 1, dark(trim, 0.3));
    px(ctx, x, y + 10, T, 1, WALL.line);
    px(ctx, x, y + 11, T, 3, WALL.wain);
    px(ctx, x, y + 11, T, 1, WALL.wainHi);
    for (const sx of [3, 11]) px(ctx, x + sx, y + 12, 1, 2, dark(WALL.wain, 0.2));
    px(ctx, x, y + 14, T, 1, WALL.base);
    px(ctx, x, y + 15, T, 1, OUT);
  } else {
    px(ctx, x, y, T, T, WALL.cap);
    for (let i = 0; i < 6; i++) {
      const hx = Math.floor(hash(tx, ty, 30 + i) * 15), hy = Math.floor(hash(tx, ty, 40 + i) * 15);
      px(ctx, x + hx, y + hy, 1, 1, WALL.capHi);
    }
  }
  // outline along edges that face open floor
  if (!isWall(tx - 1, ty)) px(ctx, x, y, 1, below ? T : T - 1, OUT);
  if (!isWall(tx + 1, ty)) px(ctx, x + T - 1, y, 1, below ? T : T - 1, OUT);
  if (!isWall(tx, ty - 1)) px(ctx, x, y, T, 1, OUT);
}

function windowDeco(ctx: Ctx, tx: number, ty: number) {
  const x = tx * T, y = ty * T;
  px(ctx, x + 2, y + 2, 12, 9, OUT);
  px(ctx, x + 3, y + 3, 10, 7, "#94d2f2");
  px(ctx, x + 3, y + 3, 10, 2, "#b8e6fa");
  px(ctx, x + 8, y + 3, 1, 7, "#f2f6fa");
  px(ctx, x + 3, y + 6, 10, 1, "#f2f6fa");
  px(ctx, x + 4, y + 4, 2, 1, "#ffffff");
  px(ctx, x + 2, y + 11, 12, 1, light(WALL.cream, 0.4));
}
function posterDeco(ctx: Ctx, tx: number, ty: number) {
  const x = tx * T, y = ty * T;
  const cols = ["#e8685a", "#f2b84a", "#58b8a0", "#6a8ede", "#b878d0"];
  const c = cols[Math.floor(hash(tx, ty, 50) * cols.length)];
  px(ctx, x + 4, y + 2, 8, 9, OUT);
  px(ctx, x + 5, y + 3, 6, 7, "#f6f2e6");
  px(ctx, x + 6, y + 4, 4, 3, c);
  px(ctx, x + 6, y + 8, 4, 1, dark("#f6f2e6", 0.25));
}

// ---------- props ----------
const WOOD = "#c08a52";
function desk(ctx: Ctx, x: number, y: number, w: number) {
  px(ctx, x + 2, y + 14, w - 4, 2, "rgba(40,24,80,0.22)");
  slab(ctx, x, y + 5, w, 10, WOOD, 3);
  px(ctx, x + 2, y + 15, 2, 1, OUT);
  px(ctx, x + w - 4, y + 15, 2, 1, OUT);
  const cx = x + w / 2;
  // monitor
  px(ctx, cx - 6, y, 12, 9, OUT);
  px(ctx, cx - 5, y + 1, 10, 7, "#404a68");
  px(ctx, cx - 4, y + 2, 8, 5, "#7ad6f0");
  px(ctx, cx - 4, y + 2, 8, 1, "#c8f4ff");
  px(ctx, cx - 4, y + 3, 1, 2, "#c8f4ff");
  px(ctx, cx - 1, y + 8, 2, 2, "#404a68");
  // keyboard and mouse
  px(ctx, cx - 5, y + 10, 10, 3, OUT);
  px(ctx, cx - 4, y + 10, 8, 2, "#f0f0f6");
  px(ctx, cx - 4, y + 12, 8, 0, "#a0a4b8");
  px(ctx, cx + 6, y + 10, 3, 3, OUT);
  px(ctx, cx + 7, y + 10, 1, 2, "#f0f0f6");
}
function chair(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 4, y + 13, 8, 2, "rgba(40,24,80,0.2)");
  px(ctx, x + 4, y + 1, 8, 7, OUT);
  px(ctx, x + 5, y + 2, 6, 5, "#4a5f9c");
  px(ctx, x + 5, y + 2, 6, 1, "#7088c4");
  px(ctx, x + 3, y + 8, 10, 4, OUT);
  px(ctx, x + 4, y + 9, 8, 2, "#5e76b4");
  px(ctx, x + 7, y + 12, 2, 2, OUT);
  px(ctx, x + 4, y + 14, 3, 1, OUT);
  px(ctx, x + 9, y + 14, 3, 1, OUT);
}
function plant(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 3, y + 14, 10, 2, "rgba(40,24,80,0.22)");
  blob(ctx, x + 8, y + 5.5, 5.5, 4.5, "#3f9c56");
  blob(ctx, x + 5, y + 8, 3, 2.5, "#2e8148");
  blob(ctx, x + 11, y + 7, 3, 2.5, "#5cbc6c");
  px(ctx, x + 6, y + 3, 2, 1, "#9ce29a");
  px(ctx, x + 10, y + 5, 1, 1, "#9ce29a");
  px(ctx, x + 4, y + 10, 8, 6, OUT);
  px(ctx, x + 5, y + 11, 6, 4, "#c8683c");
  px(ctx, x + 4, y + 10, 8, 2, "#a8502c");
  px(ctx, x + 5, y + 10, 6, 1, "#e48c5a");
  px(ctx, x + 5, y + 11, 1, 4, "#dc7c4c");
}
function couch(ctx: Ctx, x: number, y: number, w: number) {
  // blue bench with yellow seat cushions
  px(ctx, x + 1, y + 14, w - 2, 2, "rgba(40,24,80,0.22)");
  px(ctx, x, y + 1, w, 7, OUT);
  px(ctx, x + 1, y + 2, w - 2, 5, "#4a78d0");
  px(ctx, x + 1, y + 2, w - 2, 1, "#8ab0f4");
  px(ctx, x + 1, y + 6, w - 2, 1, "#3058a8");
  px(ctx, x + 3, y + 7, w - 6, 7, OUT);
  px(ctx, x + 4, y + 8, w - 8, 5, "#f4cc48");
  px(ctx, x + 4, y + 8, w - 8, 1, "#fff09a");
  px(ctx, x + 4, y + 12, w - 8, 1, "#c89c28");
  for (let sx = 16; sx < w - 4; sx += 16) px(ctx, x + sx, y + 8, 1, 5, "#c89c28");
  px(ctx, x, y + 4, 4, 11, OUT);
  px(ctx, x + 1, y + 5, 2, 9, "#3a68c0");
  px(ctx, x + 1, y + 5, 2, 1, "#8ab0f4");
  px(ctx, x + w - 4, y + 4, 4, 11, OUT);
  px(ctx, x + w - 3, y + 5, 2, 9, "#3058a8");
  px(ctx, x + w - 3, y + 5, 2, 1, "#8ab0f4");
}
function table(ctx: Ctx, x: number, y: number, w: number, h: number) {
  px(ctx, x + 2, y + h - 3, w - 4, 3, "rgba(40,24,80,0.22)");
  slab(ctx, x, y + 2, w, h - 4, "#d8a86c", 4);
  // a few things on top so meeting rooms feel used
  for (let i = 0; i < Math.floor(w / 16); i++) {
    const px0 = x + 5 + i * 14 + Math.floor(hash(x, i, 7) * 3);
    const py0 = y + 5 + Math.floor(hash(y, i, 8) * 4);
    if (h >= 24) {
      px(ctx, px0, py0, 6, 4, OUT);
      px(ctx, px0 + 1, py0 + 1, 4, 2, i % 2 ? "#f4f4f8" : "#8ad4ee");
    }
  }
}
function reception(ctx: Ctx, x: number, y: number, w: number) {
  px(ctx, x + 2, y + 14, w - 4, 2, "rgba(40,24,80,0.22)");
  px(ctx, x, y + 2, w, 13, OUT);
  px(ctx, x + 1, y + 3, w - 2, 5, "#fff6dc"); // cream top
  px(ctx, x + 1, y + 3, w - 2, 1, "#ffffff");
  px(ctx, x + 1, y + 7, w - 2, 1, "#d8c8a0");
  px(ctx, x + 1, y + 8, w - 2, 6, "#e8603c"); // coral front
  px(ctx, x + 1, y + 8, w - 2, 1, "#f89070");
  px(ctx, x + 1, y + 13, w - 2, 1, "#b8402a");
  for (let sx = 16; sx < w - 1; sx += 16) {
    px(ctx, x + sx, y + 9, 1, 4, "#b8402a");
    px(ctx, x + sx + 1, y + 9, 1, 4, "#f47c58");
  }
  // bell and monitor
  px(ctx, x + w / 2 - 3, y + 1, 6, 3, OUT);
  px(ctx, x + w / 2 - 2, y + 1, 4, 2, "#ffc84a");
  px(ctx, x + w - 22, y - 1, 10, 7, OUT);
  px(ctx, x + w - 21, y, 8, 5, "#7ad6f0");
  px(ctx, x + w - 21, y, 8, 1, "#c8f4ff");
}
function bookshelf(ctx: Ctx, x: number, y: number, w: number) {
  px(ctx, x, y, w, 16, OUT);
  px(ctx, x + 1, y + 1, w - 2, 14, "#4e3220");
  const books = ["#e05a50", "#4a86d8", "#f0c84a", "#58b868", "#8a62cc", "#f09a3a", "#e8e4d8"];
  for (let row = 0; row < 2; row++) {
    let bx = x + 2;
    const base = y + 7 + row * 7;
    let i = 0;
    while (bx < x + w - 3) {
      const bw = 2 + Math.floor(hash(bx, row, 5) * 2);
      const bh = 4 + Math.floor(hash(bx, row, 6) * 3);
      if (hash(bx, row, 9) > 0.08) {
        px(ctx, bx, base - bh, bw, bh, books[(i + row * 3) % books.length]);
        px(ctx, bx, base - bh, 1, bh, light(books[(i + row * 3) % books.length], 0.3));
      }
      bx += bw;
      i++;
    }
    px(ctx, x + 1, base, w - 2, 1, "#8e5c36");
  }
  px(ctx, x + 1, y + 1, w - 2, 1, "#7a5232");
}
function coffee(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 3, y + 14, 10, 2, "rgba(40,24,80,0.22)");
  px(ctx, x + 3, y, 10, 15, OUT);
  px(ctx, x + 4, y + 1, 8, 13, "#8c94ac");
  px(ctx, x + 4, y + 1, 8, 2, "#b4bcd0");
  px(ctx, x + 5, y + 3, 6, 3, "#1e2a3c");
  px(ctx, x + 9, y + 4, 1, 1, "#58e070");
  px(ctx, x + 6, y + 7, 4, 3, OUT);
  px(ctx, x + 6, y + 10, 4, 3, "#f6f2e6");
  px(ctx, x + 6, y + 10, 4, 1, "#c8c4b6");
  px(ctx, x + 11, y + 3, 1, 1, "#e85a50");
}
function whiteboard(ctx: Ctx, x: number, y: number, w: number) {
  px(ctx, x + 1, y + 1, w - 2, 13, OUT);
  px(ctx, x + 2, y + 2, w - 4, 10, "#f6f8fc");
  px(ctx, x + 2, y + 11, w - 4, 1, "#d6dae6");
  const cols = ["#e05a50", "#4a86d8", "#58b868"];
  for (let i = 0; i < 4; i++) {
    const lw = 8 + Math.floor(hash(x, i, 11) * (w - 22));
    px(ctx, x + 4, y + 3 + i * 2, lw, 1, cols[i % 3]);
  }
  px(ctx, x + w - 9, y + 4, 4, 4, "#f2b84a");
  px(ctx, x + 1, y + 14, w - 2, 1, "#9aa0b4");
}
function lamp(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 3, y + 1, 10, 7, "rgba(255,226,122,0.16)");
  px(ctx, x + 4, y + 2, 8, 5, OUT);
  px(ctx, x + 5, y + 3, 6, 3, "#ffe27a");
  px(ctx, x + 5, y + 3, 6, 1, "#fff4b8");
  px(ctx, x + 7, y + 7, 2, 7, OUT);
  px(ctx, x + 5, y + 14, 6, 2, OUT);
  px(ctx, x + 6, y + 14, 4, 1, "#6a6f88");
}
function rug(ctx: Ctx, x: number, y: number, w: number, h: number) {
  // green rug with a dotted border band and a scattered-dot field
  px(ctx, x, y, w, h, "#1e4a30");
  px(ctx, x + 1, y + 1, w - 2, h - 2, "#3c8c58");
  px(ctx, x + 2, y + 2, w - 4, h - 4, "#78c886");
  px(ctx, x + 4, y + 4, w - 8, h - 8, "#4aa068");
  for (let xx = 4; xx < w - 4; xx += 4) {
    px(ctx, x + xx, y + 3, 1, 1, "#3c8c58");
    px(ctx, x + xx, y + h - 4, 1, 1, "#3c8c58");
  }
  for (let yy = 4; yy < h - 4; yy += 4) {
    px(ctx, x + 3, y + yy, 1, 1, "#3c8c58");
    px(ctx, x + w - 4, y + yy, 1, 1, "#3c8c58");
  }
  for (let yy = 7; yy < h - 7; yy += 4)
    for (let xx = 7 + ((yy / 4) % 2) * 2; xx < w - 7; xx += 4) px(ctx, x + xx, y + yy, 1, 1, "#8ad894");
}

const DIMS: Record<string, [number, number]> = {
  desk: [2, 1], chair: [1, 1], plant: [1, 1], couch: [3, 1], table: [3, 2], reception_desk: [6, 1],
  bookshelf: [2, 1], coffee: [1, 1], whiteboard: [3, 1], rug: [4, 3], lamp: [1, 1],
  note: [1, 1], image: [1, 1], embed: [2, 1], portal: [1, 1], spotlight: [1, 1],
};
export function propRect(p: Prop) {
  const d = DIMS[p.t] ?? [1, 1];
  return { x: p.x * T, y: p.y * T, w: (p.w ?? d[0]) * T, h: (p.h ?? d[1]) * T };
}
function drawProp(ctx: Ctx, p: Prop) {
  const { x, y, w, h } = propRect(p);
  switch (p.t) {
    case "rug": return rug(ctx, x, y, w, h);
    case "desk": return desk(ctx, x, y, w);
    case "chair": return chair(ctx, x, y);
    case "plant": return plant(ctx, x, y);
    case "couch": return couch(ctx, x, y, w);
    case "table": return table(ctx, x, y, w, h);
    case "reception_desk": return reception(ctx, x, y, w);
    case "bookshelf": return bookshelf(ctx, x, y, w);
    case "coffee": return coffee(ctx, x, y);
    case "whiteboard": return whiteboard(ctx, x, y, w);
    case "lamp": return lamp(ctx, x, y);
    case "note":
      px(ctx, x + 3, y + 1, 10, 14, OUT);
      px(ctx, x + 4, y + 2, 8, 10, "#fff4d0");
      for (let row = 4; row < 11; row += 3) px(ctx, x + 5, y + row, 6, 1, "#847754");
      return;
    case "image":
    case "embed":
      px(ctx, x + 1, y + 1, w - 2, 12, OUT);
      px(ctx, x + 2, y + 2, w - 4, 9, "#78c8dc");
      px(ctx, x + 4, y + 5, w - 8, 5, "#297854");
      px(ctx, x + 4, y + 3, 3, 2, "#fff4b0");
      px(ctx, x + w / 2 - 1, y + 13, 2, 2, OUT);
      return;
    case "portal":
      for (let ring = 0; ring < 3; ring++) {
        const inset = 1 + ring * 2;
        px(ctx, x + inset, y + inset, 16 - inset * 2, 16 - inset * 2, [OUT, "#8860c8", "#92e8e0"][ring]);
      }
      return;
    case "spotlight":
      px(ctx, x + 1, y + 2, 14, 12, OUT);
      px(ctx, x + 2, y + 3, 12, 10, "#ffdb66");
      px(ctx, x + 7, y + 4, 2, 5, "#785028");
      px(ctx, x + 4, y + 7, 8, 2, "#785028");
      px(ctx, x + 6, y + 9, 4, 2, "#785028");
      return;
  }
}

// ---------- whole map ----------
export function bakeMapCanvas(map: MapData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = map.w * T;
  canvas.height = map.h * T;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= map.w || y >= map.h || map.walls[y][x] === "#";
  const areaAt = new Int16Array(map.w * map.h).fill(-1);
  for (let pass = 0; pass < 2; pass++)
    map.areas.forEach((a, i) => {
      if ((a.kind === "room") !== (pass === 1)) return;
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) areaAt[y * map.w + x] = i;
    });
  const areaOf = (x: number, y: number) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? -2 : areaAt[y * map.w + x]);
  const floorOf = (x: number, y: number) => {
    const i = areaAt[y * map.w + x];
    return FLOORS[i >= 0 ? map.areas[i].floor : "tile_gray"] ?? FLOORS.tile_gray;
  };

  // 1. floors
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) if (!isWall(tx, ty)) floorTile(ctx, floorOf(tx, ty), tx, ty);
  // 2. carpet edges where a carpet meets another area, plus contact shadow under wall faces
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      if (isWall(tx, ty)) continue;
      const f = floorOf(tx, ty);
      const x = tx * T, y = ty * T, me = areaOf(tx, ty);
      if (f.kind === "carpet") {
        const edge = (nx: number, ny: number) => !isWall(nx, ny) && areaOf(nx, ny) !== me;
        if (edge(tx - 1, ty)) {
          px(ctx, x, y, 2, T, f.edge);
          for (let yy = 1; yy < T; yy += 4) px(ctx, x + 2, y + yy, 1, 1, light(f.edge, 0.5));
        }
        if (edge(tx + 1, ty)) {
          px(ctx, x + T - 2, y, 2, T, f.edge);
          for (let yy = 1; yy < T; yy += 4) px(ctx, x + T - 3, y + yy, 1, 1, light(f.edge, 0.5));
        }
        if (edge(tx, ty - 1)) {
          px(ctx, x, y, T, 2, f.edge);
          for (let xx = 1; xx < T; xx += 4) px(ctx, x + xx, y + 2, 1, 1, light(f.edge, 0.5));
        }
        if (edge(tx, ty + 1)) {
          px(ctx, x, y + T - 2, T, 2, f.edge);
          for (let xx = 1; xx < T; xx += 4) px(ctx, x + xx, y + T - 3, 1, 1, light(f.edge, 0.5));
        }
      }
      if (isWall(tx, ty - 1)) {
        px(ctx, x, y, T, 3, "rgba(40,24,90,0.24)");
        px(ctx, x, y + 3, T, 2, "rgba(40,24,90,0.10)");
      }
      if (isWall(tx - 1, ty)) px(ctx, x, y, 2, T, "rgba(40,24,90,0.14)");
      // doorway threshold: an open tile squeezed between walls gets a doormat
      const scan = (dx: number, dy: number) => {
        for (let k = 1; k <= 2; k++) if (isWall(tx + dx * k, ty + dy * k)) return true;
        return false;
      };
      if ((scan(-1, 0) && scan(1, 0)) || (scan(0, -1) && scan(0, 1))) {
        px(ctx, x + 1, y + 3, T - 2, T - 6, "#7c3040");
        px(ctx, x + 2, y + 4, T - 4, T - 8, "#b8505c");
        px(ctx, x + 2, y + 4, T - 4, 1, "#d87880");
        px(ctx, x + 4, y + 6, T - 8, 1, "#e8b0b0");
      }
    }
  // 3. floor decor, then walls, then furniture (back to front)
  const props = [...map.props].sort((a, b) => a.y + (propRect(a).h / T) - (b.y + propRect(b).h / T));
  for (const p of props) if (p.t === "rug") drawProp(ctx, p);
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++)
      if (isWall(tx, ty)) wallTile(ctx, tx, ty, isWall, isWall(tx, ty + 1) || ty + 1 >= map.h ? WALL.cap : floorOf(tx, ty + 1).trim);
  for (let ty = 0; ty < map.h; ty++)
    for (let tx = 0; tx < map.w; tx++) {
      if (!isWall(tx, ty) || isWall(tx, ty + 1) || ty + 1 >= map.h) continue; // only visible wall faces
      if (ty === 0 && tx % 8 === 3) windowDeco(ctx, tx, ty);
      else if (ty > 0 && tx % 6 === 2 && hash(tx, ty, 60) < 0.7) posterDeco(ctx, tx, ty);
    }
  for (const p of props) if (p.t !== "rug") drawProp(ctx, p);
  return canvas;
}
