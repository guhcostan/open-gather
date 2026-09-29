package gamemap

import "encoding/json"

type wireMap struct {
	*Map
	Solid []string `json:"solid"`
	Tile  int      `json:"tile"`
}

// marshalWire encodes the map for clients. The content of interactive objects (Prop.Data) is left
// out: it is delivered on demand to players standing next to the object.
func marshalWire(m *Map, solid []string) []byte {
	cp := *m
	cp.Props = make([]Prop, len(m.Props))
	for i, p := range m.Props {
		if p.IsContent() {
			p.Data = ""
		}
		cp.Props[i] = p
	}
	b, _ := json.Marshal(wireMap{Map: &cp, Solid: solid, Tile: TilePx})
	return b
}
