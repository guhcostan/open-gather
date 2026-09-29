// Package gamemap defines the office map format, validation and the compiled
// collision/area grids shared by the authoritative server. The client receives
// the same JSON and renders/predicts from it.
package gamemap

import (
	"errors"
	"fmt"
	"strings"
)

const (
	TilePx        = 16
	MaxW          = 200
	MaxH          = 200
	MaxProps      = 4000
	MaxAreas      = 64
	AccessOpen    = "open"
	AccessMembers = "members"
	AccessAdmins  = "admins"
	AccessList    = "list"
	KindRoom      = "room"
)

type Access struct {
	Mode  string  `json:"mode"`
	Users []int64 `json:"users,omitempty"`
}

type Area struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"` // reception|desks|social|room|zone
	X        int    `json:"x"`
	Y        int    `json:"y"`
	W        int    `json:"w"`
	H        int    `json:"h"`
	Floor    string `json:"floor"`
	Access   Access `json:"access"`
	Capacity int    `json:"capacity,omitempty"`
}

type Prop struct {
	T      string `json:"t"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	W      int    `json:"w,omitempty"`
	H      int    `json:"h,omitempty"`
	Assign int64  `json:"assign,omitempty"` // desk owner (user id)
	Label  string `json:"label,omitempty"`
}

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// Map is the persisted/editable description of an office.
type Map struct {
	Version int      `json:"version"`
	W       int      `json:"w"`
	H       int      `json:"h"`
	Walls   []string `json:"walls"` // H rows of W chars; '#' = wall
	Props   []Prop   `json:"props"`
	Areas   []Area   `json:"areas"`
	Spawn   Point    `json:"spawn"`
}

// propDefaults: footprint and whether it blocks movement.
var propDefaults = map[string]struct {
	W, H  int
	Solid bool
}{
	"desk":           {2, 1, true},
	"chair":          {1, 1, false},
	"plant":          {1, 1, true},
	"couch":          {3, 1, true},
	"table":          {3, 2, true},
	"reception_desk": {6, 1, true},
	"bookshelf":      {2, 1, true},
	"coffee":         {1, 1, true},
	"whiteboard":     {3, 1, false},
	"rug":            {4, 3, false},
	"lamp":           {1, 1, true},
}

func (p Prop) Size() (int, int) {
	d := propDefaults[p.T]
	w, h := p.W, p.H
	if w <= 0 {
		w = d.W
	}
	if h <= 0 {
		h = d.H
	}
	return w, h
}

// Compiled is the read-only runtime form used by the world simulation.
type Compiled struct {
	Map    *Map
	W, H   int
	Solid  []bool  // W*H, walls + solid props
	AreaAt []int16 // W*H, index into Map.Areas or -1
	JSON   []byte  // wire form sent to clients (Map plus computed solid rows)
}

func (c *Compiled) IsSolidTile(tx, ty int) bool {
	if tx < 0 || ty < 0 || tx >= c.W || ty >= c.H {
		return true
	}
	return c.Solid[ty*c.W+tx]
}

func (c *Compiled) AreaIndexAt(tx, ty int) int {
	if tx < 0 || ty < 0 || tx >= c.W || ty >= c.H {
		return -1
	}
	return int(c.AreaAt[ty*c.W+tx])
}

// Validate checks limits and structure. It never trusts client-provided maps.
func Validate(m *Map) error {
	if m.W < 8 || m.H < 8 || m.W > MaxW || m.H > MaxH {
		return fmt.Errorf("invalid map size %dx%d", m.W, m.H)
	}
	if len(m.Walls) != m.H {
		return errors.New("walls: wrong row count")
	}
	for i, r := range m.Walls {
		if len(r) != m.W {
			return fmt.Errorf("walls: row %d has wrong length", i)
		}
		if strings.Trim(r, "#.") != "" {
			return fmt.Errorf("walls: row %d has invalid characters", i)
		}
	}
	if len(m.Props) > MaxProps {
		return errors.New("too many props")
	}
	for i, p := range m.Props {
		if _, ok := propDefaults[p.T]; !ok {
			return fmt.Errorf("prop %d: unknown type %q", i, p.T)
		}
		w, h := p.Size()
		if w > 32 || h > 32 || p.X < 0 || p.Y < 0 || p.X+w > m.W || p.Y+h > m.H {
			return fmt.Errorf("prop %d out of bounds", i)
		}
		if len(p.Label) > 40 {
			return fmt.Errorf("prop %d: label too long", i)
		}
	}
	if len(m.Areas) > MaxAreas {
		return errors.New("too many areas")
	}
	seen := map[string]bool{}
	for i, a := range m.Areas {
		if a.ID == "" || len(a.ID) > 32 || seen[a.ID] {
			return fmt.Errorf("area %d: invalid or duplicate id", i)
		}
		seen[a.ID] = true
		if len(a.Name) > 60 {
			return fmt.Errorf("area %d: name too long", i)
		}
		if a.W <= 0 || a.H <= 0 || a.X < 0 || a.Y < 0 || a.X+a.W > m.W || a.Y+a.H > m.H {
			return fmt.Errorf("area %d out of bounds", i)
		}
		switch a.Access.Mode {
		case "", AccessOpen, AccessMembers, AccessAdmins, AccessList:
		default:
			return fmt.Errorf("area %d: invalid access mode", i)
		}
		if len(a.Access.Users) > 500 {
			return fmt.Errorf("area %d: access list too large", i)
		}
	}
	if m.Spawn.X < 0 || m.Spawn.Y < 0 || m.Spawn.X >= m.W || m.Spawn.Y >= m.H {
		return errors.New("spawn out of bounds")
	}
	return nil
}

// Compile validates and builds the runtime grids.
func Compile(m *Map) (*Compiled, error) {
	if err := Validate(m); err != nil {
		return nil, err
	}
	c := &Compiled{Map: m, W: m.W, H: m.H, Solid: make([]bool, m.W*m.H), AreaAt: make([]int16, m.W*m.H)}
	for y, row := range m.Walls {
		for x := 0; x < m.W; x++ {
			if row[x] == '#' {
				c.Solid[y*m.W+x] = true
			}
		}
	}
	for _, p := range m.Props {
		if !propDefaults[p.T].Solid {
			continue
		}
		w, h := p.Size()
		for y := p.Y; y < p.Y+h; y++ {
			for x := p.X; x < p.X+w; x++ {
				c.Solid[y*m.W+x] = true
			}
		}
	}
	for i := range c.AreaAt {
		c.AreaAt[i] = -1
	}
	// Non-room areas first so rooms take precedence where they overlap.
	for pass := 0; pass < 2; pass++ {
		for i, a := range m.Areas {
			if (a.Kind == KindRoom) != (pass == 1) {
				continue
			}
			for y := a.Y; y < a.Y+a.H; y++ {
				for x := a.X; x < a.X+a.W; x++ {
					c.AreaAt[y*m.W+x] = int16(i)
				}
			}
		}
	}
	if c.Solid[m.Spawn.Y*m.W+m.Spawn.X] {
		return nil, errors.New("spawn is inside a solid tile")
	}
	c.JSON = encodeWire(c)
	return c, nil
}

func encodeWire(c *Compiled) []byte {
	rows := make([]string, c.H)
	for y := 0; y < c.H; y++ {
		b := make([]byte, c.W)
		for x := 0; x < c.W; x++ {
			if c.Solid[y*c.W+x] {
				b[x] = '1'
			} else {
				b[x] = '0'
			}
		}
		rows[y] = string(b)
	}
	return marshalWire(c.Map, rows)
}
