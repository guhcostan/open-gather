package world

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"
	"unicode"

	"opengather/internal/gamemap"
	"opengather/internal/media"
)

// Media is the subset of the SFU integration the world needs.
type Media interface {
	Enabled() bool
	PublicURL() string
	Token(media.Grants) (string, error)
	Revoke(room, identity string)
}

type cell struct {
	ents []*Player // visible players located in this cell
	subs []*Player // players whose area of interest covers this cell
}

type evKind uint8

const (
	evJoin evKind = iota + 1
	evDetach
	evInput
	evStatus
	evConsent
	evChat
	evLocate
	evToken
	evSync
	evMap
	evProfile
	evSnapshot
	evEvict
	evEmote
	evUse
	evFollow
	evLead
	evLock
	evKnock
	evKnockAns
	evBoard
	evReset
	evGoto
	evHand
	evNote
	evWave
)

type ev struct {
	kind   evKind
	p      *Player
	gen    uint64
	seq    uint32
	dx, dy int8
	s      string
	b      bool
	id     uint32
	info   UserInfo
	kick   func(reason KickReason)
	reply  chan joinResult
	cm     *gamemap.Compiled
	snap   chan map[string]map[string]bool
	errc   chan error
	x, y   int
	wb     *BoardMsg
}

type joinResult struct {
	p   *Player
	out <-chan []byte
	gen uint64
	err error
}

var ErrFull = errors.New("office is full")

type World struct {
	cfg      Config
	OfficeID int64
	Name     string
	// RoomPrefix namespaces SFU room names, e.g. "3fa9c1d2.o1". Empty means "o<office id>".
	RoomPrefix string
	m          *gamemap.Compiled
	media      Media
	log        *slog.Logger
	St         Stats
	OnLeave    func(officeID int64, userID uint32, x, y float64)
	OnChat     func(officeID int64, from uint32, text string, tsMillis int64) // persistence hook, must not block
	hist       []ChatEntry
	OnAction   func(officeID int64, actor uint32, action, target string) // metadata only, must not block

	// social features (world goroutine only)
	followers map[*Player]struct{}
	locks     map[string]*lockState // by area id
	knocks    map[uint32]knockReq   // pending knocks by requester
	spot      spotState
	onSpotSet map[*Player]struct{}
	boards    map[string]*board
	// OnBoardSave persists a whiteboard and reports whether it was accepted (a refused save is retried on
	// the next pass). final is true on shutdown: write synchronously.
	OnBoardSave func(officeID int64, key string, data []byte, final bool) bool
	bfs         bfsScratch
	counts      []int     // scratch for publishCounts
	lastCounts  []int     // last published head count per area
	countsAt    time.Time // last head-count pass

	players map[uint32]*Player
	list    []*Player
	cols    int
	rows    int
	cells   []cell
	movers  map[*Player]struct{}

	groups   map[uint32]*group
	roomGrp  map[int]*group
	nextGID  uint32
	nextProx time.Time
	tickN    uint64
	genSeq   uint64

	rAdd map[uint32]struct{}
	rUpd map[uint32]struct{}
	rDel []uint32

	inbox chan ev
	buf   []byte
}

func New(cfg Config, officeID int64, name string, m *gamemap.Compiled, md Media, log *slog.Logger) *World {
	w := &World{cfg: cfg, OfficeID: officeID, Name: name, m: m, media: md, log: log,
		players: map[uint32]*Player{}, movers: map[*Player]struct{}{},
		followers: map[*Player]struct{}{}, locks: map[string]*lockState{}, knocks: map[uint32]knockReq{},
		onSpotSet: map[*Player]struct{}{}, boards: map[string]*board{},
		groups: map[uint32]*group{}, roomGrp: map[int]*group{},
		rAdd: map[uint32]struct{}{}, rUpd: map[uint32]struct{}{},
		inbox: make(chan ev, 8192)}
	px := m.W * gamemap.TilePx
	py := m.H * gamemap.TilePx
	w.cols = (px + cfg.CellPx - 1) / cfg.CellPx
	w.rows = (py + cfg.CellPx - 1) / cfg.CellPx
	w.cells = make([]cell, w.cols*w.rows)
	return w
}

// Run drives the simulation until ctx is cancelled.
func (w *World) Run(ctx context.Context) {
	tk := time.NewTicker(time.Second / time.Duration(w.cfg.TickHz))
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			w.flushBoards(true)
			return
		case e := <-w.inbox:
			w.handle(e, time.Now())
		case now := <-tk.C:
			// drain a bounded batch of pending events first to keep ordering fair
			for i := 0; i < 4096; i++ {
				select {
				case e := <-w.inbox:
					w.handle(e, now)
					continue
				default:
				}
				break
			}
			w.St.InboxDepth.Store(int64(len(w.inbox)))
			w.tick(now)
		}
	}
}

func (w *World) post(ctx context.Context, e ev) bool {
	select {
	case w.inbox <- e:
		return true
	case <-ctx.Done():
		return false
	}
}

// ---- public API (called from connection goroutines) ----

type Conn struct {
	P   *Player
	Out <-chan []byte
	Gen uint64
	w   *World
}

// Join attaches a connection. kick is called on the world goroutine, just before the outbound channel
// is closed, to say why the server ends the connection; it must not block.
func (w *World) Join(ctx context.Context, info UserInfo, kick func(reason KickReason)) (*Conn, error) {
	reply := make(chan joinResult, 1)
	e := ev{kind: evJoin, info: info, kick: kick, reply: reply}
	if !w.post(ctx, e) {
		return nil, ctx.Err()
	}
	select {
	case r := <-reply:
		if r.err != nil {
			return nil, r.err
		}
		return &Conn{P: r.p, Out: r.out, Gen: r.gen, w: w}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *Conn) Detach(ctx context.Context) {
	c.w.post(ctx, ev{kind: evDetach, p: c.P, gen: c.Gen})
}
func (c *Conn) Input(ctx context.Context, seq uint32, dx, dy int8, run bool) {
	c.w.post(ctx, ev{kind: evInput, p: c.P, gen: c.Gen, seq: seq, dx: dx, dy: dy, b: run})
}

// GoTo starts a guided walk to a map tile, or to another player when id != 0.
func (c *Conn) GoTo(ctx context.Context, x, y int, id uint32) {
	c.w.post(ctx, ev{kind: evGoto, p: c.P, gen: c.Gen, x: x, y: y, id: id})
}
func (c *Conn) SetStatus(ctx context.Context, s string) {
	c.w.post(ctx, ev{kind: evStatus, p: c.P, gen: c.Gen, s: s})
}
func (c *Conn) SetConsent(ctx context.Context, b bool) {
	c.w.post(ctx, ev{kind: evConsent, p: c.P, gen: c.Gen, b: b})
}
func (c *Conn) Chat(ctx context.Context, scope string, to uint32, text string) {
	c.w.post(ctx, ev{kind: evChat, p: c.P, gen: c.Gen, s: scope, id: to, info: UserInfo{Name: text}})
}
func (c *Conn) Locate(ctx context.Context, id uint32) {
	c.w.post(ctx, ev{kind: evLocate, p: c.P, gen: c.Gen, id: id})
}

func (c *Conn) Emote(ctx context.Context, kind int) {
	c.w.post(ctx, ev{kind: evEmote, p: c.P, gen: c.Gen, x: kind})
}

// Hand raises or lowers the player's hand.
func (c *Conn) Hand(ctx context.Context, up bool) {
	c.w.post(ctx, ev{kind: evHand, p: c.P, gen: c.Gen, b: up})
}

// Note sets the player's short status line ("" clears it).
func (c *Conn) Note(ctx context.Context, text string) {
	c.w.post(ctx, ev{kind: evNote, p: c.P, gen: c.Gen, s: text})
}

// Wave pings another player.
func (c *Conn) Wave(ctx context.Context, id uint32) {
	c.w.post(ctx, ev{kind: evWave, p: c.P, gen: c.Gen, id: id})
}
func (c *Conn) Use(ctx context.Context, x, y int) {
	c.w.post(ctx, ev{kind: evUse, p: c.P, gen: c.Gen, x: x, y: y})
}
func (c *Conn) Follow(ctx context.Context, id uint32) {
	c.w.post(ctx, ev{kind: evFollow, p: c.P, gen: c.Gen, id: id})
}
func (c *Conn) Lead(ctx context.Context, id uint32) {
	c.w.post(ctx, ev{kind: evLead, p: c.P, gen: c.Gen, id: id})
}
func (c *Conn) Lock(ctx context.Context, on bool) {
	c.w.post(ctx, ev{kind: evLock, p: c.P, gen: c.Gen, b: on})
}
func (c *Conn) Knock(ctx context.Context, area int) {
	c.w.post(ctx, ev{kind: evKnock, p: c.P, gen: c.Gen, x: area})
}
func (c *Conn) KnockAnswer(ctx context.Context, id uint32, allow bool) {
	c.w.post(ctx, ev{kind: evKnockAns, p: c.P, gen: c.Gen, id: id, b: allow})
}
func (c *Conn) Board(ctx context.Context, m *BoardMsg) {
	c.w.post(ctx, ev{kind: evBoard, p: c.P, gen: c.Gen, wb: m})
}

// ReloadMap swaps the office map at runtime (admin edits). The map size cannot change on the fly.
func (w *World) ReloadMap(ctx context.Context, cm *gamemap.Compiled) error {
	errc := make(chan error, 1)
	if !w.post(ctx, ev{kind: evMap, cm: cm, errc: errc}) {
		return ctx.Err()
	}
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// MediaMembers returns, per SFU room, the identities the world currently allows in it.
func (w *World) MediaMembers(ctx context.Context) (map[string]map[string]bool, error) {
	ch := make(chan map[string]map[string]bool, 1)
	if !w.post(ctx, ev{kind: evSnapshot, snap: ch}) {
		return nil, ctx.Err()
	}
	select {
	case m := <-ch:
		return m, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// SeedChat loads persisted history. Call before Run.
func (w *World) SeedChat(h []ChatEntry) {
	if len(h) > chatHistory {
		h = h[len(h)-chatHistory:]
	}
	w.hist = append(w.hist[:0], h...)
}

// Evict disconnects a player (with KickEvicted) and removes them from the world at once, ending
// any call they are in. Used when an admin removes a member or changes their role: a role is read
// at join, so an evicted client that still belongs to the office simply reconnects with the new one.
func (w *World) Evict(ctx context.Context, id uint32) {
	w.post(ctx, ev{kind: evEvict, id: id})
}

// ResetContent restores a demo office: the given map, no whiteboards, no office chat history. People
// stay connected; anyone standing inside a wall is moved, open boards are closed.
func (w *World) ResetContent(ctx context.Context, cm *gamemap.Compiled) error {
	errc := make(chan error, 1)
	if !w.post(ctx, ev{kind: evReset, cm: cm, errc: errc}) {
		return ctx.Err()
	}
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (w *World) doResetContent(cm *gamemap.Compiled, now time.Time) error {
	if err := w.doReloadMap(cm, now); err != nil {
		return err
	}
	for _, b := range w.boards {
		for p := range b.viewers {
			w.closeBoard(p)
		}
	}
	clear(w.boards) // already wiped in the store; nothing left to save
	w.hist = w.hist[:0]
	return nil
}

// UpdateProfile applies a name/avatar change to an online player (no-op if offline).
func (w *World) UpdateProfile(ctx context.Context, id uint32, name string, avatar json.RawMessage) {
	w.post(ctx, ev{kind: evProfile, id: id, info: UserInfo{Name: name, Avatar: avatar}})
}

func (c *Conn) Sync(ctx context.Context) {
	c.w.post(ctx, ev{kind: evSync, p: c.P, gen: c.Gen})
}
func (c *Conn) RequestToken(ctx context.Context) {
	c.w.post(ctx, ev{kind: evToken, p: c.P, gen: c.Gen})
}

// ---- event handling (world goroutine only) ----

func (w *World) handle(e ev, now time.Time) {
	switch e.kind {
	case evJoin:
		w.doJoin(e, now)
		return
	case evMap:
		e.errc <- w.doReloadMap(e.cm, now)
		return
	case evReset:
		e.errc <- w.doResetContent(e.cm, now)
		return
	case evSnapshot:
		out := make(map[string]map[string]bool, len(w.groups)+1)
		for _, g := range w.groups {
			ids := make(map[string]bool, len(g.members))
			for _, m := range g.members {
				ids[w.identity(m)] = true
			}
			out[g.room] = ids
		}
		w.spotMembers(out)
		e.snap <- out
		return
	case evEvict:
		if p := w.players[e.id]; p != nil {
			w.evictPlayer(p)
		}
		return
	case evProfile:
		if p := w.players[e.id]; p != nil {
			p.Name, p.Avatar = e.info.Name, e.info.Avatar
			w.rUpd[p.ID] = struct{}{}
		}
		return
	}
	p := e.p
	if p == nil || w.players[p.ID] != p || p.gen != e.gen {
		return // stale connection
	}
	switch e.kind {
	case evDetach:
		w.doDetach(p, now)
	case evInput:
		w.St.InputMsgs.Add(1)
		w.doInput(p, e.seq, e.dx, e.dy, e.b, now)
	case evStatus:
		w.doStatus(p, e.s)
	case evConsent:
		p.consent = e.b
		if !e.b {
			w.leaveGroup(p)
		}
		w.sendSpot(p) // gain or lose the spotlight audience token
	case evChat:
		w.doChat(p, e.s, e.id, e.info.Name, now)
	case evLocate:
		w.doLocate(p, e.id)
	case evSync:
		// The tab was hidden (no extrapolation ran): resend the current state of everything in view.
		clear(p.pendPos)
		clear(p.pendLeave)
		w.unsubAll(p)
		w.resub(p)
	case evToken:
		if p.group != nil {
			w.sendConvJoin(p, p.group)
		}
		w.sendSpot(p)
	case evEmote:
		w.doEmote(p, e.x, now)
	case evUse:
		w.doUse(p, e.x, e.y, now)
	case evFollow:
		w.doFollow(p, e.id, now)
	case evGoto:
		w.doGoto(p, e.x, e.y, e.id, now)
	case evHand:
		w.doHand(p, e.b)
	case evNote:
		w.doNote(p, e.s)
	case evWave:
		w.doWave(p, e.id, now)
	case evLead:
		w.doLead(p, e.id, now)
	case evLock:
		w.doLock(p, e.b)
	case evKnock:
		w.doKnock(p, e.x, now)
	case evKnockAns:
		w.doKnockAns(p, e.id, e.b, now)
	case evBoard:
		w.doBoard(p, e.wb, now)
	}
}

func (w *World) doJoin(e ev, now time.Time) {
	info := e.info
	kick := e.kick
	p := w.players[info.ID]
	if p == nil {
		if len(w.players) >= w.cfg.MaxPlayers {
			e.reply <- joinResult{err: ErrFull}
			return
		}
		p = &Player{ID: info.ID, Name: info.Name, Avatar: info.Avatar, Role: info.Role, Status: StatusAvailable,
			area: -1, pendPos: map[uint32]posRec{}, pendLeave: map[uint32]struct{}{}, chatTokens: 5, portalOn: -1}
		p.sx0, p.sy0, p.sx1, p.sy1 = 0, 0, -1, -1
		p.X, p.Y = w.spawnFor(p, info)
		p.lastAdv = now
		p.cx, p.cy = w.cellOf(p.X, p.Y)
		p.area = w.m.AreaIndexAt(int(p.X)/gamemap.TilePx, int(p.Y)/gamemap.TilePx)
		p.dir = 0
		p.last = p.rec()
		p.ix, p.iy, p.sentAt, p.shadowAt = float64(p.last.x), float64(p.last.y), now, now
		w.players[p.ID] = p
		w.list = append(w.list, p)
		w.insertVisible(p)
		w.resub(p)
		w.rAdd[p.ID] = struct{}{}
	} else {
		// reattach (reconnect or second tab): the new connection wins
		if p.out != nil {
			old := p.out
			if p.kick != nil {
				p.kick(KickReplaced) // records the reason before the channel closes (see Join)
			}
			p.out = nil
			close(old)
		}
		p.Name, p.Avatar, p.Role = info.Name, info.Avatar, info.Role
		clear(p.pendPos)
		clear(p.pendLeave)
		w.unsubAll(p) // re-subscribed below so the client gets a fresh full snapshot
		w.rUpd[p.ID] = struct{}{}
	}
	w.genSeq++
	p.gen = w.genSeq
	p.gone = time.Time{}
	p.kick = kick
	out := make(chan []byte, w.cfg.OutQueue)
	p.out = out
	w.resub(p)
	w.sendHello(p)
	if len(w.lastCounts) > 0 {
		w.sendCopy(p, w.countsMsg())
	}
	if p.group != nil {
		w.sendConvJoin(p, p.group)
	}
	w.updateSpot(p, now)
	w.sendSpot(p)
	e.reply <- joinResult{p: p, out: out, gen: p.gen}
}

func (w *World) doReloadMap(cm *gamemap.Compiled, now time.Time) error {
	if cm.W != w.m.W || cm.H != w.m.H {
		return errors.New("changing the map size requires a restart")
	}
	w.m = cm
	w.pruneLocks(true, now)
	// Room groups are keyed by area index, which may have changed: dissolve them; people re-enter
	// through the normal dwell rules.
	for _, g := range w.groups {
		if g.isRoom {
			for len(g.members) > 0 {
				w.leaveGroup(g.members[0])
			}
		}
	}
	for _, p := range w.list {
		p.area = w.m.AreaIndexAt(int(p.X)/gamemap.TilePx, int(p.Y)/gamemap.TilePx)
		moved := false
		if !w.canStand(p, p.X, p.Y) {
			p.X, p.Y = w.spawnFor(p, UserInfo{})
			p.Dx, p.Dy = 0, 0
			delete(w.movers, p)
			moved = true
		}
		w.sendState(p, now)
		w.sendMap(p, moved)
		w.updateSpot(p, now)
	}
	w.broadcastDeny()
	w.checkBoards()
	return nil
}

func (w *World) doDetach(p *Player, now time.Time) {
	if p.out != nil {
		close(p.out)
		p.out = nil
	}
	p.gone = now
	p.Dx, p.Dy = 0, 0
	w.advance(p, now)
	delete(w.movers, p)
	w.sendState(p, now)
}

func (w *World) removePlayer(p *Player) {
	w.dropSocial(p)
	w.leaveGroup(p)
	w.hide(p)
	w.unsubAll(p)
	delete(w.players, p.ID)
	delete(w.movers, p)
	for i, q := range w.list {
		if q == p {
			w.list = append(w.list[:i], w.list[i+1:]...)
			break
		}
	}
	delete(w.rAdd, p.ID)
	delete(w.rUpd, p.ID)
	w.rDel = append(w.rDel, p.ID)
	if w.OnLeave != nil {
		w.OnLeave(w.OfficeID, p.ID, p.X, p.Y)
	}
}

func (w *World) doInput(p *Player, seq uint32, dx, dy int8, run bool, now time.Time) {
	if dx < -1 || dx > 1 || dy < -1 || dy > 1 {
		return
	}
	runChanged := run != p.run
	if runChanged {
		w.advance(p, now) // integrate at the old speed up to the switch
		p.run = run
	}
	if p.guided() {
		if dx == 0 && dy == 0 {
			if runChanged && (p.Dx != 0 || p.Dy != 0) {
				p.shadowAt = now
				w.sendState(p, now)
			}
			return // a released key must not stop the guided walk; only a movement key does
		}
		w.stopFollow(p, now, true, false)
	}
	w.advance(p, now)
	changed := dx != p.Dx || dy != p.Dy || (runChanged && (dx != 0 || dy != 0))
	p.Dx, p.Dy = dx, dy
	if dx != 0 || dy != 0 {
		switch {
		case dx < 0:
			p.dir = 1
		case dx > 0:
			p.dir = 2
		case dy < 0:
			p.dir = 3
		default:
			p.dir = 0
		}
		p.lastAdv = now
		w.movers[p] = struct{}{}
	} else {
		delete(w.movers, p)
	}
	if changed {
		p.shadowAt = now
		w.sendState(p, now) // direction changes are the events clients cannot predict
	}
	if p.out != nil && len(p.out) < cap(p.out)/2 {
		b := append(w.buf[:0], `{"t":"a","s":`...)
		b = strconv.AppendUint(b, uint64(seq), 10)
		b = append(b, `,"x":`...)
		b = strconv.AppendFloat(b, p.X, 'f', 1, 64)
		b = append(b, `,"y":`...)
		b = strconv.AppendFloat(b, p.Y, 'f', 1, 64)
		b = append(b, '}')
		w.buf = b
		w.sendCopy(p, b)
	}
}

func (w *World) doStatus(p *Player, s string) {
	switch s {
	case StatusAvailable, StatusBusy, StatusAway, StatusInvisible:
	default:
		return
	}
	if p.Status == s {
		return
	}
	prev := p.Status
	p.Status = s
	if s != StatusAvailable {
		w.leaveGroup(p) // busy/away/invisible never sit in automatic conversations
	}
	if s == StatusInvisible {
		w.hide(p)
	} else if prev == StatusInvisible {
		w.insertVisible(p)
		w.sendState(p, time.Now())
	}
	w.rUpd[p.ID] = struct{}{}
}

func cleanText(s string, max int) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	n := 0
	for _, r := range s {
		if r == '\n' || r == '\t' {
			r = ' '
		}
		if unicode.IsControl(r) {
			continue
		}
		b.WriteRune(r)
		n++
		if n >= max {
			break
		}
	}
	return b.String()
}

func (w *World) doChat(p *Player, scope string, to uint32, text string, now time.Time) {
	text = cleanText(text, w.cfg.MaxChatRune)
	if text == "" {
		return
	}
	tb, _ := json.Marshal(text)
	mk := func(sc string, extra string) []byte {
		b := []byte(`{"t":"c","sc":"` + sc + `","f":` + strconv.FormatUint(uint64(p.ID), 10) + extra + `,"x":`)
		b = append(b, tb...)
		b = append(b, `,"ts":`...)
		b = strconv.AppendInt(b, now.UnixMilli(), 10)
		return append(b, '}')
	}
	switch scope {
	case "o":
		w.hist = append(w.hist, ChatEntry{From: p.ID, Name: p.Name, Text: text, TS: now.UnixMilli()})
		if len(w.hist) > chatHistory {
			w.hist = append(w.hist[:0], w.hist[len(w.hist)-chatHistory:]...)
		}
		if w.OnChat != nil {
			w.OnChat(w.OfficeID, p.ID, text, now.UnixMilli())
		}
		f := mk("o", "")
		for _, q := range w.list {
			w.sendShared(q, f)
		}
	case "g":
		if p.group == nil {
			return
		}
		f := mk("g", "")
		for _, q := range p.group.members {
			w.sendShared(q, f)
		}
	case "d":
		q := w.players[to]
		if q == nil || q == p {
			return
		}
		f := mk("d", `,"to":`+strconv.FormatUint(uint64(to), 10))
		w.sendShared(p, f)
		w.sendShared(q, f)
	}
}

func (w *World) doLocate(p *Player, id uint32) {
	q := w.players[id]
	if q == nil || q.Status == StatusInvisible {
		w.sendJSON(p, map[string]any{"t": "loc", "id": id, "ok": false})
		return
	}
	area := ""
	if q.area >= 0 {
		area = w.m.Map.Areas[q.area].Name
	}
	w.sendJSON(p, map[string]any{"t": "loc", "id": id, "ok": true, "x": int(q.X), "y": int(q.Y), "a": area})
}

// ---- movement ----

// rec is the wire state: rounded position plus a direction code
// d = facing(2 bits) | (dx+1)<<2 | (dy+1)<<4. Clients extrapolate the motion themselves,
// so records are only sent when the state changes (see sendState / tick).
func (p *Player) rec() posRec {
	d := p.dir | uint8(p.Dx+1)<<2 | uint8(p.Dy+1)<<4
	if p.running() && (p.Dx != 0 || p.Dy != 0) {
		d |= 1 << 6
	}
	return posRec{x: int16(math.Round(p.X)), y: int16(math.Round(p.Y)), d: d}
}

// guided reports whether the server is steering the player (follow or "walk to").
func (p *Player) guided() bool { return p.follow != 0 || p.destOn }

// running reports whether the player moves at run speed. A "walk to" always runs.
func (p *Player) running() bool { return p.run || p.destOn }

func (w *World) speedOf(p *Player) float64 {
	if p.running() && w.cfg.RunMul > 1 {
		return w.cfg.Speed * w.cfg.RunMul
	}
	return w.cfg.Speed
}

func (w *World) canEnterArea(p *Player, ai int) bool {
	if ai < 0 {
		return true
	}
	a := &w.m.Map.Areas[ai]
	if a.Kind != gamemap.KindRoom {
		return true
	}
	if !AllowedIn(a, p.ID, p.Role) {
		return false
	}
	// A door locked from the inside stays closed for everybody who was not let in (admins bypass it).
	if ls := w.locks[a.ID]; ls != nil && p.Role != "admin" {
		_, ok := ls.admitted[p.ID]
		return ok
	}
	return true
}

// AllowedIn evaluates a room's access rule. Roles: admin, member, guest.
func AllowedIn(a *gamemap.Area, uid uint32, role string) bool {
	switch a.Access.Mode {
	case "", gamemap.AccessOpen:
		return true
	case gamemap.AccessMembers:
		return role == "admin" || role == "member"
	case gamemap.AccessAdmins:
		return role == "admin"
	case gamemap.AccessList:
		if role == "admin" {
			return true
		}
		for _, u := range a.Access.Users {
			if u == int64(uid) {
				return true
			}
		}
	}
	return false
}

func (w *World) canStand(p *Player, x, y float64) bool {
	const T = gamemap.TilePx
	x0 := int(math.Floor((x - boxHalfW) / T))
	x1 := int(math.Floor((x + boxHalfW - 0.001) / T))
	y0 := int(math.Floor((y - boxHalfH) / T))
	y1 := int(math.Floor((y + boxHalfH - 0.001) / T))
	for ty := y0; ty <= y1; ty++ {
		for tx := x0; tx <= x1; tx++ {
			if w.m.IsSolidTile(tx, ty) {
				return false
			}
			if ai := w.m.AreaIndexAt(tx, ty); ai != p.area && !w.canEnterArea(p, ai) {
				return false
			}
		}
	}
	return true
}

// advance integrates the player's motion up to now using the current input.
func (w *World) advance(p *Player, now time.Time) {
	dt := now.Sub(p.lastAdv).Seconds()
	p.lastAdv = now
	if dt <= 0 || (p.Dx == 0 && p.Dy == 0) {
		return
	}
	if dt > 0.25 {
		dt = 0.25
	}
	vx, vy := float64(p.Dx), float64(p.Dy)
	if vx != 0 && vy != 0 {
		vx *= 0.70710678
		vy *= 0.70710678
	}
	step := w.speedOf(p) * dt
	if nx := p.X + vx*step; vx != 0 && w.canStand(p, nx, p.Y) {
		p.X = nx
	}
	if ny := p.Y + vy*step; vy != 0 && w.canStand(p, p.X, ny) {
		p.Y = ny
	}
	p.area = w.m.AreaIndexAt(int(p.X)/gamemap.TilePx, int(p.Y)/gamemap.TilePx)
}

func (w *World) spawnFor(p *Player, info UserInfo) (float64, float64) {
	const T = gamemap.TilePx
	p.area = -1
	if info.LastX != nil && info.LastY != nil {
		x, y := *info.LastX, *info.LastY
		p.area = w.m.AreaIndexAt(int(x)/T, int(y)/T)
		if w.canStand(p, x, y) && w.canEnterArea(p, p.area) {
			return x, y
		}
	}
	sp := w.m.Map.Spawn
	cx, cy := float64(sp.X*T+T/2), float64(sp.Y*T+T/2)
	for i := 0; i < 40; i++ {
		x := cx + (rand.Float64()-0.5)*float64(T*6)
		y := cy + (rand.Float64()-0.5)*float64(T*4)
		p.area = w.m.AreaIndexAt(int(x)/T, int(y)/T)
		if w.canStand(p, x, y) {
			return x, y
		}
	}
	p.area = w.m.AreaIndexAt(sp.X, sp.Y)
	return cx, cy
}

// ---- spatial grid / area of interest ----

func (w *World) cellOf(x, y float64) (int, int) {
	cx := int(x) / w.cfg.CellPx
	cy := int(y) / w.cfg.CellPx
	if cx < 0 {
		cx = 0
	} else if cx >= w.cols {
		cx = w.cols - 1
	}
	if cy < 0 {
		cy = 0
	} else if cy >= w.rows {
		cy = w.rows - 1
	}
	return cx, cy
}

func removePlayer(s []*Player, p *Player) []*Player {
	for i, q := range s {
		if q == p {
			s[i] = s[len(s)-1]
			s[len(s)-1] = nil
			return s[:len(s)-1]
		}
	}
	return s
}

func (p *Player) subscribed(cx, cy int) bool {
	return cx >= p.sx0 && cx <= p.sx1 && cy >= p.sy0 && cy <= p.sy1
}

func (w *World) queuePosRec(to *Player, id uint32, r posRec) {
	if _, dup := to.pendPos[id]; dup {
		w.St.PosCoalesced.Add(1)
	}
	to.pendPos[id] = r
	delete(to.pendLeave, id)
}

// queuePos sends e's CURRENT state (used when e enters someone's view).
func (w *World) queuePos(to *Player, e *Player) { w.queuePosRec(to, e.ID, e.rec()) }

func (w *World) queueLeave(to *Player, id uint32) {
	delete(to.pendPos, id)
	to.pendLeave[id] = struct{}{}
}

// insertVisible puts p into the entity grid and tells interested clients.
func (w *World) insertVisible(p *Player) {
	if p.inGrid || p.Status == StatusInvisible {
		return
	}
	c := &w.cells[p.cy*w.cols+p.cx]
	c.ents = append(c.ents, p)
	p.inGrid = true
	p.last = p.rec()
	for _, s := range c.subs {
		if s != p {
			w.queuePos(s, p)
		}
	}
}

func (w *World) hide(p *Player) {
	if !p.inGrid {
		return
	}
	c := &w.cells[p.cy*w.cols+p.cx]
	c.ents = removePlayer(c.ents, p)
	p.inGrid = false
	for _, s := range c.subs {
		if s != p {
			w.queueLeave(s, p.ID)
		}
	}
}

// publish keeps the spatial grid in sync with p's real position and, when send is
// true, fans p's state record (p.last) out to every subscriber of its cell.
func (w *World) publish(p *Player, send bool) {
	ncx, ncy := w.cellOf(p.X, p.Y)
	if ncx != p.cx || ncy != p.cy {
		ocx, ocy := p.cx, p.cy
		if p.inGrid {
			oc := &w.cells[ocy*w.cols+ocx]
			oc.ents = removePlayer(oc.ents, p)
			for _, s := range oc.subs {
				if s != p && !s.subscribed(ncx, ncy) {
					w.queueLeave(s, p.ID)
				}
			}
			nc := &w.cells[ncy*w.cols+ncx]
			nc.ents = append(nc.ents, p)
			r := p.rec()
			for _, s := range nc.subs {
				if s != p && !s.subscribed(ocx, ocy) {
					w.queuePosRec(s, p.ID, r) // newcomers always get a fresh state
				}
			}
		}
		p.cx, p.cy = ncx, ncy
		w.resub(p)
	}
	if !send || !p.inGrid {
		return
	}
	for _, s := range w.cells[p.cy*w.cols+p.cx].subs {
		if s != p {
			w.queuePosRec(s, p.ID, p.last)
		}
	}
}

// sendState publishes p's exact state and resets the clients' extrapolation reference.
func (w *World) sendState(p *Player, now time.Time) {
	p.last = p.rec()
	p.ix, p.iy = float64(p.last.x), float64(p.last.y)
	p.sentAt = now
	w.publish(p, true)
	if p.guided() {
		w.sendSelf(p, false) // the guided player is moved by the server: tell its own client
	}
}

const shadowStep = 1.0 / 60.0

func (w *World) staticCanStand(x, y float64) bool {
	const T = gamemap.TilePx
	x0 := int(math.Floor((x - boxHalfW) / T))
	x1 := int(math.Floor((x + boxHalfW - 0.001) / T))
	y0 := int(math.Floor((y - boxHalfH) / T))
	y1 := int(math.Floor((y + boxHalfH - 0.001) / T))
	for ty := y0; ty <= y1; ty++ {
		for tx := x0; tx <= x1; tx++ {
			if w.m.IsSolidTile(tx, ty) {
				return false
			}
		}
	}
	return true
}

// advanceShadow moves the position clients would extrapolate to (static walls only,
// fixed sub-steps, the same rule the web client applies).
func (w *World) advanceShadow(p *Player, now time.Time) {
	dt := now.Sub(p.shadowAt).Seconds()
	p.shadowAt = now
	if dt <= 0 || (p.Dx == 0 && p.Dy == 0) {
		return
	}
	if dt > 0.25 {
		dt = 0.25
	}
	vx, vy := float64(p.Dx), float64(p.Dy)
	if vx != 0 && vy != 0 {
		vx *= 0.70710678
		vy *= 0.70710678
	}
	n := int(math.Ceil(dt / shadowStep))
	h := dt / float64(n)
	step := w.speedOf(p) * h
	for i := 0; i < n; i++ {
		if nx := p.ix + vx*step; vx != 0 && w.staticCanStand(nx, p.iy) {
			p.ix = nx
		}
		if ny := p.iy + vy*step; vy != 0 && w.staticCanStand(p.ix, ny) {
			p.iy = ny
		}
	}
}

func (w *World) rect(p *Player) (x0, y0, x1, y1 int) {
	r := w.cfg.AOICells
	x0, y0, x1, y1 = p.cx-r, p.cy-r, p.cx+r, p.cy+r
	if x0 < 0 {
		x0 = 0
	}
	if y0 < 0 {
		y0 = 0
	}
	if x1 >= w.cols {
		x1 = w.cols - 1
	}
	if y1 >= w.rows {
		y1 = w.rows - 1
	}
	return
}

// resub moves p's subscription rectangle to be centred on its current cell,
// emitting enters for newly covered cells and leaves for dropped ones.
func (w *World) resub(p *Player) {
	nx0, ny0, nx1, ny1 := w.rect(p)
	ox0, oy0, ox1, oy1 := p.sx0, p.sy0, p.sx1, p.sy1
	if nx0 == ox0 && ny0 == oy0 && nx1 == ox1 && ny1 == oy1 {
		return
	}
	inOld := func(x, y int) bool { return x >= ox0 && x <= ox1 && y >= oy0 && y <= oy1 }
	inNew := func(x, y int) bool { return x >= nx0 && x <= nx1 && y >= ny0 && y <= ny1 }
	for y := oy0; y <= oy1; y++ {
		for x := ox0; x <= ox1; x++ {
			if inNew(x, y) {
				continue
			}
			c := &w.cells[y*w.cols+x]
			c.subs = removePlayer(c.subs, p)
			for _, e := range c.ents {
				if e != p {
					w.queueLeave(p, e.ID)
				}
			}
		}
	}
	for y := ny0; y <= ny1; y++ {
		for x := nx0; x <= nx1; x++ {
			if inOld(x, y) {
				continue
			}
			c := &w.cells[y*w.cols+x]
			c.subs = append(c.subs, p)
			for _, e := range c.ents {
				if e != p {
					w.queuePos(p, e)
				}
			}
		}
	}
	p.sx0, p.sy0, p.sx1, p.sy1 = nx0, ny0, nx1, ny1
}

func (w *World) unsubAll(p *Player) {
	for y := p.sy0; y <= p.sy1; y++ {
		for x := p.sx0; x <= p.sx1; x++ {
			c := &w.cells[y*w.cols+x]
			c.subs = removePlayer(c.subs, p)
		}
	}
	p.sx0, p.sy0, p.sx1, p.sy1 = 0, 0, -1, -1
}
