package config

import "testing"

func setProd(t *testing.T) {
	t.Helper()
	t.Setenv("OG_ENV", "production")
	t.Setenv("LIVEKIT_URL", "wss://lk.example.com")
	t.Setenv("LIVEKIT_API_KEY", "prodkey")
	t.Setenv("LIVEKIT_API_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("OG_ALLOWED_ORIGINS", "office.example.com")
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
		"no allowed origins":  func(t *testing.T) { t.Setenv("OG_ALLOWED_ORIGINS", "") },
		"short metrics token": func(t *testing.T) { t.Setenv("OG_METRICS_TOKEN", "short") },
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
	t.Setenv("OG_METRICS_TOKEN", "0123456789abcdef")
	c, err := Load()
	if err != nil || c.MetricsToken == "" {
		t.Fatalf("%v %v", c, err)
	}
}
