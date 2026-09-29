import type { BoardEvent, BoardStroke } from "../net/protocol";

/** Transient drawing data stays outside React. Server replies are authoritative, including our own edits. */
export class BoardModel {
  key = "";
  width = 1000;
  height = 600;
  strokes: BoardStroke[] = [];
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  apply(m: BoardEvent) {
    if (m.op === "closed") { this.key = ""; this.strokes = []; }
    else if (m.op === "state") { this.key = m.bk; this.width = m.w; this.height = m.h; this.strokes = m.s; }
    else if (m.bk === this.key) {
      if (m.op === "clear") this.strokes = [];
      if (m.op === "del") this.strokes = this.strokes.filter((s) => s.o !== m.o || s.i !== m.i);
      if (m.op === "draw") {
        const s = this.strokes.find((s) => s.o === m.o && s.i === m.i);
        if (s) s.p.push(...m.p);
        else this.strokes.push({ o: m.o, i: m.i, k: m.k, c: m.c, w: m.w, p: [...m.p], tx: m.tx });
      }
    }
    this.listeners.forEach((fn) => fn());
  }
}
export const boardModel = new BoardModel();
