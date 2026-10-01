// Package world is the authoritative simulation of one office: movement,
// collisions, area-of-interest fan-out, presence and proximity conversations.
// A World owns all of its state in a single goroutine (Run); other goroutines
// only talk to it through Post, so no locks are needed on the hot path.
package world

import (
	"encoding/json"
	"time"
)

type Config struct {
	TickHz      int     // world tick rate (10-15 recommended)
	Speed       float64 // walking speed, px/s
	RunMul      float64 // speed multiplier while running (sprint or a guided "walk to")
	CellPx      int     // spatial hash cell size, px
	AOICells    int     // interest radius in cells (Chebyshev)
	OutQueue    int     // per-client outbound queue (frames)
	Grace       time.Duration
	MaxPlayers  int
	ProxEvery   time.Duration
	Prox        ProxConfig
	MaxChatRune int
}

type ProxConfig struct {
	JoinR      float64 // px: distance to nearest member to join
	LeaveR     float64 // px: distance to nearest member before leaving is considered
	CentJoin   float64 // px: max distance to group centroid to join
	CentLeave  float64 // px: max distance to centroid before leaving is considered
	MaxGroup   int
	JoinDwell  time.Duration
	LeaveDwell time.Duration
	RoomIn     time.Duration
	RoomOut    time.Duration
}

func DefaultConfig() Config {
	return Config{
		TickHz: 15, Speed: 72, RunMul: 2, CellPx: 128, AOICells: 2, OutQueue: 128,
		Grace: 10 * time.Second, MaxPlayers: 2000, ProxEvery: 250 * time.Millisecond, MaxChatRune: 500,
		Prox: ProxConfig{
			JoinR: 64, LeaveR: 96, CentJoin: 80, CentLeave: 112, MaxGroup: 8,
			JoinDwell: 500 * time.Millisecond, LeaveDwell: 1500 * time.Millisecond,
			RoomIn: 400 * time.Millisecond, RoomOut: 800 * time.Millisecond,
		},
	}
}

const (
	StatusAvailable = "available"
	StatusBusy      = "busy"
	StatusAway      = "away"
	StatusInvisible = "invisible"

	// avatar collision box (half extents around the feet point), px
	boxHalfW = 5.0
	boxHalfH = 3.0
)

// ChatEntry is one office-chat message kept in memory (and persisted by the caller).
type ChatEntry struct {
	From uint32
	Name string
	Text string
	TS   int64
}

const chatHistory = 100

type UserInfo struct {
	ID     uint32
	Name   string
	Avatar json.RawMessage
	Role   string
	LastX  *float64
	LastY  *float64
}

type posRec struct {
	x, y int16
	d    uint8
}

type group struct {
	id      uint32
	room    string
	isRoom  bool
	area    int
	members []*Player
}

// Player is world-owned state. Fields are only touched from the world goroutine.
type Player struct {
	ID     uint32
	Name   string
	Avatar json.RawMessage
	Role   string
	Status string

	X, Y     float64
	Dx, Dy   int8
	dir      uint8
	run      bool // the player holds the run key (or has "always run" on)
	lastAdv  time.Time
	last     posRec
	ix, iy   float64   // what clients extrapolate to (dead-reckoning shadow)
	sentAt   time.Time // last time a state record was published
	shadowAt time.Time
	area     int
	inGrid   bool
	cx, cy   int
	sx0, sy0 int // subscribed cell rect (inclusive)
	sx1, sy1 int

	// connection
	out       chan []byte
	kick      func(reason KickReason)
	gen       uint64
	gone      time.Time // when the connection dropped (zero = connected)
	pendPos   map[uint32]posRec
	pendLeave map[uint32]struct{}

	// media / proximity
	consent    bool
	group      *group
	leaveSince time.Time
	candKind   uint8 // 0 none, 1 group, 2 partner
	candID     uint32
	candSince  time.Time
	roomIn     time.Time
	roomOut    time.Time

	// input bookkeeping
	chatTokens float64

	// social features
	emoAt     time.Time // last emote (cooldown)
	leadAt    time.Time // last "request to lead"
	knockAt   time.Time // last knock on a door
	follow    uint32    // id of the player being followed (0 = none)
	fpath     []tile    // remaining tiles to the followed player
	fgoal     tile      // tile of the followed player when fpath was computed
	fcalc     time.Time // do not recompute the path before this time
	destOn    bool      // a "walk to" is in progress (guided walk towards dest)
	dest      tile      // target tile of the walk
	destGap   float64   // stop this close to the target (0 = on the tile)
	destID    uint32    // player walked to (0 = a map tile)
	portalOn  int       // tile index of the portal the player last arrived on (-1 = none)
	onSpot    bool      // standing on a spotlight pad
	spotSince time.Time
	board     string    // key of the whiteboard the player has open ("" = none)
	hand      bool      // raised hand
	note      string    // short custom status line, in memory only
	waveAt    time.Time // last wave sent (cooldown)
}

// tile is a map cell coordinate.
type tile struct{ x, y int16 }

func (p *Player) connected() bool { return p.out != nil }

// KickReason says why the server closed a live connection.
type KickReason uint8

const (
	KickReplaced KickReason = iota + 1 // a newer connection of the same user took over
	KickSlow                           // the reliable queue overflowed
	KickEvicted                        // an admin removed the member or changed their role
)
