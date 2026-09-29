import { session } from "../session";
import { activeMedia } from "../media/MediaManager";
import { savePrefs, toast, useStore } from "../store";
import { t } from "../i18n";
import { CamIcon, CamOffIcon, GearIcon, LeaveIcon, MicIcon, MicOffIcon, ScreenIcon } from "./Icons";

export function MediaBar({ onEnable, onSettings }: { onEnable: () => void; onSettings: () => void }) {
  const available = useStore((s) => s.mediaAvailable);
  const consent = useStore((s) => s.consent);
  const conv = useStore((s) => s.conv);
  const spotlight = useStore((s) => s.spotlight);
  const mic = useStore((s) => s.mic);
  const cam = useStore((s) => s.cam);
  const sharing = useStore((s) => s.sharing);
  const prefs = useStore((s) => s.prefs);
  const audioOnly = useStore((s) => s.settings.audioOnly);
  const err = useStore((s) => s.deviceError);
  const live = !!conv && conv.state === "live" || !!spotlight?.me && spotlight.state === "live";

  const micOn = live ? mic : prefs.micOn;
  const camOn = live ? cam : prefs.camOn;

  const toggleMic = () => {
    savePrefs({ micOn: !micOn });
    if (live) void activeMedia().setMic(!mic);
  };
  const toggleCam = () => {
    savePrefs({ camOn: !camOn });
    if (live) void activeMedia().setCam(!cam);
  };

  return (
    <footer className="bar">
      {err && <div className="bar-error" role="alert">{err}</div>}
      {conv && (
        <div className="convline" role="status">
          {conv.state === "connecting" && t("media.connecting")}
          {conv.state === "reconnecting" && t("media.reconnecting")}
          {conv.state === "failed" && t("media.failed")}
          {conv.state === "live" && <><i className="rec" /> {t("media.live")} · {conv.kind === "r" ? t("conv.room", { name: conv.name }) : t("chat.conversation")}</>}
        </div>
      )}
      <div className="bar-row">
        {!available ? (
          <span className="muted">{t("media.unavailable")}</span>
        ) : !consent ? (
          <button className="primary" onClick={onEnable}>{t("media.enable")}</button>
        ) : (
          <>
            <button className={"round" + (micOn ? "" : " off")} onClick={toggleMic} title={micOn ? t("media.mute") : t("media.unmute")} aria-pressed={micOn}>{micOn ? <MicIcon /> : <MicOffIcon />}</button>
            <button className={"round" + (camOn && !audioOnly ? "" : " off")} onClick={toggleCam} disabled={audioOnly} title={camOn ? t("media.camOff") : t("media.camOn")} aria-pressed={camOn}>{camOn && !audioOnly ? <CamIcon /> : <CamOffIcon />}</button>
            <button className={"round" + (sharing ? " on" : "")} disabled={!live} onClick={() => activeMedia().setShare(!sharing)} title={sharing ? t("media.stopShare") : t("media.share")} aria-pressed={sharing}><ScreenIcon /></button>
            <button className="round danger" onClick={() => { session.setConsent(false); toast(t("media.disabledHint")); }} title={t("media.leave")}><LeaveIcon /></button>
          </>
        )}
        <button className="round ghost" onClick={onSettings} title={t("settings.title")}><GearIcon /></button>
      </div>
      {available && !consent && <p className="hint">{t("media.disabledHint")}</p>}
    </footer>
  );
}
