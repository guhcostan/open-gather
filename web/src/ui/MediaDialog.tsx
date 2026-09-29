import { useCallback, useEffect, useRef, useState } from "react";
import { describeMediaError } from "../media/MediaManager";
import { session } from "../session";
import { savePrefs, useStore } from "../store";
import { t } from "../i18n";
import { Modal } from "./Modal";

const canPickOutput = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

export function MediaDialog({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const [micOn, setMicOn] = useState(prefs.micOn);
  const [camOn, setCamOn] = useState(prefs.camOn);
  const [micId, setMicId] = useState(prefs.micId);
  const [camId, setCamId] = useState(prefs.camId);
  const [spkId, setSpkId] = useState(prefs.spkId);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [err, setErr] = useState("");
  const [level, setLevel] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopAudio = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    stopAudio.current();
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setLevel(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      /* no device API */
    }
  }, []);

  // (Re)start the preview whenever the selection changes. Nothing is captured before this dialog opens.
  useEffect(() => {
    let cancelled = false;
    stop();
    if (!micOn && !camOn) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(t("media.noDevice"));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: micOn ? (micId ? { deviceId: { exact: micId } } : true) : false,
        video: camOn ? (camId ? { deviceId: { exact: camId }, width: 640, height: 360 } : { width: 640, height: 360 }) : false,
      })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((tr) => tr.stop());
        stream.current = s;
        setErr("");
        if (video.current) video.current.srcObject = s;
        await refreshDevices();
        if (micOn && s.getAudioTracks().length) {
          const ctx = new AudioContext();
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          ctx.createMediaStreamSource(s).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const timer = window.setInterval(() => {
            an.getByteTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += (v - 128) * (v - 128);
            setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40));
          }, 100);
          stopAudio.current = () => {
            clearInterval(timer);
            void ctx.close();
          };
        }
      })
      .catch((e) => !cancelled && setErr(describeMediaError(e)));
    return () => {
      cancelled = true;
      stop();
    };
  }, [micOn, camOn, micId, camId, stop, refreshDevices]);

  const opts = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind);
  const activate = () => {
    stop();
    savePrefs({ micOn, camOn, micId, camId, spkId });
    session.setConsent(true);
    onClose();
  };

  return (
    <Modal title={t("media.enable")} onClose={onClose}>
      <p className="muted">{t("media.consentText")}</p>
      <div className="preview">
        <video ref={video} autoPlay muted playsInline className="mirror" />
        {!camOn && <span className="ph">{t("media.cameraOff")}</span>}
      </div>
      <div className="meter" aria-hidden><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
      {err && <p className="error" role="alert">{err}</p>}
      <label className="check"><input type="checkbox" checked={micOn} onChange={(e) => setMicOn(e.target.checked)} /> {t("media.startWithMic")}</label>
      <label className="check"><input type="checkbox" checked={camOn} onChange={(e) => setCamOn(e.target.checked)} /> {t("media.startWithCam")}</label>
      <label className="field"><span>{t("media.mic")}</span>
        <select value={micId} onChange={(e) => setMicId(e.target.value)}>
          <option value="">{t("media.default")}</option>
          {opts("audioinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
        </select>
      </label>
      <label className="field"><span>{t("media.camera")}</span>
        <select value={camId} onChange={(e) => setCamId(e.target.value)}>
          <option value="">{t("media.default")}</option>
          {opts("videoinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
        </select>
      </label>
      {canPickOutput && (
        <label className="field"><span>{t("media.speaker")}</span>
          <select value={spkId} onChange={(e) => setSpkId(e.target.value)}>
            <option value="">{t("media.default")}</option>
            {opts("audiooutput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
          </select>
        </label>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("media.cancel")}</button>
        <button className="primary" onClick={activate}>{t("media.activate")}</button>
      </div>
    </Modal>
  );
}
