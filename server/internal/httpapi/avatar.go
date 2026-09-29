package httpapi

import "encoding/json"

// Avatar options are small integer indexes into palettes/styles defined by the client.
const (
	nSkin  = 6
	nHair  = 6 // styles
	nColor = 8
)

type avatar struct {
	Skin      int `json:"sk"`
	Hair      int `json:"hs"`
	HairColor int `json:"hc"`
	Shirt     int `json:"sh"`
	Pants     int `json:"pa"`
}

func clamp(v, n int) int {
	if v < 0 || v >= n {
		return 0
	}
	return v
}

// NormalizeAvatar never trusts client JSON: it re-serialises a validated struct.
func NormalizeAvatar(raw json.RawMessage) json.RawMessage {
	var a avatar
	_ = json.Unmarshal(raw, &a)
	a = avatar{clamp(a.Skin, nSkin), clamp(a.Hair, nHair), clamp(a.HairColor, nColor), clamp(a.Shirt, nColor), clamp(a.Pants, nColor)}
	b, _ := json.Marshal(a)
	return b
}
