package world

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestWhiteboardAuthorityFanoutUndoAndClear(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "admin", 49*16+8, 16*16+8)
	b := h.add(2, "member", 50*16+8, 16*16+8)
	c := h.add(3, "member", sx, sy)
	for _, p := range []*Player{a, b, c} {
		drain(p)
		h.send(p, ev{kind: evUse, x: 49, y: 15})
	}
	if a.board == "" || b.board != a.board || c.board != "" {
		t.Fatal("only nearby players can open the board")
	}
	drain(a)
	drain(b)
	drain(c)
	draw := &BoardMsg{Op: "draw", B: a.board, ID: 7, C: 2, W: 1, P: []int{20, 30, 60, 80}}
	h.send(a, ev{kind: evBoard, wb: draw})
	if !strings.Contains(frames(a), `"op":"draw"`) || !strings.Contains(frames(b), `"op":"draw"`) || strings.Contains(frames(c), `"t":"wb"`) {
		t.Fatal("accepted strokes echo to author and other viewers only")
	}
	h.send(b, ev{kind: evBoard, wb: &BoardMsg{Op: "clear", B: b.board}})
	if len(h.w.boards[a.board].strokes) != 1 {
		t.Fatal("members cannot clear the entire board")
	}
	h.send(b, ev{kind: evBoard, wb: &BoardMsg{Op: "undo", B: b.board}})
	if len(h.w.boards[a.board].strokes) != 1 {
		t.Fatal("undo can only undo your own stroke")
	}
	h.send(b, ev{kind: evBoard, wb: &BoardMsg{Op: "del", B: b.board, Owner: 1, ID: 7}})
	if len(h.w.boards[a.board].strokes) != 1 {
		t.Fatal("a member cannot erase somebody else's stroke")
	}
	h.send(a, ev{kind: evBoard, wb: &BoardMsg{Op: "undo", B: a.board}})
	if len(h.w.boards[a.board].strokes) != 0 {
		t.Fatal("the author can undo")
	}
	h.send(a, ev{kind: evBoard, wb: draw})
	h.send(a, ev{kind: evBoard, wb: &BoardMsg{Op: "clear", B: a.board}})
	if len(h.w.boards[a.board].strokes) != 0 {
		t.Fatal("an admin can clear")
	}
}

func TestWhiteboardBoundsTextSaveAndRestore(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "admin", 49*16+8, 16*16+8)
	h.send(a, ev{kind: evUse, x: 49, y: 15})
	key := a.board
	for _, m := range []*BoardMsg{
		{Op: "draw", B: key, ID: 1, P: []int{1}},
		{Op: "draw", B: key, ID: 1, C: 10, P: []int{1, 1}},
		{Op: "draw", B: "wrong", ID: 1, P: []int{1, 1}},
	} {
		h.send(a, ev{kind: evBoard, wb: m})
	}
	if len(h.w.boards[key].strokes) != 0 {
		t.Fatal("invalid edits are ignored")
	}
	h.send(a, ev{kind: evBoard, wb: &BoardMsg{Op: "draw", B: key, ID: 5, K: 1, P: []int{-5, 8000}, Tx: strings.Repeat("a", 100)}})
	s := h.w.boards[key].strokes[0]
	if s.P[0] != 0 || s.P[1] != BoardH || len(s.Tx) != maxBoardText {
		t.Fatalf("coordinates and text must be bounded: %+v", s)
	}
	var saved []byte
	h.w.OnBoardSave = func(_ int64, _ string, data []byte, _ bool) bool { saved = data; return true }
	h.w.saveBoards(h.now.Add(10 * time.Second))
	if !json.Valid(saved) {
		t.Fatal("board must be saved as JSON")
	}
	h2 := newHarness(t)
	h2.w.SeedBoards(map[string][]byte{key: saved})
	if len(h2.w.boards[key].strokes) != 1 || h2.w.boards[key].strokes[0].Tx != s.Tx {
		t.Fatal("strokes restore")
	}
	h.teleport(a, sx, sy)
	h.w.checkBoards()
	if a.board != "" {
		t.Fatal("walking away closes the board")
	}
}
