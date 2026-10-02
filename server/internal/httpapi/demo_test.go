package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"tilework/internal/config"
	"tilework/internal/gamemap"
)

func demoRig(t *testing.T) *rig {
	return newRig(t, func(c *config.Config) { c.Env = "production"; c.Demo = true; c.DemoReset = time.Hour })
}

func TestDemoJoinNeedsNoInviteAndNeverGrantsAdmin(t *testing.T) {
	r := demoRig(t)
	first, code := r.join("Visitor", "")
	if code != http.StatusOK {
		t.Fatalf("demo join without invite: %d", code)
	}
	if _, me := first.do("GET", "/api/me", nil); me["role"] != "member" {
		t.Fatalf("the first demo visitor must NOT become admin: %v", me)
	}
	if code, _ := first.do("GET", "/api/admin/members", nil); code != http.StatusForbidden {
		t.Fatalf("demo visitors have no admin API: %d", code)
	}
	_, me := first.do("GET", "/api/me", nil)
	demo, _ := me["demo"].(map[string]any)
	if demo == nil || demo["resetHours"].(float64) != 1 || int64(demo["nextReset"].(float64)) <= time.Now().Unix() {
		t.Fatalf("/api/me announces the demo and its next reset: %v", me["demo"])
	}
	// an admin can still be bootstrapped with an invite
	office, _ := r.st.OfficeBySlug(context.Background(), "default")
	inv, _ := r.st.CreateInvite(context.Background(), office.ID, "admin", 1, time.Hour, 0)
	admin, _ := r.join("Owner", inv)
	if _, me := admin.do("GET", "/api/me", nil); me["role"] != "admin" {
		t.Fatalf("an invite still grants its role in demo mode: %v", me)
	}
}

func TestDemoJoinsAreRateLimitedPerIP(t *testing.T) {
	r := demoRig(t)
	limited := false
	for i := 0; i < 12; i++ {
		if _, code := r.join("V", ""); code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("anonymous demo sign-ups must be rate limited")
	}
}

func TestDemoResetRestoresMapAndWipesChatAndBoards(t *testing.T) {
	r := demoRig(t)
	ctx := context.Background()
	office, _ := r.st.OfficeBySlug(ctx, "default")
	u, _ := r.join("Visitor", "")
	r.st.AppendChat(ctx, office.ID, u.ID, "hello", 1)
	r.st.SaveBoard(ctx, office.ID, "49,15", []byte(`[{"o":1,"i":1,"k":1,"c":0,"w":0,"p":[1,1],"tx":"x"}]`))
	m := gamemap.Default()
	m.Props = m.Props[:3]
	raw, _ := json.Marshal(m)
	r.st.SaveMap(ctx, office.ID, string(raw))

	if err := r.srv.demoReset(ctx); err != nil {
		t.Fatal(err)
	}
	if rows, _ := r.st.RecentChat(ctx, office.ID, 10); len(rows) != 0 {
		t.Fatalf("office chat must be wiped: %v", rows)
	}
	if boards, _ := r.st.LoadBoards(ctx, office.ID); len(boards) != 0 {
		t.Fatalf("whiteboards must be wiped: %v", boards)
	}
	o, _ := r.st.OfficeBySlug(ctx, "default")
	var back gamemap.Map
	json.Unmarshal([]byte(o.MapJSON), &back)
	if len(back.Props) != len(gamemap.Default().Props) {
		t.Fatalf("the starter office map must be restored: %d props", len(back.Props))
	}
	if _, me := u.do("GET", "/api/me", nil); me["authenticated"] != true {
		t.Fatal("members keep their sessions across a demo reset")
	}
}

// A demo that saved an older starter map (another size) picks up the new one when it starts: the
// running world cannot change size, so a scheduled reset alone would fail half-way.
func TestDemoStartupInstallsAResizedStarterMap(t *testing.T) {
	r := demoRig(t)
	ctx := context.Background()
	office, _ := r.st.OfficeBySlug(ctx, "default")
	old := gamemap.Default()
	old.H = 36
	old.Walls = append([]string(nil), old.Walls[:36]...)
	old.Walls[35] = strings.Repeat("#", old.W)
	var areas []gamemap.Area
	for _, a := range old.Areas {
		if a.Y+a.H <= 35 {
			areas = append(areas, a)
		}
	}
	old.Areas = areas
	var props []gamemap.Prop
	for _, p := range old.Props {
		if p.Y < 35 {
			props = append(props, p)
		}
	}
	old.Props = props
	if _, err := gamemap.Compile(old); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(old)
	r.st.SaveMap(ctx, office.ID, string(raw))

	if err := r.srv.demoStartup(ctx); err != nil {
		t.Fatal(err)
	}
	o, _ := r.st.OfficeBySlug(ctx, "default")
	var back gamemap.Map
	json.Unmarshal([]byte(o.MapJSON), &back)
	if back.H != gamemap.Default().H {
		t.Fatalf("the demo must start on the current starter map, got height %d", back.H)
	}
	// a same-size demo keeps its content across restarts
	u, _ := r.join("Visitor", "")
	if err := r.st.AppendChat(ctx, office.ID, u.ID, "kept", 1); err != nil {
		t.Fatal(err)
	}
	if err := r.srv.demoStartup(ctx); err != nil {
		t.Fatal(err)
	}
	if rows, _ := r.st.RecentChat(ctx, office.ID, 10); len(rows) != 1 {
		t.Fatalf("a restart on the current map must not wipe the demo: %v", rows)
	}
}

func TestNonDemoProductionStillRequiresInvites(t *testing.T) {
	r := newRig(t, func(c *config.Config) { c.Env = "production" })
	if _, code := r.join("Nobody", ""); code != http.StatusForbidden {
		t.Fatalf("production without demo needs an invite: %d", code)
	}
	if _, me := (&user{r: r, c: &http.Client{}}).do("GET", "/api/me", nil); me["demo"] != nil {
		t.Fatalf("no demo info outside demo mode: %v", me["demo"])
	}
}
