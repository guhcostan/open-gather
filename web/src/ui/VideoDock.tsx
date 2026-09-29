import { useEffect, useRef, useSyncExternalStore } from "react";
import { media, spotlightMedia, type Tile } from "../media/MediaManager";
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

export function TileView({ tile, big }: { tile: Tile; big?: boolean }) {
  const roster = useStore((s) => s.roster);
  const p = roster.get(Number(tile.identity));
  return (
    <div className={"tile" + (tile.speaking ? " speaking" : "") + (big ? " big" : "")}>
      {big ? <Video el={tile.screen} /> : tile.cam ? <Video el={tile.video} mirror={tile.local} /> : <div className="avatar-fallback">{(p?.n ?? tile.name).slice(0, 1).toUpperCase()}</div>}
      <span className="tag">
        {tile.local ? t("media.you") : p?.n ?? tile.name}
        {!tile.mic && !big && <MicOffIcon />}
      </span>
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
      <TileView tile={tile} />
      {tile.screen && <TileView tile={tile} big />}
    </div>)}
  </section>;
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
        <div key={"s" + s.identity} className="share">
          <TileView tile={s} big />
        </div>
      ))}
      <div className="grid">
        {tiles.map((x) => (
          <TileView key={x.identity} tile={x} />
        ))}
      </div>
    </section>
  );
}
