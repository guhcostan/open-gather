import { getState } from "./store";

// Gentle cues for things that need you: a wave, a direct message, a knock. Sounds are synthesised
// (no audio files to license or download); desktop notifications only fire while the tab is hidden,
// only after the user opted in, and never carry message text (lock screens are public).

let ctx: AudioContext | null = null;

const TUNES: Record<"wave" | "dm" | "knock", number[]> = { wave: [660, 880], dm: [988], knock: [294, 294] };

export function chime(kind: keyof typeof TUNES) {
  if (!getState().settings.sounds) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    let t0 = ctx.currentTime + 0.01;
    for (const f of TUNES[kind]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.22);
      t0 += 0.15;
    }
  } catch {
    /* audio is a nicety */
  }
}

export function desktopNotify(title: string, body: string) {
  if (!document.hidden || !getState().settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: "og-" + title, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

export async function askNotifyPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

