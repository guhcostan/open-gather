package media

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// ReconcileRemovals counts participants removed because the app server did not consider them members.
var ReconcileRemovals atomic.Int64

func (c *Client) twirp(ctx context.Context, method, room string, body, out any) error {
	tok, err := c.sign(map[string]any{
		"iss":   c.cfg.Key,
		"nbf":   nowMinus10(),
		"exp":   nowPlus(60),
		"video": map[string]any{"roomAdmin": true, "roomList": true, "room": room},
	})
	if err != nil {
		return err
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.APIURL+"/twirp/livekit.RoomService/"+method, bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= 300 {
		e, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return fmt.Errorf("livekit %s: status %d: %s", method, resp.StatusCode, e)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Reconcile removes from the SFU every participant of a room that starts with prefix and is not
// listed in allowed(). The SFU is listed FIRST and the world snapshot taken AFTER, so a member who
// joined legitimately in between is never removed by mistake. This bounds what a leaked or replayed
// (still unexpired) token can do to one reconcile interval.
func (c *Client) Reconcile(ctx context.Context, prefix string, allowed func(context.Context) (map[string]map[string]bool, error)) (int, error) {
	if !c.Enabled() {
		return 0, nil
	}
	var rooms struct {
		Rooms []struct {
			Name string `json:"name"`
		} `json:"rooms"`
	}
	if err := c.twirp(ctx, "ListRooms", "", map[string]any{}, &rooms); err != nil {
		return 0, err
	}
	type live struct {
		room string
		ids  []string
	}
	var seen []live
	for _, r := range rooms.Rooms {
		if !strings.HasPrefix(r.Name, prefix) {
			continue
		}
		var ps struct {
			Participants []struct {
				Identity string `json:"identity"`
			} `json:"participants"`
		}
		if err := c.twirp(ctx, "ListParticipants", r.Name, map[string]any{"room": r.Name}, &ps); err != nil {
			return 0, err
		}
		l := live{room: r.Name}
		for _, p := range ps.Participants {
			l.ids = append(l.ids, p.Identity)
		}
		seen = append(seen, l)
	}
	if len(seen) == 0 {
		return 0, nil
	}
	ok, err := allowed(ctx)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, l := range seen {
		for _, id := range l.ids {
			if ok[l.room][id] {
				continue
			}
			if err := c.removeParticipant(ctx, l.room, id); err == nil {
				removed++
				ReconcileRemovals.Add(1)
			}
		}
	}
	return removed, nil
}

func nowMinus10() int64     { return time.Now().Add(-10 * time.Second).Unix() }
func nowPlus(sec int) int64 { return time.Now().Add(time.Duration(sec) * time.Second).Unix() }
