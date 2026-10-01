// How a pet follows its owner: pure logic, no PixiJS, so it can be tested with plain Node
// (node --test 'web/test/*.test.ts'). The view calls followOwner() once per frame for every visible pet.

export const PET_GAP = 20; // px along the owner's trail between the owner's feet and the pet
export const PET_SNAP = 140; // px: an owner jump farther than this reseeds the trail (portal, teleport)
const SETTLE_MS = 500; // owner still this long: a pet hidden behind them strolls to their side
const STROLL = 45; // px/s for that little walk

export interface PetState {
  /** Owner positions, oldest first, flat [x0, y0, x1, y1, ...]; the pet walks this trail. */
  trail: number[];
  px: number;
  py: number;
  dir: number; // 0 down, 1 left, 2 right, 3 up
  moving: boolean;
  /** ms timestamp of the last frame the pet moved */
  restSince: number;
  /** ms timestamp of the last frame the owner moved */
  ownerMoved: number;
}

export const newPet = (): PetState => ({ trail: [], px: NaN, py: NaN, dir: 0, moving: false, restSince: 0, ownerMoved: 0 });

const facing = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0);

/** Share of a pet standing at (px, py) that the owner at (ox, oy) hides: their sprite plus the name tag. */
export function hiddenShare(px: number, py: number, ox: number, oy: number) {
  const w = Math.max(0, Math.min(px + 7, ox + 9) - Math.max(px - 7, ox - 9));
  const h = Math.max(0, Math.min(py, oy) - Math.max(py - 13, oy - 31));
  return (w * h) / (14 * 13);
}

/**
 * Advances the pet one frame. ox/oy/odir: the owner now; ownerV: the owner's current speed in px/s
 * (walk or run); dt in seconds; now in ms; canStand: whether a pet may stand at a point (walls).
 */
export function followOwner(s: PetState, ox: number, oy: number, odir: number, ownerV: number, dt: number, now: number, canStand: (x: number, y: number) => boolean = () => true) {
  const tr = s.trail;
  const lx = tr[tr.length - 2], ly = tr[tr.length - 1];
  if (!Number.isFinite(s.px) || tr.length === 0 || Math.hypot(ox - lx, oy - ly) > PET_SNAP) {
    // (re)seed a short trail from the owner's back; an owner facing the camera gets the pet at their
    // side instead, where it is not hidden behind them
    const back = [[-1, 0], [1, 0], [-1, 0], [0, 1]][odir] ?? [-1, 0];
    tr.length = 0;
    tr.push(ox + back[0] * PET_GAP, oy + back[1] * PET_GAP, ox, oy);
    s.px = tr[0];
    s.py = tr[1];
    s.ownerMoved = now;
  } else if (Math.hypot(ox - lx, oy - ly) >= 1) {
    tr.push(ox, oy);
    s.ownerMoved = now;
  }
  const still = now - s.ownerMoved > SETTLE_MS;
  // walk back from the owner along the trail to find the pet's spot; drop what lies beyond it
  let need = PET_GAP, gx = tr[0], gy = tr[1], cut = 0;
  let ax = ox, ay = oy;
  for (let i = tr.length - 2; i >= 0; i -= 2) {
    const bx = tr[i], by = tr[i + 1];
    const seg = Math.hypot(ax - bx, ay - by);
    if (seg >= need) {
      const k = need / seg;
      gx = ax + (bx - ax) * k;
      gy = ay + (by - ay) * k;
      cut = i;
      break;
    }
    need -= seg;
    ax = bx;
    ay = by;
  }
  if (cut > 2) tr.splice(0, cut - 2); // keep one point behind the spot
  if (still && hiddenShare(gx, gy, ox, oy) > 0.25) {
    // the spot is behind the owner (they face the camera): sit beside them instead. The trail now ends
    // at that side spot, so when the owner walks off the pet leaves from there without a jump.
    const side = s.px >= ox ? 1 : -1;
    for (const sx of [ox + side * PET_GAP, ox - side * PET_GAP]) {
      if (canStand(sx, oy)) {
        tr.length = 0;
        tr.push(sx, oy, ox, oy);
        gx = sx;
        gy = oy;
        break;
      }
    }
  }
  // Move to the spot at the owner's pace. Lag is what is left after this frame's normal advance, so the
  // rule does not depend on the frame rate: a small lag (a network correction) is closed at 1.15x the
  // owner's pace, a big one (the owner jumped: correction, short portal) with a proportional catch-up.
  // With the owner standing still the pet strolls.
  const ddx = gx - s.px, ddy = gy - s.py;
  const d = Math.hypot(ddx, ddy);
  const lag = Math.max(0, d - ownerV * dt);
  const step = still ? STROLL * dt : (ownerV * (lag > 2 ? 1.15 : 1) + Math.max(0, lag - 8) * 5) * dt;
  if (d > 0.3) {
    const k = Math.min(1, step / d);
    s.px += ddx * k;
    s.py += ddy * k;
    s.moving = true;
    s.dir = facing(ddx, ddy);
    s.restSince = now;
  } else {
    s.moving = false;
    if (now - s.restSince > 400) s.dir = facing(ox - s.px, oy - s.py); // settled: look at the owner
  }
}
