package world

import (
	"encoding/json"
	"strconv"
	"time"

	"tilework/internal/gamemap"
)

// Shared whiteboards. A board belongs to a whiteboard prop (key "x,y" of its top-left tile). People next
// to it open it with X; strokes are relayed to everybody who has it open and kept in memory, then saved
// (debounced) through OnBoardSave. Everything is bounded: viewers, strokes, points and message sizes.

const (
	BoardW, BoardH   = 1000, 600
	maxStrokes       = 1500
	maxStrokeInts    = 4000   // x,y pairs -> 2000 points in one stroke
	maxBoardInts     = 200000 // per board
	maxMsgInts       = 100    // per message
	maxBoardViewers  = 50
	maxBoardText     = 80
	boardColors      = 8
	boardWidths      = 4
	boardReach       = useReach * 3 // a viewer that walks further away than this loses the board
	boardSaveEvery   = 5 * time.Second
	MaxBoardJSONSize = 2 << 20
)

// BoardMsg is a client message about a whiteboard (t = "wb").
type BoardMsg struct {
	Op    string `json:"op"` // draw | del | undo | clear | close
	B     string `json:"bk"` // board key
	ID    uint32 `json:"i"`  // stroke id (chosen by the client, unique per owner)
	Owner uint32 `json:"o"`  // owner of the stroke to delete
	K     uint8  `json:"k"`  // 0 pen, 1 text
	C     uint8  `json:"c"`  // colour index
	W     uint8  `json:"w"`  // width index
	P     []int  `json:"p"`  // x,y pairs
	Tx    string `json:"tx"` // text
}

type stroke struct {
	Owner uint32  `json:"o"`
	ID    uint32  `json:"i"`
	K     uint8   `json:"k"`
	C     uint8   `json:"c"`
	W     uint8   `json:"w"`
	P     []int16 `json:"p"`
	Tx    string  `json:"tx,omitempty"`
}

type board struct {
	key            string
	rx, ry, rw, rh float64
	strokes        []*stroke
	index          map[uint64]*stroke
	ints           int
	viewers        map[*Player]struct{}
	dirty          bool
	saved          time.Time
}

func skey(owner, id uint32) uint64 { return uint64(owner)<<32 | uint64(id) }

func (w *World) board(key string) *board {
	b := w.boards[key]
	if b == nil {
		b = &board{key: key, index: map[uint64]*stroke{}, viewers: map[*Player]struct{}{}}
		w.boards[key] = b
	}
	return b
}

func (b *board) add(s *stroke) {
	b.strokes = append(b.strokes, s)
	b.index[skey(s.Owner, s.ID)] = s
	b.ints += len(s.P)
	for len(b.strokes) > maxStrokes || b.ints > maxBoardInts { // the oldest strokes make room
		b.remove(b.strokes[0])
	}
}

func (b *board) remove(s *stroke) {
	for i, q := range b.strokes {
		if q == s {
			b.strokes = append(b.strokes[:i], b.strokes[i+1:]...)
			break
		}
	}
	delete(b.index, skey(s.Owner, s.ID))
	b.ints -= len(s.P)
}

// SeedBoards loads persisted boards. Call before Run.
func (w *World) SeedBoards(data map[string][]byte) {
	for key, raw := range data {
		var ss []*stroke
		if json.Unmarshal(raw, &ss) != nil {
			continue
		}
		b := w.board(key)
		for _, s := range ss {
			if s == nil || len(s.P)%2 != 0 || len(s.P) > maxStrokeInts {
				continue
			}
			b.add(s)
		}
		b.saved = time.Now()
	}
}

func boardKey(pr *gamemap.Prop) string { return strconv.Itoa(pr.X) + "," + strconv.Itoa(pr.Y) }

func (w *World) openBoard(p *Player, pr *gamemap.Prop, now time.Time) {
	key := boardKey(pr)
	b := w.board(key)
	if p.board == key {
		w.sendBoardState(p, b)
		return
	}
	if len(b.viewers) >= maxBoardViewers {
		return
	}
	w.closeBoard(p)
	pw, ph := pr.Size()
	b.rx, b.ry, b.rw, b.rh = float64(pr.X*gamemap.TilePx), float64(pr.Y*gamemap.TilePx), float64(pw*gamemap.TilePx), float64(ph*gamemap.TilePx)
	b.viewers[p] = struct{}{}
	p.board = key
	w.sendBoardState(p, b)
}

func (w *World) sendBoardState(p *Player, b *board) {
	sb, _ := json.Marshal(b.strokes)
	out := make([]byte, 0, len(sb)+64)
	out = append(out, `{"t":"wb","op":"state","bk":`...)
	kb, _ := json.Marshal(b.key)
	out = append(out, kb...)
	out = append(out, `,"w":1000,"h":600,"s":`...)
	if b.strokes == nil {
		sb = []byte("[]")
	}
	out = append(out, sb...)
	out = append(out, '}')
	w.sendShared(p, out)
}

func (w *World) closeBoard(p *Player) {
	if p.board == "" {
		return
	}
	if b := w.boards[p.board]; b != nil {
		delete(b.viewers, p)
	}
	p.board = ""
	if p.out != nil {
		w.sendShared(p, []byte(`{"t":"wb","op":"closed"}`))
	}
}

func (b *board) broadcast(w *World, msg []byte, except *Player) {
	for v := range b.viewers {
		if v != except {
			w.sendShared(v, msg)
		}
	}
}

func (w *World) doBoard(p *Player, m *BoardMsg, now time.Time) {
	if m == nil || p.board == "" || m.B != p.board {
		return
	}
	b := w.boards[p.board]
	if b == nil {
		return
	}
	if m.Op == "close" {
		w.closeBoard(p)
		return
	}
	if !w.canViewBoard(p, b) {
		w.closeBoard(p)
		return
	}
	kb, _ := json.Marshal(b.key)
	head := `{"t":"wb","bk":` + string(kb)
	switch m.Op {
	case "draw":
		if m.K > 1 || m.C >= boardColors || m.W >= boardWidths || len(m.P) == 0 || len(m.P) > maxMsgInts || len(m.P)%2 != 0 {
			return
		}
		pts := make([]int16, len(m.P))
		for i, v := range m.P {
			lim := BoardW
			if i%2 == 1 {
				lim = BoardH
			}
			if v < 0 {
				v = 0
			} else if v > lim {
				v = lim
			}
			pts[i] = int16(v)
		}
		s := b.index[skey(p.ID, m.ID)]
		if m.K == 1 {
			text := cleanText(m.Tx, maxBoardText)
			if text == "" || len(pts) != 2 || s != nil {
				return
			}
			s = &stroke{Owner: p.ID, ID: m.ID, K: 1, C: m.C, W: m.W, P: pts, Tx: text}
			b.add(s)
		} else if s == nil {
			s = &stroke{Owner: p.ID, ID: m.ID, K: 0, C: m.C, W: m.W}
			s.P = append(s.P, pts...)
			b.add(s)
		} else {
			if s.K != 0 || len(s.P)+len(pts) > maxStrokeInts || b.ints+len(pts) > maxBoardInts {
				return
			}
			s.P = append(s.P, pts...)
			b.ints += len(pts)
		}
		b.dirty = true
		out := m2json(map[string]any{"op": "draw", "o": p.ID, "i": m.ID, "k": s.K, "c": s.C, "w": s.W, "p": pts, "tx": s.Tx}, head)
		b.broadcast(w, out, nil) // echo accepted edits so the author never diverges on a rejected edit
	case "del":
		s := b.index[skey(m.Owner, m.ID)]
		if s == nil {
			return
		}
		if s.Owner != p.ID && p.Role != "admin" {
			return // members erase only their own strokes; admins may erase any
		}
		b.remove(s)
		b.dirty = true
		b.broadcast(w, m2json(map[string]any{"op": "del", "o": s.Owner, "i": s.ID}, head), nil)
	case "undo":
		for i := len(b.strokes) - 1; i >= 0; i-- {
			if s := b.strokes[i]; s.Owner == p.ID {
				b.remove(s)
				b.dirty = true
				b.broadcast(w, m2json(map[string]any{"op": "del", "o": s.Owner, "i": s.ID}, head), nil)
				break
			}
		}
	case "clear":
		if p.Role != "admin" || len(b.strokes) == 0 {
			return
		}
		b.strokes, b.index, b.ints, b.dirty = nil, map[uint64]*stroke{}, 0, true
		if w.OnAction != nil {
			w.OnAction(w.OfficeID, p.ID, "board.clear", b.key)
		}
		b.broadcast(w, m2json(map[string]any{"op": "clear"}, head), nil)
	}
}

// m2json renders {"t":"wb","bk":"<key>", ...fields} by splicing the fields after head.
func m2json(fields map[string]any, head string) []byte {
	fb, _ := json.Marshal(fields)
	// fb is {...}: drop its opening brace and continue after head
	return append([]byte(head+","), fb[1:]...)
}

// checkBoards closes boards for viewers who left, walked away or lost access to the area.
func (w *World) checkBoards() {
	for key, b := range w.boards {
		for p := range b.viewers {
			if p.out == nil || w.players[p.ID] != p || !w.canViewBoard(p, b) {
				w.closeBoard(p)
			}
		}
		if len(b.viewers) == 0 && len(b.strokes) == 0 && !b.dirty {
			delete(w.boards, key)
		}
	}
}

func (w *World) canViewBoard(p *Player, b *board) bool {
	if rectDist(p.X, p.Y, b.rx, b.ry, b.rw, b.rh) > boardReach {
		return false
	}
	for i := range w.m.Map.Props {
		pr := &w.m.Map.Props[i]
		if pr.T == gamemap.PropWhiteboard && boardKey(pr) == b.key {
			ai := w.m.AreaIndexAt(pr.X, pr.Y)
			return ai == p.area || w.canEnterArea(p, ai)
		}
	}
	return false // deleted by a map edit
}

func (w *World) saveBoards(now time.Time) {
	for _, b := range w.boards {
		if b.dirty && now.Sub(b.saved) >= boardSaveEvery {
			w.saveBoard(b, now, false)
		}
	}
}

func (w *World) saveBoard(b *board, now time.Time, final bool) {
	b.dirty = false
	b.saved = now
	if w.OnBoardSave == nil {
		return
	}
	data, err := json.Marshal(b.strokes)
	if err != nil || len(data) > MaxBoardJSONSize {
		return
	}
	if b.strokes == nil {
		data = []byte("[]")
	}
	if !w.OnBoardSave(w.OfficeID, b.key, data, final) {
		b.dirty = true
	}
}

func (w *World) flushBoards(final bool) {
	now := time.Now()
	for _, b := range w.boards {
		if b.dirty || final { // accepted asynchronous writes may still be queued when shutdown begins
			w.saveBoard(b, now, final)
		}
	}
}
