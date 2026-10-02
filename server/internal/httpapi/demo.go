package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"tilework/internal/gamemap"
)

// demoInfo tells the client whether this is a public demo and when its content is next reset.
func (s *Server) demoInfo() any {
	if !s.cfg.Demo {
		return nil
	}
	return map[string]any{"resetHours": int(s.demoPeriod() / time.Hour), "nextReset": s.nextDemoReset().Unix()}
}

func (s *Server) demoPeriod() time.Duration {
	if s.cfg.DemoReset <= 0 {
		return 6 * time.Hour
	}
	return s.cfg.DemoReset
}

// Resets happen on wall-clock boundaries (every period since the Unix epoch), so every visitor sees
// the same next-reset time and restarts do not postpone it.
func (s *Server) nextDemoReset() time.Time {
	p := s.demoPeriod()
	return time.Now().Truncate(p).Add(p)
}

func (s *Server) demoLoop(ctx context.Context) {
	for {
		t := time.NewTimer(time.Until(s.nextDemoReset()))
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
			if err := s.demoReset(ctx); err != nil {
				s.log.Error("demo reset", "err", err)
			}
		}
	}
}

// demoStartup runs once before the demo serves anybody. When the stored map has another size than
// the current starter map (a deploy changed the starter office), it resets the demo now: the running
// world cannot change size, so the scheduled reset could not install it. Otherwise content is kept.
func (s *Server) demoStartup(ctx context.Context) error {
	office, err := s.st.OfficeBySlug(ctx, s.cfg.OfficeSlug)
	if err != nil {
		return err
	}
	var stored struct{ W, H int }
	def := gamemap.Default()
	if json.Unmarshal([]byte(office.MapJSON), &stored) == nil && stored.W == def.W && stored.H == def.H {
		return nil
	}
	s.log.Info("demo starter map changed size: resetting the demo")
	return s.demoReset(ctx)
}

// demoReset restores the starter office: map, no office chat, no whiteboards. Members are kept.
func (s *Server) demoReset(ctx context.Context) error {
	m := gamemap.Default()
	cm, err := gamemap.Compile(m)
	if err != nil {
		return err
	}
	raw, _ := json.Marshal(m)
	office, err := s.st.OfficeBySlug(ctx, s.cfg.OfficeSlug)
	if err != nil {
		return err
	}
	s.mu.Lock()
	wd := s.worlds[office.ID]
	s.mu.Unlock()
	if wd != nil && !wd.SameSize(cm) { // never leave a half-done reset behind
		return errors.New("the starter map changed size: restart the server to reset the demo")
	}
	if err := s.st.ResetDemoContent(ctx, office.ID, string(raw)); err != nil {
		return err
	}
	if wd != nil {
		rctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if err := wd.ResetContent(rctx, cm); err != nil {
			return err
		}
	}
	if err := s.st.Audit(ctx, office.ID, 0, "demo.reset", 0, "", ""); err != nil {
		s.log.Error("audit", "err", err)
	}
	s.log.Info("demo office reset")
	return nil
}
