import type { MapData, Prop } from "../net/protocol";

export const PROP_TYPES: { t: string; w: number; h: number; solid: boolean; label: string }[] = [
  { t: "desk", w: 2, h: 1, solid: true, label: "Mesa" },
  { t: "chair", w: 1, h: 1, solid: false, label: "Cadeira" },
  { t: "table", w: 3, h: 2, solid: true, label: "Mesa grande" },
  { t: "couch", w: 3, h: 1, solid: true, label: "Sofá" },
  { t: "plant", w: 1, h: 1, solid: true, label: "Planta" },
  { t: "bookshelf", w: 2, h: 1, solid: true, label: "Estante" },
  { t: "coffee", w: 1, h: 1, solid: true, label: "Cafeteira" },
  { t: "whiteboard", w: 3, h: 1, solid: false, label: "Quadro" },
  { t: "rug", w: 4, h: 3, solid: false, label: "Tapete" },
  { t: "lamp", w: 1, h: 1, solid: true, label: "Luminária" },
  { t: "reception_desk", w: 6, h: 1, solid: true, label: "Balcão" },
];
const byType = new Map(PROP_TYPES.map((p) => [p.t, p]));

export function propSize(p: Prop): [number, number] {
  const d = byType.get(p.t);
  return [p.w ?? d?.w ?? 1, p.h ?? d?.h ?? 1];
}

/** Same rule as the server (gamemap.Compile): walls plus the footprint of solid props. */
export function computeSolid(map: MapData): string[] {
  const rows = map.walls.map((r) => Array.from(r, (c) => (c === "#" ? "1" : "0")));
  for (const p of map.props) {
    if (!byType.get(p.t)?.solid) continue;
    const [w, h] = propSize(p);
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) if (rows[y]?.[x] !== undefined) rows[y][x] = "1";
  }
  return rows.map((r) => r.join(""));
}

export function cloneMap(m: MapData): MapData {
  return JSON.parse(JSON.stringify(m)) as MapData;
}

/** Payload accepted by PUT /api/map: the editable fields only (the server recomputes the rest). */
export function toWire(m: MapData) {
  return { version: m.version, w: m.w, h: m.h, walls: m.walls, props: m.props, areas: m.areas, spawn: m.spawn };
}
