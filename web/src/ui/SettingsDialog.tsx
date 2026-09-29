import { useState } from "react";
import { media } from "../media/MediaManager";
import { session } from "../session";
import { saveSettings, toast, useStore } from "../store";
import { t } from "../i18n";
import { Modal } from "./Modal";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore((x) => x.settings);
  const role = useStore((x) => x.role);
  const [link, setLink] = useState("");
  const createInvite = async () => {
    const r = await fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "member", maxUses: 10, hours: 24 }) });
    if (!r.ok) return toast(t("invite.error"));
    const j = (await r.json()) as { path: string };
    setLink(location.origin + j.path);
  };
  return (
    <Modal title={t("settings.title")} onClose={onClose}>
      <label className="check">
        <input type="checkbox" checked={s.eco} onChange={(e) => { saveSettings({ eco: e.target.checked, maxVideos: e.target.checked ? Math.min(s.maxVideos, 3) : s.maxVideos }); session.setEco(e.target.checked); media.applySubscriptions(); }} />
        <span>{t("settings.eco")}<small className="muted"> — {t("settings.ecoHint")}</small></span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.audioOnly} onChange={(e) => { saveSettings({ audioOnly: e.target.checked }); if (e.target.checked) void media.setCam(false); media.applySubscriptions(); }} />
        <span>{t("media.audioOnly")}</span>
      </label>
      <label className="field">
        <span>{t("settings.videoLimit")}: {s.maxVideos}</span>
        <input type="range" min={1} max={12} value={s.maxVideos} onChange={(e) => { saveSettings({ maxVideos: Number(e.target.value) }); media.applySubscriptions(); }} />
      </label>
      <label className="check">
        <input type="checkbox" checked={s.debug} onChange={(e) => saveSettings({ debug: e.target.checked })} />
        <span>{t("settings.debug")}</span>
      </label>
      {role === "admin" && (
        <div className="field">
          <span>{t("invite.title")}</span>
          {link ? (
            <div className="composer">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" onClick={() => { void navigator.clipboard.writeText(link); toast(t("invite.copied")); }}>{t("invite.copy")}</button>
            </div>
          ) : (
            <button className="btn" onClick={createInvite}>{t("invite.create")}</button>
          )}
          <small className="muted">{t("invite.hint")}</small>
        </div>
      )}
      <div className="modal-actions"><button className="primary" onClick={onClose}>{t("settings.close")}</button></div>
    </Modal>
  );
}
