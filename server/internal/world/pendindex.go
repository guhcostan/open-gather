package world

// pendIndex maps an entity ID to its item in a client's pending list. It is an open-addressing
// table over a slice: lookups and inserts cost a hash and a probe or two, with no allocation
// once warm, and a reset clears only the slots used since the last one. It is on the hottest
// path of the tick (every state record fanned out to every observer goes through it); a Go map
// spent a third of the tick there. Only a full reset removes keys, so no tombstones are needed.
type pendIndex struct {
	slots []int32 // 0 = empty, otherwise item index + 1
	used  []int32 // slots set since the last reset
}

func (t *pendIndex) slot(id uint32) uint32 {
	return (id * 2654435761) & uint32(len(t.slots)-1) // Knuth's multiplicative hash
}

// find returns the item index of id, or -1.
func (t *pendIndex) find(items []pendItem, id uint32) int32 {
	if len(t.slots) == 0 {
		return -1
	}
	mask := uint32(len(t.slots) - 1)
	for s := t.slot(id); ; s = (s + 1) & mask {
		v := t.slots[s]
		if v == 0 {
			return -1
		}
		if items[v-1].id == id {
			return v - 1
		}
	}
}

// add records that items[i] belongs to id (which must not be present). The table stays at most
// half full, so probes stay short.
func (t *pendIndex) add(items []pendItem, id uint32, i int32) {
	if 2*(len(t.used)+1) > len(t.slots) {
		t.grow(items)
	}
	mask := uint32(len(t.slots) - 1)
	s := t.slot(id)
	for t.slots[s] != 0 {
		s = (s + 1) & mask
	}
	t.slots[s] = i + 1
	t.used = append(t.used, int32(s))
}

func (t *pendIndex) grow(items []pendItem) {
	n := 64
	for n < 4*(len(t.used)+1) {
		n *= 2
	}
	n0 := len(t.used) // items[:n0] are indexed; the caller is adding the next one
	t.slots = make([]int32, n)
	t.used = make([]int32, 0, n/2)
	mask := uint32(n - 1)
	for i := range items[:n0] {
		s := t.slot(items[i].id)
		for t.slots[s] != 0 {
			s = (s + 1) & mask
		}
		t.slots[s] = int32(i) + 1
		t.used = append(t.used, int32(s))
	}
}

func (t *pendIndex) reset() {
	for _, s := range t.used {
		t.slots[s] = 0
	}
	t.used = t.used[:0]
}
