package world

import (
	"math/rand/v2"
	"testing"
	"time"

	"tilework/internal/gamemap"
)

// BenchmarkTick measures one world tick (simulation, interest management and encoding of every
// client's frame) with n connected players, a third of them changing direction every tick:
// far busier than people really are, so it shows the cost of the hot path, not a capacity.
// Concentrated puts everybody in the 17x13-tile reception, the worst case for fan-out.
func BenchmarkTick(b *testing.B) {
	for _, c := range []struct {
		name         string
		n            int
		x0, y0, w, h int
	}{
		{"300-concentrated", 300, 2, 1, 17, 13},
		{"300-distributed", 300, 1, 1, 70, 40},
	} {
		b.Run(c.name, func(b *testing.B) {
			h := newHarness(b)
			rng := rand.New(rand.NewPCG(1, 2))
			var ps []*Player
			for id := uint32(1); len(ps) < c.n; {
				tx, ty := c.x0+rng.IntN(c.w), c.y0+rng.IntN(c.h)
				if tx >= h.w.m.Map.W || ty >= h.w.m.Map.H || h.w.m.IsSolidTile(tx, ty) {
					continue
				}
				if ai := h.w.m.AreaIndexAt(tx, ty); ai >= 0 && !h.w.canEnterArea(&Player{Role: "member", area: -1}, ai) {
					continue
				}
				ps = append(ps, h.add(id, "member", float64(tx*gamemap.TilePx+8), float64(ty*gamemap.TilePx+8)))
				id++
			}
			step := time.Second / time.Duration(h.w.cfg.TickHz)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				for j := i % 3; j < len(ps); j += 3 {
					h.send(ps[j], ev{kind: evInput, seq: uint32(i), dx: int8(rng.IntN(3) - 1), dy: int8(rng.IntN(3) - 1)})
				}
				h.now = h.now.Add(step)
				h.w.tick(h.now)
				for _, p := range ps {
					for len(p.out) > 0 {
						<-p.out
					}
				}
			}
		})
	}
}
