package world

import (
	"time"

	"opengather/internal/gamemap"
	"opengather/internal/media"
)

// Spotlight. Standing on a spotlight pad, with audio and video enabled and the status Available, puts
// you on air: your microphone and camera go to everybody in the office who has enabled audio and
// video, through one extra SFU room ("<prefix>.s") next to their normal conversation. The speaker gets a
// publish token, the audience subscribe-only tokens; both are scoped to that one room, and stepping off
// the pad revokes everything. There is one active speaker per office: the pad that was stepped on first
// keeps it until they leave.

type spotState struct {
	speaker *Player
	aud     map[uint32]struct{} // players holding a subscribe token
}

func (w *World) spotRoom() string { return w.MediaPrefix() + ".s" }

func (w *World) mediaOn() bool { return w.media != nil && w.media.Enabled() }

// updateSpot recomputes whether p stands on a pad.
func (w *World) updateSpot(p *Player, now time.Time) {
	on := false
	if len(w.m.Spotlights) > 0 {
		tx, ty := int(p.X)/gamemap.TilePx, int(p.Y)/gamemap.TilePx
		if tx >= 0 && ty >= 0 && tx < w.m.W && ty < w.m.H {
			_, on = w.m.Spotlights[ty*w.m.W+tx]
		}
	}
	if on == p.onSpot {
		return
	}
	p.onSpot = on
	if on {
		p.spotSince = now
		w.onSpotSet[p] = struct{}{}
	} else {
		delete(w.onSpotSet, p)
	}
}

func (w *World) spotCandidate(p *Player) bool {
	return p.onSpot && p.eligible() && p.out != nil && w.players[p.ID] == p
}

func (w *World) reconcileSpot(now time.Time) {
	if w.spot.speaker == nil && len(w.onSpotSet) == 0 {
		return
	}
	if sp := w.spot.speaker; sp != nil && !w.spotCandidate(sp) {
		w.endSpot()
	}
	if w.spot.speaker != nil {
		return
	}
	var best *Player
	for p := range w.onSpotSet {
		if w.spotCandidate(p) && (best == nil || p.spotSince.Before(best.spotSince)) {
			best = p
		}
	}
	if best != nil {
		w.startSpot(best)
	}
}

func (w *World) startSpot(sp *Player) {
	w.leaveGroup(sp) // one publishing room: no duplicated capture or private-call audio in a broadcast
	w.spot = spotState{speaker: sp, aud: map[uint32]struct{}{}}
	for _, p := range w.list {
		w.sendSpot(p)
	}
}

func (w *World) endSpot() {
	sp := w.spot.speaker
	if sp == nil {
		return
	}
	room := w.spotRoom()
	if w.media != nil {
		for id := range w.spot.aud {
			w.media.Revoke(room, itoa(id))
		}
		w.media.Revoke(room, w.identity(sp))
	}
	w.spot = spotState{}
	off := []byte(`{"t":"spot","op":"off"}`)
	for _, p := range w.list {
		w.sendShared(p, off)
	}
}

// sendSpot tells one player about the active spotlight (if any) and, when they may listen, gives them a
// token. Players who have not enabled audio and video only get the banner.
func (w *World) sendSpot(p *Player) {
	sp := w.spot.speaker
	if sp == nil || p.out == nil {
		return
	}
	msg := map[string]any{"t": "spot", "op": "on", "sid": sp.ID, "n": sp.Name, "me": p == sp}
	if p == sp || p.consent {
		if w.mediaOn() {
			tok, err := w.media.Token(media.Grants{Room: w.spotRoom(), Identity: w.identity(p), Name: p.Name, CanPublish: p == sp})
			if err != nil {
				w.log.Error("spotlight token", "err", err)
			} else {
				msg["room"], msg["url"], msg["tok"] = w.spotRoom(), w.media.PublicURL(), tok
				if p != sp {
					w.spot.aud[p.ID] = struct{}{}
				}
			}
		}
	} else if _, held := w.spot.aud[p.ID]; held {
		delete(w.spot.aud, p.ID)
		if w.media != nil {
			w.media.Revoke(w.spotRoom(), w.identity(p))
		}
	}
	w.sendJSON(p, msg)
}

// spotMembers adds the spotlight room to a media membership snapshot (see the reconciler).
func (w *World) spotMembers(out map[string]map[string]bool) {
	sp := w.spot.speaker
	if sp == nil {
		return
	}
	ids := map[string]bool{w.identity(sp): true}
	for id := range w.spot.aud {
		ids[itoa(id)] = true
	}
	out[w.spotRoom()] = ids
}
