package world

import (
	"strconv"
	"time"

	"opengather/internal/gamemap"
)

// Locked doors. Somebody standing inside a meeting room can lock it. From then on nobody who was
// not inside at that moment (or let in since) can walk in, except admins. Outsiders knock; the people
// inside answer. The state lives only in memory: an empty room unlocks itself and a restart unlocks
// everything. Movement is what enforces it (canEnterArea), and media follows position, so a locked
// call cannot be joined from outside.
//
// An assigned private office is always closed: it is announced as locked, its owners never need to
// be let in, and the lock control does nothing there. Visitors an owner admits are remembered in the
// same lockState until the office is empty again.

const (
	knockReach = 40.0 // px from the room's rectangle
	knockTTL   = 60 * time.Second
	knockEvery = 4 * time.Second
)

type lockState struct {
	admitted map[uint32]struct{}
}

type knockReq struct {
	area  string
	until time.Time
}

func (w *World) areaRect(a *gamemap.Area) (x, y, ww, hh float64) {
	const T = gamemap.TilePx
	return float64(a.X * T), float64(a.Y * T), float64(a.W * T), float64(a.H * T)
}

func (w *World) appendLocked(b []byte) []byte {
	b = append(b, '[')
	first := true
	for i := range w.m.Map.Areas {
		if w.locks[w.m.Map.Areas[i].ID] == nil && !isOwnedOffice(&w.m.Map.Areas[i]) {
			continue
		}
		if !first {
			b = append(b, ',')
		}
		first = false
		b = strconv.AppendInt(b, int64(i), 10)
	}
	return append(b, ']')
}

func (w *World) sendDeny(p *Player) {
	if p.out == nil {
		return
	}
	b := []byte(`{"t":"deny","d":`)
	b = w.appendDeny(b, p)
	b = append(b, `,"lk":`...)
	b = w.appendLocked(b)
	b = append(b, '}')
	w.sendShared(p, b)
}

// broadcastDeny re-sends the blocked-area list to everybody (lock state changed; rare).
func (w *World) broadcastDeny() {
	for _, p := range w.list {
		w.sendDeny(p)
	}
}

func (w *World) occupants(areaIdx int) []*Player {
	var out []*Player
	for _, p := range w.list {
		if p.area == areaIdx && p.out != nil {
			out = append(out, p)
		}
	}
	return out
}

// doLock locks or unlocks the room the player is standing in.
func (w *World) doLock(p *Player, on bool) {
	if p.area < 0 {
		return
	}
	a := &w.m.Map.Areas[p.area]
	if a.Kind != gamemap.KindRoom || isOwnedOffice(a) {
		return
	}
	_, locked := w.locks[a.ID]
	switch {
	case on && !locked:
		ls := &lockState{admitted: map[uint32]struct{}{}}
		for _, q := range w.list { // everybody inside right now may come back
			if q.area == p.area {
				ls.admitted[q.ID] = struct{}{}
			}
		}
		w.locks[a.ID] = ls
	case !on && locked:
		delete(w.locks, a.ID)
		for id, k := range w.knocks {
			if k.area == a.ID {
				delete(w.knocks, id)
			}
		}
	default:
		return
	}
	if p.Role == "admin" && w.OnAction != nil {
		w.OnAction(w.OfficeID, p.ID, "room.lock", a.ID)
	}
	w.broadcastDeny()
}

// pruneLocks unlocks rooms that are empty or no longer exist. force skips nothing but makes the caller's
// intent explicit after a map reload.
func (w *World) pruneLocks(force bool, now time.Time) {
	for id, k := range w.knocks {
		if now.After(k.until) {
			delete(w.knocks, id)
		}
	}
	changed := false
	for id := range w.locks {
		idx := -1
		for i := range w.m.Map.Areas {
			if w.m.Map.Areas[i].ID == id && w.m.Map.Areas[i].Kind == gamemap.KindRoom {
				idx = i
			}
		}
		occupied := false
		if idx >= 0 {
			for _, q := range w.list {
				if q.area == idx {
					occupied = true
					break
				}
			}
		}
		if !occupied {
			delete(w.locks, id)
			changed = true
		}
	}
	for id, k := range w.knocks {
		if _, ok := w.locks[k.area]; !ok && !w.isOwnedOfficeID(k.area) {
			delete(w.knocks, id)
		}
	}
	if changed && !force { // after a map reload the caller broadcasts anyway
		w.broadcastDeny()
	}
}

func (w *World) doKnock(p *Player, areaIdx int, now time.Time) {
	if areaIdx < 0 || areaIdx >= len(w.m.Map.Areas) || p.area == areaIdx || now.Sub(p.knockAt) < knockEvery {
		return
	}
	a := &w.m.Map.Areas[areaIdx]
	ls := w.locks[a.ID]
	office := isOwnedOffice(a)
	if a.Kind != gamemap.KindRoom || (ls == nil && !office) || p.Role == "admin" || (office && ownsOffice(a, p.ID)) {
		return
	}
	if ls != nil {
		if _, in := ls.admitted[p.ID]; in {
			return
		}
	}
	x, y, ww, hh := w.areaRect(a)
	if rectDist(p.X, p.Y, x, y, ww, hh) > knockReach {
		return
	}
	p.knockAt = now
	if !office && !AllowedIn(a, p.ID, p.Role) { // the room is not for them even when unlocked
		w.sendJSON(p, map[string]any{"t": "knr", "st": "no", "a": a.Name})
		return
	}
	occ := w.occupants(areaIdx)
	if office { // in somebody's office only the owner (or an admin) decides who comes in
		hosts := occ[:0]
		for _, o := range occ {
			if o.Role == "admin" || ownsOffice(a, o.ID) {
				hosts = append(hosts, o)
			}
		}
		occ = hosts
	}
	if len(occ) == 0 {
		w.sendJSON(p, map[string]any{"t": "knr", "st": "empty", "a": a.Name})
		return
	}
	w.knocks[p.ID] = knockReq{area: a.ID, until: now.Add(knockTTL)}
	for _, o := range occ {
		w.sendJSON(o, map[string]any{"t": "knk", "id": p.ID, "n": p.Name, "a": a.Name})
	}
	w.sendJSON(p, map[string]any{"t": "knr", "st": "wait", "a": a.Name})
}

// doKnockAns lets somebody inside the room answer a pending knock.
func (w *World) doKnockAns(p *Player, id uint32, allow bool, now time.Time) {
	k, ok := w.knocks[id]
	if !ok {
		return
	}
	if now.After(k.until) {
		delete(w.knocks, id)
		return
	}
	if p.area < 0 || w.m.Map.Areas[p.area].ID != k.area {
		return // only somebody inside can answer
	}
	if a := &w.m.Map.Areas[p.area]; isOwnedOffice(a) && p.Role != "admin" && !ownsOffice(a, p.ID) {
		return // a guest cannot let more people into somebody's office
	}
	delete(w.knocks, id)
	for _, o := range w.occupants(p.area) { // the other people inside can dismiss their prompt
		if o != p {
			w.sendJSON(o, map[string]any{"t": "knk", "id": id, "done": true})
		}
	}
	q := w.players[id]
	if q == nil {
		return
	}
	name := w.m.Map.Areas[p.area].Name
	if !allow {
		w.sendJSON(q, map[string]any{"t": "knr", "st": "no", "a": name})
		return
	}
	ls := w.locks[k.area]
	if ls == nil && isOwnedOffice(&w.m.Map.Areas[p.area]) { // first guest of an office
		ls = &lockState{admitted: map[uint32]struct{}{}}
		w.locks[k.area] = ls
	}
	if ls != nil {
		ls.admitted[id] = struct{}{}
	}
	w.sendJSON(q, map[string]any{"t": "knr", "st": "ok", "a": name})
	w.sendDeny(q)
}
