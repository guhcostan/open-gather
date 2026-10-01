import { useEffect, useRef } from "react";
import { session } from "../session";
import { getState, saveSettings, useStore } from "../store";
import { t } from "../i18n";

const W = 200; // css px

/**
 * Overview of the whole office, redrawn 4 times a second from the world view (never per frame, never
 * through React state). Areas show head counts sent by the server, so busy places are visible from
 * anywhere without an office-wide position feed. Click to run to that spot.
 */
export function Minimap() {
  const enabled = useStore((s) => s.settings.minimap);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key.toLowerCase() !== "m" || e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector(".scrim, .editor")) return;
      saveSettings({ minimap: !getState().settings.minimap });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const draw = () => {
      const c = ref.current, view = session.view, map = view?.currentMap(), img = view?.mapImage();
      if (!c || !view || !map || !img) return;
      const s = W / (map.w * 16);
      const h = Math.round(map.h * 16 * s);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(h * dpr); c.style.height = h + "px"; }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(img, 0, 0, W, h);
      g.fillStyle = "rgba(20, 16, 40, 0.25)";
      g.fillRect(0, 0, W, h);
      // people in view (area of interest), me on top
      g.fillStyle = "#ffffff";
      for (const e of view.debugEntities()) { g.beginPath(); g.arc(e.x * s, e.y * s, 2, 0, 7); g.fill(); }
      const dest = view.destination();
      if (dest) { g.strokeStyle = "#3cc9b0"; g.lineWidth = 1.5; g.strokeRect(dest.x * s - 3, dest.y * s - 3, 6, 6); }
      const me = view.position();
      g.fillStyle = "#ffb84d"; g.strokeStyle = "#1a1526"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(me.x * s, me.y * s, 3.5, 0, 7); g.fill(); g.stroke();
      // head counts per area
      const counts = getState().areaCounts;
      g.font = "700 10px system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      map.areas.forEach((a, i) => {
        const n = counts[i] ?? 0;
        if (!n) return;
        const x = (a.x + a.w / 2) * 16 * s, y = (a.y + a.h / 2) * 16 * s;
        g.fillStyle = "#1a1526"; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
        g.fillStyle = "#ffe9a8"; g.fillText(n > 99 ? "99+" : String(n), x, y + 0.5);
      });
    };
    draw();
    const timer = window.setInterval(draw, 250);
    return () => clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;
  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const map = session.view?.currentMap();
    if (!map) return;
    const r = e.currentTarget.getBoundingClientRect();
    const s = W / (map.w * 16);
    session.view?.goTo(Math.floor((e.clientX - r.left) / s / 16), Math.floor((e.clientY - r.top) / s / 16));
  };
  return (
    <section className="minimap" aria-label={t("minimap.title")}>
      <canvas ref={ref} style={{ width: W }} onClick={click} role="img" aria-label={t("minimap.hint")} title={t("minimap.hint")} />
    </section>
  );
}

