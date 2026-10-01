import { useEffect, useState } from "react";
import { session } from "../session";
import { useStore } from "../store";
import { t } from "../i18n";

const DIRS: { k: "up" | "down" | "left" | "right"; dx: number; dy: number; glyph: string }[] = [
  { k: "up", dx: 0, dy: -1, glyph: "▲" },
  { k: "left", dx: -1, dy: 0, glyph: "◀" },
  { k: "right", dx: 1, dy: 0, glyph: "▶" },
  { k: "down", dx: 0, dy: 1, glyph: "▼" },
];

/** On-screen pad for touch screens (no keyboard). Holding a button walks; the runner button toggles running. */
export function TouchPad() {
  const [coarse, setCoarse] = useState(() => window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const running = useStore((s) => s.running);
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    const on = () => setCoarse(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  if (!coarse) return null;
  const hold = (dx: number, dy: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    session.view?.setDirection(dx, dy);
  };
  const release = () => session.view?.setDirection(0, 0);
  return (
    <div className="touchpad" role="group" aria-label={t("touch.pad")}>
      {DIRS.map((d) => (
        <button key={d.k} className={"tp-" + d.k} aria-label={t(`touch.${d.k}`)} onPointerDown={hold(d.dx, d.dy)} onPointerUp={release} onPointerCancel={release} onContextMenu={(e) => e.preventDefault()}>{d.glyph}</button>
      ))}
      <button className={"tp-run" + (running ? " on" : "")} aria-pressed={running} aria-label={t("run.toggle")} onClick={() => session.toggleRun()}>🏃</button>
    </div>
  );
}

