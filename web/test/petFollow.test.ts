// Pet following, frame by frame with a fixed 60 Hz clock. Run: node --test web/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { followOwner, newPet, PET_GAP, type PetState } from "../src/game/petFollow.ts";

const DT = 1 / 60, WALK = 72, RUN = 144;

/** Walks the owner along (vx, vy) for secs; returns the pet-owner distance at every frame. */
function walk(s: PetState, o: { x: number; y: number; t: number }, vx: number, vy: number, secs: number, v = WALK) {
  const gaps: number[] = [];
  const dir = vx < 0 ? 1 : vx > 0 ? 2 : vy < 0 ? 3 : 0;
  for (let i = 0; i < Math.round(secs / DT); i++) {
    o.x += vx * v * DT;
    o.y += vy * v * DT;
    o.t += DT * 1000;
    followOwner(s, o.x, o.y, dir, v, DT, o.t);
    gaps.push(Math.hypot(s.px - o.x, s.py - o.y));
  }
  return gaps;
}

test("walks PET_GAP behind on a straight line and never on top", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  const g = walk(s, o, 1, 0, 2).slice(30);
  assert.ok(Math.min(...g) >= PET_GAP - 2 && Math.max(...g) <= PET_GAP + 2, `gaps ${Math.min(...g)}..${Math.max(...g)}`);
});

test("goes around a corner on the owner's trail", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 1, 0, 1);
  const cornerX = o.x;
  for (let i = 0; i < 40; i++) {
    walk(s, o, 0, 1, DT);
    // while the owner goes down, the pet is still on the horizontal leg or on the vertical one, never inside the corner
    assert.ok(Math.abs(s.py - 100) < 0.5 || Math.abs(s.px - cornerX) < 0.5, `pet at ${s.px.toFixed(1)},${s.py.toFixed(1)}`);
  }
});

test("keeps up with a runner", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  const g = walk(s, o, 1, 0, 2, RUN).slice(30);
  assert.ok(Math.max(...g) <= PET_GAP + 3, `max ${Math.max(...g)}`);
});

test("catches up within a second after a 60 px jump of its owner (network correction, short portal)", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 1, 0, 1);
  o.x += 60;
  const g = walk(s, o, 1, 0, 1.5);
  const late = g.slice(60);
  assert.ok(Math.max(...late) <= PET_GAP + 6, `still ${Math.max(...late).toFixed(1)} px away 1 s after the jump`);
});

test("small network corrections (up to 6 px, sudden) never make the pet outrun a walker", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 1, 0, 1);
  let fastest = 0;
  for (let i = 0; i < 180; i++) {
    const px = s.px, py = s.py;
    o.x += WALK * DT + (i % 20 === 0 ? 6 * Math.sign(Math.sin(i)) : 0); // a correction every third of a second
    o.t += DT * 1000;
    followOwner(s, o.x, o.y, 2, WALK, DT, o.t);
    fastest = Math.max(fastest, Math.hypot(s.px - px, s.py - py) / DT);
  }
  assert.ok(fastest <= WALK * 1.35, `pet reached ${fastest.toFixed(0)} px/s`);
});

test("reseeds behind the owner after a teleport", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 1, 0, 1);
  o.x += 500;
  const g = walk(s, o, 1, 0, DT * 2);
  assert.ok(g[g.length - 1] <= PET_GAP + 2);
});

/** Share of the pet sprite (16x14 above its feet) hidden by the owner (18x26 sprite plus name tag above). */
function hidden(s: PetState, o: { x: number; y: number }) {
  const p = { x0: s.px - 7, x1: s.px + 7, y0: s.py - 13, y1: s.py };
  const owner = { x0: o.x - 9, x1: o.x + 9, y0: o.y - 31, y1: o.y };
  const w = Math.max(0, Math.min(p.x1, owner.x1) - Math.max(p.x0, owner.x0));
  const h = Math.max(0, Math.min(p.y1, owner.y1) - Math.max(p.y0, owner.y0));
  return (w * h) / (14 * 13);
}

test("after the owner walks toward the camera and stops, the pet does not stay hidden behind them", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 0, 1, 1);
  walk(s, o, 0, 0, 1.5);
  assert.ok(hidden(s, o) <= 0.25, `${Math.round(hidden(s, o) * 100)} % of the pet is behind the owner`);
});

test("a pet that appears next to an owner facing the camera is visible", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 0, 0, 1.5); // owner standing, facing down (dir 0), pet just created
  assert.ok(hidden(s, o) <= 0.25, `${Math.round(hidden(s, o) * 100)} % hidden`);
});

test("at rest it settles behind and looks at the owner", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 1, 0, 1);
  walk(s, o, 0, 0, 1);
  assert.ok(!s.moving && Math.abs(Math.hypot(s.px - o.x, s.py - o.y) - PET_GAP) < 1);
  assert.equal(s.dir, 2, "facing right, toward the owner");
});

test("behaves the same at 12 fps (slow, software-rendered browsers)", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  const dt = 1 / 12;
  let fastest = 0;
  const gaps: number[] = [];
  for (let i = 0; i < 36; i++) {
    const px = s.px, py = s.py;
    o.x += WALK * dt;
    o.t += dt * 1000;
    followOwner(s, o.x, o.y, 2, WALK, dt, o.t);
    if (i > 6) {
      fastest = Math.max(fastest, Math.hypot(s.px - px, s.py - py) / dt);
      gaps.push(Math.hypot(s.px - o.x, s.py - o.y));
    }
  }
  assert.ok(fastest <= WALK * 1.35, `pet reached ${fastest.toFixed(0)} px/s`);
  assert.ok(Math.min(...gaps) >= PET_GAP - 3 && Math.max(...gaps) <= PET_GAP + 3, `gaps ${Math.min(...gaps).toFixed(1)}..${Math.max(...gaps).toFixed(1)}`);
});

test("the trail stays bounded", () => {
  const s = newPet(), o = { x: 100, y: 100, t: 0 };
  walk(s, o, 1, 0, 30);
  assert.ok(s.trail.length < 2 * (PET_GAP + 4), `trail has ${s.trail.length / 2} points`);
});
