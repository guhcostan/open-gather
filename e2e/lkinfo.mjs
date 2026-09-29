// Prints the participants and published tracks of SFU rooms (debug helper for media load tests).
// usage: OG_LK_HTTP=http://127.0.0.1:17880 node lkinfo.mjs [roomPrefix]
import { lk } from "./lib.mjs";
const prefix = process.argv[2] ?? "";
const rooms = (await lk("ListRooms", {}, "")).rooms ?? [];
let pubs = 0, parts = 0;
for (const r of rooms.filter((r) => r.name.startsWith(prefix))) {
  const ps = (await lk("ListParticipants", { room: r.name }, r.name)).participants ?? [];
  parts += ps.length;
  for (const p of ps) pubs += (p.tracks ?? []).length;
  if (rooms.length <= 3) for (const p of ps) console.log(r.name, p.identity, (p.tracks ?? []).map((t) => t.type + ":" + (t.source ?? "") + ":muted=" + !!t.muted + ":layers=" + (t.layers?.length ?? 0) + ":codec=" + (t.mimeType ?? "") + ":" + (t.width ?? 0) + "x" + (t.height ?? 0)).join(","));
}
console.log(JSON.stringify({ rooms: rooms.filter((r) => r.name.startsWith(prefix)).length, participants: parts, tracks: pubs }));
