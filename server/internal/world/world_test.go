package world

import (
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"opengather/internal/gamemap"
	"opengather/internal/media"
)

type fakeMedia struct {
	mu      sync.Mutex
	revoked []string
}

func (f *fakeMedia) Enabled() bool     { return true }
func (f *fakeMedia) PublicURL() string { return "ws://test" }
func (f *fakeMedia) Token(g media.Grants) (string, error) {
	return "tok:" + g.Room + ":" + g.Identity, nil
}
func (f *fakeMedia) Revoke(room, id string) {
	f.mu.Lock()
	f.revoked = append(f.revoked, room+"/"+id)
	f.mu.Unlock()
}

type harness struct {
	t   *testing.T
	w   *World
	now time.Time
	fm  *fakeMedia
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	cm, err := gamemap.Compile(gamemap.Default())
	if err != nil {
		t.Fatal(err)
	}
	fm := &fakeMedia{}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	w := New(DefaultConfig(), 1, "t", cm, fm, log)
	return &harness{t: t, w: w, now: time.Unix(1_000_000, 0), fm: fm}
}

func (h *harness) add(id uint32, role string, x, y float64) *Player {
	reply := make(chan joinResult, 1)
	h.w.handle(ev{kind: evJoin, info: UserInfo{ID: id, Name: "u", Role: role, Avatar: json.RawMessage("{}")}, reply: reply}, h.now)
	r := <-reply
	if r.err != nil {
		h.t.Fatal(r.err)
	}
	h.teleport(r.p, x, y)
	return r.p
}

func (h *harness) teleport(p *Player, x, y float64) {
	p.X, p.Y = x, y
	p.area = h.w.m.AreaIndexAt(int(x)/gamemap.TilePx, int(y)/gamemap.TilePx)
	h.w.sendState(p, h.now)
}

// run advances virtual time by d in tick-sized steps.
func (h *harness) run(d time.Duration) {
	step := time.Second / time.Duration(h.w.cfg.TickHz)
	for e := time.Duration(0); e < d; e += step {
		h.now = h.now.Add(step)
		h.w.tick(h.now)
	}
}

func (h *harness) consent(p *Player, on bool) {
	h.w.handle(ev{kind: evConsent, p: p, gen: p.gen, b: on}, h.now)
}

// social area tiles: x 1..40, y 15..34 -> pixels
const sx, sy = 20 * 16.0, 28 * 16.0

func TestWallsBlockMovement(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", 3*16+8, 15*16+8) // just below the y=14 wall (social side)
	h.w.handle(ev{kind: evInput, p: p, gen: p.gen, seq: 1, dx: 0, dy: -1}, h.now)
	h.run(3 * time.Second)
	if p.Y < 15*16 {
		t.Fatalf("player crossed a wall: y=%v", p.Y)
	}
}

func TestSpeedIsServerEnforced(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", sx, sy)
	x0 := p.X
	h.w.handle(ev{kind: evInput, p: p, gen: p.gen, seq: 1, dx: 1}, h.now)
	h.run(1 * time.Second)
	got := p.X - x0
	if got < 60 || got > 80 {
		t.Fatalf("expected ~72px in 1s, got %v", got)
	}
}

func TestRoomAccessRules(t *testing.T) {
	h := newHarness(t)
	// Diretoria (admins only): door on x=44,y=10..11, room interior x45+.
	m := h.add(1, "member", 43*16+8, 10*16+8)
	a := h.add(2, "admin", 43*16+8, 11*16+8)
	h.w.handle(ev{kind: evInput, p: m, gen: m.gen, seq: 1, dx: 1}, h.now)
	h.w.handle(ev{kind: evInput, p: a, gen: a.gen, seq: 1, dx: 1}, h.now)
	h.run(2 * time.Second)
	if m.X >= 45*16 {
		t.Fatalf("member entered admin-only room: x=%v", m.X)
	}
	if a.X < 45*16 {
		t.Fatalf("admin could not enter: x=%v", a.X)
	}
}

func TestAOIEnterLeave(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", 2*16, 2*16)
	b := h.add(2, "member", 58*16, 33*16) // far corner
	h.run(100 * time.Millisecond)
	if _, ok := a.pendPos[2]; ok {
		t.Fatal("far player must not be in a's interest area")
	}
	h.teleport(b, 3*16, 3*16)
	h.w.flush(a)
	if _, ok := a.pendPos[2]; !ok && len(a.out) == 0 {
		t.Fatal("expected b to enter a's interest area")
	}
	// Drain frames and look for b's id in a "w" frame.
	seen := false
	for len(a.out) > 0 {
		f := string(<-a.out)
		if strings.HasPrefix(f, `{"t":"w"`) && strings.Contains(f, "[2,") {
			seen = true
		}
	}
	if !seen {
		t.Fatal("no world frame with entity 2")
	}
	h.teleport(b, 58*16, 33*16)
	h.w.flush(a)
	left := false
	for len(a.out) > 0 {
		f := string(<-a.out)
		if strings.Contains(f, `"l":[2]`) {
			left = true
		}
	}
	if !left {
		t.Fatal("expected leave event for entity 2")
	}
}

func TestProximityPairFormsAfterDwellAndRevokesOnLeave(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+40, sy)
	h.consent(a, true)
	h.consent(b, true)
	h.run(200 * time.Millisecond)
	if a.group != nil {
		t.Fatal("group must not form before the join dwell")
	}
	h.run(1500 * time.Millisecond)
	if a.group == nil || a.group != b.group {
		t.Fatal("expected a and b in the same group")
	}
	room := a.group.room
	// Move b away: hysteresis keeps them together briefly.
	h.teleport(b, sx+200, sy)
	h.run(500 * time.Millisecond)
	if a.group == nil {
		t.Fatal("hysteresis must keep the group for a short time")
	}
	h.run(3 * time.Second)
	if a.group != nil || b.group != nil {
		t.Fatal("group must dissolve after LeaveDwell")
	}
	h.fm.mu.Lock()
	defer h.fm.mu.Unlock()
	if len(h.fm.revoked) != 2 {
		t.Fatalf("expected 2 SFU revocations, got %v", h.fm.revoked)
	}
	for _, r := range h.fm.revoked {
		if !strings.HasPrefix(r, room+"/") {
			t.Fatalf("revocation for unexpected room: %s", r)
		}
	}
}

func TestBusyAndNoConsentNeverJoin(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+30, sy)
	c := h.add(3, "member", sx+30, sy+30)
	h.consent(a, true)
	h.consent(b, true)
	h.consent(c, false)
	h.w.handle(ev{kind: evStatus, p: b, gen: b.gen, s: StatusBusy}, h.now)
	h.run(3 * time.Second)
	if a.group != nil || b.group != nil || c.group != nil {
		t.Fatal("busy or non-consenting players must not be pulled into conversations")
	}
	// Becoming busy inside an existing conversation leaves it right away.
	h.w.handle(ev{kind: evStatus, p: b, gen: b.gen, s: StatusAvailable}, h.now)
	h.run(2 * time.Second)
	if a.group == nil || a.group != b.group {
		t.Fatal("expected group after b became available")
	}
	h.w.handle(ev{kind: evStatus, p: b, gen: b.gen, s: StatusBusy}, h.now)
	if b.group != nil {
		t.Fatal("busy must leave the conversation immediately")
	}
}

func TestChainOfAvatarsDoesNotMergeOffice(t *testing.T) {
	h := newHarness(t)
	var ps []*Player
	for i := 0; i < 30; i++ { // 40 px apart: each is within JoinR of its neighbour
		p := h.add(uint32(10+i), "member", 3*16+float64(i)*20, sy)
		if p.X > 39*16 {
			break
		}
		h.consent(p, true)
		ps = append(ps, p)
	}
	h.run(20 * time.Second)
	seen := map[uint32]int{}
	for _, p := range ps {
		if p.group != nil {
			seen[p.group.id] = len(p.group.members)
		}
	}
	if len(seen) < 2 {
		t.Fatalf("a long chain must split into several groups, got %v", seen)
	}
	for id, n := range seen {
		if n > h.w.cfg.Prox.MaxGroup {
			t.Fatalf("group %d has %d members (max %d)", id, n, h.w.cfg.Prox.MaxGroup)
		}
	}
}

func TestBetweenTwoConversationsIsSticky(t *testing.T) {
	h := newHarness(t)
	l1 := h.add(1, "member", sx-120, sy)
	l2 := h.add(2, "member", sx-90, sy)
	r1 := h.add(3, "member", sx+120, sy)
	r2 := h.add(4, "member", sx+90, sy)
	mid := h.add(5, "member", sx-60, sy) // close to the left pair only
	for _, p := range []*Player{l1, l2, r1, r2, mid} {
		h.consent(p, true)
	}
	h.run(3 * time.Second)
	if mid.group == nil || mid.group != l1.group {
		t.Fatal("mid should join the nearest (left) conversation")
	}
	first := mid.group
	// Walk to the exact middle, then jitter around it: must not hop.
	for i := 0; i < 20; i++ {
		x := sx - 5
		if i%2 == 0 {
			x = sx + 5
		}
		h.teleport(mid, x, sy)
		h.run(400 * time.Millisecond)
		if mid.group != nil && mid.group != first && mid.group != r1.group {
			t.Fatal("unexpected group")
		}
	}
	joins := h.w.St.GroupJoins.Load()
	h.run(5 * time.Second)
	if h.w.St.GroupJoins.Load() != joins {
		t.Fatal("membership must be stable while standing between groups")
	}
}

func TestMeetingRoomGroupIsolatedFromCorridor(t *testing.T) {
	h := newHarness(t)
	in1 := h.add(1, "member", 50*16, 3*16) // Aurora (open)
	in2 := h.add(2, "member", 54*16, 5*16)
	out := h.add(3, "member", 43*16, 3*16+8) // right outside the door
	for _, p := range []*Player{in1, in2, out} {
		h.consent(p, true)
	}
	h.run(3 * time.Second)
	if in1.group == nil || in1.group != in2.group || !in1.group.isRoom {
		t.Fatal("room occupants must share the room group")
	}
	if out.group != nil {
		t.Fatal("someone outside the room must not be pulled into the room call")
	}
}

func TestSlowClientIsCoalescedNotUnbounded(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy) // never drained
	b := h.add(2, "member", sx+200, sy)
	// b keeps changing direction: every change is a state record clients cannot predict
	for i := 0; i < 450; i++ {
		dx := int8(1)
		if i%2 == 1 {
			dx = -1
		}
		h.w.handle(ev{kind: evInput, p: b, gen: b.gen, seq: uint32(i + 1), dx: dx}, h.now)
		h.run(time.Second / 15)
	}
	if len(a.out) > cap(a.out) {
		t.Fatal("queue overflow")
	}
	if len(a.pendPos) > 1 {
		t.Fatalf("stale positions must be coalesced: %d pending", len(a.pendPos))
	}
	if h.w.St.PosCoalesced.Load() == 0 && h.w.St.Skipped.Load() == 0 {
		t.Fatal("expected backpressure counters to move")
	}
}

func TestNewcomersJoinGroupWithDisconnectedMembersAndSurviveTheirExpiry(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+32, sy)
	h.consent(a, true)
	h.consent(b, true)
	h.run(2 * time.Second)
	if a.group == nil {
		t.Fatal("setup: expected group")
	}
	old := a.group
	// both browsers close: reconnect grace keeps them in the world for a while
	h.w.handle(ev{kind: evDetach, p: a, gen: a.gen}, h.now)
	h.w.handle(ev{kind: evDetach, p: b, gen: b.gen}, h.now)
	c := h.add(3, "member", sx, sy)
	d := h.add(4, "member", sx+32, sy)
	h.consent(c, true)
	h.consent(d, true)
	h.run(3 * time.Second)
	if c.group == nil || d.group == nil {
		t.Fatalf("newcomers must be able to converse: c=%v d=%v", c.group != nil, d.group != nil)
	}
	h.run(h.w.cfg.Grace + 2*time.Second)
	if _, ok := h.w.players[1]; ok {
		t.Fatal("disconnected players must be removed after grace")
	}
	if c.group == nil || d.group == nil || c.group != d.group {
		t.Fatalf("newcomers must keep talking after leftovers expire (old group %d)", old.id)
	}
}

func drain(p *Player) []string {
	var out []string
	for len(p.out) > 0 {
		out = append(out, string(<-p.out))
	}
	return out
}

func countRecords(frames []string, id string) int {
	n := 0
	for _, f := range frames {
		if strings.HasPrefix(f, `{"t":"w"`) {
			n += strings.Count(f, "["+id+",")
		}
	}
	return n
}

func TestDeadReckoningSendsStateChangesNotEveryTick(t *testing.T) {
	h := newHarness(t)
	obs := h.add(1, "member", 5*16, 28*16)
	mov := h.add(2, "member", 4*16, 30*16)
	drain(obs)
	h.w.handle(ev{kind: evInput, p: mov, gen: mov.gen, seq: 1, dx: 1}, h.now)
	h.run(8 * time.Second) // straight walk along an open row of the social area
	h.w.handle(ev{kind: evInput, p: mov, gen: mov.gen, seq: 2, dx: 0}, h.now)
	h.run(300 * time.Millisecond)
	n := countRecords(drain(obs), "2")
	// ~8 s * 15 Hz = 120 records before dead reckoning; now: start + ~1/s safety resync + stop
	if n < 3 || n > 14 {
		t.Fatalf("expected a handful of state records for a straight walk, got %d", n)
	}
	if mov.X < 4*16+72*7 {
		t.Fatalf("player did not really walk: x=%v", mov.X)
	}
}

func TestDivergenceIsCorrected(t *testing.T) {
	h := newHarness(t)
	// A member pushes against the admins-only room: clients extrapolate through the open door,
	// the server refuses, so the server must keep publishing corrections.
	m := h.add(1, "member", 43*16+8, 10*16+8)
	obs := h.add(2, "member", 40*16, 10*16+8)
	drain(obs)
	h.w.handle(ev{kind: evInput, p: m, gen: m.gen, seq: 1, dx: 1}, h.now)
	h.run(3 * time.Second)
	if m.X >= 45*16 {
		t.Fatalf("member entered the locked room: %v", m.X)
	}
	n := countRecords(drain(obs), "1")
	if n < 5 {
		t.Fatalf("server must publish corrections while reality diverges from the extrapolation, got %d records", n)
	}
	// the last record must place the player where the server says he is (not inside the room)
	if m.last.x >= 45*16 {
		t.Fatalf("published state disagrees with authority: %v", m.last)
	}
}

func TestCellCrossingStillNotifiesWithoutStateRecords(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", 3*16, 28*16)  // cell (0,3): interest covers x < 384 px
	b := h.add(2, "member", 34*16, 32*16) // far outside
	drain(a)
	h.w.handle(ev{kind: evInput, p: b, gen: b.gen, seq: 1, dx: -1}, h.now)
	h.run(3500 * time.Millisecond) // b walks left ~250 px, crossing into a's area of interest
	if countRecords(drain(a), "2") == 0 {
		t.Fatal("entering someone's area of interest must deliver a fresh state even if b sent no records")
	}
	if _, ok := b.pendPos[1]; ok {
		t.Fatal("unexpected pending state")
	}
}

func TestSyncResendsCurrentStates(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+40, sy)
	h.run(200 * time.Millisecond)
	drain(a)
	h.w.handle(ev{kind: evSync, p: a, gen: a.gen}, h.now)
	h.run(100 * time.Millisecond)
	if countRecords(drain(a), "2") == 0 || b == nil {
		t.Fatal("sync must resend every visible entity")
	}
}

func TestReloadMapRelocatesTrappedPlayersAndDissolvesRooms(t *testing.T) {
	h := newHarness(t)
	in1 := h.add(1, "member", 46*16+8, 5*16+8) // Aurora, on free floor (the table is solid)
	in2 := h.add(2, "member", 56*16+8, 5*16+8)
	stay := h.add(3, "member", 20*16, 28*16)
	for _, p := range []*Player{in1, in2, stay} {
		h.consent(p, true)
	}
	h.run(3 * time.Second)
	if in1.group == nil || !in1.group.isRoom {
		t.Fatal("setup: expected a room call")
	}
	m := gamemap.Default()
	// wall the player 'stay' in: put a solid wall tile exactly under his feet
	row := []byte(m.Walls[28])
	row[20] = '#'
	m.Walls[28] = string(row)
	cm, err := gamemap.Compile(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.w.doReloadMap(cm, h.now); err != nil {
		t.Fatal(err)
	}
	if in1.group != nil || in2.group != nil {
		t.Fatal("room calls must be dissolved when the map changes (area indexes may differ)")
	}
	if !h.w.canStand(stay, stay.X, stay.Y) {
		t.Fatalf("a player standing inside a new wall must be relocated, at %v,%v", stay.X, stay.Y)
	}
	h.run(2 * time.Second)
	if in1.group == nil {
		t.Fatalf("people inside a room re-join its call through the normal dwell rules: area=%d elig=%v pos=%v,%v status=%s roomIn=%v stay=%v,%v", in1.area, in1.eligible(), in1.X, in1.Y, in1.Status, in1.roomIn, stay.X, stay.Y)
	}
	bad := gamemap.Default()
	bad.W = 70
	bad.Walls = nil
	if _, err := gamemap.Compile(bad); err == nil {
		t.Fatal("invalid maps must not compile")
	}
	big := gamemap.Default()
	big.Walls = big.Walls[:20]
	big.H = 20
	cm2, err := gamemap.Compile(big)
	if err == nil {
		if err := h.w.doReloadMap(cm2, h.now); err == nil {
			t.Fatal("changing the map size at runtime must be refused")
		}
	}
}

func TestHelloCarriesOfficeChatHistoryAndProfileChangesReachTheRoster(t *testing.T) {
	h := newHarness(t)
	h.w.SeedChat([]ChatEntry{{From: 9, Name: "Zed", Text: "bem-vindos", TS: 5}})
	a := h.add(1, "member", sx, sy)
	hello := ""
	for _, f := range drain(a) {
		if strings.HasPrefix(f, `{"t":"hello"`) {
			hello = f
		}
	}
	if !strings.Contains(hello, `"chat":[{"f":9,"n":"Zed","x":"bem-vindos","ts":5}]`) {
		t.Fatalf("hello must carry persisted history: %s", hello[len(hello)-120:])
	}
	var saved []string
	h.w.OnChat = func(_ int64, _ uint32, text string, _ int64) { saved = append(saved, text) }
	h.w.handle(ev{kind: evChat, p: a, gen: a.gen, s: "o", info: UserInfo{Name: "  oi  "}}, h.now)
	h.w.handle(ev{kind: evChat, p: a, gen: a.gen, s: "d", id: 99, info: UserInfo{Name: "segredo"}}, h.now)
	h.w.handle(ev{kind: evChat, p: a, gen: a.gen, s: "g", info: UserInfo{Name: "sem grupo"}}, h.now)
	if len(saved) != 1 || saved[0] != "oi" || len(h.w.hist) != 2 {
		t.Fatalf("only office chat is persisted (and trimmed): saved=%v hist=%d", saved, len(h.w.hist))
	}
	b := h.add(2, "member", sx+400, sy)
	drain(a)
	drain(b)
	h.w.handle(ev{kind: evProfile, id: 1, info: UserInfo{Name: "Ana Nova", Avatar: json.RawMessage(`{"sk":3}`)}}, h.now)
	h.run(200 * time.Millisecond)
	got := false
	for _, f := range drain(b) {
		if strings.HasPrefix(f, `{"t":"p"`) && strings.Contains(f, "Ana Nova") && strings.Contains(f, `"sk":3`) {
			got = true
		}
	}
	if !got {
		t.Fatal("a profile change must reach everyone's roster")
	}
}

func TestMediaRoomsAreNamespacedPerInstallation(t *testing.T) {
	h := newHarness(t)
	h.w.RoomPrefix = "abcd1234.o1"
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+32, sy)
	h.consent(a, true)
	h.consent(b, true)
	h.run(2 * time.Second)
	if a.group == nil || !strings.HasPrefix(a.group.room, "abcd1234.o1.g") {
		t.Fatalf("room names must carry the installation prefix: %+v", a.group)
	}
	snap := make(chan map[string]map[string]bool, 1)
	h.w.handle(ev{kind: evSnapshot, snap: snap}, h.now)
	m := <-snap
	if !m[a.group.room]["1"] || !m[a.group.room]["2"] || len(m) != 1 {
		t.Fatalf("snapshot must list exactly the group's members: %v", m)
	}
}
