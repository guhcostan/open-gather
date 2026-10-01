package world

import (
	"strconv"
	"time"
)

// Presence niceties decided on the server: waving at somebody, a raised hand, a short status note
// and per-area head counts for the minimap. Everything here runs on the world goroutine.

const (
	waveCooldown = 2 * time.Second
	maxNoteRunes = 60
	countsEvery  = 2 * time.Second
	danceEmote   = 8 // emote kind rendered as a short dance instead of a bubble
)

// doWave pings another player wherever they are. Busy (do not disturb) and away people are not
// disturbed; the sender learns the outcome. Invisible players cannot wave (it would reveal them).
func (w *World) doWave(p *Player, id uint32, now time.Time) {
	q := w.players[id]
	if q == nil || q == p || q.out == nil || q.Status == StatusInvisible {
		w.sendJSON(p, map[string]any{"t": "wvr", "id": id, "st": "offline"})
		return
	}
	if p.Status == StatusInvisible || now.Sub(p.waveAt) < waveCooldown {
		return
	}
	p.waveAt = now
	switch q.Status {
	case StatusBusy, StatusAway:
		w.sendJSON(p, map[string]any{"t": "wvr", "id": id, "st": q.Status})
		return
	}
	w.sendJSON(q, map[string]any{"t": "wv", "from": p.ID, "n": p.Name})
	w.sendJSON(p, map[string]any{"t": "wvr", "id": id, "st": "ok"})
}

// doHand raises or lowers the player's hand; everybody sees it in the roster and over the avatar.
func (w *World) doHand(p *Player, up bool) {
	if p.hand == up {
		return
	}
	p.hand = up
	w.rUpd[p.ID] = struct{}{}
}

// doNote sets a short custom status line ("In a meeting until 3", "🎧 focus"). It is presence, not
// content: it is shown to the office like the name, kept in memory only and never logged.
func (w *World) doNote(p *Player, text string) {
	text = cleanText(text, maxNoteRunes)
	if p.note == text {
		return
	}
	p.note = text
	w.rUpd[p.ID] = struct{}{}
}

// publishCounts sends how many visible people stand in each area, at most every countsEvery and only
// when something changed. One small message per player per change: no positions leave the area of
// interest, so the minimap can show where the office is busy without an office-wide position feed.
func (w *World) publishCounts(now time.Time) {
	if now.Sub(w.countsAt) < countsEvery {
		return
	}
	w.countsAt = now
	n := len(w.m.Map.Areas)
	if cap(w.counts) < n {
		w.counts = make([]int, n)
	}
	cur := w.counts[:n]
	clear(cur)
	for _, p := range w.list {
		if p.out != nil && p.Status != StatusInvisible && p.area >= 0 && p.area < n {
			cur[p.area]++
		}
	}
	same := len(w.lastCounts) == n
	for i := 0; same && i < n; i++ {
		same = w.lastCounts[i] == cur[i]
	}
	if same {
		return
	}
	w.lastCounts = append(w.lastCounts[:0], cur...)
	b := w.countsMsg()
	for _, q := range w.list {
		w.sendCopy(q, b) // cosmetic: a congested client simply waits for the next change
	}
}

func (w *World) countsMsg() []byte {
	b := []byte(`{"t":"ac","c":[`)
	for i, c := range w.lastCounts {
		if i > 0 {
			b = append(b, ',')
		}
		b = strconv.AppendInt(b, int64(c), 10)
	}
	return append(b, ']', '}')
}
