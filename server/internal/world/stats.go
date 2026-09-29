package world

import (
	"sync/atomic"
	"time"
)

// Stats are lock-free counters read by the /metrics endpoint.
type Stats struct {
	Players      atomic.Int64
	Connected    atomic.Int64
	Moving       atomic.Int64
	Groups       atomic.Int64
	Ticks        atomic.Int64
	TickNsSum    atomic.Int64
	TickNsMax    atomic.Int64
	TickBuckets  [10]atomic.Int64 // <0.1ms,0.25,0.5,1,2,5,10,25,50,+Inf
	FramesOut    atomic.Int64
	BytesOut     atomic.Int64
	PosSent      atomic.Int64
	PosCoalesced atomic.Int64 // stale positions overwritten for slow clients
	Skipped      atomic.Int64 // flushes skipped due to backpressure
	Kicked       atomic.Int64 // clients dropped: reliable queue overflow
	InputMsgs    atomic.Int64
	InboxDepth   atomic.Int64
	GroupJoins   atomic.Int64
	GroupLeaves  atomic.Int64
}

var TickBucketLE = [10]float64{0.0001, 0.00025, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 1e9}

func (s *Stats) observeTick(d time.Duration) {
	ns := d.Nanoseconds()
	s.Ticks.Add(1)
	s.TickNsSum.Add(ns)
	for {
		m := s.TickNsMax.Load()
		if ns <= m || s.TickNsMax.CompareAndSwap(m, ns) {
			break
		}
	}
	sec := d.Seconds()
	for i, le := range TickBucketLE {
		if sec <= le {
			s.TickBuckets[i].Add(1)
			return
		}
	}
}
