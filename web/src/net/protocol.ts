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
  cfg: { speed: number; tick: number; media: boolean; x: number; y: number; deny: number[] };
  map: MapData;
  roster: Person[];
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

export type ServerMsg = MapUpdate | Hello | WorldDelta | Ack | RosterDelta | ChatIn | ConvJoin | ConvMembers | ConvLeave | Loc | Pong;
