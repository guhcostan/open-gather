import { useState } from "react";
import type { ObjectReply } from "../net/protocol";
import { t } from "../i18n";
import { Modal } from "./Modal";

export function ObjectDialog({ object, onClose }: { object: ObjectReply; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // The server validates it; guard here too so an older map cannot create executable links.
  const safe = (() => { try { const u = new URL(object.d); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } })();
  return <Modal title={object.l || t(`object.${object.k}`)} onClose={onClose} wide>
    {object.k === "note" ? <p className="object-note">{object.d}</p> : safe ? <>
      <p className="muted">{t("object.external")}</p>
      <a href={object.d} target="_blank" rel="noopener noreferrer">{t("object.openLink")}</a>
      {!loaded ? <button className="primary" onClick={() => setLoaded(true)}>{t("object.load")}</button> : object.k === "image" ? <>
        <img className="object-image" src={object.d} alt={object.l} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        {failed && <p role="alert">{t("object.imageError")}</p>}
      </> : <>
        <iframe className="object-embed" title={object.l || t("object.embed")} src={object.d} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" />
        <p className="muted">{t("object.embedHint")}</p>
      </>}
    </> : null}
    <div className="modal-actions"><button className="btn" onClick={onClose}>{t("settings.close")}</button></div>
  </Modal>;
}
