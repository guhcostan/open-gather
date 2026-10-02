package world

import (
	"math/rand/v2"
	"testing"
)

// The index must agree with a Go map through inserts, growth and resets.
func TestPendIndexAgreesWithAMap(t *testing.T) {
	rng := rand.New(rand.NewPCG(7, 9))
	var idx pendIndex
	var items []pendItem
	ref := map[uint32]int32{}
	for round := 0; round < 200; round++ {
		n := rng.IntN(600)
		for k := 0; k < n; k++ {
			id := uint32(rng.IntN(2000)) + 1
			got := idx.find(items, id)
			want, ok := ref[id]
			if !ok {
				want = -1
			}
			if got != want {
				t.Fatalf("round %d: find(%d) = %d, want %d", round, id, got, want)
			}
			if !ok {
				items = append(items, pendItem{id: id})
				idx.add(items, id, int32(len(items)-1))
				ref[id] = int32(len(items) - 1)
			}
		}
		idx.reset()
		items = items[:0]
		clear(ref)
		for id := uint32(1); id <= 2000; id += 97 {
			if idx.find(items, id) != -1 {
				t.Fatalf("round %d: %d survived a reset", round, id)
			}
		}
	}
}
