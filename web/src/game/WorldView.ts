import { Application, BitmapText, Container, Graphics, Sprite, Text } from "pixi.js";
import type { Ack, AvatarSpec, MapData, Person, Prop, SelfPosition, WorldDelta } from "../net/protocol";
import { EMOTES } from "./emotes";
import { propSize } from "./mapModel";
import { avatarFrames, FEET_Y, CELL_H, type AvatarFrames } from "./avatars";
import { bakeMap } from "./mapArt";

const T = 16;
// Reference view in world pixels. A 240x160 handheld screen would be 15x10 tiles; an office wants a little more room.
const VIEW_REF_W = 320;
const VIEW_REF_H = 200;
const FONT = '"Pixelify Sans", ui-monospace, Menlo, monospace';
const BOX_HW = 5;
const BOX_HH = 3;
const SHADOW_STEP = 1 / 60; // fixed sub-step used by server and client so extrapolation matches
const OFFSET_TAU = 0.08; // seconds over which a correction blends in
const HEARTBEAT_MS = 400; // re-send held input so the server can correct drift
const STATUS_COLOR: Record<string, number> = { available: 0x5ec26a, busy: 0xe5584f, away: 0xf2d14b, offline: 0x8e8e9a, invisible: 0x8e8e9a };
const DEFAULT_AV: AvatarSpec = { sk: 1, hs: 0, hc: 1, sh: 4, pa: 1 };

interface Ent {
  id: number;
  key: string;
  frames: AvatarFrames;
  spr: Sprite;
  label: Container;
  text: BitmapText;
  dot: Graphics;
  ring: Graphics | null;
  // Remote entities are dead-reckoned: the server sends state changes (position + direction),
  // the client keeps walking the entity with the same collision rules. (tx,ty) is the extrapolated
  // truth, (ox,oy) a short-lived offset that hides corrections.
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  speaking: boolean;
  inConv: boolean;
  status: string;
  name: string;
  drawnStatus: string;
  drawnConv: boolean;
}

export interface ViewHooks {
  sendInput(seq: number, dx: number, dy: number): void;
  onArea(name: string): void;
  onResume(): void;
  onEmote?(kind: number): void;
  onInteract?(prop: Prop): void;
  onNearby?(prop: Prop | null): void;
}

export interface ViewStats {
  fps: number;
  frameMs: number;
  worldMsgs: number;
  entities: number;
  visible: number;
}

export class WorldView {
  private app!: Application;
  private world = new Container();
  private entLayer = new Container();
  private hud = new Container();
  private fxG = new Graphics();
  private hudG = new Graphics();
  private banner = new Container();
  private bannerG = new Graphics();
  private bannerText: BitmapText | null = null;
  private bannerT0 = -1e9;
  private bannerW = 0;
  private areaLabels: { text: BitmapText; ai: number }[] = [];
  private deskLabels: { text: BitmapText; x: number; y: number }[] = [];
  private ents = new Map<number, Ent>();
  private people = new Map<number, Person>();
  private map: MapData | null = null;
  private solid = new Uint8Array(0);
  private areaAt = new Int16Array(0);
  private deny = new Set<number>();
  private speed = 72;
  private S = 3;
  private camX = 0;
  private camY = 0;
  private mapSprite: Sprite | null = null;
  private keys = new Set<string>();
  private destroyed = false;

  // local player
  meId = 0;
  private meEnt: Ent | null = null;
  private mx = 0;
  private my = 0;
  private dx = 0;
  private dy = 0;
  private mdir = 0;
  private mArea = -1;
  private seq = 0;
  private hist = new Map<number, { x: number; y: number }>();
  private lastBeat = 0;

  // stats
  private nFrames = 0;
  private msFrames = 0;
  private lastStat = performance.now();
  private nWorld = 0;
  stats: ViewStats = { fps: 0, frameMs: 0, worldMsgs: 0, entities: 0, visible: 0 };

  private locate: { x: number; y: number; until: number } | null = null;
  private hover: { x: number; y: number; w: number; h: number } | null = null;
  private eco = false;
  private guided = false;
  private nearby: Prop | null = null;
  private nearbyAt = 0;
  private emotes = new Map<number, { text: Text; until: number }>();
  private cleanup: (() => void)[] = [];

  constructor(private hooks: ViewHooks) {}

  async init(host: HTMLElement, eco: boolean) {
    await document.fonts.load('700 14px "Pixelify Sans"').catch(() => []);
    this.eco = eco;
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: 0x1b1830,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, eco ? 1 : 2),
      roundPixels: true,
      powerPreference: "low-power",
      preference: "webgl",
    });
    this.app = app;
    host.appendChild(app.canvas);
    app.canvas.style.display = "block";
    app.stage.addChild(this.world, this.hud);
    this.world.addChild(this.entLayer, this.fxG);
    this.entLayer.sortableChildren = true;
    this.hud.addChild(this.hudG);
    this.bannerText = new BitmapText({ text: "", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: 0x383858, stroke: { color: 0xdcdcf0, width: 2 } } });
    this.bannerText.anchor.set(0.5);
    this.banner.addChild(this.bannerG, this.bannerText);
    this.banner.visible = false;
    this.hud.addChild(this.banner);
    app.ticker.maxFPS = eco ? 30 : 0;
    app.ticker.add((t) => this.frame(t.deltaMS));
    this.layout();
    app.renderer.on("resize", () => this.layout());

    const kd = (e: KeyboardEvent) => this.key(e, true);
    const ku = (e: KeyboardEvent) => this.key(e, false);
    const blur = () => this.releaseKeys();
    const vis = () => {
      if (document.hidden) {
        this.releaseKeys();
        app.ticker.stop(); // no rendering in hidden tabs; sockets and calls keep running
      } else {
        app.ticker.start();
        this.hooks.onResume(); // extrapolation did not run while hidden: ask for fresh states
      }
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    });
  }

  destroy() {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    this.app?.destroy(true, { children: true });
  }

  setEco(eco: boolean) {
    this.eco = eco;
    this.app.ticker.maxFPS = eco ? 30 : 0;
    const r = Math.min(window.devicePixelRatio || 1, eco ? 1 : 2);
    this.app.renderer.resolution = r;
    this.app.renderer.resize(this.app.screen.width, this.app.screen.height);
  }

  // ---- input ----
  private key(e: KeyboardEvent, down: boolean) {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Modal controls and the editor own their keyboard interaction.
    if (document.querySelector(".scrim, .editor")) return;
    if (down && !e.repeat && /^[1-7]$/.test(k)) {
      e.preventDefault();
      this.hooks.onEmote?.(Number(k));
      return;
    }
    if (down && !e.repeat && k === "x") {
      e.preventDefault();
      this.interact();
      return;
    }
    const map: Record<string, string> = { arrowleft: "l", a: "l", arrowright: "r", d: "r", arrowup: "u", w: "u", arrowdown: "d", s: "d" };
    const m = map[k];
    if (!m) return;
    e.preventDefault();
    if (down) this.keys.add(m);
    else this.keys.delete(m);
    this.applyKeys();
  }

  private releaseKeys() {
    this.keys.clear();
    this.applyKeys();
  }

  private applyKeys() {
    const dx = (this.keys.has("r") ? 1 : 0) - (this.keys.has("l") ? 1 : 0);
    const dy = (this.keys.has("d") ? 1 : 0) - (this.keys.has("u") ? 1 : 0);
    this.setDirection(dx, dy);
  }

  /** Public so tests can drive movement without synthesising key events. */
  setDirection(dx: number, dy: number) {
    if (dx || dy) this.guided = false;
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    if (dx < 0) this.mdir = 1;
    else if (dx > 0) this.mdir = 2;
    else if (dy < 0) this.mdir = 3;
    else if (dy > 0) this.mdir = 0;
    this.sendDir();
  }

  private sendDir() {
    this.seq++;
    this.hist.set(this.seq, { x: this.mx, y: this.my });
    if (this.hist.size > 64) this.hist.delete(this.hist.keys().next().value!);
    this.hooks.sendInput(this.seq, this.dx, this.dy);
    this.lastBeat = performance.now();
  }

  // ---- data ----
  setMap(map: MapData, deny: number[]) {
    this.map = map;
    this.deny = new Set(deny);
    this.solid = new Uint8Array(map.w * map.h);
    this.areaAt = new Int16Array(map.w * map.h).fill(-1);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) this.solid[y * map.w + x] = map.solid[y][x] === "1" ? 1 : 0;
    for (let pass = 0; pass < 2; pass++)
      map.areas.forEach((a, i) => {
        if ((a.kind === "room") !== (pass === 1)) return;
        for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) this.areaAt[y * map.w + x] = i;
      });
    this.mapSprite?.destroy({ texture: true, textureSource: true }); // do not leak a GPU texture per edit
    const tex = bakeMap(this.app.renderer, map);
    this.mapSprite = new Sprite(tex);
    this.world.addChildAt(this.mapSprite, 0);
    this.areaLabels.forEach((l) => l.text.destroy());
    this.areaLabels = map.areas.map((a, ai) => {
      const text = new BitmapText({
        text: a.name + (this.deny.has(ai) ? " 🔒" : ""),
        style: { fontFamily: FONT, fontSize: 12, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x1a1526, width: 3 } },
      });
      text.anchor.set(0.5, 0);
      text.alpha = 0.85;
      this.hud.addChild(text);
      return { text, ai };
    });
    // assigned desks show their owner
    this.deskLabels.forEach((l) => l.text.destroy());
    this.deskLabels = map.props
      .filter((p) => p.t === "desk" && p.assign && p.label)
      .map((p) => {
        const text = new BitmapText({ text: p.label!, style: { fontFamily: FONT, fontSize: 9, fontWeight: "700", fill: 0xffe9a8, stroke: { color: 0x1a1526, width: 3 } } });
        text.anchor.set(0.5, 1);
        text.alpha = 0.95;
        this.hud.addChild(text);
        return { text, x: (p.x + 1) * T, y: p.y * T };
      });
    this.layout();
  }

  setMe(id: number, x: number, y: number, speed: number) {
    this.meId = id;
    this.mx = x;
    this.my = y;
    this.speed = speed;
    this.mArea = this.areaIndex(x, y);
    this.hooks.onArea(this.map && this.mArea >= 0 ? this.map.areas[this.mArea].name : "");
    if (this.map && this.mArea >= 0) this.showBanner(this.map.areas[this.mArea].name);
    if (!this.meEnt) {
      this.meEnt = this.makeEnt(id);
      this.ents.set(id, this.meEnt);
    }
    this.meEnt.x = x;
    this.meEnt.y = y;
    // A reconnect must never leave the player "stuck walking".
    this.dx = this.dy = 0;
    this.keys.clear();
  }

  setPeople(people: Map<number, Person>) {
    this.people = people;
    for (const e of this.ents.values()) this.refreshEnt(e);
  }

  setSpeaking(ids: Set<number>) {
    for (const e of this.ents.values()) e.speaking = ids.has(e.id);
  }

  setInConversation(ids: Set<number>) {
    for (const e of this.ents.values()) e.inConv = ids.has(e.id);
  }

  // ---- map editor support ----
  currentMap() {
    return this.map;
  }
  /** Re-render/re-collide with an unsaved draft (deny rules are kept). */
  previewMap(map: MapData) {
    this.setMap(map, [...this.deny]);
  }
  screenToTile(clientX: number, clientY: number): [number, number] {
    const r = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - r.left - this.camX) / this.S;
    const wy = (clientY - r.top - this.camY) / this.S;
    return [Math.floor(wx / T), Math.floor(wy / T)];
  }
  setHover(h: { x: number; y: number; w: number; h: number } | null) {
    this.hover = h;
  }
  teleport(x: number, y: number) {
    this.mx = x;
    this.my = y;
    this.dx = this.dy = 0;
    this.hist.clear();
    this.keys.clear();
    this.mArea = this.areaIndex(x, y);
    this.hooks.onArea(this.map && this.mArea >= 0 ? this.map.areas[this.mArea].name : "");
  }

  setGuided(on: boolean) {
    this.guided = on;
    this.releaseKeys();
  }

  applySelf(m: SelfPosition) {
    this.mx = m.x;
    this.my = m.y;
    this.mdir = m.d;
    if (m.tp) this.teleport(m.x, m.y);
    else {
      this.dx = m.dx;
      this.dy = m.dy;
      this.mArea = this.areaIndex(m.x, m.y);
      this.hooks.onArea(this.map && this.mArea >= 0 ? this.map.areas[this.mArea].name : "");
    }
  }

  setDeny(deny: number[]) {
    this.deny = new Set(deny);
    for (const l of this.areaLabels) l.text.text = this.map!.areas[l.ai].name + (this.deny.has(l.ai) ? " 🔒" : "");
  }

  showEmote(id: number, kind: number) {
    const emoji = EMOTES[kind - 1];
    if (!emoji || !this.ents.has(id)) return;
    this.emotes.get(id)?.text.destroy();
    const text = new Text({ text: emoji, style: { fontSize: 32 } });
    text.anchor.set(0.5, 1);
    this.hud.addChild(text);
    this.emotes.set(id, { text, until: performance.now() + 2500 });
  }

  interact() {
    this.updateNearby();
    if (this.nearby) this.hooks.onInteract?.(this.nearby);
  }

  private updateNearby() {
    let best: Prop | null = null;
    let bestD = 20;
    for (const p of this.map?.props ?? []) {
      if (!["note", "embed", "image", "whiteboard"].includes(p.t)) continue;
      const [w, h] = propSize(p);
      const d = Math.hypot(Math.max(p.x * T - this.mx, 0, this.mx - (p.x + w) * T), Math.max(p.y * T - this.my, 0, this.my - (p.y + h) * T));
      if (d <= bestD) { bestD = d; best = p; }
    }
    if (best !== this.nearby) { this.nearby = best; this.hooks.onNearby?.(best); }
  }

  showLocation(x: number, y: number) {
    this.locate = { x, y, until: performance.now() + 5000 };
  }

  applyWorld(m: WorldDelta) {
    this.nWorld++;
    if (m.m) {
      for (const [id, x, y, d] of m.m) {
        if (id === this.meId) continue;
        const dx = ((d >> 2) & 3) - 1;
        const dy = ((d >> 4) & 3) - 1;
        let e = this.ents.get(id);
        if (!e) {
          e = this.makeEnt(id);
          e.tx = e.x = x;
          e.ty = e.y = y;
          this.ents.set(id, e);
        } else {
          // keep the picture continuous: the difference to the new truth fades out
          const ox = e.tx + e.ox - x;
          const oy = e.ty + e.oy - y;
          if (Math.hypot(ox, oy) > 24) {
            e.ox = 0;
            e.oy = 0;
          } else {
            e.ox = ox;
            e.oy = oy;
          }
          e.tx = x;
          e.ty = y;
        }
        e.dir = d & 3;
        e.dx = dx;
        e.dy = dy;
        e.moving = dx !== 0 || dy !== 0;
      }
    }
    if (m.l) for (const id of m.l) if (id !== this.meId) this.removeEnt(id);
  }

  /** Server reconciliation: compare with where we were when that input was sent. */
  applyAck(a: Ack) {
    const h = this.hist.get(a.s);
    if (!h) return;
    for (const k of this.hist.keys()) if (k <= a.s) this.hist.delete(k);
    const ex = a.x - h.x;
    const ey = a.y - h.y;
    const err = Math.hypot(ex, ey);
    if (err < 0.5) return;
    if (err > 24) {
      this.mx += ex;
      this.my += ey;
    } else {
      this.mx += ex * 0.5;
      this.my += ey * 0.5;
    }
  }

  clearRemote() {
    for (const id of [...this.ents.keys()]) if (id !== this.meId) this.removeEnt(id);
  }

  position() {
    return { x: this.mx, y: this.my };
  }

  debugEntities() {
    return [...this.ents.values()].filter((e) => e.id !== this.meId).map((e) => ({ id: e.id, x: e.x, y: e.y }));
  }

  // ---- entities ----
  private makeEnt(id: number): Ent {
    const p = this.people.get(id);
    const frames = avatarFrames(p?.av ?? DEFAULT_AV);
    const spr = new Sprite(frames[0][0]);
    spr.anchor.set(0.5, FEET_Y / CELL_H);
    this.entLayer.addChild(spr);
    const label = new Container();
    const dot = new Graphics();
    const text = new BitmapText({
      text: p?.n ?? "…",
      style: { fontFamily: FONT, fontSize: 14, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x1a1526, width: 3 } },
    });
    text.anchor.set(0.5, 1);
    label.addChild(dot, text);
    this.hud.addChild(label);
    const e: Ent = {
      id, key: "", frames, spr, label, text, dot, ring: null, tx: 0, ty: 0, ox: 0, oy: 0, dx: 0, dy: 0, x: 0, y: 0, dir: 0, moving: false,
      speaking: false, inConv: false, status: p?.s ?? "available", name: p?.n ?? "", drawnStatus: "", drawnConv: false,
    };
    this.refreshEnt(e);
    return e;
  }

  private refreshEnt(e: Ent) {
    const p = this.people.get(e.id);
    if (!p) return;
    const frames = avatarFrames(p.av);
    if (frames !== e.frames) e.frames = frames;
    if (e.name !== p.n || e.text.text !== p.n) {
      e.name = p.n;
      e.text.text = p.n;
    }
    e.status = p.s;
    e.spr.alpha = p.s === "offline" ? 0.5 : 1;
  }

  private removeEnt(id: number) {
    const e = this.ents.get(id);
    if (!e) return;
    e.spr.destroy();
    e.label.destroy({ children: true });
    e.ring?.destroy();
    this.ents.delete(id);
    this.emotes.get(id)?.text.destroy();
    this.emotes.delete(id);
  }

  /** Location signboard that slides in from the top when entering an area (handheld-RPG style). */
  private showBanner(name: string) {
    const t = this.bannerText;
    if (!t || !name) return;
    t.text = name.toUpperCase();
    const w = Math.round(t.width) + 40, h = 38;
    this.bannerW = w;
    this.bannerG
      .clear()
      .roundRect(0, 0, w, h, 4).fill(0x383858)
      .roundRect(2, 2, w - 4, h - 4, 3).fill(0xa0a8e8)
      .roundRect(4, 4, w - 8, h - 8, 2).fill(0xf8f8ff)
      .rect(4, h - 8, w - 8, 3).fill(0xdcdcf0)
      .rect(4, 4, w - 8, 2).fill(0xffffff);
    t.position.set(w / 2, h / 2 + 1);
    this.bannerT0 = performance.now();
  }

  // ---- movement / collision (mirrors the server) ----
  private areaIndex(x: number, y: number) {
    if (!this.map) return -1;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return -1;
    return this.areaAt[ty * this.map.w + tx];
  }

  private canStand(x: number, y: number) {
    const m = this.map!;
    const x0 = Math.floor((x - BOX_HW) / T), x1 = Math.floor((x + BOX_HW - 0.001) / T);
    const y0 = Math.floor((y - BOX_HH) / T), y1 = Math.floor((y + BOX_HH - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || this.solid[ty * m.w + tx]) return false;
        const ai = this.areaAt[ty * m.w + tx];
        if (ai !== this.mArea && this.deny.has(ai)) return false;
      }
    }
    return true;
  }

  private canStandStatic(x: number, y: number) {
    const m = this.map!;
    const x0 = Math.floor((x - BOX_HW) / T), x1 = Math.floor((x + BOX_HW - 0.001) / T);
    const y0 = Math.floor((y - BOX_HH) / T), y1 = Math.floor((y + BOX_HH - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || this.solid[ty * m.w + tx]) return false;
    return true;
  }

  /** Walks a remote entity along its last known direction (same rule as the server's shadow). */
  private extrapolate(e: Ent, dt: number) {
    let vx = e.dx, vy = e.dy;
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    const n = Math.max(1, Math.ceil(dt / SHADOW_STEP));
    const step = (this.speed * dt) / n;
    for (let i = 0; i < n; i++) {
      const nx = e.tx + vx * step;
      if (vx && this.canStandStatic(nx, e.ty)) e.tx = nx;
      const ny = e.ty + vy * step;
      if (vy && this.canStandStatic(e.tx, ny)) e.ty = ny;
    }
  }

  private stepLocal(dt: number) {
    if (!this.map || (!this.dx && !this.dy)) return;
    let vx = this.dx, vy = this.dy;
    if (vx && vy) { vx *= Math.SQRT1_2; vy *= Math.SQRT1_2; }
    const step = this.speed * dt;
    const nx = this.mx + vx * step;
    if (vx && this.canStand(nx, this.my)) this.mx = nx;
    const ny = this.my + vy * step;
    if (vy && this.canStand(this.mx, ny)) this.my = ny;
    const ai = this.areaIndex(this.mx, this.my);
    if (ai !== this.mArea) {
      this.mArea = ai;
      this.hooks.onArea(ai >= 0 ? this.map.areas[ai].name : "");
      if (ai >= 0) this.showBanner(this.map.areas[ai].name);
    }
  }

  // ---- layout / frame ----
  private layout() {
    if (!this.app) return;
    const { width, height } = this.app.screen;
    // integer zoom keeps pixel art crisp; the reference view is a handheld-style screen scaled by whole numbers
    this.S = Math.max(2, Math.min(6, Math.floor(Math.min(width / VIEW_REF_W, height / VIEW_REF_H))));
    this.world.scale.set(this.S);
  }

  private frame(deltaMS: number) {
    if (this.destroyed || !this.map) return;
    const t0 = performance.now();
    const dt = Math.min(deltaMS / 1000, 0.1);
    const now = t0;
    const S = this.S;
    const { width: W, height: H } = this.app.screen;

    if (!this.guided) {
      this.stepLocal(dt);
      if ((this.dx || this.dy) && now - this.lastBeat > HEARTBEAT_MS) this.sendDir();
    }
    if (now - this.nearbyAt > 150) { this.nearbyAt = now; this.updateNearby(); }

    const mw = this.map.w * T * S, mh = this.map.h * T * S;
    let cx = W / 2 - this.mx * S, cy = H / 2 - this.my * S;
    cx = mw <= W ? (W - mw) / 2 : Math.min(0, Math.max(W - mw, cx));
    cy = mh <= H ? (H - mh) / 2 : Math.min(0, Math.max(H - mh, cy));
    this.camX = Math.round(cx);
    this.camY = Math.round(cy);
    this.world.position.set(this.camX, this.camY);

    const walkRate = this.eco ? 5 : 8;
    let visible = 0;
    for (const e of this.ents.values()) {
      const isMe = e.id === this.meId;
      if (isMe) {
        e.x = this.mx; e.y = this.my; e.dir = this.mdir; e.moving = !!(this.dx || this.dy);
      } else {
        if (e.dx || e.dy) this.extrapolate(e, dt);
        const k = Math.exp(-dt / OFFSET_TAU);
        e.ox *= k;
        e.oy *= k;
        e.x = e.tx + e.ox;
        e.y = e.ty + e.oy;
      }
      const sx = Math.round(e.x * S + this.camX);
      const sy = Math.round(e.y * S + this.camY);
      const on = sx > -40 && sx < W + 40 && sy > -60 && sy < H + 60;
      e.spr.visible = on;
      e.label.visible = on;
      if (e.ring) e.ring.visible = on && e.speaking;
      if (!on) continue;
      visible++;
      const phase = e.moving ? [1, 0, 2, 0][Math.floor((now / 1000) * walkRate) & 3] : 0;
      e.spr.texture = e.frames[e.dir]?.[phase] ?? e.frames[0][0];
      e.spr.position.set(Math.round(e.x), Math.round(e.y));
      e.spr.zIndex = e.y;
      e.label.position.set(sx, sy - (CELL_H - 2) * S * 0.9);
      if (e.drawnStatus !== e.status || e.drawnConv !== e.inConv) this.drawDot(e);
      if (e.speaking) {
        if (!e.ring) { e.ring = new Graphics(); this.world.addChildAt(e.ring, 1); }
        e.ring.clear().ellipse(0, 0, 9, 4).stroke({ color: 0x3cc9b0, width: 1.5 });
        e.ring.position.set(Math.round(e.x), Math.round(e.y) - 1);
        e.ring.visible = true;
      }
    }

    // area labels
    for (const [id, bubble] of this.emotes) {
      const e = this.ents.get(id);
      if (!e || now >= bubble.until) { bubble.text.destroy(); this.emotes.delete(id); continue; }
      bubble.text.visible = e.label.visible;
      bubble.text.position.set(e.x * S + this.camX, e.y * S + this.camY - CELL_H * S - 28);
    }

    // area labels
    for (const l of this.areaLabels) {
      const a = this.map.areas[l.ai];
      const sx = (a.x + a.w / 2) * T * S + this.camX;
      const sy = (a.y + 0.2) * T * S + this.camY;
      l.text.visible = sx > -100 && sx < W + 100 && sy > -20 && sy < H;
      l.text.position.set(Math.round(sx), Math.round(sy));
    }

    for (const l of this.deskLabels) {
      const sx = l.x * S + this.camX;
      const sy = l.y * S + this.camY;
      l.text.visible = S >= 3 && sx > -60 && sx < W + 60 && sy > 0 && sy < H + 20;
      l.text.position.set(Math.round(sx), Math.round(sy));
    }

    // locate marker
    this.fxG.clear();
    if (this.hover) this.fxG.rect(this.hover.x * T, this.hover.y * T, this.hover.w * T, this.hover.h * T).stroke({ color: 0xffb84d, width: 1 }).fill({ color: 0xffb84d, alpha: 0.18 });
    this.hudG.clear();
    if (this.locate) {
      if (now > this.locate.until) this.locate = null;
      else {
        const pulse = (now % 900) / 900;
        this.fxG.circle(this.locate.x, this.locate.y, 6 + pulse * 14).stroke({ color: 0xffb84d, width: 2, alpha: 1 - pulse });
        const sx = this.locate.x * S + this.camX, sy = this.locate.y * S + this.camY;
        if (sx < 0 || sy < 0 || sx > W || sy > H) {
          const ang = Math.atan2(sy - H / 2, sx - W / 2);
          const ex = Math.max(24, Math.min(W - 24, sx)), ey = Math.max(24, Math.min(H - 24, sy));
          this.hudG.poly([ex + Math.cos(ang) * 14, ey + Math.sin(ang) * 14, ex + Math.cos(ang + 2.5) * 10, ey + Math.sin(ang + 2.5) * 10, ex + Math.cos(ang - 2.5) * 10, ey + Math.sin(ang - 2.5) * 10]).fill(0xffb84d);
        }
      }
    }

    // location signboard animation: slide in, hold, slide out
    {
      const t = now - this.bannerT0;
      const h = 38, total = 2600, slide = 260;
      if (t < 0 || t > total) this.banner.visible = false;
      else {
        const k = t < slide ? t / slide : t > total - slide ? (total - t) / slide : 1;
        const e = 1 - (1 - k) * (1 - k);
        this.banner.visible = true;
        this.banner.position.set(Math.round((W - this.bannerW) / 2), Math.round(-h + (h + 60) * e));
      }
    }

    // stats
    this.nFrames++;
    this.msFrames += performance.now() - t0;
    if (now - this.lastStat >= 1000) {
      const secs = (now - this.lastStat) / 1000;
      this.stats = {
        fps: Math.round(this.nFrames / secs),
        frameMs: +(this.msFrames / Math.max(1, this.nFrames)).toFixed(2),
        worldMsgs: Math.round(this.nWorld / secs),
        entities: this.ents.size,
        visible,
      };
      this.nFrames = 0; this.msFrames = 0; this.nWorld = 0; this.lastStat = now;
    }
  }

  private drawDot(e: Ent) {
    e.drawnStatus = e.status;
    e.drawnConv = e.inConv;
    const w = e.text.width;
    e.dot.clear().circle(-w / 2 - 6, -6, 3).fill(STATUS_COLOR[e.status] ?? 0x8e8e9a);
    if (e.inConv) e.dot.roundRect(w / 2 + 3, -10, 6, 8, 2).fill(0x3cc9b0);
  }
}
