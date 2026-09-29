package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"

	"opengather/internal/store"
	"opengather/internal/world"
)

type inMsg struct {
	T     string `json:"t"`
	S     uint32 `json:"s"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
	V     string `json:"v"`
	B     bool   `json:"b"`
	ID    uint32 `json:"id"`
	Scope string `json:"sc"`
	Text  string `json:"text"`
	C     int64  `json:"c"`
}

const maxFrame = 2048

func (s *Server) ws(w http.ResponseWriter, r *http.Request) {
	se, err := s.session(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	office, err := s.st.OfficeBySlug(r.Context(), s.cfg.OfficeSlug)
	if err != nil || office.ID != se.OfficeID {
		// single-office deployment for now: the session must belong to it
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	wd, err := s.worldFor(office)
	if err != nil {
		s.log.Error("world", "err", err)
		http.Error(w, "unavailable", http.StatusInternalServerError)
		return
	}
	opts := &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled}
	if len(s.cfg.AllowedOrigins) > 0 {
		opts.OriginPatterns = s.cfg.AllowedOrigins
	}
	c, err := websocket.Accept(w, r, opts)
	if err != nil {
		return // Accept already replied
	}
	c.SetReadLimit(maxFrame)
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()

	role := se.Role
	conn, err := wd.Join(ctx, world.UserInfo{ID: uint32(se.UserID), Name: se.Name, Avatar: se.Avatar, Role: role,
		LastX: se.LastX, LastY: se.LastY}, func(replaced bool) {
		if replaced {
			c.Close(websocket.StatusCode(4001), "replaced by a newer connection")
		} else {
			c.Close(websocket.StatusCode(4002), "client too slow")
		}
		cancel()
	})
	if err != nil {
		c.Close(websocket.StatusTryAgainLater, "office unavailable")
		return
	}
	defer func() {
		dctx, dc := context.WithTimeout(s.ctx, time.Second)
		conn.Detach(dctx)
		dc()
	}()

	// writer
	go func() {
		defer cancel()
		for {
			select {
			case b, ok := <-conn.Out:
				if !ok {
					c.Close(websocket.StatusTryAgainLater, "closed by server")
					return
				}
				wctx, wc := context.WithTimeout(ctx, 5*time.Second)
				err := c.Write(wctx, websocket.MessageText, b)
				wc()
				if err != nil {
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// keepalive
	go func() {
		t := time.NewTicker(25 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				pctx, pc := context.WithTimeout(ctx, 10*time.Second)
				err := c.Ping(pctx)
				pc()
				if err != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	inputRL := newConnBucket(40, 80)
	ctrlRL := newConnBucket(10, 30)
	chatRL := newConnBucket(3, 8)
	strikes := 0
	var m inMsg
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		now := time.Now()
		m = inMsg{}
		if err := json.Unmarshal(data, &m); err != nil {
			strikes++
			if strikes > 20 {
				c.Close(websocket.StatusPolicyViolation, "invalid messages")
				return
			}
			continue
		}
		rl := ctrlRL
		switch m.T {
		case "in":
			rl = inputRL
		case "chat":
			rl = chatRL
		}
		if !rl.allow(now) {
			strikes++
			if strikes > 200 {
				c.Close(websocket.StatusPolicyViolation, "rate limit")
				return
			}
			continue
		}
		switch m.T {
		case "in":
			if m.X < -1 || m.X > 1 || m.Y < -1 || m.Y > 1 {
				continue
			}
			conn.Input(ctx, m.S, int8(m.X), int8(m.Y))
		case "st":
			conn.SetStatus(ctx, m.V)
		case "consent":
			conn.SetConsent(ctx, m.B)
		case "chat":
			if len(m.Text) > 4*world.DefaultConfig().MaxChatRune {
				continue
			}
			conn.Chat(ctx, m.Scope, m.ID, m.Text)
		case "loc":
			conn.Locate(ctx, m.ID)
		case "sync":
			conn.Sync(ctx)
		case "tok":
			conn.RequestToken(ctx)
		case "ping":
			wctx, wc := context.WithTimeout(ctx, 2*time.Second)
			c.Write(wctx, websocket.MessageText, []byte(`{"t":"pong","c":`+strconv.FormatInt(m.C, 10)+`}`))
			wc()
		}
	}
}

var _ = store.ErrNotFound
