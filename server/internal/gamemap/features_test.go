package gamemap

import (
	"strings"
	"testing"
)

func TestInteractiveContentAndPortalValidation(t *testing.T) {
	for _, u := range []string{"javascript:alert(1)", "http://example.com", "https://u:p@example.com", "https://", "https://example.com/a b"} {
		if ValidHTTPS(u) {
			t.Errorf("unsafe URL accepted: %q", u)
		}
	}
	m := Default()
	c, err := Compile(m)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(c.JSON), "Welcome to Open Gather!") || strings.Contains(string(c.JSON), "https://example.com/") {
		t.Fatal("object content is not in the public map")
	}
	m.Props = append(m.Props, Prop{T: PropPortal, X: 5, Y: 9, To: &Point{X: 0, Y: 0}})
	if _, err := Compile(m); err == nil {
		t.Fatal("portal into a wall must fail")
	}
}
