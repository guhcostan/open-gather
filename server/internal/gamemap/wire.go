package gamemap

import "encoding/json"

type wireMap struct {
	*Map
	Solid []string `json:"solid"`
	Tile  int      `json:"tile"`
}

func marshalWire(m *Map, solid []string) []byte {
	b, _ := json.Marshal(wireMap{Map: m, Solid: solid, Tile: TilePx})
	return b
}
