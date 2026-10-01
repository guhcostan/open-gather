package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"opengather/internal/config"
	"opengather/internal/gamemap"
	"opengather/internal/media"
	"opengather/internal/store"
)

type rig struct {
	t   *testing.T
	ts  *httptest.Server
	st  *store.Store
	cfg *config.Config
	srv *Server
}

func newRig(t *testing.T, mutate func(*config.Config)) *rig {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	mj, _ := json.Marshal(gamemap.Default())
	if _, err := st.EnsureOffice(context.Background(), "default", "T", string(mj)); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{Env: "dev", OfficeSlug: "default", OfficeName: "T", SessionTTL: time.Hour, TickHz: 15, AOICells: 2,
		MaxPlayers: 100, MaxGroup: 8, JoinRate: 1000, MediaTTL: 30 * time.Second, MediaReconcile: time.Hour}
	if mutate != nil {
		mutate(cfg)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	srv := New(ctx, cfg, log, st, media.New(media.Config{}, log))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return &rig{t: t, ts: ts, st: st, cfg: cfg, srv: srv}
}

type user struct {
	r  *rig
	c  *http.Client
	ID int64
}

func (r *rig) join(name, invite string) (*user, int) {
	r.t.Helper()
	jar, _ := cookiejar.New(nil)
	u := &user{r: r, c: &http.Client{Jar: jar}}
	body, _ := json.Marshal(map[string]any{"name": name, "invite": invite})
	resp, err := u.c.Post(r.ts.URL+"/api/join", "application/json", bytes.NewReader(body))
	if err != nil {
		r.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	u.ID = out.ID
	return u, resp.StatusCode
}

func (u *user) do(method, path string, body any) (int, map[string]any) {
	u.r.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, u.r.ts.URL+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := u.c.Do(req)
	if err != nil {
		u.r.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestAdminEndpointsRequireTheAdminRole(t *testing.T) {
	r := newRig(t, nil)
	admin, _ := r.join("Ana", "")
	member, _ := r.join("Bia", "")
	anon := &user{r: r, c: &http.Client{}}
	for _, ep := range [][2]string{{"GET", "/api/admin/members"}, {"GET", "/api/admin/invites"}, {"GET", "/api/admin/audit"},
		{"PATCH", "/api/admin/members/1"}, {"DELETE", "/api/admin/members/2"}, {"DELETE", "/api/admin/invites/1"}} {
		if code, _ := anon.do(ep[0], ep[1], map[string]string{"role": "member"}); code != http.StatusUnauthorized {
			t.Errorf("anonymous %v: %d", ep, code)
		}
		if code, _ := member.do(ep[0], ep[1], map[string]string{"role": "admin"}); code != http.StatusForbidden {
			t.Errorf("member %v: %d", ep, code)
		}
	}
	if code, out := admin.do("GET", "/api/admin/members", nil); code != 200 || len(out["members"].([]any)) != 2 {
		t.Fatalf("admin list: %d %v", code, out)
	}
	// a member trying to promote themselves must not work
	if code, _ := member.do("PATCH", "/api/admin/members/"+strconv.FormatInt(member.ID, 10), map[string]string{"role": "admin"}); code != http.StatusForbidden {
		t.Fatalf("self-promotion: %d", code)
	}
}

func TestRoleChangeRemovalAndTheLastAdminGuard(t *testing.T) {
	r := newRig(t, nil)
	admin, _ := r.join("Ana", "")
	member, _ := r.join("Bia", "")
	aid, bid := strconv.FormatInt(admin.ID, 10), strconv.FormatInt(member.ID, 10)

	if code, out := admin.do("PATCH", "/api/admin/members/"+aid, map[string]string{"role": "member"}); code != http.StatusConflict {
		t.Fatalf("the only admin cannot demote themselves: %d %v", code, out)
	}
	if code, _ := admin.do("PATCH", "/api/admin/members/"+bid, map[string]string{"role": "owner"}); code != http.StatusConflict {
		t.Fatalf("invalid role: %d", code)
	}
	if code, _ := admin.do("PATCH", "/api/admin/members/999", map[string]string{"role": "admin"}); code != http.StatusNotFound {
		t.Fatalf("unknown member: %d", code)
	}
	if code, _ := admin.do("PATCH", "/api/admin/members/"+bid, map[string]string{"role": "admin"}); code != 200 {
		t.Fatalf("promote: %d", code)
	}
	if _, me := member.do("GET", "/api/me", nil); me["role"] != "admin" {
		t.Fatalf("the new role applies to the existing session: %v", me)
	}
	if code, _ := admin.do("DELETE", "/api/admin/members/"+aid, nil); code != http.StatusConflict {
		t.Fatalf("nobody removes themselves: %d", code)
	}
	if code, _ := admin.do("DELETE", "/api/admin/members/"+bid, nil); code != 200 {
		t.Fatalf("remove: %d", code)
	}
	if _, me := member.do("GET", "/api/me", nil); me["authenticated"] != false {
		t.Fatalf("a removed member's session must stop working: %v", me)
	}
	if code, _ := admin.do("DELETE", "/api/admin/members/"+bid, nil); code != http.StatusNotFound {
		t.Fatalf("already removed: %d", code)
	}

	_, out := admin.do("GET", "/api/admin/audit", nil)
	var actions []string
	for _, e := range out["entries"].([]any) {
		actions = append(actions, e.(map[string]any)["action"].(string))
	}
	if len(actions) != 2 || actions[0] != "member.remove" || actions[1] != "member.role" {
		t.Fatalf("audit trail: %v", actions)
	}
}

func TestInviteLifecycleThroughTheAPI(t *testing.T) {
	r := newRig(t, func(c *config.Config) { c.Env = "production" })
	// production: no join without an invite; the first admin comes from the CLI-style store call
	if _, code := r.join("Nobody", ""); code != http.StatusForbidden {
		t.Fatalf("join without invite in production: %d", code)
	}
	office, _ := r.st.OfficeBySlug(context.Background(), "default")
	first, _ := r.st.CreateInvite(context.Background(), office.ID, "admin", 1, time.Hour, 0)
	admin, code := r.join("Ana", first)
	if code != 200 {
		t.Fatalf("first admin: %d", code)
	}
	_, made := admin.do("POST", "/api/invites", map[string]any{"role": "member", "maxUses": 3, "hours": 2})
	tok, _ := made["token"].(string)
	if tok == "" {
		t.Fatalf("invite: %v", made)
	}
	_, out := admin.do("GET", "/api/admin/invites", nil)
	list := out["invites"].([]any)
	if len(list) != 2 {
		t.Fatalf("invites: %v", list)
	}
	newest := list[0].(map[string]any)
	if newest["status"] != "active" || newest["role"] != "member" || newest["maxUses"].(float64) != 3 {
		t.Fatalf("newest invite: %v", newest)
	}
	if b, _ := json.Marshal(out); bytes.Contains(b, []byte(tok)) {
		t.Fatal("the invite secret must never be listed")
	}
	if _, code := r.join("Bia", tok); code != 200 {
		t.Fatalf("join with invite: %d", code)
	}
	id := strconv.FormatInt(int64(newest["id"].(float64)), 10)
	if code, _ := admin.do("DELETE", "/api/admin/invites/"+id, nil); code != 200 {
		t.Fatalf("revoke: %d", code)
	}
	if _, code := r.join("Cid", tok); code != http.StatusForbidden {
		t.Fatalf("a revoked invite must not work: %d", code)
	}
	if code, _ := admin.do("DELETE", "/api/admin/invites/9999", nil); code != http.StatusNotFound {
		t.Fatalf("unknown invite: %d", code)
	}
	_, a := admin.do("GET", "/api/admin/audit", nil)
	seen := map[string]bool{}
	for _, e := range a["entries"].([]any) {
		seen[e.(map[string]any)["action"].(string)] = true
	}
	for _, want := range []string{"invite.create", "invite.revoke", "member.join"} {
		if !seen[want] {
			t.Errorf("audit misses %s: %v", want, seen)
		}
	}
}

func TestMetricsPolicy(t *testing.T) {
	get := func(r *rig, auth string) int {
		req, _ := http.NewRequest("GET", r.ts.URL+"/metrics", nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	dev := newRig(t, nil)
	if get(dev, "") != 200 {
		t.Fatal("dev without a token leaves /metrics open")
	}
	prod := newRig(t, func(c *config.Config) { c.Env = "production" })
	if get(prod, "") != 404 || get(prod, "Bearer x") != 404 {
		t.Fatal("production without a token disables /metrics")
	}
	tok := newRig(t, func(c *config.Config) { c.Env = "production"; c.MetricsToken = "0123456789abcdef" })
	if get(tok, "") != 401 || get(tok, "Bearer wrong") != 401 || get(tok, "Bearer 0123456789abcdeg") != 401 {
		t.Fatal("a wrong or missing token must be refused")
	}
	if get(tok, "Bearer 0123456789abcdef") != 200 {
		t.Fatal("the right token must work")
	}
}
