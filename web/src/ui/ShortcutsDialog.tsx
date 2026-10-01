import { t, type Key } from "../i18n";
import { Modal } from "./Modal";

const ROWS: [string[], Key][] = [
  [["W A S D", "↑ ← ↓ →"], "keys.move"],
  [["Shift", "R"], "keys.run"],
  [[], "keys.goto"],
  [["X"], "keys.interact"],
  [["1-7"], "keys.emotes"],
  [["Z"], "keys.dance"],
  [["H"], "keys.hand"],
  [["M"], "keys.minimap"],
  [["Esc"], "keys.close"],
  [["?"], "keys.help"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("keys.title")} onClose={onClose}>
      <table className="keys">
        <caption className="sr-only">{t("keys.title")}</caption>
        <tbody>
          {ROWS.map(([ks, label]) => (
            <tr key={label}>
              <th scope="row">{ks.length ? ks.map((k, i) => <span key={k}>{i > 0 && " / "}<kbd>{k}</kbd></span>) : t("keys.dblclick")}</th>
              <td>{t(label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-actions"><button className="primary" onClick={onClose}>{t("settings.close")}</button></div>
    </Modal>
  );
}

