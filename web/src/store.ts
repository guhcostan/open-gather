import { useSyncExternalStore } from "react";
import type { AvatarSpec, Person, Role, Status } from "./net/protocol";

export interface ChatMsg {
  id: number;
  sc: "o" | "g" | "d";
  from: number;
  to?: number;
  text: string;
  ts: number;
  n?: string; // sender name, for history entries whose author is offline
}

export type ConvState = "connecting" | "live" | "reconnecting" | "failed";
export interface Conv {
  kind: "p" | "r";
  name: string;
  members: number[];
  state: ConvState;
}

export interface Settings {
  eco: boolean;
  maxVideos: number;
  audioOnly: boolean;
  debug: boolean;
}

export interface MediaPrefs {
  micOn: boolean;
  camOn: boolean;
  micId: string;
  camId: string;
  spkId: string;
}

export interface State {
  phase: "boot" | "join" | "play";
  conn: "connecting" | "open" | "reconnecting" | "replaced";
  meId: number;
  role: Role;
  status: Status;
  office: string;
  mediaAvailable: boolean;
  consent: boolean;
  roster: Map<number, Person>;
  conv: Conv | null;
  chat: ChatMsg[];
  unread: number;
  settings: Settings;
  prefs: MediaPrefs;
  mic: boolean;
  cam: boolean;
  sharing: boolean;
  deviceError: string;
  currentArea: string;
  toast: string;
  myAvatar: AvatarSpec;
  /** One-off message shown on the join screen (for example after being removed). */
  notice: string;
}

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...d, ...JSON.parse(v) } : d;
  } catch {
    return d;
  }
};

const initial: State = {
  phase: "boot",
  conn: "connecting",
  meId: 0,
  role: "member",
  status: "available",
  office: "",
  mediaAvailable: false,
  consent: localStorage.getItem("og.consent") === "1",
  roster: new Map(),
  conv: null,
  chat: [],
  unread: 0,
  settings: load<Settings>("og.settings", { eco: false, maxVideos: 6, audioOnly: false, debug: false }),
  prefs: load<MediaPrefs>("og.prefs", { micOn: true, camOn: false, micId: "", camId: "", spkId: "" }),
  mic: false,
  cam: false,
  sharing: false,
  deviceError: "",
  currentArea: "",
  toast: "",
  myAvatar: load<AvatarSpec>("og.avatar", { sk: 1, hs: 0, hc: 1, sh: 4, pa: 1 }),
  notice: "",
};

let state = initial;
const subs = new Set<() => void>();

export const getState = () => state;
export function setState(p: Partial<State>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => sel(state),
  );
}

export function saveSettings(s: Partial<Settings>) {
  const settings = { ...state.settings, ...s };
  localStorage.setItem("og.settings", JSON.stringify(settings));
  setState({ settings });
}
export function savePrefs(p: Partial<MediaPrefs>) {
  const prefs = { ...state.prefs, ...p };
  localStorage.setItem("og.prefs", JSON.stringify(prefs));
  setState({ prefs });
}
export function saveAvatar(a: AvatarSpec) {
  localStorage.setItem("og.avatar", JSON.stringify(a));
  setState({ myAvatar: a });
}

let toastTimer = 0;
export function toast(msg: string, ms = 4000) {
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setState({ toast: "" }), ms);
}
