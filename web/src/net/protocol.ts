export type Status = "available" | "busy" | "away" | "invisible";
export type PublicStatus = Status | "offline";
export type Role = "admin" | "member";

export interface AvatarSpec {
  sk: number; // skin
  hs: number; // hair style
  hc: number; // hair color
  sh: number; // shirt
  pa: number; // pants
}

export interface Person {
  id: number;
  n: string;
  av: AvatarSpec;
  s: PublicStatus;
  r: Role;
}

export interface Area {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: string;
  access: { mode: string; users?: number[] };
  capacity?: number;
}
export interface Prop {
  t: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  assign?: number;
  label?: string;
  data?: string; // available only in the admin editor or an authorized interaction reply
  to?: { x: number; y: number };
}
export interface MapData {
  version: number;
  tile: number;
  w: number;
  h: number;
  walls: string[];
  solid: string[];
  props: Prop[];
  areas: Area[];
  spawn: { x: number; y: number };
}

export interface Hello {
  t: "hello";
  you: number;
  role: Role;
  status: Status;
  office: string;
  cfg: { speed: number; tick: number; media: boolean; x: number; y: number; deny: number[]; lk?: number[] };
  map: MapData;
  roster: Person[];
  chat?: { f: number; n: string; x: string; ts: number }[];
}

export interface WorldDelta {
  t: "w";
  k: number;
  m?: [number, number, number, number][];
  l?: number[];
}
export interface Ack { t: "a"; s: number; x: number; y: number }
export interface RosterDelta { t: "p"; a?: Person[]; d?: number[] }
export interface ChatIn {
  t: "c";
  sc: "o" | "g" | "d";
  f: number;
  to?: number;
  x: string;
  ts: number;
}
export interface ConvJoin {
  t: "conv";
  op: "join";
  k: "p" | "r";
  gid: number;
  room: string;
  name: string;
  url: string;
  tok: string;
  m: number[];
}
export interface ConvMembers { t: "conv"; op: "m"; m: number[] }
export interface ConvLeave { t: "conv"; op: "leave" }
export interface Loc { t: "loc"; id: number; ok: boolean; x?: number; y?: number; a?: string }
export interface Pong { t: "pong"; c: number }

export interface MapUpdate { t: "map"; deny: number[]; x?: number; y?: number; map: MapData }

export interface Emote { t: "e"; id: number; v: number }
export interface ObjectReply { t: "obj"; k: "note" | "embed" | "image"; l: string; d: string }
export interface Follow { t: "fol"; id: number; n: string }
export interface SelfPosition { t: "self"; x: number; y: number; dx: number; dy: number; d: number; tp: boolean }
export interface LeadRequest { t: "lreq"; from: number; n: string }
export interface DoorState { t: "deny"; d: number[]; lk: number[] }
export interface Knock { t: "knk"; id: number; n?: string; a?: string; done?: boolean }
export interface KnockResult { t: "knr"; st: "wait" | "ok" | "no" | "empty"; a: string }
export interface BoardStroke { o: number; i: number; k: number; c: number; w: number; p: number[]; tx?: string }
export type BoardEvent =
  | { t: "wb"; op: "state"; bk: string; w: number; h: number; s: BoardStroke[] }
  | ({ t: "wb"; op: "draw"; bk: string } & BoardStroke)
  | { t: "wb"; op: "del"; bk: string; o: number; i: number }
  | { t: "wb"; op: "clear"; bk: string }
  | { t: "wb"; op: "closed" };
export type BoardCommand = { op: "draw" | "del" | "undo" | "clear" | "close"; bk: string; i?: number; o?: number; k?: number; c?: number; w?: number; p?: number[]; tx?: string };
export type Spotlight = { t: "spot"; op: "off" } | { t: "spot"; op: "on"; sid: number; n: string; me: boolean; room?: string; url?: string; tok?: string };

export type ServerMsg = MapUpdate | Hello | WorldDelta | Ack | RosterDelta | ChatIn | ConvJoin | ConvMembers | ConvLeave | Loc | Pong | Emote | ObjectReply | Follow | SelfPosition | LeadRequest | DoorState | Knock | KnockResult | BoardEvent | Spotlight;
