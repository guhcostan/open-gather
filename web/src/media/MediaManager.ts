import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { getState, setState } from "../store";
import { t } from "../i18n";

export interface Tile {
  identity: string;
  name: string;
  local: boolean;
  mic: boolean;
  cam: boolean;
  speaking: boolean;
  video: HTMLVideoElement | null;
  screen: HTMLVideoElement | null;
}

export interface JoinInfo {
  url: string;
  token: string;
  room: string;
}

type Listener = () => void;

export function describeMediaError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return t("media.deny");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("media.noDevice");
  if (name === "NotReadableError" || name === "AbortError") return t("media.busyDevice");
  return t("media.failed");
}

/**
 * Owns the LiveKit connection for the *current* conversation group only.
 * The server decides the room and issues a scoped token; leaving the group
 * disconnects and stops every local track (no capture outside conversations).
 */
export class MediaManager {
  private room: Room | null = null;
  private roomName = "";
  private gen = 0;
  private leaving = false;
  private listeners = new Set<Listener>();
  private audioHost: HTMLDivElement;
  private speakingTimer = 0;
  tiles: Tile[] = [];
  onSpeaking: (ids: Set<number>) => void = () => {};
  onNeedToken: () => void = () => {};

  private publishing = true;
  constructor(private target: "conversation" | "spotlight" = "conversation") {
    this.publishing = target === "conversation";
    this.audioHost = document.createElement("div");
    this.audioHost.style.display = "none";
    document.body.appendChild(this.audioHost);
  }

  subscribe = (cb: Listener) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getTiles = () => this.tiles;
  private emit() {
    this.listeners.forEach((f) => f());
  }

  get currentRoom() {
    return this.roomName;
  }

  async join(info: JoinInfo, publish = true) {
    if (this.room && this.roomName === info.room && this.room.state !== ConnectionState.Disconnected) {
      // Same group after a signalling reconnect: keep the media session, just refresh UI state.
      if (this.room.state === ConnectionState.Connected) this.setPlaybackState("live");
      return;
    }
    await this.leave(false);
    this.publishing = publish;
    const gen = ++this.gen;
    const prefs = getState().prefs;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: true,
      disconnectOnPageLeave: true,
      audioCaptureDefaults: { deviceId: prefs.micId || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { deviceId: prefs.camId || undefined, resolution: VideoPresets.h360.resolution },
      publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360], dtx: true, red: true },
    });
    this.room = room;
    this.roomName = info.room;
    this.leaving = false;
    this.bind(room, gen);
    if (publish) setState({ mic: false, cam: false, sharing: false, deviceError: "" });
    this.setPlaybackState("connecting");
    try {
      await room.connect(info.url, info.token, { autoSubscribe: false });
    } catch (e) {
      if (gen === this.gen) {
        this.setPlaybackState("failed");
        this.room = null;
        this.roomName = "";
      }
      throw e;
    }
    if (gen !== this.gen) {
      room.disconnect(true);
      return;
    }
    this.setPlaybackState("live");
    if (prefs.spkId) await room.switchActiveDevice("audiooutput", prefs.spkId).catch(() => {});
    this.applySubscriptions();
    this.refresh();
    if (publish && prefs.micOn) await this.setMic(true);
    if (publish && prefs.camOn && !getState().settings.audioOnly) await this.setCam(true);
  }

  async leave(intentional = true) {
    this.gen++;
    const room = this.room;
    this.room = null;
    this.roomName = "";
    this.leaving = intentional;
    if (room) {
      room.removeAllListeners();
      await room.disconnect(true); // stops capture and closes the peer connection
    }
    this.audioHost.replaceChildren();
    this.audioEls.clear();
    this.vEls.forEach((e) => (e.srcObject = null));
    this.vEls.clear();
    this.tiles = [];
    if (this.publishing && (this.target === "spotlight" || !getState().spotlight?.me)) setState({ mic: false, cam: false, sharing: false });
    this.onSpeaking(new Set());
    this.emit();
  }

  private bind(room: Room, gen: number) {
    const on = (ev: RoomEvent, fn: (...a: never[]) => void) => room.on(ev, fn as never);
    const guard = (fn: () => void) => () => {
      if (gen === this.gen) fn();
    };
    for (const ev of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackUnsubscribed,
    ])
      on(ev, guard(() => this.refresh()));
    on(RoomEvent.TrackPublished, guard(() => { this.applySubscriptions(); this.refresh(); }));
    on(RoomEvent.TrackSubscribed, guard((() => {
      this.refresh();
    })));
    on(RoomEvent.ActiveSpeakersChanged, guard(() => {
      this.refresh();
      clearTimeout(this.speakingTimer);
      this.speakingTimer = window.setTimeout(() => this.applySubscriptions(), 500);
    }));
    on(RoomEvent.Reconnecting, guard(() => this.setPlaybackState("reconnecting")));
    on(RoomEvent.Reconnected, guard(() => { this.setPlaybackState("live"); this.refresh(); }));
    on(RoomEvent.MediaDevicesError, ((e: unknown) => setState({ deviceError: describeMediaError(e) })) as never);
    on(RoomEvent.Disconnected, guard(() => {
      if (this.leaving) return;
      // Unexpected drop: the server keeps the membership, so ask for a fresh token and rejoin.
      this.setPlaybackState("reconnecting");
      this.room = null;
      this.roomName = "";
      this.onNeedToken();
    }));
  }

  /** Audio is always subscribed; camera video is limited and ranked (speakers first). */
  applySubscriptions() {
    const room = this.room;
    if (!room) return;
    const { settings } = getState();
    const speakers = new Set(room.activeSpeakers.map((p) => p.identity));
    const remotes = [...room.remoteParticipants.values()].sort((a, b) => Number(speakers.has(b.identity)) - Number(speakers.has(a.identity)));
    let videos = 0;
    for (const p of remotes) {
      for (const pub of p.trackPublications.values() as IterableIterator<RemoteTrackPublication>) {
        if (pub.kind === Track.Kind.Audio) {
          if (!pub.isSubscribed) pub.setSubscribed(true);
        } else if (pub.source === Track.Source.ScreenShare) {
          if (!pub.isSubscribed) pub.setSubscribed(true);
        } else {
          const want = !settings.audioOnly && videos < settings.maxVideos;
          if (want) videos++;
          if (pub.isSubscribed !== want) pub.setSubscribed(want);
        }
      }
    }
  }

  private refresh() {
    const room = this.room;
    if (!room) return;
    const alive = new Set<string>();
    const mk = (p: Participant, local: boolean): Tile => {
      const cam = p.getTrackPublication(Track.Source.Camera);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const scr = p.getTrackPublication(Track.Source.ScreenShare);
      const el = (pub: typeof cam) => {
        const tr = pub?.track;
        if (!pub || !tr || pub.isMuted) return null;
        alive.add(pub.trackSid);
        let e = this.vEls.get(pub.trackSid);
        if (!e) {
          e = document.createElement("video");
          e.muted = true;
          e.playsInline = true;
          e.autoplay = true;
          tr.attach(e);
          this.vEls.set(pub.trackSid, e);
        }
        return e;
      };
      return {
        identity: p.identity,
        name: p.name || p.identity,
        local,
        mic: !!mic && !mic.isMuted,
        cam: !!cam && !cam.isMuted && !!cam.track,
        speaking: p.isSpeaking,
        video: el(cam),
        screen: el(scr),
      };
    };
    const list: Tile[] = this.publishing ? [mk(room.localParticipant, true)] : [];
    room.remoteParticipants.forEach((p: RemoteParticipant) => list.push(mk(p, false)));
    // remote audio elements
    room.remoteParticipants.forEach((p) => {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.track && !this.audioEls.has(pub.trackSid)) {
          const a = pub.track.attach() as HTMLAudioElement;
          this.audioHost.appendChild(a);
          this.audioEls.add(pub.trackSid);
        }
      }
    });
    for (const [sid, e] of this.vEls) {
      if (!alive.has(sid)) {
        e.srcObject = null;
        this.vEls.delete(sid);
      }
    }
    this.tiles = list;
    const speaking = new Set<number>();
    for (const tl of list) if (tl.speaking) speaking.add(Number(tl.identity));
    this.onSpeaking(speaking);
    const st = getState();
    const lp = room.localParticipant;
    const sharing = lp.isScreenShareEnabled;
    if (this.publishing && (this.target === "spotlight" || !st.spotlight?.me) && (st.mic !== lp.isMicrophoneEnabled || st.cam !== lp.isCameraEnabled || st.sharing !== sharing))
      setState({ mic: lp.isMicrophoneEnabled, cam: lp.isCameraEnabled, sharing });
    this.emit();
  }

  private audioEls = new Set<string>();
  private vEls = new Map<string, HTMLVideoElement>();

  // ---- local controls ----
  async setMic(on: boolean) {
    if (!this.room || !this.publishing) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(on);
      setState({ deviceError: "" });
    } catch (e) {
      setState({ deviceError: describeMediaError(e) });
    }
    this.refresh();
  }

  async setCam(on: boolean) {
    if (!this.room || !this.publishing) return;
    try {
      await this.room.localParticipant.setCameraEnabled(on);
      setState({ deviceError: "" });
    } catch (e) {
      setState({ deviceError: describeMediaError(e) });
    }
    this.refresh();
  }

  async setShare(on: boolean) {
    if (!this.room || !this.publishing) return;
    try {
      await this.room.localParticipant.setScreenShareEnabled(on, on ? { audio: true, contentHint: "detail", resolution: { width: 1280, height: 720, frameRate: 15 } } : undefined);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name !== "NotAllowedError") setState({ deviceError: describeMediaError(e) });
    }
    this.refresh();
  }

  async switchDevice(kind: "audioinput" | "videoinput" | "audiooutput", id: string) {
    if (!this.room) return;
    await this.room.switchActiveDevice(kind, id).catch((e) => setState({ deviceError: describeMediaError(e) }));
  }
  private setPlaybackState(state: "connecting" | "live" | "reconnecting" | "failed") {
    if (this.target === "spotlight") {
      const s = getState().spotlight;
      if (s) setState({ spotlight: { ...s, state } });
    } else setConvState(state);
  }
}

function setConvState(state: "connecting" | "live" | "reconnecting" | "failed") {
  const c = getState().conv;
  if (c) setState({ conv: { ...c, state } });
}

export const media = new MediaManager();
export const spotlightMedia = new MediaManager("spotlight");
export const activeMedia = () => getState().spotlight?.me ? spotlightMedia : media;
