// Package httpapi wires HTTP endpoints, WebSocket sessions, health checks and metrics.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"tilework/internal/config"
	"tilework/internal/gamemap"
	"tilework/internal/media"
	"tilework/internal/store"
	"tilework/internal/world"
)

const cookieName = "tilework_session"

type Server struct {
	cfg   *config.Config
	log   *slog.Logger
	st    *store.Store
	media *media.Client
	ctx   context.Context

	mu     sync.Mutex
	worlds map[int64]*world.World

	posQ    chan posSave
	chatQ   chan chatSave
	boardQ  chan boardSave
	auditQ  chan actionSave
	workers sync.WaitGroup

	inst     string // installation id, namespaces SFU rooms
	joinLim  *limiter
	mapLim   *limiter
	profLim  *limiter
	adminLim *limiter
	annLim   *limiter
	demoLim  *limiter
}

type chatSave struct {
	office, user int64
	text         string
	ts           int64
}

type boardSave struct {
	office int64
	key    string
	data   []byte
}

type actionSave struct {
	office, actor  int64
	action, target string
}

type posSave struct {
	office, user int64
	x, y         float64
}

func New(ctx context.Context, cfg *config.Config, log *slog.Logger, st *store.Store, md *media.Client) *Server {
	s := &Server{cfg: cfg, log: log, st: st, media: md, ctx: ctx, worlds: map[int64]*world.World{},
		posQ: make(chan posSave, 1024), chatQ: make(chan chatSave, 256), boardQ: make(chan boardSave, 64), joinLim: newLimiter(float64(cfg.JoinRate), float64(cfg.JoinRate)*2), mapLim: newLimiter(1, 5), profLim: newLimiter(0.5, 5), adminLim: newLimiter(5, 20), annLim: newLimiter(1.0/15, 2)}
	if id, err := st.InstanceID(ctx); err == nil {
		s.inst = id
	} else {
		log.Error("instance id", "err", err)
	}
	s.auditQ = make(chan actionSave, 128)
	s.demoLim = newLimiter(0.2, 5) // demo: about one new account per 5 s per IP, burst 5
	s.workers.Add(1)
	go func() { defer s.workers.Done(); s.savePositions(ctx) }()
	go s.reconcileMedia(ctx)
	if cfg.Demo {
		if err := s.demoStartup(ctx); err != nil {
			log.Error("demo startup", "err", err)
		}
		go s.demoLoop(ctx)
	}
	return s
}

func (s *Server) savePositions(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case b := <-s.boardQ:
			if err := s.st.SaveBoard(ctx, b.office, b.key, b.data); err != nil {
				s.log.Error("save whiteboard", "err", err) // never log the strokes
			}
		case a := <-s.auditQ:
			if err := s.st.Audit(ctx, a.office, a.actor, a.action, 0, a.target, ""); err != nil {
				s.log.Error("audit action", "err", err)
			}
		case c := <-s.chatQ:
			if err := s.st.AppendChat(ctx, c.office, c.user, c.text, c.ts); err != nil {
				s.log.Error("save chat", "err", err) // never log the message text
			}
		case p := <-s.posQ:
			if err := s.st.SaveLastPos(ctx, p.office, p.user, p.x, p.y); err != nil {
				s.log.Error("save last position", "err", err)
			}
		}
	}
}

// worldFor lazily starts the simulation goroutine for an office.
func (s *Server) worldFor(o *store.Office) (*world.World, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return nil, s.ctx.Err()
	}
	if w, ok := s.worlds[o.ID]; ok {
		return w, nil
	}
	var m gamemap.Map
	if err := json.Unmarshal([]byte(o.MapJSON), &m); err != nil {
		return nil, fmt.Errorf("office %d map: %w", o.ID, err)
	}
	cm, err := gamemap.Compile(&m)
	if err != nil {
		return nil, fmt.Errorf("office %d map: %w", o.ID, err)
	}
	wc := world.DefaultConfig()
	wc.TickHz, wc.AOICells, wc.MaxPlayers = s.cfg.TickHz, s.cfg.AOICells, s.cfg.MaxPlayers
	wc.Prox.MaxGroup = s.cfg.MaxGroup
	w := world.New(wc, o.ID, o.Name, cm, s.media, s.log.With("office", o.ID))
	if s.inst != "" {
		w.RoomPrefix = s.inst + ".o" + strconv.FormatInt(o.ID, 10)
	}
	if rows, err := s.st.RecentChat(s.ctx, o.ID, 100); err == nil {
		h := make([]world.ChatEntry, 0, len(rows))
		for _, r := range rows {
			h = append(h, world.ChatEntry{From: uint32(r.UserID), Name: r.Name, Text: r.Text, TS: r.TS})
		}
		w.SeedChat(h)
	} else {
		s.log.Error("load chat history", "err", err)
	}
	if boards, err := s.st.LoadBoards(s.ctx, o.ID); err == nil {
		w.SeedBoards(boards)
	} else {
		s.log.Error("load whiteboards", "err", err)
	}
	w.OnBoardSave = func(office int64, key string, data []byte, final bool) bool {
		if final { // shutting down: the writer goroutine is gone, write here
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			return s.st.SaveBoard(ctx, office, key, data) == nil
		}
		select {
		case s.boardQ <- boardSave{office, key, data}:
			return true
		default:
			return false // busy: the world keeps the board dirty and tries again
		}
	}
	w.OnChat = func(office int64, from uint32, text string, ts int64) {
		select {
		case s.chatQ <- chatSave{office, int64(from), text, ts}:
		default: // history is best effort; never block the world loop
		}
	}
	w.OnAction = func(office int64, actor uint32, action, target string) {
		select {
		case s.auditQ <- actionSave{office, int64(actor), action, target}:
		default:
			s.log.Error("audit queue full")
		}
	}
	w.OnLeave = func(office int64, user uint32, x, y float64) {
		select {
		case s.posQ <- posSave{office, int64(user), x, y}:
		default:
		}
	}
	s.workers.Add(1)
	go func() { defer s.workers.Done(); w.Run(s.ctx) }()
	s.worlds[o.ID] = w
	return w, nil
}

// Wait waits for world final snapshots after cancellation, before the database is closed or the process exits.
func (s *Server) Wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() { s.workers.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /readyz", s.ready)
	mux.HandleFunc("GET /metrics", s.metrics)
	mux.HandleFunc("POST /api/join", s.join)
	mux.HandleFunc("POST /api/invites", s.createInvite)
	mux.HandleFunc("GET /api/admin/members", s.listMembers)
	mux.HandleFunc("PATCH /api/admin/members/{id}", s.patchMember)
	mux.HandleFunc("DELETE /api/admin/members/{id}", s.deleteMember)
	mux.HandleFunc("GET /api/admin/invites", s.listInvites)
	mux.HandleFunc("DELETE /api/admin/invites/{id}", s.revokeInvite)
	mux.HandleFunc("GET /api/admin/audit", s.listAudit)
	mux.HandleFunc("POST /api/admin/announce", s.announce)
	mux.HandleFunc("GET /api/admin/map", s.getFullMap)
	mux.HandleFunc("PUT /api/map", s.putMap)
	mux.HandleFunc("PUT /api/profile", s.putProfile)
	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("GET /ws", s.ws)
	if s.cfg.StaticDir != "" {
		mux.Handle("/", spa(s.cfg.StaticDir))
	}
	return secureHeaders(mux)
}

func secureHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hd := w.Header()
		hd.Set("X-Content-Type-Options", "nosniff")
		hd.Set("Referrer-Policy", "same-origin")
		hd.Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()")
		h.ServeHTTP(w, r)
	})
}

func spa(dir string) http.Handler {
	fsrv := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if fi, err := os.Stat(p); err != nil || fi.IsDir() {
			if !strings.HasPrefix(r.URL.Path, "/assets/") {
				http.ServeFile(w, r, filepath.Join(dir, "index.html"))
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fsrv.ServeHTTP(w, r)
	})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.st.DB.PingContext(ctx); err != nil {
		http.Error(w, "db unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ready"))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) setCookie(w http.ResponseWriter, tok string) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: tok, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: !s.cfg.Dev(), MaxAge: int(s.cfg.SessionTTL.Seconds())})
}

type joinReq struct {
	Name   string          `json:"name"`
	Avatar json.RawMessage `json:"avatar"`
	Invite string          `json:"invite"`
}

// join creates a member. In production an invite is mandatory; in dev an invite-less join is allowed
// (the first member of an office becomes admin) to keep local development friction-free.
func (s *Server) join(w http.ResponseWriter, r *http.Request) {
	if !s.joinLim.Allow(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var req joinReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	name := store.CleanName(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}
	var o *store.Office
	forced := ""
	var err error
	switch {
	case req.Invite != "":
		inv, ierr := s.st.ConsumeInvite(r.Context(), req.Invite)
		if ierr != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "invite invalid, expired or exhausted"})
			return
		}
		forced = inv.Role
		o, err = s.st.OfficeByID(r.Context(), inv.OfficeID)
	case s.cfg.Demo:
		// Public sandbox: no invite, always a plain member (never the office's first admin), tight per-IP limit.
		if !s.demoLim.Allow(clientIP(r)) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
			return
		}
		forced = "member"
		o, err = s.st.OfficeBySlug(r.Context(), s.cfg.OfficeSlug)
	case s.cfg.Dev():
		o, err = s.st.OfficeBySlug(r.Context(), s.cfg.OfficeSlug)
	default:
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "join requires an invite"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "office unavailable"})
		return
	}
	uid, role, err := s.st.AddMember(r.Context(), o.ID, name, NormalizeAvatar(req.Avatar), forced)
	if err != nil {
		s.log.Error("add member", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	tok, err := s.st.CreateSession(r.Context(), uid, o.ID, s.cfg.SessionTTL)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	s.setCookie(w, tok)
	if req.Invite != "" {
		s.audit(r, &store.Session{UserID: uid, OfficeID: o.ID}, "member.join", uid, name, "role="+role)
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": uid, "name": name, "role": role})
}

func (s *Server) session(r *http.Request) (*store.Session, error) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return nil, store.ErrNotFound
	}
	return s.st.LookupSession(r.Context(), c.Value)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	se, err := s.session(r)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false, "dev": s.cfg.Dev(), "demo": s.demoInfo()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "id": se.UserID, "name": se.Name, "role": se.Role, "avatar": se.Avatar, "dev": s.cfg.Dev(), "demo": s.demoInfo()})
}

var errBadOrigin = errors.New("origin not allowed")

type inviteReq struct {
	Role    string `json:"role"`
	MaxUses int    `json:"maxUses"`
	Hours   int    `json:"hours"`
}

// createInvite lets an office admin mint an invite link with explicit access controls.
func (s *Server) createInvite(w http.ResponseWriter, r *http.Request) {
	se, err := s.session(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if se.Role != "admin" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin only"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var req inviteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.MaxUses == 0 {
		req.MaxUses = 1
	}
	if req.Hours == 0 {
		req.Hours = 24
	}
	tok, err := s.st.CreateInvite(r.Context(), se.OfficeID, req.Role, req.MaxUses, time.Duration(req.Hours)*time.Hour, se.UserID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.log.Info("invite created", "by", se.UserID, "role", req.Role, "uses", req.MaxUses, "hours", req.Hours) // never logs the token
	s.audit(r, se, "invite.create", 0, "", "role="+req.Role+" uses="+strconv.Itoa(req.MaxUses)+" hours="+strconv.Itoa(req.Hours))
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "path": "/?invite=" + tok})
}

// putMap lets an admin replace the office map. The map is validated and compiled server-side
// (never trusted), persisted, then hot-swapped into the running world.
func (s *Server) putMap(w http.ResponseWriter, r *http.Request) {
	se, err := s.session(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if se.Role != "admin" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin only"})
		return
	}
	if !s.mapLim.Allow(strconv.FormatInt(se.UserID, 10)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 512<<10)
	var m gamemap.Map
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid map json"})
		return
	}
	cm, err := gamemap.Compile(&m)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	office, err := s.st.OfficeByID(r.Context(), se.OfficeID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	wd, err := s.worldFor(office)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	if err := wd.ReloadMap(r.Context(), cm); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		return
	}
	raw, _ := json.Marshal(&m)
	rev, err := s.st.SaveMap(r.Context(), office.ID, string(raw))
	if err != nil {
		s.log.Error("save map", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "map applied but not saved"})
		return
	}
	s.log.Info("map updated", "by", se.UserID, "rev", rev, "props", len(m.Props), "areas", len(m.Areas))
	s.audit(r, se, "map.update", 0, "", "rev="+strconv.FormatInt(rev, 10)+" props="+strconv.Itoa(len(m.Props))+" areas="+strconv.Itoa(len(m.Areas)))
	writeJSON(w, http.StatusOK, map[string]any{"rev": rev})
}

// putProfile lets a member change their own display name and avatar.
func (s *Server) putProfile(w http.ResponseWriter, r *http.Request) {
	se, err := s.session(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !s.profLim.Allow(strconv.FormatInt(se.UserID, 10)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limited"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var req joinReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	name := store.CleanName(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}
	av := NormalizeAvatar(req.Avatar)
	if err := s.st.UpdateProfile(r.Context(), se.UserID, name, av); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
		return
	}
	if office, err := s.st.OfficeByID(r.Context(), se.OfficeID); err == nil {
		if wd, err := s.worldFor(office); err == nil {
			wd.UpdateProfile(r.Context(), uint32(se.UserID), name, av)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "avatar": json.RawMessage(av)})
}

// reconcileMedia periodically removes from the SFU anyone the world does not consider a member of that room.
func (s *Server) reconcileMedia(ctx context.Context) {
	if s.media == nil || !s.media.Enabled() {
		return
	}
	t := time.NewTicker(s.cfg.MediaReconcile)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.mu.Lock()
			ws := make(map[int64]*world.World, len(s.worlds))
			for id, w := range s.worlds {
				ws[id] = w
			}
			s.mu.Unlock()
			for id, w := range ws {
				rctx, cancel := context.WithTimeout(ctx, 8*time.Second)
				n, err := s.media.Reconcile(rctx, w.MediaPrefix()+".", w.MediaMembers)
				cancel()
				if err != nil {
					s.log.Warn("media reconcile", "office", id, "err", err)
				} else if n > 0 {
					s.log.Warn("removed unauthorised SFU participants", "office", id, "count", n)
				}
			}
		}
	}
}
