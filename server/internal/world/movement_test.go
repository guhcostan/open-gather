package world

import (
	"strings"
	"testing"
	"time"
)

func TestRunningDoublesSpeedAndIsCarriedInTheStateRecord(t *testing.T) {
	h := newHarness(t)
	walk := h.add(1, "member", sx, sy)
	run := h.add(2, "member", sx, sy+40)
	h.send(walk, ev{kind: evInput, seq: 1, dx: 1})
	h.send(run, ev{kind: evInput, seq: 1, dx: 1, b: true})
	h.run(time.Second)
	dw, dr := walk.X-sx, run.X-sx
	if dw < 60 || dw > 80 {
		t.Fatalf("walking covers ~72 px/s, got %.1f", dw)
	}
	if dr < 1.9*dw || dr > 2.1*dw {
		t.Fatalf("running is twice as fast: walk %.1f run %.1f", dw, dr)
	}
	if run.rec().d&(1<<6) == 0 || walk.rec().d&(1<<6) != 0 {
		t.Fatal("the run bit tells clients how fast to extrapolate")
	}
	// releasing the run key mid-walk publishes a new state at walking speed
	drain(walk)
	h.send(run, ev{kind: evInput, seq: 2, dx: 1})
	if run.running() || run.rec().d&(1<<6) != 0 {
		t.Fatal("releasing the run key walks again")
	}
	if run.last.d&(1<<6) != 0 {
		t.Fatal("the speed change is published at once, not at the next resync")
	}
	// a stopped player never carries the run bit
	h.send(run, ev{kind: evInput, seq: 3, b: true})
	if run.rec().d&(1<<6) != 0 {
		t.Fatal("standing still is not running")
	}
}

func TestShadowMatchesTheServerWhileRunning(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", sx, sy)
	h.send(p, ev{kind: evInput, seq: 1, dx: 1, b: true})
	h.run(800 * time.Millisecond)
	if d := dist(p.X, p.Y, p.ix, p.iy); d > divergeTol {
		t.Fatalf("clients extrapolate a runner correctly (diverged %.1f px)", d)
	}
}

// The client walks in small per-frame steps and stops touching a wall. The server must stop at
// the same spot, or every run into a wall ends with the avatar pulled back a few pixels.
func TestRunningIntoAWallStopsTouchingIt(t *testing.T) {
	for _, run := range []bool{false, true} {
		h := newHarness(t)
		p := h.add(1, "member", 5*16+8, 15*16+8) // below the y=14 wall (a 1-tile wall, open floor above)
		h.send(p, ev{kind: evInput, seq: 1, dy: -1, b: run})
		h.run(time.Second)
		if want := 15*16 + boxHalfH; p.Y != want {
			t.Fatalf("run=%v: stops touching the wall at y=%v, got %v", run, want, p.Y)
		}
		if p.iy != p.Y {
			t.Fatalf("run=%v: clients extrapolate to the same contact point (%v vs %v)", run, p.iy, p.Y)
		}
	}
}

// A starved VM can deliver a tick late. Movement is integrated over real time, so the late
// tick must cover the whole gap; clamping it made the client (which kept walking) snap back.
func TestALateTickDoesNotLoseDistance(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", 3*16+8, sy)
	h.send(p, ev{kind: evInput, seq: 1, dx: 1, b: true})
	h.now = h.now.Add(600 * time.Millisecond)
	h.w.tick(h.now)
	if got, want := p.X-(3*16+8), 144*0.6; got < want-0.5 || got > want+0.5 {
		t.Fatalf("a 600 ms tick moves a runner %.1f px, got %.1f", want, got)
	}
}

func TestALateTickDoesNotTunnelThroughAWall(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", 5*16+8, 15*16+8)
	h.send(p, ev{kind: evInput, seq: 1, dy: -1, b: true})
	h.now = h.now.Add(900 * time.Millisecond)
	h.w.tick(h.now)
	if p.Y != 15*16+boxHalfH {
		t.Fatalf("a long step stops at the wall, got y=%v", p.Y)
	}
}

func TestWalkToATileRunsAroundWallsAndArrives(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", 9*16+8, 20*16+8) // social area; reception is behind a wall
	drain(p)
	h.send(p, ev{kind: evGoto, x: 9, y: 6})
	if got := frames(p); !strings.Contains(got, `"ok":true`) {
		t.Fatalf("the walk is accepted: %q", got)
	}
	if !p.destOn || !p.running() {
		t.Fatal("a walk-to runs")
	}
	h.run(9 * time.Second)
	if got := tileOf(p.X, p.Y); got != (tile{9, 6}) {
		t.Fatalf("must arrive at (9,6), is at tile %v (%.0f,%.0f)", got, p.X, p.Y)
	}
	if p.destOn || p.Dx != 0 || p.Dy != 0 || len(h.w.followers) != 0 {
		t.Fatal("the walk ends and the avatar stops on arrival")
	}
}

func TestWalkToAPersonStopsNextToThem(t *testing.T) {
	h := newHarness(t)
	target := h.add(1, "member", 9*16+8, 6*16+8)
	p := h.add(2, "member", 9*16+8, 20*16+8)
	h.send(p, ev{kind: evGoto, id: 1})
	h.run(9 * time.Second)
	if d := dist(p.X, p.Y, target.X, target.Y); d > followGap+10 {
		t.Fatalf("must stop next to the person, distance %.1f", d)
	}
	if p.destOn {
		t.Fatal("the walk ends on arrival")
	}
}

func TestWalkToIsCancelledByInputAndRefusesForbiddenPlaces(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", sx, sy)
	h.send(p, ev{kind: evGoto, x: 3, y: 30})
	h.run(200 * time.Millisecond)
	h.send(p, ev{kind: evInput, seq: 1}) // a released key does not cancel
	if !p.destOn {
		t.Fatal("a zero input keeps the walk going")
	}
	h.send(p, ev{kind: evInput, seq: 2, dy: -1})
	if p.destOn || len(h.w.followers) != 0 {
		t.Fatal("moving on your own cancels the walk")
	}
	drain(p)
	h.send(p, ev{kind: evGoto, x: 50, y: 10}) // inside the admin-only boardroom
	if got := frames(p); !strings.Contains(got, `"ok":false`) || p.destOn {
		t.Fatalf("a member cannot be routed into an admin room: %q", got)
	}
	h.send(p, ev{kind: evGoto, x: 0, y: 0}) // outer wall
	if p.destOn {
		t.Fatal("cannot walk into a wall")
	}
	h.send(p, ev{kind: evGoto, x: -4, y: 9999})
	if p.destOn {
		t.Fatal("out-of-map targets are ignored")
	}
	h.send(p, ev{kind: evGoto, id: 77})
	if p.destOn {
		t.Fatal("cannot walk to somebody who is not there")
	}
}

// A leave and a fresh state for the same entity in one tick replace each other: the client gets
// whichever came last, never both.
func TestLeaveAndReturnInOneTickKeepOnlyTheLast(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+20, sy)
	h.run(200 * time.Millisecond)
	drain(a)
	h.w.queueLeave(a, b.ID)
	h.w.queuePos(a, b)
	h.w.flush(a)
	got := frames(a)
	if !strings.Contains(got, `"m":[[2,`) || strings.Contains(got, `"l":`) {
		t.Fatalf("leave then return must send only the state: %s", got)
	}
	h.w.queuePos(a, b)
	h.w.queueLeave(a, b.ID)
	h.w.flush(a)
	got = frames(a)
	if !strings.Contains(got, `"l":[2]`) || strings.Contains(got, `"m":`) {
		t.Fatalf("return then leave must send only the leave: %s", got)
	}
}

// An acknowledgement dropped for congestion is retried on later ticks, not lost: without it a
// lost ack leaves the owner's prediction diverged with no recovery (the ack is the only channel
// that keeps it on the truth).
func TestUnsentAckIsRetriedAfterCongestion(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", sx, sy)
	drain(p)
	for len(p.out) < cap(p.out) { // completely full: even a best-effort send is dropped
		p.out <- []byte("{}")
	}
	h.send(p, ev{kind: evInput, seq: 7, dx: 1})
	for _, f := range drain(p) {
		if strings.Contains(f, `"t":"a"`) {
			t.Fatal("a congested queue must skip the ack, retrying later")
		}
	}
	if p.ackSeq != 7 || p.ackSent == 7 {
		t.Fatalf("the input is recorded with its ack pending (seq %d sent %d)", p.ackSeq, p.ackSent)
	}
	h.run(time.Second / 15) // the queue is free again: the ack for the latest input goes out
	found := false
	for _, f := range drain(p) {
		if strings.Contains(f, `"t":"a","s":7`) {
			found = true
		}
	}
	if !found {
		t.Fatal("the ack is retried on a later tick, not lost")
	}
	h.run(time.Second) // and it is sent once, not every tick
	for _, f := range drain(p) {
		if strings.Contains(f, `"t":"a"`) {
			t.Fatal("the ack must not repeat once queued")
		}
	}
}
