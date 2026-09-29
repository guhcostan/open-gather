// Package config loads runtime configuration from environment variables.
// OG_ENV=dev enables developer conveniences; OG_ENV=production refuses to
// start with insecure defaults.
package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env            string // dev | production
	Addr           string
	DBPath         string
	StaticDir      string
	AllowedOrigins []string
	OfficeSlug     string
	OfficeName     string
	SessionTTL     time.Duration

	LiveKitURL    string // public ws(s) URL used by browsers
	LiveKitAPIURL string // http(s) URL used by this server for admin calls
	LiveKitKey    string
	LiveKitSecret string

	TickHz         int
	AOICells       int
	MaxPlayers     int
	MaxGroup       int
	MediaTTL       time.Duration // validity of a media join token
	MediaReconcile time.Duration // how often SFU rooms are compared with the world's membership
	JoinRate       int           // dev /api/join requests per second per IP (raise for load tests only)
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

func (c *Config) Dev() bool { return c.Env != "production" }

func Load() (*Config, error) {
	c := &Config{
		Env:            env("OG_ENV", "dev"),
		Addr:           env("OG_ADDR", ":8080"),
		DBPath:         env("OG_DB", "data/opengather.db"),
		StaticDir:      env("OG_STATIC_DIR", ""),
		OfficeSlug:     env("OG_OFFICE_SLUG", "default"),
		OfficeName:     env("OG_OFFICE_NAME", "Office"),
		SessionTTL:     time.Duration(envInt("OG_SESSION_DAYS", 30)) * 24 * time.Hour,
		LiveKitURL:     env("LIVEKIT_URL", ""),
		LiveKitAPIURL:  env("LIVEKIT_API_URL", ""),
		LiveKitKey:     env("LIVEKIT_API_KEY", ""),
		LiveKitSecret:  env("LIVEKIT_API_SECRET", ""),
		TickHz:         envInt("OG_TICK_HZ", 15),
		AOICells:       envInt("OG_AOI_CELLS", 2),
		MaxPlayers:     envInt("OG_MAX_PLAYERS", 2000),
		MaxGroup:       envInt("OG_MAX_GROUP", 8),
		JoinRate:       envInt("OG_JOIN_RATE", 20),
		MediaTTL:       time.Duration(envInt("OG_MEDIA_TOKEN_TTL_SECONDS", 30)) * time.Second,
		MediaReconcile: time.Duration(envInt("OG_MEDIA_RECONCILE_SECONDS", 10)) * time.Second,
	}
	if o := env("OG_ALLOWED_ORIGINS", ""); o != "" {
		c.AllowedOrigins = strings.Split(o, ",")
	}
	if c.Env != "dev" && c.Env != "production" {
		return nil, errors.New("OG_ENV must be dev or production")
	}
	if c.LiveKitAPIURL == "" && c.LiveKitURL != "" {
		u := c.LiveKitURL
		u = strings.Replace(u, "wss://", "https://", 1)
		u = strings.Replace(u, "ws://", "http://", 1)
		c.LiveKitAPIURL = u
	}
	if c.TickHz < 5 || c.TickHz > 30 {
		return nil, errors.New("OG_TICK_HZ must be within 5..30")
	}
	if c.Env == "production" {
		if c.LiveKitKey == "" || c.LiveKitSecret == "" || c.LiveKitURL == "" {
			return nil, errors.New("production requires LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET")
		}
		if c.LiveKitKey == "devkey" || len(c.LiveKitSecret) < 32 {
			return nil, errors.New("production requires a non-default LiveKit key and a secret with at least 32 characters")
		}
		if !strings.HasPrefix(c.LiveKitURL, "wss://") {
			return nil, errors.New("production requires LIVEKIT_URL to use wss://")
		}
		if len(c.AllowedOrigins) == 0 {
			return nil, errors.New("production requires OG_ALLOWED_ORIGINS (e.g. office.example.com)")
		}
	}
	return c, nil
}
