import { WorldView } from "./game/WorldView";
import { Socket, type ConnState } from "./net/socket";
import type { Person, ServerMsg, Status } from "./net/protocol";
import { media } from "./media/MediaManager";
import { getState, setState, toast, type ChatMsg } from "./store";
import { t } from "./i18n";

const AWAY_AFTER_MS = 5 * 60 * 1000;

/** Glue between the socket, the Pixi world, the media manager and the React store. */
class Session {
  view: WorldView | null = null;
  socket: Socket | null = null;
  private stopped = true;
  private chatId = 0;
  private idleTimer = 0;
  private lastActivity = Date.now();
  private autoAway = false;
  private cleanup: (() => void)[] = [];

  async start(host: HTMLElement) {
    this.stopped = false;
    const view = new WorldView({
      sendInput: (seq, dx, dy) => this.socket?.send({ t: "in", s: seq, x: dx, y: dy }),
      onArea: (name) => setState({ currentArea: name }),
      onResume: () => this.socket?.send({ t: "sync" }),
    });
    await view.init(host, getState().settings.eco);
    if (this.stopped) {
      view.destroy();
      return;
    }
    this.view = view;
    media.onSpeaking = (ids) => view.setSpeaking(ids);
    media.onNeedToken = () => this.socket?.send({ t: "tok" });
    this.socket = new Socket((m) => this.onMessage(m), (s) => this.onConn(s));
    this.socket.connect();

    const act = () => {
      this.lastActivity = Date.now();
      if (this.autoAway && getState().status === "away") {
        this.autoAway = false;
        this.setStatus("available");
      }
    };
    for (const ev of ["keydown", "pointerdown", "pointermove"]) window.addEventListener(ev, act, { passive: true });
    this.cleanup.push(() => ["keydown", "pointerdown", "pointermove"].forEach((ev) => window.removeEventListener(ev, act)));
    this.idleTimer = window.setInterval(() => {
      if (getState().status === "available" && Date.now() - this.lastActivity > AWAY_AFTER_MS) {
        this.autoAway = true;
        this.setStatus("away");
      }
    }, 15000);
    (window as unknown as { __og: unknown }).__og = { view, media, get state() { return getState(); }, session: this };
  }

  stop() {
    this.stopped = true;
    clearInterval(this.idleTimer);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.socket?.close();
    this.socket = null;
    void media.leave();
    this.view?.destroy();
    this.view = null;
    setState({ conv: null, roster: new Map() });
  }

  private onConn(s: ConnState) {
    setState({ conn: s });
  }

  private onMessage(m: ServerMsg) {
    const view = this.view;
    if (!view) return;
    switch (m.t) {
      case "hello": {
        const roster = new Map<number, Person>(m.roster.map((p) => [p.id, p]));
        // The server replays the persisted office chat on every connect; other scopes are kept as they are.
        const history: ChatMsg[] = (m.chat ?? []).map((c) => ({ id: ++this.chatId, sc: "o", from: c.f, text: c.x, ts: c.ts, n: c.n }));
        setState({ chat: [...history, ...getState().chat.filter((c) => c.sc !== "o")] });
        setState({ meId: m.you, role: m.role, status: m.status, office: m.office, mediaAvailable: m.cfg.media, roster, phase: "play" });
        view.setMap(m.map, m.cfg.deny);
        view.clearRemote();
        view.setMe(m.you, m.cfg.x, m.cfg.y, m.cfg.speed);
        view.setPeople(roster);
        const s = getState();
        if (s.consent) this.socket?.send({ t: "consent", b: true });
        if (s.status !== "available") this.socket?.send({ t: "st", v: s.status });
        break;
      }
      case "w":
        view.applyWorld(m);
        break;
      case "a":
        view.applyAck(m);
        break;
      case "p": {
        const roster = new Map(getState().roster);
        m.a?.forEach((p) => roster.set(p.id, p));
        m.d?.forEach((id) => roster.delete(id));
        setState({ roster });
        view.setPeople(roster);
        const me = roster.get(getState().meId);
        if (me && me.s !== "offline" && me.s !== getState().status) setState({ status: me.s as Status });
        break;
      }
      case "c": {
        const msg: ChatMsg = { id: ++this.chatId, sc: m.sc, from: m.f, to: m.to, text: m.x, ts: m.ts };
        const s = getState();
        setState({ chat: [...s.chat.slice(-299), msg], unread: m.f === s.meId ? s.unread : s.unread + 1 });
        break;
      }
      case "conv":
        this.onConv(m);
        break;
      case "map":
        view.setMap(m.map, m.deny);
        if (m.x !== undefined && m.y !== undefined) view.teleport(m.x, m.y);
        break;
      case "loc":
        if (m.ok && m.x !== undefined && m.y !== undefined) {
          view.showLocation(m.x, m.y);
          if (m.a) toast(m.a);
        }
        break;
    }
  }

  private onConv(m: Extract<ServerMsg, { t: "conv" }>) {
    const view = this.view!;
    if (m.op === "join") {
      setState({ conv: { kind: m.k, name: m.name, members: m.m, state: "connecting" } });
      view.setInConversation(new Set(m.m));
      if (m.tok && m.url) {
        media.join({ url: m.url, token: m.tok, room: m.room }).catch(() => {
          const c = getState().conv;
          if (c) setState({ conv: { ...c, state: "failed" } });
          toast(t("media.failed"));
        });
      } else {
        const c = getState().conv;
        if (c) setState({ conv: { ...c, state: "failed" } });
      }
    } else if (m.op === "m") {
      const c = getState().conv;
      if (c) setState({ conv: { ...c, members: m.m } });
      view.setInConversation(new Set(m.m));
    } else if (m.op === "leave") {
      void media.leave();
      setState({ conv: null });
      view.setInConversation(new Set());
    }
  }

  // ---- user actions ----
  setStatus(s: Status) {
    setState({ status: s });
    this.socket?.send({ t: "st", v: s });
  }
  setConsent(b: boolean) {
    setState({ consent: b });
    localStorage.setItem("og.consent", b ? "1" : "0");
    this.socket?.send({ t: "consent", b });
  }
  chat(scope: "o" | "g" | "d", text: string, to?: number) {
    this.socket?.send({ t: "chat", sc: scope, text, id: to });
  }
  locate(id: number) {
    this.socket?.send({ t: "loc", id });
  }
  setEco(eco: boolean) {
    this.view?.setEco(eco);
  }
}

export const session = new Session();
