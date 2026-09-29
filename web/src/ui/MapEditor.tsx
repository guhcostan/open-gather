import { useEffect, useRef, useState } from "react";
import { session } from "../session";
import { cloneMap, computeSolid, propSize, PROP_TYPES, toWire } from "../game/mapModel";
import type { MapData } from "../net/protocol";
import { toast, useStore } from "../store";
import { t } from "../i18n";

type Tool = "wall" | "prop" | "erase" | "room" | "unroom" | "desk";

export function MapEditor({ onClose }: { onClose: () => void }) {
  const roster = useStore((s) => s.roster);
  const [tool, setTool] = useState<Tool>("wall");
  const [propType, setPropType] = useState("plant");
  const [assignTo, setAssignTo] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [roomName, setRoomName] = useState("");
  const [access, setAccess] = useState("open");
  const draft = useRef<MapData | null>(null);
  const original = useRef<MapData | null>(null);
  const drag = useRef<{ x: number; y: number; paint?: boolean } | null>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const m = session.view?.currentMap();
    if (m) {
      draft.current = cloneMap(m);
      original.current = cloneMap(m);
    }
    return () => {
      session.view?.setHover(null);
      if (original.current) session.view?.previewMap(original.current); // discard unsaved edits
    };
  }, []);

  const apply = () => {
    const d = draft.current!;
    d.solid = computeSolid(d);
    session.view?.previewMap(d);
    setDirty(true);
  };

  const tileAt = (e: React.PointerEvent) => session.view!.screenToTile(e.clientX, e.clientY);

  const down = (e: React.PointerEvent) => {
    const d = draft.current;
    if (!d || !session.view) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = tileAt(e);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    if (tool === "wall") {
      const on = d.walls[y][x] !== "#";
      drag.current = { x, y, paint: on };
      setWall(x, y, on);
    } else if (tool === "prop") {
      if (!d.props.some((p) => p.t === propType && p.x === x && p.y === y)) {
        d.props.push({ t: propType, x, y });
        apply();
      }
    } else if (tool === "erase") {
      for (let i = d.props.length - 1; i >= 0; i--) {
        const p = d.props[i];
        const [w, h] = propSize(p);
        if (x >= p.x && x < p.x + w && y >= p.y && y < p.y + h) {
          d.props.splice(i, 1);
          apply();
          break;
        }
      }
    } else if (tool === "room") {
      drag.current = { x, y };
      setPending({ x, y, w: 1, h: 1 });
    } else if (tool === "unroom") {
      const i = d.areas.findIndex((a) => a.kind === "room" && x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
      if (i >= 0) {
        d.areas.splice(i, 1);
        apply();
      }
    } else if (tool === "desk") {
      const p = d.props.find((q) => {
        if (q.t !== "desk") return false;
        const [w, h] = propSize(q);
        return x >= q.x && x < q.x + w && y >= q.y && y < q.y + h;
      });
      if (p && assignTo) {
        p.assign = assignTo;
        p.label = t("editor.deskOf", { name: roster.get(assignTo)?.n ?? "" }).slice(0, 40);
        apply();
      }
    }
  };

  const setWall = (x: number, y: number, on: boolean) => {
    const d = draft.current!;
    const row = d.walls[y];
    if (on === (row[x] === "#")) return;
    d.walls[y] = row.slice(0, x) + (on ? "#" : ".") + row.slice(x + 1);
    apply();
  };

  const move = (e: React.PointerEvent) => {
    const d = draft.current;
    if (!d || !session.view) return;
    const [x, y] = tileAt(e);
    if (tool === "prop") {
      const [w, h] = propSize({ t: propType, x, y });
      session.view.setHover({ x, y, w, h });
    } else if (tool === "room" && drag.current) {
      const x0 = Math.min(drag.current.x, x), y0 = Math.min(drag.current.y, y);
      const r = { x: x0, y: y0, w: Math.abs(x - drag.current.x) + 1, h: Math.abs(y - drag.current.y) + 1 };
      setPending(r);
      session.view.setHover(r);
    } else {
      session.view.setHover({ x, y, w: 1, h: 1 });
    }
    if (tool === "wall" && drag.current?.paint !== undefined && x >= 0 && y >= 0 && x < d.w && y < d.h) setWall(x, y, drag.current.paint);
  };

  const up = () => {
    if (tool === "wall") drag.current = null;
    if (tool === "room") drag.current = null;
  };

  const createRoom = () => {
    const d = draft.current;
    if (!d || !pending || !roomName.trim()) return;
    const base = roomName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sala";
    let id = base, n = 2;
    while (d.areas.some((a) => a.id === id)) id = `${base}-${n++}`;
    d.areas.push({ id, name: roomName.trim().slice(0, 60), kind: "room", ...pending, floor: "carpet_teal", access: { mode: access }, capacity: 20 });
    setPending(null);
    setRoomName("");
    session.view?.setHover(null);
    apply();
  };

  const save = async () => {
    const d = draft.current!;
    const r = await fetch("/api/map", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toWire(d)) });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      toast(`${t("editor.saveError")}: ${j.error ?? r.status}`);
      return;
    }
    original.current = cloneMap(d); // now the saved version
    setDirty(false);
    toast(t("editor.saved"));
  };

  return (
    <>
      <div className="editor-layer" ref={layer} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => session.view?.setHover(null)} />
      <aside className="editor" aria-label={t("editor.title")}>
        <h3>{t("editor.title")}</h3>
        <div className="chips">
          {(["wall", "prop", "erase", "room", "unroom", "desk"] as Tool[]).map((k) => (
            <button key={k} className={"chip" + (tool === k ? " on" : "")} onClick={() => { setTool(k); setPending(null); }}>{t(`editor.tool.${k}` as never)}</button>
          ))}
        </div>
        {tool === "prop" && (
          <label className="field"><span>{t("editor.object")}</span>
            <select value={propType} onChange={(e) => setPropType(e.target.value)}>
              {PROP_TYPES.map((p) => <option key={p.t} value={p.t}>{p.label}</option>)}
            </select>
          </label>
        )}
        {tool === "desk" && (
          <label className="field"><span>{t("editor.assign")}</span>
            <select value={assignTo} onChange={(e) => setAssignTo(Number(e.target.value))}>
              <option value={0}>—</option>
              {[...roster.values()].map((p) => <option key={p.id} value={p.id}>{p.n}</option>)}
            </select>
          </label>
        )}
        {tool === "room" && (
          <div className="field">
            <span>{t("editor.roomHint")}</span>
            {pending && (
              <>
                <input placeholder={t("editor.roomName")} maxLength={60} value={roomName} onChange={(e) => setRoomName(e.target.value)} />
                <select value={access} onChange={(e) => setAccess(e.target.value)} aria-label={t("editor.access")}>
                  <option value="open">{t("editor.access.open")}</option>
                  <option value="members">{t("editor.access.members")}</option>
                  <option value="admins">{t("editor.access.admins")}</option>
                </select>
                <button className="btn" onClick={createRoom} disabled={!roomName.trim()}>{t("editor.createRoom")}</button>
              </>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t("editor.close")}</button>
          <button className="primary" onClick={save} disabled={!dirty}>{t("editor.save")}</button>
        </div>
      </aside>
    </>
  );
}
