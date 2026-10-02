package world

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"tilework/internal/gamemap"
)

// Private offices: a row of small rooms under the social area, behind a hall. Office 1 spans tiles
// x 1..9, y 39..44, with its door on row 38 at x 4..5. Standing in the hall in front of it: (5, 37).
const officeDoorX, hallY, insideY = 5*16 + 0, 37*16 + 8, 41*16 + 8

func officeIndex(t *testing.T, w *World, id string) int {
	t.Helper()
	for i := range w.m.Map.Areas {
		if w.m.Map.Areas[i].ID == id {
			return i
		}
	}
	t.Fatalf("the default office has no area %q", id)
	return -1
}

func assignOffice(t *testing.T, h *harness, id string, owners ...int64) int {
	t.Helper()
	m := *gamemap.Default()
	m.Areas = append([]gamemap.Area(nil), m.Areas...)
	for i := range m.Areas {
		if m.Areas[i].ID == id {
			m.Areas[i].Access = gamemap.Access{Mode: gamemap.AccessOffice, Users: owners}
		}
	}
	cm, err := gamemap.Compile(&m)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.w.doReloadMap(cm, h.now); err != nil {
		t.Fatal(err)
	}
	return officeIndex(t, h.w, id)
}

func walkIn(h *harness, p *Player, seq uint32) {
	h.send(p, ev{kind: evInput, seq: seq, dy: 1})
	h.run(2 * time.Second)
	h.send(p, ev{kind: evInput, seq: seq + 1})
}

func TestUnassignedOfficeIsOpenAndLockable(t *testing.T) {
	h := newHarness(t)
	oi := officeIndex(t, h.w, "office-1")
	if a := h.w.m.Map.Areas[oi]; a.Kind != gamemap.KindRoom || a.Access.Mode != gamemap.AccessOffice || len(a.Access.Users) != 0 {
		t.Fatalf("office-1 must be an unassigned office room: %+v", a)
	}
	p := h.add(1, "member", officeDoorX, hallY)
	walkIn(h, p, 1)
	if p.area != oi {
		t.Fatalf("anybody walks into a free office from the hall, at %.0f,%.0f area %d", p.X, p.Y, p.area)
	}
	h.send(p, ev{kind: evLock, b: true})
	if h.w.locks["office-1"] == nil {
		t.Fatal("a free office locks like a meeting room")
	}
	q := h.add(2, "member", officeDoorX, hallY)
	walkIn(h, q, 1)
	if q.area == oi {
		t.Fatal("a locked free office keeps others out")
	}
}

func TestAssignedOfficeOwnerKnockAndAdmit(t *testing.T) {
	h := newHarness(t)
	oi := assignOffice(t, h, "office-1", 1)
	visitor := h.add(2, "member", officeDoorX, hallY)
	drain(visitor)
	h.w.sendDeny(visitor)
	if got := frames(visitor); !strings.Contains(got, "\"lk\":[") || !strings.Contains(got, "\"lk\":["+strconv.Itoa(oi)+"]") {
		t.Fatalf("an assigned office is announced as closed so the visitor can knock: %q", got)
	}
	walkIn(h, visitor, 1)
	if visitor.area == oi {
		t.Fatal("a raw input cannot walk a visitor into somebody's office")
	}
	// nobody home: knocking says so
	h.send(visitor, ev{kind: evKnock, x: oi})
	if got := frames(visitor); !strings.Contains(got, "\"st\":\"empty\"") {
		t.Fatalf("knocking on an empty office says nobody is there: %q", got)
	}
	owner := h.add(1, "member", officeDoorX, hallY+16)
	h.teleport(owner, officeDoorX, hallY)
	walkIn(h, owner, 1)
	if owner.area != oi {
		t.Fatalf("the owner walks into their office, area %d", owner.area)
	}
	h.now = h.now.Add(5 * time.Second)
	drain(owner)
	h.send(visitor, ev{kind: evKnock, x: oi})
	if got := frames(owner); !strings.Contains(got, "\"t\":\"knk\"") {
		t.Fatalf("the owner inside is asked: %q", got)
	}
	h.run(2 * time.Second) // people take a moment to answer; housekeeping must not drop the knock
	h.send(owner, ev{kind: evKnockAns, id: 2, b: true})
	walkIn(h, visitor, 3)
	if visitor.area != oi {
		t.Fatal("an admitted visitor walks in")
	}
	// a guest inside is neither asked nor able to let somebody else in
	h.now = h.now.Add(5 * time.Second)
	other := h.add(5, "member", officeDoorX, hallY)
	drain(visitor)
	h.send(other, ev{kind: evKnock, x: oi})
	if strings.Contains(frames(visitor), "\"t\":\"knk\"") {
		t.Fatal("only the owner is asked")
	}
	h.send(visitor, ev{kind: evKnockAns, id: 5, b: true})
	walkIn(h, other, 1)
	if other.area == oi {
		t.Fatal("a guest cannot admit others")
	}
	h.w.removePlayer(other)
	// the owner can always come back, also now that the office remembers a guest
	h.teleport(owner, officeDoorX, hallY)
	h.run(500 * time.Millisecond)
	walkIn(h, owner, 3)
	if owner.area != oi {
		t.Fatal("the owner is never locked out of their own office")
	}
	// the lock control does not open an assigned office
	h.send(owner, ev{kind: evLock, b: false})
	stranger := h.add(3, "member", officeDoorX, hallY)
	walkIn(h, stranger, 1)
	if stranger.area == oi {
		t.Fatal("unlocking does not open an assigned office to strangers")
	}
	admin := h.add(4, "admin", officeDoorX, hallY)
	walkIn(h, admin, 1)
	if admin.area != oi {
		t.Fatal("admins can enter any office")
	}
}

// Reassigning an office clears admissions and locks from the previous arrangement.
func TestReassigningAnOfficeStartsWithACleanDoor(t *testing.T) {
	h := newHarness(t)
	oi := assignOffice(t, h, "office-1", 1)
	owner := h.add(1, "member", officeDoorX, hallY)
	walkIn(h, owner, 1)
	guest := h.add(2, "member", officeDoorX, hallY)
	h.send(guest, ev{kind: evKnock, x: oi})
	h.send(owner, ev{kind: evKnockAns, id: 2, b: true})
	if h.w.locks["office-1"] == nil {
		t.Fatal("expected the admitted guest to be remembered")
	}
	assignOffice(t, h, "office-1", 3) // the office changes hands while the old owner is inside
	if h.w.locks["office-1"] != nil {
		t.Fatal("admissions from the previous owner must not carry over")
	}
	walkIn(h, guest, 3)
	if guest.area == oi {
		t.Fatal("the old owner's guest cannot walk into the new owner's office")
	}
}

func TestOfficeOwnersAreBounded(t *testing.T) {
	m := *gamemap.Default()
	m.Areas = append([]gamemap.Area(nil), m.Areas...)
	for i := range m.Areas {
		if m.Areas[i].ID == "office-2" {
			m.Areas[i].Access = gamemap.Access{Mode: gamemap.AccessOffice, Users: []int64{1, 2, 3, 4, 5}}
		}
	}
	if _, err := gamemap.Compile(&m); err == nil {
		t.Fatal("an office lists at most four owners")
	}
}
