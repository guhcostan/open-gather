import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { media, spotlightMedia, type MediaManager, type Tile } from "../media/MediaManager";
import { useStore } from "../store";
import { t } from "../i18n";
import { MicOffIcon } from "./Icons";

function Video({ el, mirror }: { el: HTMLVideoElement | null; mirror?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    if (el) {
      host.replaceChildren(el);
      void el.play().catch(() => {});
    } else host.replaceChildren();
  }, [el]);
  return <div ref={ref} className={"vid" + (mirror ? " mirror" : "")} />;
}

export function TileView({ tile, big, mgr = media }: { tile: Tile; big?: boolean; mgr?: MediaManager }) {
  const roster = useStore((s) => s.roster);
  const p = roster.get(Number(tile.identity));
  const name = p?.n ?? tile.name;
  const nextVol = tile.vol >= 1 ? 0.5 : tile.vol > 0 ? 0 : 1;
  return (
    <div className={"tile" + (tile.speaking ? " speaking" : "") + (big ? " big" : "")}>
      {big ? <Video el={tile.screen} /> : tile.cam ? <Video el={tile.video} mirror={tile.local} /> : <div className="avatar-fallback">{(p?.n ?? tile.name).slice(0, 1).toUpperCase()}</div>}
      <span className="tag">
        {tile.local ? t("media.you") : p?.n ?? tile.name}
        {!tile.mic && !big && <MicOffIcon />}
      </span>
      {!tile.local && !big && (
        <button className="vol" onClick={() => mgr.setVolume(tile.identity, nextVol)} aria-label={t("media.volumeOf", { name, level: Math.round(tile.vol * 100) })} title={t("media.volumeOf", { name, level: Math.round(tile.vol * 100) })}>
          {tile.vol >= 1 ? "🔊" : tile.vol > 0 ? "🔉" : "🔇"}
        </button>
      )}
    </div>
  );
}

export function SpotlightDock() {
  const tiles = useSyncExternalStore(spotlightMedia.subscribe, spotlightMedia.getTiles);
  const spot = useStore((s) => s.spotlight);
  const consent = useStore((s) => s.consent);
  if (!spot) return null;
  return <section className="spotlight-dock" aria-label={t("spot.title")}>
    <p role="status">{spot.me ? t("spot.onAir") : t("spot.speaker", { name: spot.name })}</p>
    {!consent && <p>{t("spot.listen")}</p>}
    {tiles.filter((tile) => Number(tile.identity) === spot.id).map((tile) => <div key={tile.identity}>
      <TileView tile={tile} mgr={spotlightMedia} />
      {tile.screen && <ShareView tile={tile} />}
    </div>)}
  </section>;
}

/** A shared screen with view controls: expand over the map, full screen, picture-in-picture. */
function ShareView({ tile }: { tile: Tile }) {
  const [focus, setFocus] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const roster = useStore((s) => s.roster);
  const name = tile.local ? t("media.you") : roster.get(Number(tile.identity))?.n ?? tile.name;
  useEffect(() => {
    if (!focus) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setFocus(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [focus]);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.().catch(() => {});
  };
  const pip = () => void tile.screen?.requestPictureInPicture?.().catch(() => {});
  return (
    <div ref={box} className={"share" + (focus ? " focus" : "")} role="group" aria-label={t("media.sharing", { name })}>
      <TileView tile={tile} big />
      <div className="share-tools">
        <button className="chip" onClick={() => setFocus(!focus)} aria-pressed={focus} aria-label={focus ? t("share.shrink") : t("share.expand")} title={focus ? t("share.shrink") : t("share.expand")}>{focus ? "⤡" : "⤢"}</button>
        <button className="chip" onClick={fullscreen} aria-label={t("share.fullscreen")} title={t("share.fullscreen")}>⛶</button>
        {document.pictureInPictureEnabled && <button className="chip" onClick={pip} aria-label={t("share.pip")} title={t("share.pip")}>⧉</button>}
      </div>
    </div>
  );
}

export function VideoDock() {
  const tiles = useSyncExternalStore(media.subscribe, media.getTiles);
  const conv = useStore((s) => s.conv);
  const eco = useStore((s) => s.settings.eco);
  if (!conv || tiles.length === 0) return null;
  const shares = tiles.filter((x) => x.screen);
  return (
    <section className={"dock" + (eco ? " eco" : "")} aria-label={t("chat.conversation")}>
      {shares.map((s) => (
        <ShareView key={"s" + s.identity} tile={s} />
      ))}
      <div className="grid">
        {tiles.map((x) => (
          <TileView key={x.identity} tile={x} />
        ))}
      </div>
    </section>
  );
}
