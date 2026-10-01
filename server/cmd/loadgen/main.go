// Command loadgen drives many WebSocket bots against an Open Gather server.
// It measures what a WebSocket load test CAN measure (presence/movement fan-out,
// propagation latency, reconnect behaviour). It does NOT prove audio/video capacity.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

var (
	base        = flag.String("url", "http://127.0.0.1:18080", "server base URL")
	nBots       = flag.Int("n", 100, "number of bots")
	moving      = flag.Float64("moving", 0.3, "fraction of time bots spend walking")
	region      = flag.String("region", "distributed", "distributed | concentrated")
	rampRate    = flag.Int("ramp", 50, "joins per second")
	warmup      = flag.Duration("warmup", 10*time.Second, "warmup after everyone joined")
	duration    = flag.Duration("duration", 60*time.Second, "measurement window")
	probes      = flag.Int("probes", 6, "probe pairs measuring propagation latency")
	consent     = flag.Bool("consent", false, "bots opt in to media (enables proximity grouping work; no real media)")
	storm       = flag.Bool("storm", false, "after measuring, drop every connection at once and reconnect")
	serverPID   = flag.Int("pid", 0, "server PID for CPU/RSS sampling (only meaningful on the same host)")
	label       = flag.String("label", "run", "label for the report")
	out         = flag.String("out", "", "write JSON report to this file")
	sampleEvery = flag.Duration("sample", 0, "record a time series (heap, goroutines, RSS, CPU) at this interval, e.g. 30s")
	invite      = flag.String("invite", "", "invite token every bot joins with (production servers require one; mint a multi-use one with opengather -invite member -invite-uses N)")
	metricsTok  = flag.String("metrics-token", "", "bearer token for /metrics on a production server (prefer $OG_METRICS_TOKEN: flags are visible in the process list)")
	metricsURL  = flag.String("metrics-url", "", "where to scrape /metrics when the public URL hides it (e.g. an SSH tunnel); default: -url")
)

type mapData struct {
	W, H  int
	Solid []string
}
type hello struct {
	T   string `json:"t"`
	You uint32 `json:"you"`
	Cfg struct {
		Speed float64 `json:"speed"`
		X, Y  float64
	} `json:"cfg"`
	Map mapData `json:"map"`
}

type stats struct {
	framesIn, bytesIn, worldFrames, bytesOut, msgsOut atomic.Int64
	joined, failed, disconnects                       atomic.Int64
}

var st stats

type bot struct {
	idx    int
	cookie string
	id     uint32
	probe  int // 0 none, 1 mover, 2 observer
	pair   int
	x, y   float64
	speed  float64
	dx, dy int
	seq    uint32
	grid   *mapData
	conn   *websocket.Conn
	sentAt atomic.Int64 // probe mover: nano time of last direction change
	sentMv atomic.Int64 // 1 = started moving, 0 = stopped
}

var (
	latMu    sync.Mutex
	latStart []float64
	latStop  []float64
	moverID  sync.Map // pair -> mover user id
	moverBot sync.Map // pair -> *bot
)

func httpJoin(name string) (string, error) {
	req := map[string]any{"name": name, "avatar": map[string]int{"sk": rand.IntN(6), "hs": rand.IntN(6), "hc": rand.IntN(8), "sh": rand.IntN(8), "pa": rand.IntN(8)}}
	if *invite != "" {
		req["invite"] = *invite
	}
	body, _ := json.Marshal(req)
	for attempt := 0; attempt < 8; attempt++ {
		resp, err := http.Post(*base+"/api/join", "application/json", bytes.NewReader(body))
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == 429 {
			time.Sleep(300 * time.Millisecond)
			continue
		}
		for _, c := range resp.Cookies() {
			if c.Name == "og_session" {
				return c.Value, nil
			}
		}
		return "", fmt.Errorf("join status %d", resp.StatusCode)
	}
	return "", fmt.Errorf("join failed")
}

func (b *bot) dial(ctx context.Context) error {
	u, _ := url.Parse(*base)
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	h := http.Header{}
	h.Set("Cookie", "og_session="+b.cookie)
	h.Set("Origin", *base)
	c, _, err := websocket.Dial(ctx, scheme+"://"+u.Host+"/ws", &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		return err
	}
	c.SetReadLimit(4 << 20)
	b.conn = c
	return nil
}

func (b *bot) send(ctx context.Context, v string) {
	wctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if b.conn.Write(wctx, websocket.MessageText, []byte(v)) == nil {
		st.bytesOut.Add(int64(len(v)))
		st.msgsOut.Add(1)
	}
}

func (b *bot) setDir(ctx context.Context, dx, dy int) {
	if dx == b.dx && dy == b.dy {
		return
	}
	b.dx, b.dy = dx, dy
	b.seq++
	if b.probe == 1 {
		b.sentAt.Store(time.Now().UnixNano())
		if dx != 0 {
			b.sentMv.Store(1)
		} else {
			b.sentMv.Store(0)
		}
	}
	b.send(ctx, fmt.Sprintf(`{"t":"in","s":%d,"x":%d,"y":%d}`, b.seq, dx, dy))
}

// run connects, reads until ctx ends or the connection drops.
func (b *bot) run(ctx context.Context, ready chan<- struct{}) {
	if err := b.dial(ctx); err != nil {
		st.failed.Add(1)
		ready <- struct{}{}
		return
	}
	defer b.conn.CloseNow()
	first := true
	var w struct {
		M [][4]int `json:"m"`
	}
	for {
		typ, data, err := b.conn.Read(ctx)
		if err != nil {
			if ctx.Err() == nil {
				st.disconnects.Add(1)
			}
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		st.framesIn.Add(1)
		st.bytesIn.Add(int64(len(data)))
		switch {
		case bytes.HasPrefix(data, []byte(`{"t":"w"`)):
			st.worldFrames.Add(1)
			if b.probe == 2 {
				w.M = w.M[:0]
				if json.Unmarshal(data, &w) == nil {
					b.observe(w.M)
				}
			}
		case bytes.HasPrefix(data, []byte(`{"t":"a"`)):
			var a struct{ X, Y float64 }
			if json.Unmarshal(data, &a) == nil && b.dx == 0 && b.dy == 0 {
				b.x, b.y = a.X, a.Y
			}
		case bytes.HasPrefix(data, []byte(`{"t":"hello"`)):
			var h hello
			if json.Unmarshal(data, &h) == nil && first {
				first = false
				b.id, b.x, b.y, b.speed, b.grid = h.You, h.Cfg.X, h.Cfg.Y, h.Cfg.Speed, &h.Map
				if *consent {
					b.send(ctx, `{"t":"consent","b":true}`)
				}
				if b.probe == 1 {
					moverID.Store(b.pair, b.id)
				}
				st.joined.Add(1)
				ready <- struct{}{}
				go b.behave(ctx)
			}
		}
	}
}

func (b *bot) observe(m [][4]int) {
	v, ok := moverID.Load(b.pair)
	if !ok {
		return
	}
	mb, _ := moverBot.Load(b.pair)
	mover := mb.(*bot)
	for _, e := range m {
		if uint32(e[0]) != v.(uint32) {
			continue
		}
		at := mover.sentAt.Load()
		if at == 0 {
			continue
		}
		isMoving := (e[3]>>2)&3 != 1 || (e[3]>>4)&3 != 1 // dx!=0 || dy!=0 (see wire format)
		want := mover.sentMv.Load() == 1
		if isMoving == want {
			lat := float64(time.Now().UnixNano()-at) / 1e6
			if mover.sentAt.CompareAndSwap(at, 0) {
				latMu.Lock()
				if want {
					latStart = append(latStart, lat)
				} else {
					latStop = append(latStop, lat)
				}
				latMu.Unlock()
			}
		}
	}
}

// ---- behaviour ----

type tile struct{ x, y int }

func (b *bot) walkable(x, y int) bool {
	return x >= 0 && y >= 0 && x < b.grid.W && y < b.grid.H && b.grid.Solid[y][x] == '0'
}

func (b *bot) inRegion(x, y int) bool {
	if *region == "concentrated" {
		return x >= 1 && x <= 17 && y >= 1 && y <= 13
	}
	return true
}

func (b *bot) path(from, to tile) []tile {
	prev := map[tile]tile{from: from}
	q := []tile{from}
	for len(q) > 0 {
		c := q[0]
		q = q[1:]
		if c == to {
			break
		}
		for _, d := range []tile{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			n := tile{c.x + d.x, c.y + d.y}
			if _, seen := prev[n]; seen || !b.walkable(n.x, n.y) || !b.inRegion(n.x, n.y) {
				continue
			}
			prev[n] = c
			q = append(q, n)
		}
	}
	if _, ok := prev[to]; !ok {
		return nil
	}
	var p []tile
	for c := to; c != from; c = prev[c] {
		p = append([]tile{c}, p...)
	}
	return p
}

func (b *bot) behave(ctx context.Context) {
	if b.probe == 2 {
		return
	}
	if b.probe == 1 {
		b.probeLoop(ctx)
		return
	}
	step := 50 * time.Millisecond
	beat := time.Now()
	time.Sleep(time.Duration(rand.IntN(3000)) * time.Millisecond)
	for ctx.Err() == nil {
		// choose a target
		var target tile
		for tries := 0; tries < 50; tries++ {
			t := tile{1 + rand.IntN(b.grid.W-2), 1 + rand.IntN(b.grid.H-2)}
			if b.walkable(t.x, t.y) && b.inRegion(t.x, t.y) {
				target = t
				break
			}
		}
		p := b.path(tile{int(b.x) / 16, int(b.y) / 16}, target)
		walkStart := time.Now()
		last := time.Now()
		for _, wp := range p {
			cx, cy := float64(wp.x*16+8), float64(wp.y*16+8)
			for ctx.Err() == nil {
				now := time.Now()
				dt := now.Sub(last).Seconds()
				last = now
				dx, dy := 0, 0
				if math.Abs(cx-b.x) > 2 {
					dx = sign(cx - b.x)
				} else if math.Abs(cy-b.y) > 2 {
					dy = sign(cy - b.y)
				}
				if dx == 0 && dy == 0 {
					break
				}
				b.setDir(ctx, dx, dy)
				b.x += float64(dx) * b.speed * dt
				b.y += float64(dy) * b.speed * dt
				if now.Sub(beat) > 400*time.Millisecond {
					b.seq++
					b.send(ctx, fmt.Sprintf(`{"t":"in","s":%d,"x":%d,"y":%d}`, b.seq, b.dx, b.dy))
					beat = now
				}
				time.Sleep(step)
			}
		}
		b.setDir(ctx, 0, 0)
		walked := time.Since(walkStart)
		idle := time.Duration(float64(walked) * (1 - *moving) / math.Max(*moving, 0.01))
		if idle < 500*time.Millisecond {
			idle = 500 * time.Millisecond
		}
		select {
		case <-time.After(time.Duration(float64(idle) * (0.5 + rand.Float64()))):
		case <-ctx.Done():
		}
	}
}

func (b *bot) probeLoop(ctx context.Context) {
	sgn := 1
	time.Sleep(2 * time.Second)
	for ctx.Err() == nil {
		b.setDir(ctx, sgn, 0)
		time.Sleep(350 * time.Millisecond)
		b.setDir(ctx, 0, 0)
		sgn = -sgn
		time.Sleep(650 * time.Millisecond)
	}
}

func sign(f float64) int {
	if f < 0 {
		return -1
	}
	return 1
}

// ---- server metrics ----

func scrape() map[string]float64 {
	mu := *metricsURL
	if mu == "" {
		mu = *base
	}
	rq, _ := http.NewRequest("GET", mu+"/metrics", nil)
	tok := *metricsTok
	if tok == "" {
		tok = os.Getenv("OG_METRICS_TOKEN")
	}
	if tok != "" {
		rq.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := http.DefaultClient.Do(rq)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	b, _ := io.ReadAll(resp.Body)
	m := map[string]float64{}
	for _, line := range strings.Split(string(b), "\n") {
		if line == "" || line[0] == '#' {
			continue
		}
		i := strings.LastIndexByte(line, ' ')
		if i < 0 {
			continue
		}
		v, err := strconv.ParseFloat(line[i+1:], 64)
		if err == nil {
			m[line[:i]] = v
		}
	}
	return m
}

func psSample(pid int) (cpu, rssMB float64) {
	o, err := exec.Command("ps", "-o", "%cpu=,rss=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return
	}
	f := strings.Fields(string(o))
	if len(f) == 2 {
		cpu, _ = strconv.ParseFloat(f[0], 64)
		kb, _ := strconv.ParseFloat(f[1], 64)
		rssMB = kb / 1024
	}
	return
}

func pct(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return math.NaN()
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	return s[int(math.Min(float64(len(s)-1), math.Ceil(p*float64(len(s)))-1))]
}

// histQuantile estimates a quantile from Prometheus cumulative buckets (upper bound of the bucket).
func histQuantile(before, after map[string]float64, q float64) float64 {
	type bk struct{ le, n float64 }
	var bs []bk
	for k, v := range after {
		if !strings.HasPrefix(k, "og_tick_seconds_bucket{le=\"") {
			continue
		}
		leS := strings.TrimSuffix(strings.TrimPrefix(k, "og_tick_seconds_bucket{le=\""), "\"}")
		le := math.Inf(1)
		if leS != "+Inf" {
			le, _ = strconv.ParseFloat(leS, 64)
		}
		bs = append(bs, bk{le, v - before[k]})
	}
	sort.Slice(bs, func(i, j int) bool { return bs[i].le < bs[j].le })
	if len(bs) == 0 || bs[len(bs)-1].n == 0 {
		return math.NaN()
	}
	total := bs[len(bs)-1].n
	for _, b := range bs {
		if b.n >= q*total {
			return b.le
		}
	}
	return math.Inf(1)
}

type report struct {
	Label, Region                         string
	Bots, Joined, Failed, Disconnects     int64
	Moving                                float64
	DurationS                             float64
	ServerMsgsPerSec, ServerKBPerSec      float64
	PosPerSec, CoalescedPerSec            float64
	InputsPerSec                          float64
	ClientKBInPerBot, ClientMsgsInPerBot  float64
	TickP50ms, TickP95ms, TickP99ms       float64
	TickMaxMs, TickMeanMs                 float64
	LatStartP50, LatStartP95, LatStartP99 float64
	LatStopP50, LatStopP95, LatStopP99    float64
	LatSamples                            int
	CPUAvg, CPUMax, RSSMax                float64
	HeapMB, GoSysMB                       float64
	Kicked, Skipped                       float64
	Groups                                float64
	StormMs                               float64
	StormFailed                           int
	Note                                  string
	// Unix seconds of the measurement window, to line up host samples taken elsewhere (bench/vm-sample.sh).
	WindowStart, WindowEnd float64
	Series                 []sample
}

type sample struct {
	TSec, HeapMB, Goroutines, RSSMB, CPU, Players, FramesOut float64
}

func main() {
	flag.Parse()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bots := make([]*bot, *nBots)
	ready := make(chan struct{}, *nBots*2)

	// join (HTTP) then connect (WS), ramped
	go func() {
		tk := time.NewTicker(time.Second / time.Duration(*rampRate))
		defer tk.Stop()
		for i := 0; i < *nBots; i++ {
			<-tk.C
			i := i
			go func() {
				cookie, err := httpJoin(fmt.Sprintf("bot%d", i))
				if err != nil {
					st.failed.Add(1)
					ready <- struct{}{}
					return
				}
				b := &bot{idx: i, cookie: cookie}
				if i < *probes*2 {
					b.pair = i / 2
					b.probe = 1 + i%2
					if b.probe == 1 {
						moverBot.Store(b.pair, b)
					}
				}
				bots[i] = b
				go b.run(ctx, ready)
			}()
		}
	}()
	t0 := time.Now()
	for i := 0; i < *nBots; i++ {
		<-ready
	}
	fmt.Fprintf(os.Stderr, "joined %d/%d in %s (failed %d)\n", st.joined.Load(), *nBots, time.Since(t0).Round(time.Millisecond), st.failed.Load())
	time.Sleep(*warmup)

	// measurement window
	latMu.Lock()
	latStart, latStop = nil, nil
	latMu.Unlock()
	m0 := scrape()
	f0, by0, o0 := st.framesIn.Load(), st.bytesIn.Load(), st.msgsOut.Load()
	var cpus []float64
	var rssMax float64
	start := time.Now()
	var series []sample
	lastSample := time.Now()
	for time.Since(start) < *duration {
		time.Sleep(time.Second)
		if *serverPID > 0 {
			c, r := psSample(*serverPID)
			cpus = append(cpus, c)
			rssMax = math.Max(rssMax, r)
			if *sampleEvery > 0 && time.Since(lastSample) >= *sampleEvery {
				lastSample = time.Now()
				m := scrape()
				sm := sample{TSec: time.Since(start).Seconds(), HeapMB: m["go_heap_alloc_bytes"] / 1048576, Goroutines: m["go_goroutines"], RSSMB: r, CPU: c, Players: m["og_players"], FramesOut: m["og_ws_frames_out_total"]}
				series = append(series, sm)
				fmt.Fprintf(os.Stderr, "t=%4.0fs heap=%.1fMB goroutines=%.0f rss=%.1fMB cpu=%.1f%% players=%.0f\n", sm.TSec, sm.HeapMB, sm.Goroutines, sm.RSSMB, sm.CPU, sm.Players)
			}
		}
	}
	el := time.Since(start).Seconds()
	m1 := scrape()
	_ = o0

	r := report{Label: *label, Region: *region, Bots: int64(*nBots), Joined: st.joined.Load(), Failed: st.failed.Load(), Disconnects: st.disconnects.Load(), Moving: *moving, DurationS: el}
	r.WindowStart, r.WindowEnd = float64(start.UnixMilli())/1000, float64(start.UnixMilli())/1000+el
	d := func(k string) float64 { return m1[k] - m0[k] }
	r.ServerMsgsPerSec = d("og_ws_frames_out_total") / el
	r.ServerKBPerSec = d("og_ws_bytes_out_total") / el / 1024
	r.PosPerSec = d("og_positions_sent_total") / el
	r.CoalescedPerSec = d("og_positions_coalesced_total") / el
	r.InputsPerSec = d("og_input_msgs_total") / el
	r.ClientKBInPerBot = float64(st.bytesIn.Load()-by0) / el / 1024 / float64(max(1, int(st.joined.Load())))
	r.ClientMsgsInPerBot = float64(st.framesIn.Load()-f0) / el / float64(max(1, int(st.joined.Load())))
	r.TickP50ms, r.TickP95ms, r.TickP99ms = histQuantile(m0, m1, 0.5)*1000, histQuantile(m0, m1, 0.95)*1000, histQuantile(m0, m1, 0.99)*1000
	r.TickMaxMs = m1["og_tick_seconds_max"] * 1000
	if n := d("og_tick_seconds_count"); n > 0 {
		r.TickMeanMs = d("og_tick_seconds_sum") / n * 1000
	}
	latMu.Lock()
	r.LatStartP50, r.LatStartP95, r.LatStartP99 = pct(latStart, .5), pct(latStart, .95), pct(latStart, .99)
	r.LatStopP50, r.LatStopP95, r.LatStopP99 = pct(latStop, .5), pct(latStop, .95), pct(latStop, .99)
	r.LatSamples = len(latStart) + len(latStop)
	latMu.Unlock()
	if len(cpus) > 0 {
		var s float64
		for _, c := range cpus {
			s += c
			r.CPUMax = math.Max(r.CPUMax, c)
		}
		r.CPUAvg = s / float64(len(cpus))
		r.RSSMax = rssMax
	}
	r.HeapMB, r.GoSysMB = m1["go_heap_alloc_bytes"]/1048576, m1["go_sys_bytes"]/1048576
	r.Series = series
	r.Kicked, r.Skipped, r.Groups = m1["og_clients_kicked_total"], m1["og_flush_skipped_total"], m1["og_conversation_groups"]

	if *storm {
		cancel() // drop every connection at once
		time.Sleep(500 * time.Millisecond)
		ctx2, cancel2 := context.WithCancel(context.Background())
		defer cancel2()
		ready2 := make(chan struct{}, *nBots*2)
		s0 := st.joined.Load()
		t1 := time.Now()
		var wg sync.WaitGroup
		for _, b := range bots {
			if b == nil {
				continue
			}
			wg.Add(1)
			go func(b *bot) {
				defer wg.Done()
				time.Sleep(time.Duration(rand.IntN(2000)) * time.Millisecond) // client-side jitter like the web app
				b.dx, b.dy = 0, 0
				b.run(ctx2, ready2)
			}(b)
		}
		got := 0
		deadline := time.After(60 * time.Second)
	loop:
		for got < len(bots) {
			select {
			case <-ready2:
				got++
			case <-deadline:
				break loop
			}
		}
		r.StormMs = float64(time.Since(t1).Milliseconds())
		r.StormFailed = len(bots) - int(st.joined.Load()-s0)
		cancel2()
	}
	cancel()
	if m1 == nil || m0 == nil {
		r.Note = strings.TrimSpace(r.Note + " server metrics unavailable: server-side fields are 0 or -1 (no value)")
	}
	scrubNaN(&r)
	js, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "report:", err)
		os.Exit(1)
	}
	fmt.Println(string(js))
	if *out != "" {
		os.WriteFile(*out, js, 0o644)
	}
}

// scrubNaN sets NaN/Inf fields to -1 so the report always serialises: -1 means no samples, no metrics,
// or (tick percentiles) a value above the histogram's largest finite bucket.
func scrubNaN(r *report) {
	v := reflect.ValueOf(r).Elem()
	for i := 0; i < v.NumField(); i++ {
		if f := v.Field(i); f.Kind() == reflect.Float64 && (math.IsNaN(f.Float()) || math.IsInf(f.Float(), 0)) {
			f.SetFloat(-1)
		}
	}
}
