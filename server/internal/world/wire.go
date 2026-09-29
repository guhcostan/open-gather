package world

import (
	"encoding/json"
	"math"
	"strconv"
	"time"
)

const (
	divergeTol  = 1.5 // px between the real and the extrapolated position
	resyncEvery = time.Second
)

// ---- outbound helpers (world goroutine only) ----

func (w *World) evictPlayer(p *Player) {
	if p.out != nil {
		if p.kick != nil {
			p.kick(KickEvicted)
		}
		close(p.out)
		p.out = nil
	}
	p.Dx, p.Dy = 0, 0
	w.removePlayer(p)
}

func (w *World) kickPlayer(p *Player, now time.Time) {
	if p.out == nil {
		return
	}
	if p.kick != nil {
		p.kick(KickSlow)
	}
	close(p.out)
	p.out = nil
	p.gone = now
	p.Dx, p.Dy = 0, 0
	delete(w.movers, p)
	w.St.Kicked.Add(1)
}

// sendShared queues an immutable frame on a reliable path. A full queue means
// the client cannot keep up with reliable traffic: drop the connection (it can
// reconnect and resync) instead of growing memory without bound.
func (w *World) sendShared(p *Player, b []byte) {
	if p.out == nil {
		return
	}
	select {
	case p.out <- b:
		w.St.FramesOut.Add(1)
		w.St.BytesOut.Add(int64(len(b)))
	default:
		w.kickPlayer(p, time.Now())
	}
}

// sendCopy queues a best-effort frame (copying the scratch buffer); dropped when congested.
func (w *World) sendCopy(p *Player, b []byte) {
	if p.out == nil {
		return
	}
	c := make([]byte, len(b))
	copy(c, b)
	select {
	case p.out <- c:
		w.St.FramesOut.Add(1)
		w.St.BytesOut.Add(int64(len(c)))
	default:
	}
}

func (w *World) sendJSON(p *Player, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	w.sendShared(p, b)
}

func publicStatus(p *Player) string {
	if p.Status == StatusInvisible {
		return "offline"
	}
	return p.Status
}

func (w *World) entry(p *Player) []byte {
	b := make([]byte, 0, 128)
	b = append(b, `{"id":`...)
	b = strconv.AppendUint(b, uint64(p.ID), 10)
	b = append(b, `,"n":`...)
	nb, _ := json.Marshal(p.Name)
	b = append(b, nb...)
	b = append(b, `,"av":`...)
	if len(p.Avatar) > 0 {
		b = append(b, p.Avatar...)
	} else {
		b = append(b, '{', '}')
	}
	b = append(b, `,"s":"`...)
	b = append(b, publicStatus(p)...)
	b = append(b, `","r":"`...)
	b = append(b, p.Role...)
	b = append(b, '"', '}')
	return b
}

func (w *World) sendHello(p *Player) {
	b := make([]byte, 0, 4096+len(w.m.JSON)+len(w.players)*110)
	b = append(b, `{"t":"hello","you":`...)
	b = strconv.AppendUint(b, uint64(p.ID), 10)
	b = append(b, `,"role":"`...)
	b = append(b, p.Role...)
	b = append(b, `","status":"`...)
	b = append(b, p.Status...)
	b = append(b, `","office":`...)
	nb, _ := json.Marshal(w.Name)
	b = append(b, nb...)
	b = append(b, `,"cfg":{"speed":`...)
	b = strconv.AppendFloat(b, w.cfg.Speed, 'f', -1, 64)
	b = append(b, `,"tick":`...)
	b = strconv.AppendInt(b, int64(w.cfg.TickHz), 10)
	b = append(b, `,"media":`...)
	b = strconv.AppendBool(b, w.media != nil && w.media.Enabled())
	b = append(b, `,"x":`...)
	b = strconv.AppendFloat(b, p.X, 'f', 1, 64)
	b = append(b, `,"y":`...)
	b = strconv.AppendFloat(b, p.Y, 'f', 1, 64)
	b = append(b, `,"deny":`...)
	b = w.appendDeny(b, p)
	b = append(b, `,"lk":`...)
	b = w.appendLocked(b)
	b = append(b, `},"map":`...)
	b = append(b, w.m.JSON...)
	b = append(b, `,"roster":[`...)
	for i, q := range w.list {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, w.entry(q)...)
	}
	b = append(b, `],"chat":[`...)
	for i, h := range w.hist {
		if i > 0 {
			b = append(b, ',')
		}
		nb, _ := json.Marshal(h.Name)
		tb, _ := json.Marshal(h.Text)
		b = append(b, `{"f":`...)
		b = strconv.AppendUint(b, uint64(h.From), 10)
		b = append(b, `,"n":`...)
		b = append(b, nb...)
		b = append(b, `,"x":`...)
		b = append(b, tb...)
		b = append(b, `,"ts":`...)
		b = strconv.AppendInt(b, h.TS, 10)
		b = append(b, '}')
	}
	b = append(b, ']', '}')
	w.sendShared(p, b)
}

func (w *World) flushRoster() {
	if len(w.rAdd) == 0 && len(w.rUpd) == 0 && len(w.rDel) == 0 {
		return
	}
	b := []byte(`{"t":"p"`)
	if len(w.rAdd)+len(w.rUpd) > 0 {
		b = append(b, `,"a":[`...)
		first := true
		emit := func(id uint32) {
			if q := w.players[id]; q != nil {
				if !first {
					b = append(b, ',')
				}
				first = false
				b = append(b, w.entry(q)...)
			}
		}
		for id := range w.rAdd {
			emit(id)
		}
		for id := range w.rUpd {
			if _, dup := w.rAdd[id]; !dup {
				emit(id)
			}
		}
		b = append(b, ']')
	}
	if len(w.rDel) > 0 {
		b = append(b, `,"d":[`...)
		for i, id := range w.rDel {
			if i > 0 {
				b = append(b, ',')
			}
			b = strconv.AppendUint(b, uint64(id), 10)
		}
		b = append(b, ']')
	}
	b = append(b, '}')
	clear(w.rAdd)
	clear(w.rUpd)
	w.rDel = w.rDel[:0]
	for _, q := range w.list {
		w.sendShared(q, b)
	}
}

// flush sends p's coalesced world delta unless its queue is congested, in
// which case pending positions keep being overwritten by newer ones.
func (w *World) flush(p *Player) {
	if p.out == nil || (len(p.pendPos) == 0 && len(p.pendLeave) == 0) {
		return
	}
	if len(p.out) > cap(p.out)/2 {
		w.St.Skipped.Add(1)
		return
	}
	b := make([]byte, 0, 40+len(p.pendPos)*22+len(p.pendLeave)*8)
	b = append(b, `{"t":"w","k":`...)
	b = strconv.AppendUint(b, w.tickN, 10)
	if len(p.pendPos) > 0 {
		b = append(b, `,"m":[`...)
		first := true
		for id, r := range p.pendPos {
			if !first {
				b = append(b, ',')
			}
			first = false
			b = append(b, '[')
			b = strconv.AppendUint(b, uint64(id), 10)
			b = append(b, ',')
			b = strconv.AppendInt(b, int64(r.x), 10)
			b = append(b, ',')
			b = strconv.AppendInt(b, int64(r.y), 10)
			b = append(b, ',')
			b = strconv.AppendInt(b, int64(r.d), 10)
			b = append(b, ']')
		}
		b = append(b, ']')
		w.St.PosSent.Add(int64(len(p.pendPos)))
	}
	if len(p.pendLeave) > 0 {
		b = append(b, `,"l":[`...)
		first := true
		for id := range p.pendLeave {
			if !first {
				b = append(b, ',')
			}
			first = false
			b = strconv.AppendUint(b, uint64(id), 10)
		}
		b = append(b, ']')
	}
	b = append(b, '}')
	clear(p.pendPos)
	clear(p.pendLeave)
	select {
	case p.out <- b:
		w.St.FramesOut.Add(1)
		w.St.BytesOut.Add(int64(len(b)))
	default:
		w.St.Skipped.Add(1)
	}
}

// tick advances the simulation one step. Exposed to tests through handle/tick.
func (w *World) tick(now time.Time) {
	t0 := time.Now()
	w.tickN++
	w.driveFollowers(now)
	for p := range w.movers {
		w.advance(p, now)
		if w.checkPortal(p, now) {
			continue // teleported: state was published by the teleport
		}
		w.updateSpot(p, now)
		w.advanceShadow(p, now)
		// Clients extrapolate from the last record. Publish only when reality diverges from
		// that extrapolation (a door that is locked for this player, a capacity limit...)
		// or as a periodic safety resync.
		if math.Hypot(p.X-p.ix, p.Y-p.iy) > divergeTol || now.Sub(p.sentAt) >= resyncEvery {
			w.sendState(p, now)
		} else {
			w.publish(p, false)
		}
		if p.follow != 0 {
			w.sendSelf(p, false) // authoritative guided movement, bounded by the 15 Hz world tick
		}
	}
	var expired []*Player
	var connected int64
	for _, p := range w.list {
		if p.out != nil {
			connected++
		} else if !p.gone.IsZero() && now.Sub(p.gone) > w.cfg.Grace {
			expired = append(expired, p)
		}
	}
	for _, p := range expired {
		w.removePlayer(p)
	}
	if !now.Before(w.nextProx) {
		w.proximityPass(now)
		w.pruneLocks(false, now)
		w.checkBoards()
		w.saveBoards(now)
		w.nextProx = now.Add(w.cfg.ProxEvery)
	}
	w.reconcileSpot(now)
	w.flushRoster()
	for _, p := range w.list {
		w.flush(p)
	}
	w.St.Players.Store(int64(len(w.list)))
	w.St.Connected.Store(connected)
	w.St.Moving.Store(int64(len(w.movers)))
	w.St.Groups.Store(int64(len(w.groups)))
	w.St.observeTick(time.Since(t0))
}

func (w *World) appendDeny(b []byte, p *Player) []byte {
	b = append(b, '[')
	first := true
	for i := range w.m.Map.Areas {
		if !w.canEnterArea(p, i) {
			if !first {
				b = append(b, ',')
			}
			first = false
			b = strconv.AppendInt(b, int64(i), 10)
		}
	}
	return append(b, ']')
}

// sendMap pushes the (edited) map; teleport tells the client its position was reset.
func (w *World) sendMap(p *Player, teleport bool) {
	if p.out == nil {
		return
	}
	b := make([]byte, 0, len(w.m.JSON)+128)
	b = append(b, `{"t":"map","deny":`...)
	b = w.appendDeny(b, p)
	if teleport {
		b = append(b, `,"x":`...)
		b = strconv.AppendFloat(b, p.X, 'f', 1, 64)
		b = append(b, `,"y":`...)
		b = strconv.AppendFloat(b, p.Y, 'f', 1, 64)
	}
	b = append(b, `,"map":`...)
	b = append(b, w.m.JSON...)
	b = append(b, '}')
	w.sendShared(p, b)
}
