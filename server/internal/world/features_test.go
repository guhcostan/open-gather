package world

import (
	"strings"
	"testing"
	"time"

	"opengather/internal/gamemap"
)

func frames(p *Player) string { return strings.Join(drain(p), "\n") }

func (h *harness) send(p *Player, e ev) {
	e.p, e.gen = p, p.gen
	h.w.handle(e, h.now)
}

func (h *harness) members() map[string]map[string]bool {
	ch := make(chan map[string]map[string]bool, 1)
	h.w.handle(ev{kind: evSnapshot, snap: ch}, h.now)
	return <-ch
}

func TestEmotesReachNearbyPlayersOnlyAndAreRateLimited(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+40, sy)
	far := h.add(3, "member", 3*16, 3*16) // reception: outside a's area of interest
	h.run(200 * time.Millisecond)
	drain(a)
	drain(b)
	drain(far)

	h.send(a, ev{kind: evEmote, x: 3})
	if !strings.Contains(frames(b), `{"t":"e","id":1,"v":3}`) {
		t.Fatal("a nearby player must see the emote")
	}
	if strings.Contains(frames(far), `"t":"e"`) {
		t.Fatal("somebody outside the area of interest must not receive it")
	}
	h.send(a, ev{kind: evEmote, x: 4}) // same instant: cooldown
	if strings.Contains(frames(b), `"t":"e"`) {
		t.Fatal("emotes are rate limited")
	}
	h.now = h.now.Add(time.Second)
	h.send(a, ev{kind: evEmote, x: 99})
	h.send(a, ev{kind: evEmote, x: 0})
	if strings.Contains(frames(b), `"t":"e"`) {
		t.Fatal("unknown emotes are ignored")
	}
	h.w.handle(ev{kind: evStatus, p: a, gen: a.gen, s: StatusInvisible}, h.now)
	h.now = h.now.Add(time.Second)
	drain(b)
	h.send(a, ev{kind: evEmote, x: 2})
	if strings.Contains(frames(b), `"t":"e"`) {
		t.Fatal("an invisible player cannot emote")
	}
}

func TestObjectContentIsHiddenFromTheMapAndServedOnlyNextToTheObject(t *testing.T) {
	h := newHarness(t)
	// the welcome note sits at tile (4,5); the reception is open to everybody
	near := h.add(1, "member", 4*16+8, 6*16+8)
	far := h.add(2, "member", 12*16+8, 9*16+8)
	if strings.Contains(string(h.w.m.JSON), "Welcome to Open Gather") {
		t.Fatal("the wire map must not carry the content of interactive objects")
	}
	drain(near)
	drain(far)
	h.send(far, ev{kind: evUse, x: 4, y: 5})
	if strings.Contains(frames(far), `"t":"obj"`) {
		t.Fatal("content must not be served from a distance")
	}
	h.send(near, ev{kind: evUse, x: 4, y: 5})
	got := frames(near)
	if !strings.Contains(got, `"t":"obj"`) || !strings.Contains(got, "Welcome to Open Gather") || !strings.Contains(got, `"k":"note"`) {
		t.Fatalf("expected the note, got %q", got)
	}
	h.send(near, ev{kind: evUse, x: 5, y: 5}) // no object there
	if strings.Contains(frames(near), `"t":"obj"`) {
		t.Fatal("nothing to use at an empty tile")
	}
}

func TestFollowWalksAroundWallsAndStopsOnInput(t *testing.T) {
	h := newHarness(t)
	leader := h.add(1, "member", 9*16+8, 6*16+8)    // reception
	follower := h.add(2, "member", 9*16+8, 20*16+8) // social area, on the other side of the wall
	h.send(follower, ev{kind: evFollow, id: 1})
	if follower.follow != 1 {
		t.Fatal("the follower must be told it follows")
	}
	h.run(14 * time.Second)
	if d := dist(follower.X, follower.Y, leader.X, leader.Y); d > followGap+6 {
		t.Fatalf("the follower must reach the leader through the door, distance %.1f at (%.0f,%.0f)", d, follower.X, follower.Y)
	}
	if follower.follow != 1 {
		t.Fatal("following continues until the player moves on their own")
	}
	// the leader walks away: the follower keeps up
	h.send(leader, ev{kind: evInput, seq: 1, dx: 1})
	h.run(2 * time.Second)
	h.send(leader, ev{kind: evInput, seq: 2})
	h.run(4 * time.Second)
	if d := dist(follower.X, follower.Y, leader.X, leader.Y); d > followGap+6 {
		t.Fatalf("the follower must keep up, distance %.1f", d)
	}
	// releasing a key does not stop the walk, pressing one does
	h.send(follower, ev{kind: evInput, seq: 9})
	if follower.follow != 1 {
		t.Fatal("a zero input must not cancel following")
	}
	h.send(follower, ev{kind: evInput, seq: 10, dx: -1})
	if follower.follow != 0 || len(h.w.followers) != 0 {
		t.Fatal("moving on your own ends following")
	}
}

func TestFollowStopsWhenTheLeaderLeavesAndIsBounded(t *testing.T) {
	h := newHarness(t)
	leader := h.add(1, "member", sx, sy)
	f := h.add(2, "member", sx+100, sy)
	h.send(f, ev{kind: evFollow, id: 1})
	h.w.removePlayer(leader)
	h.run(300 * time.Millisecond)
	if f.follow != 0 {
		t.Fatal("following ends when the leader is gone")
	}
	h.send(f, ev{kind: evFollow, id: 77}) // nobody
	if f.follow != 0 {
		t.Fatal("cannot follow somebody who is not there")
	}
	h.send(f, ev{kind: evFollow, id: 2}) // itself
	if f.follow != 0 {
		t.Fatal("cannot follow yourself")
	}
}

func TestRequestToLeadReachesTheOtherPlayerWithACooldown(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", sx, sy)
	b := h.add(2, "member", sx+400, sy)
	drain(b)
	h.send(a, ev{kind: evLead, id: 2})
	if got := frames(b); !strings.Contains(got, `"t":"lreq"`) || !strings.Contains(got, `"from":1`) {
		t.Fatal("the other player must get the request")
	}
	h.send(a, ev{kind: evLead, id: 2})
	if strings.Contains(frames(b), "lreq") {
		t.Fatal("requests are rate limited")
	}
	if b.follow != 0 {
		t.Fatal("a request never moves anybody by itself")
	}
}

func TestPortalsTeleportOncePerArrivalAndNotIntoLockedRooms(t *testing.T) {
	h := newHarness(t)
	p := h.add(1, "member", 16*16+8, 11*16+8) // just above the portal at tile (16,12)
	drain(p)
	h.send(p, ev{kind: evInput, seq: 1, dy: 1})
	h.run(1500 * time.Millisecond)
	if tile := tileOf(p.X, p.Y); tile.x != 36 || tile.y != 32 {
		t.Fatalf("expected to land next to the other portal at (36,32), got %v", tile)
	}
	if !strings.Contains(frames(p), `"t":"self"`) {
		t.Fatal("the client must be told it was teleported")
	}
	if p.group != nil || len(h.w.movers) != 0 && p.Dx != 0 {
		t.Fatal("a teleport stops movement")
	}
	// walk onto the return portal at (37,32): back to the reception, once
	h.send(p, ev{kind: evInput, seq: 2, dx: 1})
	h.run(800 * time.Millisecond)
	if tile := tileOf(p.X, p.Y); tile.x != 16 || tile.y != 11 {
		t.Fatalf("expected to be back at (16,11), got %v", tile)
	}
}

func TestPortalIntoALockedRoomDoesNothing(t *testing.T) {
	h := newHarness(t)
	m := *gamemap.Default()
	m.Props = append(m.Props, gamemap.Prop{T: gamemap.PropPortal, X: 30, Y: 30, To: &gamemap.Point{X: 47, Y: 5}}) // into Aurora
	cm, err := gamemap.Compile(&m)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.w.doReloadMap(cm, h.now); err != nil {
		t.Fatal(err)
	}
	inside := h.add(9, "member", 46*16+8, 5*16+8)
	p := h.add(1, "member", 30*16+8, 29*16+8)
	h.send(inside, ev{kind: evLock, b: true})
	h.send(p, ev{kind: evInput, seq: 1, dy: 1})
	h.run(time.Second)
	if p.area == 3 {
		t.Fatal("a portal must not bypass a locked door")
	}
}

func TestLockingKnockingAndAnswering(t *testing.T) {
	h := newHarness(t)
	in := h.add(1, "member", 46*16+8, 5*16+8)  // inside Aurora (open room)
	out := h.add(2, "member", 42*16+8, 4*16+8) // outside its west door, same row
	admin := h.add(3, "admin", 41*16+8, 4*16+8)
	drain(in)
	drain(out)

	h.send(in, ev{kind: evLock, b: true})
	if got := frames(out); !strings.Contains(got, `"t":"deny"`) || !strings.Contains(got, `"lk":[3]`) {
		t.Fatalf("everybody learns the room is locked: %q", got)
	}
	h.send(out, ev{kind: evInput, seq: 1, dx: 1})
	h.run(3 * time.Second)
	if out.X > 45*16 {
		t.Fatalf("a locked door must stop an outsider, x=%.0f", out.X)
	}
	h.send(admin, ev{kind: evInput, seq: 1, dx: 1})
	h.run(3 * time.Second)
	if admin.X < 46*16 {
		t.Fatalf("admins walk through locked doors, x=%.0f", admin.X)
	}

	// knock: only near the room, answered by somebody inside
	h.send(out, ev{kind: evKnock, x: 3})
	if got := frames(in); !strings.Contains(got, `"t":"knk"`) || !strings.Contains(got, `"id":2`) {
		t.Fatalf("somebody inside must be asked: %q", got)
	}
	h.send(out, ev{kind: evKnock, x: 3}) // cooldown
	stranger := h.add(4, "member", 20*16, 28*16)
	h.send(stranger, ev{kind: evKnock, x: 3})
	if len(h.w.knocks) != 1 {
		t.Fatalf("a knock from far away is ignored: %v", h.w.knocks)
	}
	h.send(stranger, ev{kind: evKnockAns, id: 2, b: true}) // not inside: cannot answer
	if _, still := h.w.knocks[2]; !still {
		t.Fatal("only people inside can answer")
	}
	drain(out)
	h.send(in, ev{kind: evKnockAns, id: 2, b: true})
	if got := frames(out); !strings.Contains(got, `"st":"ok"`) || !strings.Contains(got, `"t":"deny"`) {
		t.Fatalf("the visitor is let in and gets a fresh deny list: %q", got)
	}
	h.send(out, ev{kind: evInput, seq: 2, dx: 1})
	h.run(3 * time.Second)
	if out.X < 46*16 {
		t.Fatalf("an admitted visitor can enter, x=%.0f", out.X)
	}

	// somebody else is refused
	h.now = h.now.Add(10 * time.Second)
	late := h.add(5, "member", 42*16+8, 4*16+8)
	h.send(late, ev{kind: evKnock, x: 3})
	h.send(in, ev{kind: evKnockAns, id: 5, b: false})
	if !strings.Contains(frames(late), `"st":"no"`) {
		t.Fatal("a refused visitor is told so")
	}
	h.send(late, ev{kind: evInput, seq: 1, dx: 1})
	h.run(2 * time.Second)
	if late.X > 45*16 {
		t.Fatal("a refused visitor stays outside")
	}

	// unlocking opens the door again
	h.send(in, ev{kind: evLock, b: false})
	h.send(late, ev{kind: evInput, seq: 2, dx: 1})
	h.run(2 * time.Second)
	if late.X < 46*16 {
		t.Fatalf("after unlocking anybody may enter, x=%.0f", late.X)
	}
}

func TestAnEmptyLockedRoomUnlocksItselfAndOnlyRoomsLock(t *testing.T) {
	h := newHarness(t)
	in := h.add(1, "member", 46*16+8, 5*16+8)
	h.send(in, ev{kind: evLock, b: true})
	if len(h.w.locks) != 1 {
		t.Fatal("expected a lock")
	}
	h.w.removePlayer(in)
	h.run(time.Second)
	if len(h.w.locks) != 0 {
		t.Fatal("a room with nobody inside must unlock")
	}
	open := h.add(2, "member", sx, sy) // the social area is not a room
	h.send(open, ev{kind: evLock, b: true})
	if len(h.w.locks) != 0 {
		t.Fatal("only meeting rooms can be locked")
	}
}

func TestSpotlightBroadcastsToConsentingPlayersAndIsRevoked(t *testing.T) {
	h := newHarness(t)
	speaker := h.add(1, "member", 34*16+8, 19*16+8) // on the pad
	listener := h.add(2, "member", sx, sy)
	quiet := h.add(3, "member", sx+40, sy)
	h.consent(listener, true)
	h.consent(speaker, false)
	h.run(time.Second)
	if h.w.spot.speaker != nil {
		t.Fatal("without audio and video enabled nobody goes on air")
	}
	h.consent(speaker, true)
	h.run(time.Second)
	if h.w.spot.speaker != speaker {
		t.Fatal("the speaker should be on air")
	}
	sp, ls, qt := frames(speaker), frames(listener), frames(quiet)
	if !strings.Contains(sp, `"me":true`) || !strings.Contains(sp, `"tok":"tok:`) {
		t.Fatalf("the speaker gets a token: %q", sp)
	}
	if !strings.Contains(ls, `"op":"on"`) || !strings.Contains(ls, `"tok":"tok:`) || strings.Contains(ls, `"me":true`) {
		t.Fatalf("a listener gets a subscribe token: %q", ls)
	}
	if !strings.Contains(qt, `"op":"on"`) || strings.Contains(qt, `"tok":"tok:`) {
		t.Fatalf("a player without audio and video only gets the banner: %q", qt)
	}
	members := h.members()
	room := h.w.spotRoom()
	if !members[room]["1"] || !members[room]["2"] || members[room]["3"] {
		t.Fatalf("the reconciler must know who may be in the spotlight room: %v", members[room])
	}
	// a late consent gets a token; withdrawing consent revokes it
	h.consent(quiet, true)
	if !strings.Contains(frames(quiet), `"tok":"tok:`) {
		t.Fatal("enabling audio and video later joins the audience")
	}
	h.consent(listener, false)
	h.fm.mu.Lock()
	revoked := strings.Join(h.fm.revoked, ",")
	h.fm.mu.Unlock()
	if !strings.Contains(revoked, room+"/2") {
		t.Fatalf("withdrawing consent revokes the audience token: %s", revoked)
	}
	// stepping off ends it and revokes everybody
	h.teleport(speaker, sx+200, sy)
	h.w.updateSpot(speaker, h.now)
	drain(quiet)
	h.run(300 * time.Millisecond)
	if h.w.spot.speaker != nil || !strings.Contains(frames(quiet), `"op":"off"`) {
		t.Fatal("stepping off the pad ends the spotlight")
	}
	h.fm.mu.Lock()
	revoked = strings.Join(h.fm.revoked, ",")
	h.fm.mu.Unlock()
	if !strings.Contains(revoked, room+"/1") || !strings.Contains(revoked, room+"/3") {
		t.Fatalf("everybody is revoked: %s", revoked)
	}
	members = h.members()
	if _, on := members[room]; on {
		t.Fatal("the room must vanish from the membership snapshot so the reconciler empties it")
	}
}

func TestOnlyOneSpeakerAndTheFirstKeepsIt(t *testing.T) {
	h := newHarness(t)
	a := h.add(1, "member", 34*16+8, 19*16+8)
	b := h.add(2, "member", 34*16+8, 19*16+8)
	h.consent(a, true)
	h.consent(b, true)
	h.now = h.now.Add(time.Second)
	h.run(time.Second)
	first := h.w.spot.speaker
	if first == nil {
		t.Fatal("somebody should be on air")
	}
	h.run(2 * time.Second)
	if h.w.spot.speaker != first {
		t.Fatal("the speaker does not change while they stay on the pad")
	}
	h.teleport(first, sx, sy)
	h.w.updateSpot(first, h.now)
	h.run(time.Second)
	if h.w.spot.speaker == nil || h.w.spot.speaker == first {
		t.Fatal("the next person on the pad takes over")
	}
}
