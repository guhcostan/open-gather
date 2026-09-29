package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"opengather/internal/config"
	"opengather/internal/gamemap"
	"opengather/internal/httpapi"
	"opengather/internal/media"
	"opengather/internal/store"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe /healthz on OG_ADDR and exit (for container health checks)")
	inviteRole := flag.String("invite", "", "print a new invite link path for this role (admin|member) and exit; use it to bootstrap the first admin")
	inviteUses := flag.Int("invite-uses", 1, "max uses of the invite created with -invite")
	inviteHours := flag.Int("invite-hours", 24, "validity in hours of the invite created with -invite")
	backup := flag.String("backup", "", "write a consistent online backup of the SQLite database to this path and exit")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(2)
	}
	if *healthcheck {
		os.Exit(probe(cfg.Addr))
	}
	if *backup != "" {
		os.Exit(runBackup(cfg.DBPath, *backup))
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o750); err != nil {
		log.Error("data dir", "err", err)
		os.Exit(1)
	}
	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Error("open store", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	def, _ := json.Marshal(gamemap.Default())
	office, err := st.EnsureOffice(context.Background(), cfg.OfficeSlug, cfg.OfficeName, string(def))
	if err != nil {
		log.Error("ensure office", "err", err)
		os.Exit(1)
	}

	if *inviteRole != "" {
		tok, err := st.CreateInvite(context.Background(), office.ID, *inviteRole, *inviteUses, time.Duration(*inviteHours)*time.Hour, 0)
		if err != nil {
			fmt.Fprintln(os.Stderr, "invite:", err)
			os.Exit(1)
		}
		fmt.Println("/?invite=" + tok)
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	md := media.New(media.Config{PublicURL: cfg.LiveKitURL, APIURL: cfg.LiveKitAPIURL, Key: cfg.LiveKitKey, Secret: cfg.LiveKitSecret, TokenTTL: cfg.MediaTTL}, log)
	go md.Run(ctx)
	if !md.Enabled() {
		log.Warn("LiveKit not configured: audio/video disabled (conversations still form, without media)")
	}

	srv := httpapi.New(ctx, cfg, log, st, md)
	hs := &http.Server{Addr: cfg.Addr, Handler: srv.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		hs.Shutdown(sctx)
	}()
	log.Info("listening", "addr", cfg.Addr, "env", cfg.Env, "office", office.Slug, "media", md.Enabled())
	if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server", "err", err)
		os.Exit(1)
	}
}

func probe(addr string) int {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 2
	}
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + port + "/readyz")
	if err != nil || resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

// runBackup uses VACUUM INTO: a transactionally consistent copy that is safe while the server is running.
func runBackup(dbPath, dest string) int {
	if _, err := os.Stat(dest); err == nil {
		fmt.Fprintln(os.Stderr, "destination already exists:", dest)
		return 2
	}
	st, err := store.Open(dbPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "open:", err)
		return 1
	}
	defer st.Close()
	if err := st.BackupTo(context.Background(), dest); err != nil {
		fmt.Fprintln(os.Stderr, "backup:", err)
		return 1
	}
	fmt.Println("backup written to", dest)
	return 0
}
