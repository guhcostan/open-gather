package gamemap

import "testing"

// Every private office of the starter map must be reachable on foot from the spawn point.
func TestEveryStarterOfficeIsReachable(t *testing.T) {
	cm, err := Compile(Default())
	if err != nil {
		t.Fatal(err)
	}
	m := cm.Map
	seen := make([]bool, m.W*m.H)
	q := [][2]int{{m.Spawn.X, m.Spawn.Y}}
	seen[m.Spawn.Y*m.W+m.Spawn.X] = true
	for len(q) > 0 {
		c := q[0]
		q = q[1:]
		for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			x, y := c[0]+d[0], c[1]+d[1]
			if x < 0 || y < 0 || x >= m.W || y >= m.H || seen[y*m.W+x] || m.Walls[y][x] == '#' {
				continue
			}
			seen[y*m.W+x] = true
			q = append(q, [2]int{x, y})
		}
	}
	offices := 0
	for _, a := range m.Areas {
		if a.Access.Mode != AccessOffice {
			continue
		}
		offices++
		ok := false
		for y := a.Y; y < a.Y+a.H && !ok; y++ {
			for x := a.X; x < a.X+a.W && !ok; x++ {
				ok = seen[y*m.W+x]
			}
		}
		if !ok {
			t.Errorf("%s cannot be reached from the spawn point", a.ID)
		}
	}
	if offices != 6 {
		t.Fatalf("expected six offices, got %d", offices)
	}
}
