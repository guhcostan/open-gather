package config

import (
	"strings"
	"testing"
)

func TestTileworkConfiguration(t *testing.T) {
	t.Setenv("TILEWORK_ENV", "production")
	t.Setenv("TILEWORK_ADDR", "127.0.0.1:19001")
	t.Setenv("TILEWORK_DB", "data/preserved.db")
	t.Setenv("TILEWORK_ALLOWED_ORIGINS", "office.example.com")
	t.Setenv("LIVEKIT_URL", "wss://lk.example.com")
	t.Setenv("LIVEKIT_API_KEY", "prodkey")
	t.Setenv("LIVEKIT_API_SECRET", "0123456789abcdef0123456789abcdef")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Dev() || c.Addr != "127.0.0.1:19001" || c.DBPath != "data/preserved.db" {
		t.Fatalf("Tilework configuration was ignored: %+v", c)
	}
}

func TestLegacyConfigurationRequiresMigration(t *testing.T) {
	for _, key := range []string{"OG_ENV", "OG_DB", "OG_ALLOWED_ORIGINS"} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, "legacy-value")
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), "TILEWORK_") {
				t.Fatalf("legacy configuration must fail with migration guidance: %v", err)
			}
		})
	}
}

func setProd(t *testing.T) {
	t.Helper()
	t.Setenv("TILEWORK_ENV", "production")
	t.Setenv("LIVEKIT_URL", "wss://lk.example.com")
	t.Setenv("LIVEKIT_API_KEY", "prodkey")
	t.Setenv("LIVEKIT_API_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("TILEWORK_ALLOWED_ORIGINS", "office.example.com")
}

func TestProductionAcceptsAFullConfiguration(t *testing.T) {
	setProd(t)
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

func TestProductionRefusesInsecureDefaults(t *testing.T) {
	for name, mutate := range map[string]func(*testing.T){
		"dev LiveKit key":     func(t *testing.T) { t.Setenv("LIVEKIT_API_KEY", "devkey") },
		"short secret":        func(t *testing.T) { t.Setenv("LIVEKIT_API_SECRET", "short") },
		"plain ws://":         func(t *testing.T) { t.Setenv("LIVEKIT_URL", "ws://lk.example.com") },
		"no allowed origins":  func(t *testing.T) { t.Setenv("TILEWORK_ALLOWED_ORIGINS", "") },
		"short metrics token": func(t *testing.T) { t.Setenv("TILEWORK_METRICS_TOKEN", "short") },
	} {
		t.Run(name, func(t *testing.T) {
			setProd(t)
			mutate(t)
			if _, err := Load(); err == nil {
				t.Fatal("production must refuse this configuration")
			}
		})
	}
}

func TestMetricsTokenIsOptionalButValidated(t *testing.T) {
	setProd(t)
	t.Setenv("TILEWORK_METRICS_TOKEN", "0123456789abcdef")
	c, err := Load()
	if err != nil || c.MetricsToken == "" {
		t.Fatalf("%v %v", c, err)
	}
}
