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
  const role = useStore((x) => x.role);
  const [link, setLink] = useState("");
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
  const createInvite = async () => {
    const r = await fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "member", maxUses: 10, hours: 24 }) });
    if (!r.ok) return toast(t("invite.error"));
    const j = (await r.json()) as { path: string };
    setLink(location.origin + j.path);
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
