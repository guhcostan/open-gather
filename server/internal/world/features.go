package world

import (
	"math"
	"strconv"
	"time"

	"tilework/internal/gamemap"
)

// Social features that are decided on the server: emotes, interactive objects, guided walking
// ("follow" / "request to lead") and portals. Everything here runs on the world goroutine.

const (
	emoteCooldown = 700 * time.Millisecond
	emoteKinds    = 8    // 1-7 bubbles, 8 dance
	useReach      = 20.0 // px between the player's feet and the object's rectangle
	followGap     = 26.0 // a follower stops this close to the leader
	maxFollowers  = 64   // bounds the path-finding work per tick
	leadCooldown  = 3 * time.Second
	pathEvery     = 400 * time.Millisecond
)

func itoa(n uint32) string { return strconv.FormatUint(uint64(n), 10) }

// rectDist is the distance from a point to a rectangle (0 when inside).
func rectDist(px, py, rx, ry, rw, rh float64) float64 {
	dx := math.Max(math.Max(rx-px, 0), px-(rx+rw))
	dy := math.Max(math.Max(ry-py, 0), py-(ry+rh))
	return math.Hypot(dx, dy)
}

func tileOf(x, y float64) tile {
	return tile{int16(int(x) / gamemap.TilePx), int16(int(y) / gamemap.TilePx)}
}

func tileCenter(t tile) (float64, float64) {
	return float64(int(t.x)*gamemap.TilePx + gamemap.TilePx/2), float64(int(t.y)*gamemap.TilePx + gamemap.TilePx/2)
}

// ---- emotes ----

// Conn.Emote / Use / Follow / Lead are called from the connection goroutine.

func (w *World) doEmote(p *Player, kind int, now time.Time) {
	if kind < 1 || kind > emoteKinds || p.Status == StatusInvisible || now.Sub(p.emoAt) < emoteCooldown {
		return
	}
	p.emoAt = now
	b := []byte(`{"t":"e","id":` + itoa(p.ID) + `,"v":` + strconv.Itoa(kind) + "}")
	c := &w.cells[p.cy*w.cols+p.cx]
	self := false
	for _, s := range c.subs { // everybody whose area of interest covers the sender
		if s == p {
			self = true
		}
		w.sendCopy(s, b) // cosmetic: dropped for congested clients instead of kicking them
	}
	if !self {
		w.sendCopy(p, b)
	}
}

// ---- interactive objects ----

// doUse is "press X": the player must stand next to the object and be allowed in its area. The
// content of notes, sites and images travels only in this reply, never in the map.
func (w *World) doUse(p *Player, x, y int, now time.Time) {
	for i := range w.m.Map.Props {
		pr := &w.m.Map.Props[i]
		if pr.X != x || pr.Y != y || !pr.Interactive() {
			continue
		}
		pw, ph := pr.Size()
		if rectDist(p.X, p.Y, float64(pr.X*gamemap.TilePx), float64(pr.Y*gamemap.TilePx), float64(pw*gamemap.TilePx), float64(ph*gamemap.TilePx)) > useReach {
			return
		}
		if ai := w.m.AreaIndexAt(pr.X, pr.Y); ai != p.area && !w.canEnterArea(p, ai) {
			return
		}
		if pr.T == gamemap.PropWhiteboard {
			w.openBoard(p, pr, now)
			return
		}
		w.sendJSON(p, map[string]any{"t": "obj", "k": pr.T, "l": pr.Label, "d": pr.Data})
		return
	}
}

// ---- guided walking ----

func (w *World) sendFollow(p *Player, id uint32, name string) {
	w.sendJSON(p, map[string]any{"t": "fol", "id": id, "n": name})
}

// sendSelf tells a client about its own server-driven position (guided walk or teleport).
func (w *World) sendSelf(p *Player, teleport bool) {
	if p.out == nil {
		return
	}
	b := []byte(`{"t":"self","x":`)
	b = strconv.AppendFloat(b, p.X, 'f', 1, 64)
	b = append(b, `,"y":`...)
	b = strconv.AppendFloat(b, p.Y, 'f', 1, 64)
	b = append(b, `,"dx":`...)
	b = strconv.AppendInt(b, int64(p.Dx), 10)
	b = append(b, `,"dy":`...)
	b = strconv.AppendInt(b, int64(p.Dy), 10)
	b = append(b, `,"d":`...)
	b = strconv.AppendInt(b, int64(p.dir), 10)
	b = append(b, `,"tp":`...)
	b = strconv.AppendBool(b, teleport)
	b = append(b, '}')
	w.sendShared(p, b)
}

func (w *World) doFollow(p *Player, id uint32, now time.Time) {
	if id == 0 || id == p.ID {
		w.stopFollow(p, now, true, true)
		return
	}
	q := w.players[id]
	if q == nil || q.Status == StatusInvisible || q.out == nil {
		w.stopFollow(p, now, true, true)
		return
	}
	if _, ok := w.followers[p]; !ok && len(w.followers) >= maxFollowers {
		w.stopFollow(p, now, true, true)
		return
	}
	p.follow, p.fpath, p.fcalc = id, nil, time.Time{}
	w.followers[p] = struct{}{}
	w.sendFollow(p, id, q.Name)
}

// stopFollow ends a guided walk. halt also stops the avatar; it is false when the player's own input
// is what ended the walk.
func (w *World) stopFollow(p *Player, now time.Time, notify, halt bool) {
	if !p.guided() {
		return
	}
	wasRunning := p.running()
	w.advance(p, now)
	p.follow, p.fpath, p.destOn, p.destID = 0, nil, false, 0
	delete(w.followers, p)
	if halt && (p.Dx != 0 || p.Dy != 0) {
		w.setDrive(p, 0, 0, now)
	} else if wasRunning != p.running() && (p.Dx != 0 || p.Dy != 0) {
		p.shadowAt = now
		w.sendState(p, now) // the speed changed under a direction clients already extrapolate
	}
	if halt {
		w.sendSelf(p, false) // the final resting point: the client stops predicting after this
	}
	if notify && p.out != nil {
		w.sendFollow(p, 0, "")
	}
}

// doGoto starts a guided run to a tile (id == 0) or next to another player. It reuses the follow
// machinery: the path is searched on the server, so walls and locked rooms are respected.
func (w *World) doGoto(p *Player, x, y int, id uint32, now time.Time) {
	var dest tile
	gap := 0.0
	if id != 0 {
		q := w.players[id]
		if q == nil || q == p || q.Status == StatusInvisible || q.out == nil {
			w.sendJSON(p, map[string]any{"t": "go", "ok": false})
			return
		}
		dest, gap = tileOf(q.X, q.Y), followGap
	} else {
		if x < 0 || y < 0 || x >= w.m.W || y >= w.m.H {
			return
		}
		dest = tile{int16(x), int16(y)}
	}
	if _, ok := w.followers[p]; !ok && len(w.followers) >= maxFollowers {
		w.sendJSON(p, map[string]any{"t": "go", "ok": false})
		return
	}
	if p.follow != 0 {
		w.stopFollow(p, now, true, false)
	}
	from := tileOf(p.X, p.Y)
	path := w.findPath(p, from, dest)
	if path == nil && from != dest {
		w.sendJSON(p, map[string]any{"t": "go", "ok": false})
		return
	}
	w.advance(p, now)
	p.destOn, p.dest, p.destGap, p.destID = true, dest, gap, id
	p.fpath, p.fcalc = path, now.Add(time.Hour) // a fixed target: one search is enough
	w.followers[p] = struct{}{}
	if p.Dx != 0 || p.Dy != 0 {
		p.shadowAt = now
		w.sendState(p, now) // now at run speed
	}
	w.sendJSON(p, map[string]any{"t": "go", "ok": true, "x": dest.x, "y": dest.y})
}

// setDrive applies a server-chosen direction, exactly like a client input would.
func (w *World) setDrive(p *Player, dx, dy int8, now time.Time) {
	w.advance(p, now)
	if dx == p.Dx && dy == p.Dy {
		return
	}
	p.Dx, p.Dy = dx, dy
	if dx != 0 || dy != 0 {
		switch {
		case dx < 0:
			p.dir = 1
		case dx > 0:
			p.dir = 2
		case dy < 0:
			p.dir = 3
		default:
			p.dir = 0
		}
		p.lastAdv = now
		w.movers[p] = struct{}{}
	} else {
		delete(w.movers, p)
	}
	p.shadowAt = now
	w.sendState(p, now)
}

func (w *World) driveFollowers(now time.Time) {
	if len(w.followers) == 0 {
		return
	}
	for p := range w.followers {
		step := w.speedOf(p) / float64(w.cfg.TickHz)
		fix := func(cur, target float64) int8 {
			d := target - cur
			if math.Abs(d) <= step*0.6 { // residual after a step is < 0.4 step, so this cannot oscillate
				return 0
			}
			if d > 0 {
				return 1
			}
			return -1
		}
		w.advance(p, now)
		cur := tileOf(p.X, p.Y)
		if p.destOn {
			if p.out == nil {
				w.stopFollow(p, now, false, true)
				continue
			}
			arrived := cur == p.dest
			if p.destGap > 0 {
				if q := w.players[p.destID]; q != nil && q.out != nil {
					arrived = arrived || dist(p.X, p.Y, q.X, q.Y) <= p.destGap
				}
			}
			if arrived {
				w.stopFollow(p, now, true, true)
				continue
			}
		} else {
			q := w.players[p.follow]
			if q == nil || q.Status == StatusInvisible || q.out == nil || p.out == nil {
				w.stopFollow(p, now, true, true)
				continue
			}
			if dist(p.X, p.Y, q.X, q.Y) <= followGap {
				w.setDrive(p, 0, 0, now)
				continue
			}
			goal := tileOf(q.X, q.Y)
			if !now.Before(p.fcalc) { // the leader moves: search again, but at most every pathEvery
				p.fpath = w.findPath(p, cur, goal)
				p.fgoal = goal
				p.fcalc = now.Add(pathEvery)
			}
		}
		for len(p.fpath) > 0 && p.fpath[0] == cur {
			p.fpath = p.fpath[1:]
		}
		if len(p.fpath) == 0 {
			if p.destOn { // the way closed (a door was locked meanwhile): give up
				w.stopFollow(p, now, true, true)
				w.sendJSON(p, map[string]any{"t": "go", "ok": false})
				continue
			}
			w.setDrive(p, 0, 0, now) // unreachable (a locked door, another floor...): wait
			continue
		}
		nxt := p.fpath[0]
		tx, ty := tileCenter(nxt)
		// Snap the cross axis onto the lane once it is within one step: at run speed the residual
		// would otherwise be large enough for the collision box to catch a wall corner.
		snap := func() {
			if nxt.x != cur.x && p.Y != ty && w.canStand(p, p.X, ty) {
				p.Y = ty
			} else if nxt.y != cur.y && p.X != tx && w.canStand(p, tx, p.Y) {
				p.X = tx
			}
		}
		var dx, dy int8
		if nxt.x != cur.x { // horizontal step: line up with the row first so the box never clips a wall
			if dy = fix(p.Y, ty); dy == 0 {
				snap()
				dx = fix(p.X, tx)
			}
		} else {
			if dx = fix(p.X, tx); dx == 0 {
				snap()
				dy = fix(p.Y, ty)
			}
		}
		if dx == 0 && dy == 0 {
			p.fpath = p.fpath[1:]
		}
		w.setDrive(p, dx, dy, now)
	}
}

// bfsScratch is reused by every path search so a search allocates nothing.
type bfsScratch struct {
	seen  []uint32
	prev  []int32
	queue []int32
	gen   uint32
}

// findPath returns the tiles from (excluding) 'from' to (including) 'to' over tiles p may stand on,
// or nil. Portals are avoided so a follower does not teleport by accident.
func (w *World) findPath(p *Player, from, to tile) []tile {
	W, H := w.m.W, w.m.H
	n := W * H
	s := &w.bfs
	if len(s.seen) != n {
		s.seen, s.prev, s.queue, s.gen = make([]uint32, n), make([]int32, n), make([]int32, 0, 256), 0
	}
	s.gen++
	pass := func(t tile) bool {
		x, y := int(t.x), int(t.y)
		if x < 0 || y < 0 || x >= W || y >= H || w.m.Solid[y*W+x] {
			return false
		}
		if _, portal := w.m.Portals[y*W+x]; portal {
			return false
		}
		ai := w.m.AreaIndexAt(x, y)
		return ai == p.area || w.canEnterArea(p, ai)
	}
	if from == to || !pass(to) {
		return nil
	}
	start, goal := int32(int(from.y)*W+int(from.x)), int32(int(to.y)*W+int(to.x))
	s.queue = append(s.queue[:0], start)
	s.seen[start], s.prev[start] = s.gen, -1
	dirs := [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	for head := 0; head < len(s.queue); head++ {
		cur := s.queue[head]
		if cur == goal {
			break
		}
		cx, cy := int(cur)%W, int(cur)/W
		for _, d := range dirs {
			nx, ny := cx+d[0], cy+d[1]
			if nx < 0 || ny < 0 || nx >= W || ny >= H {
				continue
			}
			ni := int32(ny*W + nx)
			if s.seen[ni] == s.gen || !pass(tile{int16(nx), int16(ny)}) {
				continue
			}
			s.seen[ni], s.prev[ni] = s.gen, cur
			s.queue = append(s.queue, ni)
		}
	}
	if s.seen[goal] != s.gen {
		return nil
	}
	var rev []tile
	for c := goal; c != start; c = s.prev[c] {
		rev = append(rev, tile{int16(int(c) % W), int16(int(c) / W)})
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev
}

// doLead is "request to lead": ask another player to follow me. The other side decides.
func (w *World) doLead(p *Player, id uint32, now time.Time) {
	q := w.players[id]
	if q == nil || q == p || q.Status == StatusInvisible || q.out == nil || now.Sub(p.leadAt) < leadCooldown {
		return
	}
	p.leadAt = now
	w.sendJSON(q, map[string]any{"t": "lreq", "from": p.ID, "n": p.Name})
}

// ---- portals ----

// checkPortal teleports a player who steps onto a portal. It reports whether it did.
func (w *World) checkPortal(p *Player, now time.Time) bool {
	if len(w.m.Portals) == 0 {
		p.portalOn = -1
		return false
	}
	t := tileOf(p.X, p.Y)
	at := int(t.y)*w.m.W + int(t.x)
	to, ok := w.m.Portals[at]
	if !ok {
		p.portalOn = -1
		return false
	}
	if p.portalOn == at {
		return false // arrived here by portal: it fires again only after stepping off
	}
	dest := tile{int16(to.X), int16(to.Y)}
	x, y := tileCenter(dest)
	dai := w.m.AreaIndexAt(to.X, to.Y)
	if !w.staticCanStand(x, y) || (dai != p.area && !w.canEnterArea(p, dai)) {
		p.portalOn = at // locked or blocked: do not retry every tick
		return false
	}
	w.teleportTo(p, x, y, to.Y*w.m.W+to.X, now)
	return true
}

func (w *World) teleportTo(p *Player, x, y float64, portalTile int, now time.Time) {
	w.leaveGroup(p) // a call belongs to where you were standing
	p.X, p.Y = x, y
	p.Dx, p.Dy = 0, 0
	delete(w.movers, p)
	p.area = w.m.AreaIndexAt(int(x)/gamemap.TilePx, int(y)/gamemap.TilePx)
	p.portalOn = portalTile
	p.roomIn, p.roomOut = time.Time{}, time.Time{}
	p.lastAdv = now
	p.shadowAt = now
	w.sendState(p, now)
	w.sendSelf(p, true)
	w.updateSpot(p, now)
}

// dropSocial releases everything a player holds in the social features when they leave the world.
func (w *World) dropSocial(p *Player) {
	delete(w.followers, p)
	p.follow, p.fpath = 0, nil
	delete(w.knocks, p.ID)
	w.closeBoard(p)
	delete(w.onSpotSet, p)
	if w.spot.speaker == p {
		w.endSpot()
	}
	if w.spot.aud != nil {
		delete(w.spot.aud, p.ID)
		if w.media != nil {
			w.media.Revoke(w.spotRoom(), w.identity(p))
		}
	}
	for f := range w.followers {
		if f.follow == p.ID {
			w.stopFollow(f, time.Now(), true, true)
		}
	}
}
