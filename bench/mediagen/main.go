// Command mediagen puts synthetic but REAL media through an SFU: every participant publishes an
// Opus audio track and (optionally) a VP8 video track read from encoded files, and subscribes to the
// others like a browser would. Receivers measure bitrate, packet loss, jitter, interruptions and
// time-to-first-media from the RTP they actually receive. It knows nothing about the app server:
// pair it with the presence load generator for a full picture.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var (
	url       = flag.String("url", "http://127.0.0.1:17880", "LiveKit URL")
	key       = flag.String("key", "devkey", "API key")
	secret    = flag.String("secret", "secret", "API secret")
	rooms     = flag.Int("rooms", 1, "number of rooms")
	perRoom   = flag.Int("per-room", 4, "participants per room")
	withVideo = flag.Bool("video", true, "every participant publishes camera video (360p VP8)")
	maxVideos = flag.Int("max-videos", 0, "max camera videos each participant subscribes to (0 = all)")
	screen    = flag.Bool("screen", false, "one participant per room also shares a 720p screen")
	ramp      = flag.Int("ramp", 8, "participants started per second")
	warmup    = flag.Duration("warmup", 10*time.Second, "settle time after everybody joined")
	duration  = flag.Duration("duration", 45*time.Second, "measurement window")
	assets    = flag.String("assets", "assets", "directory with audio.ogg, video.ivf, screen.ivf")
	sfuPID    = flag.Int("sfu-pid", 0, "PID of a local livekit-server, sampled with ps (CPU is percent of ONE core)")
	sfuProm   = flag.String("sfu-metrics", "", "LiveKit Prometheus URL, e.g. http://127.0.0.1:16789/metrics (bytes in/out)")
	container = flag.String("sfu-container", "", "docker container running the SFU, sampled with docker stats")
	label     = flag.String("label", "media", "report label")
	out       = flag.String("out", "", "write the JSON report here")
)

type trackStat struct {
	kind                       string // audio | video | screen
	subscribedAt               time.Time
	firstAt                    atomic.Int64 // unix nano of first packet
	packets, bytes, lost, gaps atomic.Int64
	jitterUs                   atomic.Int64
	base                       struct{ packets, bytes, lost, gaps int64 }
}

type agg struct {
	mu          sync.Mutex
	tracks      []*trackStat
	connectMs   []float64
	connectFail int
	connected   atomic.Int32
}

func (a *agg) add(t *trackStat) { a.mu.Lock(); a.tracks = append(a.tracks, t); a.mu.Unlock() }

func token(room, id string) string {
	at := auth.NewAccessToken(*key, *secret)
	at.SetVideoGrant(&auth.VideoGrant{RoomJoin: true, Room: room}).SetIdentity(id).SetValidFor(2 * time.Hour)
	t, err := at.ToJWT()
	if err != nil {
		panic(err)
	}
	return t
}

type participant struct {
	a      *agg
	mu     sync.Mutex
	seen   map[string]bool
	reqAt  map[string]time.Time // when SetSubscribed was requested, per publication SID
	videos int
}

func (p *participant) subscribe(pub *lksdk.RemoteTrackPublication) {
	p.mu.Lock()
	if p.seen[pub.SID()] {
		p.mu.Unlock()
		return
	}
	want := true
	if pub.Kind() == lksdk.TrackKindVideo && pub.Source() == livekit.TrackSource_CAMERA {
		if *maxVideos > 0 && p.videos >= *maxVideos {
			want = false
		} else {
			p.videos++
		}
	}
	if want {
		p.seen[pub.SID()] = true
	}
	p.mu.Unlock()
	if want {
		p.mu.Lock()
		p.reqAt[pub.SID()] = time.Now()
		p.mu.Unlock()
		_ = pub.SetSubscribed(true)
	}
}

func (p *participant) run(ctx context.Context, room, id string, shareScreen bool) {
	st := map[string]*trackStat{}
	var stMu sync.Mutex
	cb := &lksdk.RoomCallback{ParticipantCallback: lksdk.ParticipantCallback{
		OnTrackPublished: func(pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) { p.subscribe(pub) },
		OnTrackSubscribed: func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
			kind := "audio"
			if pub.Kind() == lksdk.TrackKindVideo {
				kind = "video"
				if pub.Source() == livekit.TrackSource_SCREEN_SHARE {
					kind = "screen"
				}
			}
			p.mu.Lock()
			req, ok := p.reqAt[pub.SID()]
			p.mu.Unlock()
			if !ok {
				req = time.Now()
			}
			ts := &trackStat{kind: kind, subscribedAt: req}
			stMu.Lock()
			st[pub.SID()] = ts
			stMu.Unlock()
			p.a.add(ts)
			go readTrack(ctx, track, ts)
		},
	}}
	t0 := time.Now()
	rm, err := lksdk.ConnectToRoomWithToken(*url, token(room, id), cb, lksdk.WithAutoSubscribe(false), lksdk.WithIncludeDefaultInterceptors(true))
	if err != nil {
		p.a.mu.Lock()
		p.a.connectFail++
		p.a.mu.Unlock()
		return
	}
	defer rm.Disconnect()
	p.a.mu.Lock()
	p.a.connectMs = append(p.a.connectMs, float64(time.Since(t0).Milliseconds()))
	p.a.mu.Unlock()
	p.a.connected.Add(1)
	for _, rp := range rm.GetRemoteParticipants() {
		for _, pub := range rp.TrackPublications() {
			if rpub, ok := pub.(*lksdk.RemoteTrackPublication); ok {
				p.subscribe(rpub)
			}
		}
	}
	publish := func(file string, frame time.Duration, opts *lksdk.TrackPublicationOptions) {
		var ro []lksdk.ReaderSampleProviderOption
		if frame > 0 {
			ro = append(ro, lksdk.ReaderTrackWithFrameDuration(frame))
		}
		tr, err := lksdk.NewLocalFileTrack(filepath.Join(*assets, file), ro...)
		if err != nil {
			fmt.Fprintln(os.Stderr, "track", file, err)
			return
		}
		if _, err := rm.LocalParticipant.PublishTrack(tr, opts); err != nil {
			fmt.Fprintln(os.Stderr, "publish", file, err)
		}
	}
	publish("audio.ogg", 0, &lksdk.TrackPublicationOptions{Name: "mic", Source: livekit.TrackSource_MICROPHONE})
	if *withVideo {
		publish("video.ivf", 66*time.Millisecond, &lksdk.TrackPublicationOptions{Name: "cam", Source: livekit.TrackSource_CAMERA, VideoWidth: 640, VideoHeight: 360})
	}
	if shareScreen {
		publish("screen.ivf", 200*time.Millisecond, &lksdk.TrackPublicationOptions{Name: "screen", Source: livekit.TrackSource_SCREEN_SHARE, VideoWidth: 1280, VideoHeight: 720})
	}
	<-ctx.Done()
}

// readTrack measures what a browser would experience: loss from sequence gaps, RFC 3550 jitter,
// stalls longer than 500 ms and the time to the first packet.
func readTrack(ctx context.Context, tr *webrtc.TrackRemote, ts *trackStat) {
	clock := float64(tr.Codec().ClockRate)
	buf := make([]byte, 1600)
	var hdr rtp.Header
	var lastSeq uint16
	var lastArr time.Time
	var lastTS uint32
	var jitter float64
	first := true
	for ctx.Err() == nil {
		n, _, err := tr.Read(buf)
		if err != nil {
			return
		}
		now := time.Now()
		if _, err := hdr.Unmarshal(buf[:n]); err != nil {
			continue
		}
		ts.packets.Add(1)
		ts.bytes.Add(int64(n))
		if first {
			first = false
			ts.firstAt.Store(now.UnixNano())
		} else {
			if d := int16(hdr.SequenceNumber - lastSeq - 1); d > 0 {
				ts.lost.Add(int64(d))
			}
			if hdr.SequenceNumber != lastSeq+1 || true {
				dArr := now.Sub(lastArr).Seconds()
				dTS := float64(int32(hdr.Timestamp-lastTS)) / clock
				jitter += (math.Abs(dArr-dTS) - jitter) / 16
				ts.jitterUs.Store(int64(jitter * 1e6))
			}
			if now.Sub(lastArr) > 500*time.Millisecond {
				ts.gaps.Add(1)
			}
		}
		lastSeq, lastArr, lastTS = hdr.SequenceNumber, now, hdr.Timestamp
	}
}

func pct(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return math.NaN()
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	return s[int(math.Min(float64(len(s)-1), math.Ceil(p*float64(len(s)))-1))]
}

type report struct {
	Label                                                    string
	Rooms, PerRoom, Participants                             int
	Video                                                    bool
	MaxVideos                                                int
	Screen                                                   bool
	Connected, ConnectFailed                                 int
	ConnectMsP50, ConnectMsP95                               float64
	FirstMediaMsP50, FirstMediaMsP95                         float64
	SubscribedAudio, SubscribedVideo, SubscribedScr          int
	AudioKbpsPerTrack, VideoKbpsPerTrack, ScreenKbpsPerTrack float64
	ReceivedMbpsTotal, ReceivedKbpsPerParticipant            float64
	LossPct                                                  float64
	AudioJitterMsP50, AudioJitterMsP95                       float64
	VideoJitterMsP50, VideoJitterMsP95                       float64
	Stalls500ms                                              int64
	WindowS                                                  float64
	SFUCPUAvgPct, SFUCPUMaxPct, SFUMemMaxMB                  float64
	SFUNetInMBps, SFUNetOutMBps                              float64
	Notes                                                    string
}

func dockerSample(name string) (cpu, memMB, rx, tx float64) {
	o, err := exec.Command("docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}", name).Output()
	if err != nil {
		return
	}
	f := strings.Split(strings.TrimSpace(string(o)), "|")
	if len(f) != 3 {
		return
	}
	cpu, _ = strconv.ParseFloat(strings.TrimSuffix(f[0], "%"), 64)
	memMB = parseSize(strings.Fields(f[1])[0])
	io := strings.Split(f[2], "/")
	rx, tx = parseSize(strings.TrimSpace(io[0])), parseSize(strings.TrimSpace(io[1]))
	return
}

func parseSize(s string) float64 {
	mult := map[string]float64{"B": 1e-6, "kB": 1e-3, "MB": 1, "GB": 1e3, "KiB": 1.024e-3, "MiB": 1.048576, "GiB": 1073.7}
	for suf, m := range mult {
		if strings.HasSuffix(s, suf) {
			v, _ := strconv.ParseFloat(strings.TrimSuffix(s, suf), 64)
			return v * m
		}
	}
	return 0
}

func main() {
	flag.Parse()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := &agg{}
	total := *rooms * *perRoom
	tick := time.NewTicker(time.Second / time.Duration(*ramp))
	t0 := time.Now()
	for r := 0; r < *rooms; r++ {
		for i := 0; i < *perRoom; i++ {
			<-tick.C
			p := &participant{a: a, seen: map[string]bool{}, reqAt: map[string]time.Time{}}
			go p.run(ctx, fmt.Sprintf("mg-%s-r%d", *label, r), fmt.Sprintf("u%d-%d", r, i), *screen && i == 0)
		}
	}
	tick.Stop()
	deadline := time.Now().Add(60 * time.Second)
	for int(a.connected.Load())+a.connectFail < total && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	fmt.Fprintf(os.Stderr, "connected %d/%d in %s (failed %d)\n", a.connected.Load(), total, time.Since(t0).Round(time.Millisecond), a.connectFail)
	time.Sleep(*warmup)

	a.mu.Lock()
	for _, t := range a.tracks {
		t.base.packets, t.base.bytes, t.base.lost, t.base.gaps = t.packets.Load(), t.bytes.Load(), t.lost.Load(), t.gaps.Load()
	}
	nTracks0 := len(a.tracks)
	a.mu.Unlock()
	var cpus []float64
	var memMax, rx0, tx0, rx1, tx1 float64
	start := time.Now()
	if *container != "" {
		_, _, rx0, tx0 = dockerSample(*container)
	}
	var pin0, pout0, pin1, pout1 float64
	if *sfuProm != "" {
		pin0, pout0 = promBytes(*sfuProm)
	}
	for time.Since(start) < *duration {
		if *sfuPID > 0 {
			c, m := psSample(*sfuPID)
			cpus = append(cpus, c)
			memMax = math.Max(memMax, m)
			fmt.Fprintf(os.Stderr, "t=%3.0fs sfu cpu=%.0f%% rss=%.0fMB\n", time.Since(start).Seconds(), c, m)
			time.Sleep(2 * time.Second)
		} else if *container != "" {
			c, m, r, t := dockerSample(*container)
			cpus = append(cpus, c)
			memMax = math.Max(memMax, m)
			rx1, tx1 = r, t
			fmt.Fprintf(os.Stderr, "t=%3.0fs sfu cpu=%.0f%% mem=%.0fMB\n", time.Since(start).Seconds(), c, m)
		} else {
			time.Sleep(2 * time.Second)
		}
	}
	el := time.Since(start).Seconds()
	if *sfuProm != "" {
		pin1, pout1 = promBytes(*sfuProm)
	}

	rep := report{Label: *label, Rooms: *rooms, PerRoom: *perRoom, Participants: total, Video: *withVideo, MaxVideos: *maxVideos, Screen: *screen,
		Connected: int(a.connected.Load()), ConnectFailed: a.connectFail, WindowS: el}
	rep.ConnectMsP50, rep.ConnectMsP95 = pct(a.connectMs, .5), pct(a.connectMs, .95)
	var ttfp, aj, vj []float64
	var bytes, pk, lost, gaps int64
	kb := map[string]float64{}
	kn := map[string]float64{}
	a.mu.Lock()
	for i, t := range a.tracks {
		switch t.kind {
		case "audio":
			rep.SubscribedAudio++
			aj = append(aj, float64(t.jitterUs.Load())/1000)
		case "video":
			rep.SubscribedVideo++
			vj = append(vj, float64(t.jitterUs.Load())/1000)
		case "screen":
			rep.SubscribedScr++
			vj = append(vj, float64(t.jitterUs.Load())/1000)
		}
		if f := t.firstAt.Load(); f > 0 {
			ttfp = append(ttfp, float64(f-t.subscribedAt.UnixNano())/1e6)
		}
		if i < nTracks0 {
			bytes += t.bytes.Load() - t.base.bytes
			pk += t.packets.Load() - t.base.packets
			lost += t.lost.Load() - t.base.lost
			gaps += t.gaps.Load() - t.base.gaps
			kb[t.kind] += float64(t.bytes.Load()-t.base.bytes) * 8 / el / 1e3
			kn[t.kind]++
		}
	}
	a.mu.Unlock()
	rep.FirstMediaMsP50, rep.FirstMediaMsP95 = pct(ttfp, .5), pct(ttfp, .95)
	if kn["audio"] > 0 {
		rep.AudioKbpsPerTrack = kb["audio"] / kn["audio"]
	}
	if kn["video"] > 0 {
		rep.VideoKbpsPerTrack = kb["video"] / kn["video"]
	}
	if kn["screen"] > 0 {
		rep.ScreenKbpsPerTrack = kb["screen"] / kn["screen"]
	}
	rep.ReceivedMbpsTotal = float64(bytes) * 8 / el / 1e6
	if rep.Connected > 0 {
		rep.ReceivedKbpsPerParticipant = float64(bytes) * 8 / el / 1e3 / float64(rep.Connected)
	}
	if pk+lost > 0 {
		rep.LossPct = float64(lost) / float64(pk+lost) * 100
	}
	rep.AudioJitterMsP50, rep.AudioJitterMsP95 = pct(aj, .5), pct(aj, .95)
	rep.VideoJitterMsP50, rep.VideoJitterMsP95 = pct(vj, .5), pct(vj, .95)
	rep.Stalls500ms = gaps
	if len(cpus) > 0 {
		var s float64
		for _, c := range cpus {
			s += c
			rep.SFUCPUMaxPct = math.Max(rep.SFUCPUMaxPct, c)
		}
		rep.SFUCPUAvgPct = s / float64(len(cpus))
		rep.SFUMemMaxMB = memMax
		rep.SFUNetInMBps, rep.SFUNetOutMBps = (rx1-rx0)/el, (tx1-tx0)/el
	}
	if *sfuProm != "" {
		rep.SFUNetInMBps, rep.SFUNetOutMBps = (pin1-pin0)/el/1e6, (pout1-pout0)/el/1e6
	}
	// encoding/json cannot represent NaN (empty percentile sets): use -1 for "no samples"
	for _, p := range []*float64{&rep.ConnectMsP50, &rep.ConnectMsP95, &rep.FirstMediaMsP50, &rep.FirstMediaMsP95, &rep.AudioJitterMsP50, &rep.AudioJitterMsP95, &rep.VideoJitterMsP50, &rep.VideoJitterMsP95} {
		if math.IsNaN(*p) || math.IsInf(*p, 0) {
			*p = -1
		}
	}
	js, _ := json.MarshalIndent(rep, "", "  ")
	fmt.Println(string(js))
	if *out != "" {
		os.WriteFile(*out, js, 0o644)
	}
	cancel()
	time.Sleep(500 * time.Millisecond)
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

// promBytes sums livekit_packet_bytes by direction from the SFU's Prometheus endpoint.
func promBytes(url string) (in, out float64) {
	resp, err := httpGet(url)
	if err != nil {
		return
	}
	for _, line := range strings.Split(resp, "\n") {
		if !strings.HasPrefix(line, "livekit_packet_bytes{") {
			continue
		}
		i := strings.LastIndexByte(line, ' ')
		v, _ := strconv.ParseFloat(line[i+1:], 64)
		if strings.Contains(line, "direction=\"incoming\"") {
			in += v
		} else if strings.Contains(line, "direction=\"outgoing\"") {
			out += v
		}
	}
	return
}

func httpGet(url string) (string, error) {
	c := http.Client{Timeout: 3 * time.Second}
	r, err := c.Get(url)
	if err != nil {
		return "", err
	}
	defer r.Body.Close()
	b, err := io.ReadAll(r.Body)
	return string(b), err
}
