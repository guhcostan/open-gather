package world

import (
	"strings"
	"testing"
	"time"
)

func TestWaveReachesThePersonUnlessTheyDoNotWantToBeDisturbed(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", 3*16, 3*16) // far away: waves are not limited to the area of interest
	drain(a)
	drain(b)
	h.send(a, ev{kind: evWave, id: 2})
	if got := frames(b); !strings.Contains(got, `{"t":"wv","from":1,"n":"p1"}`) && !strings.Contains(got, `"t":"wv"`) {
		t.Fatalf("the wave must arrive: %q", got)
	}
	if got := frames(a); !strings.Contains(got, `"st":"ok"`) {
		t.Fatalf("the sender learns it arrived: %q", got)
	}
	h.send(a, ev{kind: evWave, id: 2}) // cooldown
	if strings.Contains(frames(b), `"t":"wv"`) {
		t.Fatal("waves are rate limited")
	}
	h.now = h.now.Add(3 * time.Second)
	h.send(b, ev{kind: evStatus, s: StatusBusy})
	drain(a)
	h.send(a, ev{kind: evWave, id: 2})
	if strings.Contains(frames(b), `"t":"wv"`) {
		t.Fatal("busy means do not disturb")
	}
	if got := frames(a); !strings.Contains(got, `"st":"busy"`) {
		t.Fatalf("the sender is told the person is busy: %q", got)
	}
	h.now = h.now.Add(3 * time.Second)
	h.send(b, ev{kind: evStatus, s: StatusAvailable})
	h.send(a, ev{kind: evStatus, s: StatusInvisible})
	drain(b)
	h.send(a, ev{kind: evWave, id: 2})
	if strings.Contains(frames(b), `"t":"wv"`) {
		t.Fatal("an invisible player cannot wave (it would reveal them)")
	}
	h.send(b, ev{kind: evWave, id: 1})
	if got := frames(b); !strings.Contains(got, `"st":"offline"`) {
		t.Fatalf("waving at an invisible player looks like they are offline: %q", got)
	}
}

func TestRaisedHandAndStatusNoteAreInTheRoster(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+200, sy)
	h.run(100 * time.Millisecond)
	drain(b)
	h.send(a, ev{kind: evHand, b: true})
	h.send(a, ev{kind: evNote, s: "  In a meeting\nuntil 3 " + strings.Repeat("x", 100)})
	h.run(100 * time.Millisecond)
	got := frames(b)
	if !strings.Contains(got, `"h":1`) {
		t.Fatalf("everybody sees the raised hand: %q", got)
	}
	if !strings.Contains(got, `"m":"In a meeting until 3 xxx`) {
		t.Fatalf("the note is cleaned (one line): %q", got)
	}
	if a.note != cleanText(a.note, maxNoteRunes) || len([]rune(a.note)) > maxNoteRunes {
		t.Fatalf("the note is capped at %d runes, got %d", maxNoteRunes, len([]rune(a.note)))
	}
	h.send(a, ev{kind: evHand, b: false})
	h.send(a, ev{kind: evNote, s: ""})
	h.run(100 * time.Millisecond)
	got = frames(b)
	if strings.Contains(got, `"h":1`) || strings.Contains(got, `"m":`) {
		t.Fatalf("lowering the hand and clearing the note are published: %q", got)
	}
}

func TestAreaHeadCountsArePublishedOnChangeOnly(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy) // social area
	h.run(2500 * time.Millisecond)
	got := frames(a)
	if !strings.Contains(got, `"t":"ac"`) {
		t.Fatalf("head counts are published: %q", got)
	}
	social := -1
	for i, ar := range h.w.m.Map.Areas {
		if ar.ID == "social" {
			social = i
		}
	}
	if h.w.lastCounts[social] != 1 {
		t.Fatalf("one person in the social area, got %v", h.w.lastCounts)
	}
	h.run(4500 * time.Millisecond)
	if strings.Contains(frames(a), `"t":"ac"`) {
		t.Fatal("no change, no message")
	}
	b := h.add(2, "member", sx+30, sy)
	if !strings.Contains(frames(b), `"t":"ac"`) {
		t.Fatal("a newcomer gets the current counts with the hello")
	}
	h.send(b, ev{kind: evStatus, s: StatusInvisible})
	h.run(2500 * time.Millisecond)
	if h.w.lastCounts[social] != 1 {
		t.Fatalf("invisible people are not counted, got %v", h.w.lastCounts)
	}
}

func TestDanceIsAnEmote(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+40, sy)
	drain(b)
	h.send(a, ev{kind: evEmote, x: danceEmote})
	if !strings.Contains(frames(b), `{"t":"e","id":1,"v":8}`) {
		t.Fatal("dancing is shown to people nearby")
	}
}
