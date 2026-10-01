package httpapi

import "testing"

func TestNormalizeAvatarKeepsValidPetsAndDropsUnknownFields(t *testing.T) {
	cases := []struct{ in, want string }{
		{`{"sk":1,"hs":2,"hc":3,"sh":4,"pa":5,"pt":3}`, `{"sk":1,"hs":2,"hc":3,"sh":4,"pa":5,"pt":3}`},
		{`{"sk":1,"pt":99}`, `{"sk":1,"hs":0,"hc":0,"sh":0,"pa":0,"pt":0}`},
		{`{"pt":-1,"evil":"<script>"}`, `{"sk":0,"hs":0,"hc":0,"sh":0,"pa":0,"pt":0}`},
		{`not json`, `{"sk":0,"hs":0,"hc":0,"sh":0,"pa":0,"pt":0}`},
		{`{"pt":8}`, `{"sk":0,"hs":0,"hc":0,"sh":0,"pa":0,"pt":8}`},
	}
	for _, c := range cases {
		if got := string(NormalizeAvatar([]byte(c.in))); got != c.want {
			t.Errorf("NormalizeAvatar(%s) = %s, want %s", c.in, got, c.want)
		}
	}
}
