import { useEffect, useRef, useState } from "react";
import { session } from "../session";
import { setState, useStore } from "../store";
import { t } from "../i18n";
import { SidePanel } from "./SidePanel";
import { MediaBar } from "./MediaBar";
import { VideoDock, SpotlightDock } from "./VideoDock";
import { MediaDialog } from "./MediaDialog";
import { SettingsDialog } from "./SettingsDialog";
import { DebugHud } from "./DebugHud";
import { StatusMenu } from "./StatusMenu";
import { MapEditor } from "./MapEditor";
import { AdminButton, AdminDialog } from "./AdminDialog";
import { SocialControls } from "./SocialControls";
import { ObjectDialog } from "./ObjectDialog";
import { WhiteboardDialog } from "./WhiteboardDialog";
import { Minimap } from "./Minimap";
import { TouchPad } from "./TouchPad";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function OfficeScreen() {
  const host = useRef<HTMLDivElement>(null);
  const conn = useStore((s) => s.conn);
  const office = useStore((s) => s.office);
  const area = useStore((s) => s.currentArea);
  const toastMsg = useStore((s) => s.toast);
  const debug = useStore((s) => s.settings.debug);
  const role = useStore((s) => s.role);
  const object = useStore((s) => s.object);
  const boardKey = useStore((s) => s.boardKey);
  const demo = useStore((s) => s.demo);
  const announcement = useStore((s) => s.announcement);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"" | "media" | "settings" | "admin" | "keys">("");

  useEffect(() => {
    if (!host.current) return;
    void session.start(host.current);
    return () => session.stop();
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "?" || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) || document.querySelector(".scrim, .editor")) return;
      setDialog("keys");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setState({ announcement: null }), 60000);
    return () => clearTimeout(timer);
  }, [announcement]);

  return (
    <div className="office">
      <div className="stage" ref={host} role="application" aria-label={t("map.label")} />
      <header className="topbar">
        <strong className="brand">{office || t("app.name")}</strong>
        {area && <span className="pill">{area}</span>}
        {demo && <span className="pill" title={t("demo.reset", { time: new Date(demo.nextReset * 1000).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) })}>{t("demo.pill")}</span>}
        {conn !== "open" && conn !== "connecting" && <span className="pill warn" role="status">{conn === "replaced" ? t("conn.replaced") : t("conn.reconnecting")}</span>}
        <span className="spacer" />
        <button className="btn" onClick={() => setDialog("keys")} aria-label={t("keys.open")} title={t("keys.open")}>?</button>
        <AdminButton onOpen={() => setDialog("admin")} />
        {role === "admin" && !editing && <button className="btn" onClick={() => setEditing(true)}>{t("editor.open")}</button>}
        <StatusMenu />
      </header>
      {announcement && (
        <div className="announce" role="alert">
          <span aria-hidden="true">📣</span> <b>{announcement.name}</b> <span>{announcement.text}</span>
          <button className="btn" onClick={() => setState({ announcement: null })} aria-label={t("announce.dismiss")} title={t("announce.dismiss")}>×</button>
        </div>
      )}
      <SidePanel />
      {!editing && <SocialControls />}
      {!editing && <Minimap />}
      {!editing && <TouchPad />}
      {editing && <MapEditor onClose={() => setEditing(false)} />}
      <VideoDock />
      <SpotlightDock />
      <MediaBar onEnable={() => setDialog("media")} onSettings={() => setDialog("settings")} />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {debug && <DebugHud />}
      {dialog === "media" && <MediaDialog onClose={() => setDialog("")} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog("")} />}
      {dialog === "admin" && <AdminDialog onClose={() => setDialog("")} />}
      {dialog === "keys" && <ShortcutsDialog onClose={() => setDialog("")} />}
      {object && <ObjectDialog object={object} onClose={() => setState({ object: null })} />}
      {boardKey && <WhiteboardDialog onClose={() => { session.board({ bk: boardKey, op: "close" }); setState({ boardKey: "" }); }} />}
    </div>
  );
}
