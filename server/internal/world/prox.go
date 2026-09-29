package world

import (
	"encoding/json"
	"math"
	"strconv"
	"time"

	"opengather/internal/gamemap"
	"opengather/internal/media"
)

// Conversation model
// ------------------
// Media rooms are NOT one per office. There are two kinds:
//   * room groups: one SFU room per meeting-room area (explicit access rules);
//   * proximity groups: small ad-hoc SFU rooms (max Prox.MaxGroup people).
// A player belongs to at most one group. Proximity groups are sticky: joining
// needs to be near a member for JoinDwell, leaving needs to be far for
// LeaveDwell (hysteresis), members must stay close to the group centroid so
// chains of avatars cannot merge into one office-wide call, and there is no
// hopping between groups: a player must first leave, then join.

func (p *Player) eligible() bool {
	return p.consent && p.Status == StatusAvailable
}

func (w *World) inRoomArea(p *Player) bool {
	return p.area >= 0 && w.m.Map.Areas[p.area].Kind == gamemap.KindRoom
}

func dist(ax, ay, bx, by float64) float64 { return math.Hypot(ax-bx, ay-by) }

func (g *group) centroid() (float64, float64) {
	var sx, sy float64
	for _, m := range g.members {
		sx += m.X
		sy += m.Y
	}
	n := float64(len(g.members))
	return sx / n, sy / n
}

func (w *World) newGroup(isRoom bool, area int) *group {
	w.nextGID++
	g := &group{id: w.nextGID, isRoom: isRoom, area: area}
	if isRoom {
		g.room = "o" + strconv.FormatInt(w.OfficeID, 10) + ".r." + w.m.Map.Areas[area].ID
		w.roomGrp[area] = g
	} else {
		g.room = "o" + strconv.FormatInt(w.OfficeID, 10) + ".g" + strconv.FormatUint(uint64(g.id), 10)
	}
	w.groups[g.id] = g
	return g
}

func (w *World) identity(p *Player) string { return strconv.FormatUint(uint64(p.ID), 10) }

func (w *World) memberIDs(g *group) []byte {
	b := []byte{'['}
	for i, m := range g.members {
		if i > 0 {
			b = append(b, ',')
		}
		b = strconv.AppendUint(b, uint64(m.ID), 10)
	}
	return append(b, ']')
}

func (w *World) sendConvJoin(p *Player, g *group) {
	var tok string
	if w.media != nil && w.media.Enabled() {
		t, err := w.media.Token(media.Grants{Room: g.room, Identity: w.identity(p), Name: p.Name, CanPublish: true})
		if err != nil {
			w.log.Error("media token", "err", err)
		}
		tok = t
	}
	name := ""
	kind := "p"
	if g.isRoom {
		name = w.m.Map.Areas[g.area].Name
		kind = "r"
	}
	url := ""
	if w.media != nil {
		url = w.media.PublicURL()
	}
	b := []byte(`{"t":"conv","op":"join","k":"` + kind + `","gid":` + strconv.FormatUint(uint64(g.id), 10))
	rb, _ := json.Marshal(g.room)
	nb, _ := json.Marshal(name)
	ub, _ := json.Marshal(url)
	tb, _ := json.Marshal(tok)
	b = append(b, `,"room":`...)
	b = append(b, rb...)
	b = append(b, `,"name":`...)
	b = append(b, nb...)
	b = append(b, `,"url":`...)
	b = append(b, ub...)
	b = append(b, `,"tok":`...)
	b = append(b, tb...)
	b = append(b, `,"m":`...)
	b = append(b, w.memberIDs(g)...)
	b = append(b, '}')
	w.sendShared(p, b)
}

func (w *World) sendConvMembers(g *group) {
	b := append([]byte(`{"t":"conv","op":"m","m":`), w.memberIDs(g)...)
	b = append(b, '}')
	for _, m := range g.members {
		w.sendShared(m, b)
	}
}

func (w *World) joinGroup(p *Player, g *group) {
	g.members = append(g.members, p)
	p.group = g
	p.leaveSince = time.Time{}
	p.candKind, p.candID = 0, 0
	w.St.GroupJoins.Add(1)
	w.sendConvJoin(p, g)
	w.sendConvMembers(g)
}

// leaveGroup removes p from its group, revokes SFU access and dissolves
// proximity groups that fall below two members.
func (w *World) leaveGroup(p *Player) {
	g := p.group
	if g == nil {
		return
	}
	p.group = nil
	p.leaveSince = time.Time{}
	p.candKind, p.candID = 0, 0
	for i, m := range g.members {
		if m == p {
			g.members = append(g.members[:i], g.members[i+1:]...)
			break
		}
	}
	w.St.GroupLeaves.Add(1)
	if w.media != nil {
		w.media.Revoke(g.room, w.identity(p))
	}
	if p.out != nil {
		w.sendShared(p, []byte(`{"t":"conv","op":"leave"}`))
	}
	switch {
	case len(g.members) == 0:
		w.dropGroup(g)
	case !g.isRoom && len(g.members) < 2:
		last := g.members[0]
		w.leaveGroup(last)
	default:
		w.sendConvMembers(g)
	}
}

func (w *World) dropGroup(g *group) {
	delete(w.groups, g.id)
	if g.isRoom {
		delete(w.roomGrp, g.area)
	}
}

// proximityPass recomputes group membership. Runs at ProxEvery (~4 Hz), never per movement.
func (w *World) proximityPass(now time.Time) {
	pc := w.cfg.Prox

	// 1. Drop members that are no longer eligible.
	for _, p := range w.list {
		if p.group == nil {
			continue
		}
		if !p.eligible() {
			w.leaveGroup(p)
			continue
		}
		if p.group.isRoom {
			if p.area == p.group.area {
				p.roomOut = time.Time{}
			} else {
				if p.roomOut.IsZero() {
					p.roomOut = now
				}
				if now.Sub(p.roomOut) >= pc.RoomOut {
					p.roomOut = time.Time{}
					w.leaveGroup(p)
				}
			}
		} else if w.inRoomArea(p) {
			w.leaveGroup(p)
		}
	}

	// 2. Room membership (meeting rooms), after a short dwell inside the area.
	for _, p := range w.list {
		if p.group != nil || !p.eligible() || !w.inRoomArea(p) {
			p.roomIn = time.Time{}
			continue
		}
		if !w.canEnterArea(p, p.area) {
			continue
		}
		if p.roomIn.IsZero() {
			p.roomIn = now
		}
		if now.Sub(p.roomIn) < pc.RoomIn {
			continue
		}
		a := &w.m.Map.Areas[p.area]
		g := w.roomGrp[p.area]
		if g == nil {
			g = w.newGroup(true, p.area)
		}
		if a.Capacity > 0 && len(g.members) >= a.Capacity {
			continue
		}
		p.roomIn = time.Time{}
		w.joinGroup(p, g)
	}

	// 3. Evict at most one far-away member per proximity group per pass.
	for _, g := range w.groups {
		if g.isRoom || len(g.members) < 2 {
			continue
		}
		cx, cy := g.centroid()
		var worst *Player
		worstD := -1.0
		for _, m := range g.members {
			dc := dist(m.X, m.Y, cx, cy)
			near := math.MaxFloat64
			for _, o := range g.members {
				if o != m {
					if d := dist(m.X, m.Y, o.X, o.Y); d < near {
						near = d
					}
				}
			}
			if dc > pc.CentLeave || near > pc.LeaveR {
				if m.leaveSince.IsZero() {
					m.leaveSince = now
				}
				if now.Sub(m.leaveSince) >= pc.LeaveDwell {
					score := math.Max(dc/pc.CentLeave, near/pc.LeaveR)
					if score > worstD {
						worstD, worst = score, m
					}
				}
			} else {
				m.leaveSince = time.Time{}
			}
		}
		if worst != nil {
			w.leaveGroup(worst)
		}
	}

	// 4. Joins and new pairs for free, eligible players outside meeting rooms.
	for _, p := range w.list {
		if p.group != nil || !p.eligible() || w.inRoomArea(p) || !p.inGrid {
			p.candKind = 0
			continue
		}
		var bestG *group
		var bestP *Player
		bestD := math.MaxFloat64
		x0, x1 := p.cx-1, p.cx+1
		y0, y1 := p.cy-1, p.cy+1
		for cy := y0; cy <= y1; cy++ {
			for cx := x0; cx <= x1; cx++ {
				if cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows {
					continue
				}
				for _, o := range w.cells[cy*w.cols+cx].ents {
					if o == p || !o.eligible() || w.inRoomArea(o) {
						continue
					}
					d := dist(p.X, p.Y, o.X, o.Y)
					if d > pc.JoinR || d >= bestD {
						continue
					}
					if og := o.group; og != nil {
						if og.isRoom || len(og.members) >= pc.MaxGroup {
							continue
						}
						gx, gy := og.centroid()
						if dist(p.X, p.Y, gx, gy) > pc.CentJoin {
							continue
						}
						bestD, bestG, bestP = d, og, nil
					} else {
						bestD, bestG, bestP = d, nil, o
					}
				}
			}
		}
		switch {
		case bestG != nil:
			if p.candKind != 1 || p.candID != bestG.id {
				p.candKind, p.candID, p.candSince = 1, bestG.id, now
			}
			if now.Sub(p.candSince) >= pc.JoinDwell {
				w.joinGroup(p, bestG)
			}
		case bestP != nil:
			if p.candKind != 2 || p.candID != bestP.ID {
				p.candKind, p.candID, p.candSince = 2, bestP.ID, now
			}
			if now.Sub(p.candSince) >= pc.JoinDwell && bestP.group == nil {
				g := w.newGroup(false, -1)
				w.joinGroup(bestP, g)
				w.joinGroup(p, g)
			}
		default:
			p.candKind = 0
		}
	}
}
