import { useEffect, useRef, useSyncExternalStore } from "react";
import { media, type Tile } from "../media/MediaManager";
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

function TileView({ tile, big }: { tile: Tile; big?: boolean }) {
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
