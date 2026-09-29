package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// limiter is a small per-key token bucket (used for HTTP endpoints).
type limiter struct {
	mu    sync.Mutex
	rate  float64
	burst float64
	m     map[string]*bucket
	last  time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

func newLimiter(perSec, burst float64) *limiter {
	return &limiter{rate: perSec, burst: burst, m: map[string]*bucket{}}
}

func (l *limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.last) > time.Minute { // opportunistic cleanup
		for k, b := range l.m {
			if now.Sub(b.at) > time.Minute {
				delete(l.m, k)
			}
		}
		l.last = now
	}
	b := l.m[key]
	if b == nil {
		b = &bucket{tokens: l.burst, at: now}
		l.m[key] = b
	}
	b.tokens += now.Sub(b.at).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

// connBucket is a non-locking token bucket owned by one connection goroutine.
type connBucket struct {
	tokens, rate, burst float64
	at                  time.Time
}

func newConnBucket(rate, burst float64) *connBucket {
	return &connBucket{tokens: burst, rate: rate, burst: burst, at: time.Now()}
}

func (b *connBucket) allow(now time.Time) bool {
	b.tokens += now.Sub(b.at).Seconds() * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
