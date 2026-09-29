import { useState } from "react";
import { media } from "../media/MediaManager";
import { session } from "../session";
import { saveAvatar, saveSettings, toast, useStore } from "../store";
import type { AvatarSpec } from "../net/protocol";
import { AvatarEditor } from "./AvatarEditor";
import { t } from "../i18n";
import { Modal } from "./Modal";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore((x) => x.settings);
  const meId = useStore((x) => x.meId);
  const myName = useStore((x) => x.roster.get(x.meId)?.n ?? "");
  const myAvatar = useStore((x) => x.myAvatar);
  const [name, setName] = useState(myName);
  const [avatar, setAvatar] = useState<AvatarSpec>(useStore((x) => x.roster.get(x.meId)?.av) ?? myAvatar);
  const saveProfile = async () => {
    const r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), avatar }) });
    if (!r.ok) return toast(t("settings.profileError"));
    saveAvatar(avatar);
    localStorage.setItem("og.name", name.trim());
    toast(t("settings.profileSaved"));
  };
  return (
    <Modal title={t("settings.title")} onClose={onClose}>
      {meId > 0 && (
        <div className="field">
          <span>{t("settings.profile")}</span>
          <input maxLength={24} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("join.name")} />
          <AvatarEditor value={avatar} onChange={setAvatar} />
          <button className="btn" onClick={saveProfile} disabled={!name.trim()}>{t("settings.saveProfile")}</button>
        </div>
      )}
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
      <div className="modal-actions"><button className="primary" onClick={onClose}>{t("settings.close")}</button></div>
    </Modal>
  );
}
