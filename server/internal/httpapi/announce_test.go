package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestAnnouncementsAreAdminOnlyAuditedWithoutTextAndRateLimited(t *testing.T) {
	r := newRig(t, nil)
	admin, _ := r.join("Ana", "")
	member, _ := r.join("Bia", "")
	anon := &user{r: r, c: &http.Client{}}
	msg := map[string]string{"text": "Pizza in the kitchen at noon"}
	if code, _ := anon.do("POST", "/api/admin/announce", msg); code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", code)
	}
	if code, _ := member.do("POST", "/api/admin/announce", msg); code != http.StatusForbidden {
		t.Fatalf("member: %d", code)
	}
	if code, _ := admin.do("POST", "/api/admin/announce", map[string]string{"text": "   "}); code != http.StatusBadRequest {
		t.Fatalf("empty: %d", code)
	}
	if code, _ := admin.do("POST", "/api/admin/announce", map[string]string{"text": strings.Repeat("a", 281)}); code != http.StatusBadRequest {
		t.Fatalf("too long: %d", code)
	}
	if code, _ := admin.do("POST", "/api/admin/announce", msg); code != http.StatusNoContent {
		t.Fatalf("admin: %d", code)
	}
	_, out := admin.do("GET", "/api/admin/audit", nil)
	b, _ := json.Marshal(out)
	if !strings.Contains(string(b), `"action":"announce"`) {
		t.Fatalf("the announcement is audited: %s", b)
	}
	if strings.Contains(string(b), "Pizza") {
		t.Fatal("audit rows never contain message text")
	}
	admin.do("POST", "/api/admin/announce", msg)
	if code, _ := admin.do("POST", "/api/admin/announce", msg); code != http.StatusTooManyRequests {
		t.Fatalf("announcements are rate limited: %d", code)
	}
}
