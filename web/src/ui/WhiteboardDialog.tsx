import { useEffect, useRef, useState } from "react";
import { boardModel } from "../game/boardModel";
import { session } from "../session";
import { t } from "../i18n";
import { useStore } from "../store";
import { Modal } from "./Modal";

const COLORS = ["#202032", "#cf312f", "#235bd1", "#227949", "#ac6100", "#7837b0", "#a82c79", "#ffffff"];
const WIDTHS = [2, 4, 8, 14];
let strokeID = crypto.getRandomValues(new Uint32Array(1))[0];
const nextID = () => strokeID = (strokeID + 1) >>> 0;

export function WhiteboardDialog({ onClose }: { onClose: () => void }) {
  const role = useStore((s) => s.role);
  const [tool, setTool] = useState<"pen" | "text" | "eraser">("pen");
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ id: number; points: number[]; count: number; last?: number[] } | null>(null);
  const flushTimer = useRef(0);
  const send = (op: "undo" | "clear") => session.board({ bk: boardModel.key, op });

  useEffect(() => {
    const draw = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, boardModel.width, boardModel.height);
      for (const s of boardModel.strokes) {
        ctx.strokeStyle = ctx.fillStyle = COLORS[s.c] ?? COLORS[0];
        ctx.lineWidth = WIDTHS[s.w] ?? 4;
        ctx.lineJoin = ctx.lineCap = "round";
        if (s.k === 1) {
          ctx.font = `${18 + s.w * 6}px sans-serif`;
          ctx.fillText(s.tx ?? "", s.p[0], s.p[1]);
        } else if (s.p.length >= 2) {
          ctx.beginPath(); ctx.moveTo(s.p[0], s.p[1]);
          for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i], s.p[i + 1]);
          if (s.p.length === 2) { ctx.arc(s.p[0], s.p[1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
          else ctx.stroke();
        }
      }
    };
    draw();
    const unsubscribe = boardModel.subscribe(draw);
    return () => { unsubscribe(); clearTimeout(flushTimer.current); gesture.current = null; };
  }, []);

  const flush = () => {
    const g = gesture.current;
    if (!g?.points.length) return;
    // One bounded batch every 50 ms, never one network message per pointer frame.
    session.board({ bk: boardModel.key, op: "draw", i: g.id, k: 0, c: color, w: width, p: g.points.splice(0, 100) });
    flushTimer.current = window.setTimeout(flush, 50);
  };
  const xy = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(boardModel.width, Math.round((e.clientX - r.left) * boardModel.width / r.width))), Math.max(0, Math.min(boardModel.height, Math.round((e.clientY - r.top) * boardModel.height / r.height)))];
  };
  const putText = (p: number[]) => {
    if (!text.trim()) return;
    session.board({ bk: boardModel.key, op: "draw", i: nextID(), k: 1, c: color, w: width, p, tx: text.trim() });
  };
  const erase = (p: number[]) => {
    // Whole-stroke eraser, shared with collaborators. Choose only the closest visible stroke.
    let nearest: (typeof boardModel.strokes)[number] | null = null, distance = 18;
    for (const s of boardModel.strokes) for (let i = 0; i < s.p.length; i += 2) {
      const d = Math.hypot(s.p[i] - p[0], s.p[i + 1] - p[1]);
      if (d < distance) { distance = d; nearest = s; }
    }
    if (nearest) session.board({ bk: boardModel.key, op: "del", o: nearest.o, i: nearest.i });
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = xy(e);
    if (tool === "text") { putText(p); return; }
    if (tool === "eraser") { erase(p); return; }
    gesture.current = { id: nextID(), points: p, count: 2, last: p };
    flush();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = xy(e);
    if (g.last && Math.hypot(p[0] - g.last[0], p[1] - g.last[1]) < 2) return;
    if (g.count >= 3900) { flush(); g.id = nextID(); g.count = 0; }
    if (g.points.length < 100) { g.points.push(...p); g.count += 2; g.last = p; }
  };
  const up = () => { clearTimeout(flushTimer.current); flush(); clearTimeout(flushTimer.current); gesture.current = null; };
  return <Modal title={t("board.title")} onClose={() => { up(); onClose(); }} wide>
    <div className="chips board-tools">
      {(["pen", "text", "eraser"] as const).map((k) => <button key={k} className={"chip" + (tool === k ? " on" : "")} aria-pressed={tool === k} onClick={() => { up(); setTool(k); }}>{t(`board.${k}`)}</button>)}
      <button className="btn" onClick={() => send("undo")}>{t("board.undo")}</button>
      {role === "admin" && <button className="btn" onClick={() => { if (confirm) { send("clear"); setConfirm(false); } else setConfirm(true); }}>{t(confirm ? "board.confirmClear" : "board.clear")}</button>}
    </div>
    <div className="board-palette">
      {COLORS.map((c, i) => <button key={c} className={"sw" + (color === i ? " on" : "")} aria-label={t("board.color", { number: i + 1 })} aria-pressed={color === i} style={{ background: c }} onClick={() => { up(); setColor(i); }} />)}
      <label className="field"><span>{t("board.width")}</span><input type="range" min={0} max={3} value={width} onChange={(e) => { up(); setWidth(Number(e.target.value)); }} /></label>
    </div>
    {tool === "text" && <label className="field"><span>{t("board.textHint")}</span><input maxLength={80} value={text} onChange={(e) => setText(e.target.value)} /><button className="btn" onClick={() => putText([400, 300])}>{t("board.placeText")}</button></label>}
    <canvas ref={canvas} className="whiteboard" width={boardModel.width} height={boardModel.height} aria-label={t("board.canvas")} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    <small className="muted">{t("board.accessHint")}</small>
    <div className="modal-actions"><button className="btn" onClick={() => {
      const a = document.createElement("a"); a.download = "whiteboard.png"; a.href = canvas.current!.toDataURL("image/png"); a.click();
    }}>{t("board.export")}</button><button className="primary" onClick={() => { up(); onClose(); }}>{t("settings.close")}</button></div>
  </Modal>;
}
