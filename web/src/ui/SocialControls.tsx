import { useEffect, useState } from "react";
import { session } from "../session";
import { setState, useStore } from "../store";
import { t, type Key } from "../i18n";
import { EMOTES } from "../game/emotes";
import { Modal } from "./Modal";

/** Low-rate UI state only: avatar reactions themselves are drawn by Pixi, not React. */
export function SocialControls() {
  const nearby = useStore((s) => s.nearby);
  const following = useStore((s) => s.following);
  const request = useStore((s) => s.leadRequest);
  const knock = useStore((s) => s.knock);
  const locked = useStore((s) => s.locked);
  const currentArea = useStore((s) => s.currentArea);
  const running = useStore((s) => s.running);
  const wave = useStore((s) => s.wave);
  const handUp = useStore((s) => s.roster.get(s.meId)?.h === 1);
  // Phones: the reactions collapse into one button so they never cover the map or the chat panel.
  const [compact, setCompact] = useState(() => window.matchMedia?.("(max-width: 700px)").matches ?? false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 700px)");
    const on = () => setCompact(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  const done = () => { if (compact) setOpen(false); };
  useEffect(() => {
    if (!wave) return;
    const timer = window.setTimeout(() => setState({ wave: null }), 20000);
    return () => clearTimeout(timer);
  }, [wave]);
  const [knockArea, setKnockArea] = useState<{ index: number; name: string } | null>(null);
  useEffect(() => {
    const update = () => {
      const map = session.view?.currentMap(), p = session.view?.position();
      if (!map || !p) return;
      const target = map.areas.map((a, index) => ({ ...a, index })).find((a) => {
        if (!locked.includes(a.index) || a.name === currentArea) return false;
        return Math.hypot(Math.max(a.x * 16 - p.x, 0, p.x - (a.x + a.w) * 16), Math.max(a.y * 16 - p.y, 0, p.y - (a.y + a.h) * 16)) <= 40;
      });
      setKnockArea((old) => old?.index === target?.index ? old : target ? { index: target.index, name: target.name } : null);
    };
    update();
    const timer = window.setInterval(update, 300);
    return () => clearInterval(timer);
  }, [locked, currentArea]);
  const map = session.view?.currentMap();
  const roomIndex = map?.areas.findIndex((a) => a.name === currentArea && a.kind === "room") ?? -1;
  return (
    <>
      <div className={"social-controls" + (compact && open ? " open" : "")} role="region" aria-label={t("emote.title")}>
        {compact && <button className="chip reaction-toggle" aria-expanded={open} aria-label={t("emote.title")} title={t("emote.title")} onClick={() => setOpen(!open)}>😀</button>}
        {(!compact || open) && <div className="reaction-row">
          {EMOTES.map((emoji, i) => <button key={i} className="chip" aria-label={t(`emote.${i + 1}` as Key)} title={`${i + 1} · ${t(`emote.${i + 1}` as Key)}`} onClick={() => { session.emote(i + 1); done(); }}>{emoji}</button>)}
          <button className={"chip run-toggle" + (running ? " on" : "")} aria-pressed={running} aria-label={t("run.toggle")} title={t("run.hint")} onClick={() => { session.toggleRun(); done(); }}>🏃</button>
          <button className="chip" aria-label={t("dance.action")} title={t("dance.action")} onClick={() => { session.emote(8); done(); }}>💃</button>
          <button className={"chip" + (handUp ? " on" : "")} aria-pressed={handUp} aria-label={handUp ? t("hand.lower") : t("hand.raise")} title={handUp ? t("hand.lower") : t("hand.raise")} onClick={() => { session.hand(!handUp); done(); }}>✋</button>
        </div>}
        {wave && (
          <div className="wave-card" role="alert">
            <span>{t("wave.incoming", { name: wave.name })}</span>
            <div className="modal-actions">
              <button className="btn" onClick={() => { session.wave(wave.id); setState({ wave: null }); }}>{t("wave.back")}</button>
              <button className="primary" onClick={() => { session.goToPerson(wave.id); setState({ wave: null }); }}>{t("wave.walk")}</button>
              <button className="btn" aria-label={t("wave.dismiss")} title={t("wave.dismiss")} onClick={() => setState({ wave: null })}>×</button>
            </div>
          </div>
        )}
        {nearby && <button className="btn interaction-hint" onClick={() => session.view?.interact()}>{t("object.use", { name: nearby.label || t(`object.${nearby.t}` as Key) })}</button>}
        {following && <div className="follow-hint"><span>{t("follow.active", { name: following.name })}</span> <button className="btn" onClick={() => session.follow(0)}>{t("follow.stop")}</button></div>}
        {roomIndex >= 0 && <button className="btn" onClick={() => session.lock(!locked.includes(roomIndex))}>{t(locked.includes(roomIndex) ? "door.unlock" : "door.lock")}</button>}
        {knockArea && <button className="btn" onClick={() => session.knock(knockArea.index)}>{t("door.knock", { area: knockArea.name })}</button>}
      </div>
      {request && <Modal title={t("follow.lead")} onClose={() => setState({ leadRequest: null })}>
        <p>{t("follow.request", { name: request.name })}</p>
        <div className="modal-actions"><button className="btn" onClick={() => setState({ leadRequest: null })}>{t("follow.decline")}</button><button className="primary" onClick={() => { session.follow(request.id); setState({ leadRequest: null }); }}>{t("follow.accept")}</button></div>
      </Modal>}
      {knock && <Modal title={t("door.knock", { area: knock.area })} onClose={() => session.answerKnock(knock.id, false)}>
        <p>{t("door.request", { name: knock.name, area: knock.area })}</p>
        <div className="modal-actions"><button className="btn" onClick={() => session.answerKnock(knock.id, false)}>{t("door.deny")}</button><button className="primary" onClick={() => session.answerKnock(knock.id, true)}>{t("door.allow")}</button></div>
      </Modal>}
    </>
  );
}
