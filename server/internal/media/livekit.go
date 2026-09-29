// Package media isolates everything that talks to the LiveKit SFU: short-lived
// scoped access tokens (HS256 JWT, LiveKit access-token format) and the
// server-side revocation API (Twirp RoomService over HTTP/JSON).
// The application never handles RTP: the SFU does. Keeping this tiny avoids
// pulling the whole LiveKit SDK into the game server binary.
package media

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"
)

type Config struct {
	PublicURL string // ws(s):// URL that browsers use to reach LiveKit
	APIURL    string // http(s):// URL the app server uses for admin calls
	Key       string
	Secret    string
	TokenTTL  time.Duration // validity of a join token (connection window)
}

// Grants describes what a participant may do in exactly one room.
type Grants struct {
	Room       string
	Identity   string
	Name       string
	CanPublish bool
}

type revokeJob struct {
	room, identity string
	attempt        int
}

type Client struct {
	cfg          Config
	http         *http.Client
	queue        chan revokeJob
	log          *slog.Logger
	Issued       atomic.Int64
	Revoked      atomic.Int64
	RevokeErrors atomic.Int64
}

func New(cfg Config, log *slog.Logger) *Client {
	if cfg.TokenTTL <= 0 {
		cfg.TokenTTL = 5 * time.Minute
	}
	return &Client{cfg: cfg, http: &http.Client{Timeout: 5 * time.Second}, queue: make(chan revokeJob, 4096), log: log}
}

func (c *Client) Enabled() bool {
	return c != nil && c.cfg.Key != "" && c.cfg.Secret != "" && c.cfg.PublicURL != ""
}
func (c *Client) PublicURL() string { return c.cfg.PublicURL }

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (c *Client) sign(claims map[string]any) (string, error) {
	hdr := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	pl, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	unsigned := hdr + "." + b64(pl)
	m := hmac.New(sha256.New, []byte(c.cfg.Secret))
	m.Write([]byte(unsigned))
	return unsigned + "." + b64(m.Sum(nil)), nil
}

// Token returns a join token scoped to one room and one identity, valid for a
// few minutes (only the connection window; revocation happens server side).
func (c *Client) Token(g Grants) (string, error) {
	if !c.Enabled() {
		return "", errors.New("media disabled")
	}
	now := time.Now()
	video := map[string]any{
		"room":           g.Room,
		"roomJoin":       true,
		"canSubscribe":   true,
		"canPublish":     g.CanPublish,
		"canPublishData": false,
	}
	if g.CanPublish {
		video["canPublishSources"] = []string{"microphone", "camera", "screen_share", "screen_share_audio"}
	}
	t, err := c.sign(map[string]any{
		"iss":   c.cfg.Key,
		"sub":   g.Identity,
		"name":  g.Name,
		"nbf":   now.Add(-10 * time.Second).Unix(),
		"exp":   now.Add(c.cfg.TokenTTL).Unix(),
		"video": video,
	})
	if err == nil {
		c.Issued.Add(1)
	}
	return t, err
}

func (c *Client) adminToken(room string) (string, error) {
	now := time.Now()
	return c.sign(map[string]any{
		"iss":   c.cfg.Key,
		"nbf":   now.Add(-10 * time.Second).Unix(),
		"exp":   now.Add(time.Minute).Unix(),
		"video": map[string]any{"roomAdmin": true, "room": room},
	})
}

// Revoke asks the SFU to disconnect the identity from the room. It is
// asynchronous, bounded and retried; it never blocks the world loop.
func (c *Client) Revoke(room, identity string) {
	if !c.Enabled() {
		return
	}
	select {
	case c.queue <- revokeJob{room: room, identity: identity}:
	default:
		c.RevokeErrors.Add(1)
		c.log.Error("media revoke queue full", "room", room)
	}
}

// Run drains the revocation queue until ctx is cancelled.
func (c *Client) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case j := <-c.queue:
			if err := c.removeParticipant(ctx, j.room, j.identity); err != nil {
				j.attempt++
				if j.attempt < 5 {
					go func(j revokeJob) {
						select {
						case <-time.After(time.Duration(j.attempt) * 500 * time.Millisecond):
							select {
							case c.queue <- j:
							default:
							}
						case <-ctx.Done():
						}
					}(j)
				} else {
					c.RevokeErrors.Add(1)
					c.log.Error("media revoke failed", "room", j.room, "err", err)
				}
			} else {
				c.Revoked.Add(1)
			}
		}
	}
}

func (c *Client) removeParticipant(ctx context.Context, room, identity string) error {
	tok, err := c.adminToken(room)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]string{"room": room, "identity": identity})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.APIURL+"/twirp/livekit.RoomService/RemoveParticipant", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil // room or participant already gone: revoked
	}
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		// twirp "not_found" arrives as 404; anything else is a real error
		return fmt.Errorf("livekit status %d: %s", resp.StatusCode, b)
	}
	return nil
}
