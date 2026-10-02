# Art style

Tilework looks like a 2000s handheld RPG: a top-down 3/4 view, 16 px tiles, chunky characters with big heads, outlined props with three-tone shading, and white dialog-window menus. The goal is that style, **not** any existing game's assets.

> **Original work only.** Every tile, prop, sprite, colour and UI frame is drawn by code in this repository. We do not use, trace, extract or re-colour assets from Pokémon or any other Nintendo, Game Freak or third-party game, and the project has no affiliation with them. A visual *style* (proportions, palette feel, pixel conventions) can be studied; assets and characters cannot be copied. See also [Contributing](contributing.md).

## Rules of the look

| Aspect | Rule |
| --- | --- |
| Tile size | 16 x 16 px; the map is baked into one texture |
| Camera | integer zoom only (nearest-neighbour), reference view about 320 x 200 world px (20 x 12.5 tiles); a 240 x 160 handheld screen would show 15 x 10 |
| Light | from the top-left: a light top/left edge, a darker bottom/right edge |
| Outlines | every prop and character has a 1 px dark outline, never pure black; on characters it is a very dark version of the neighbouring colour, so hair, skin and clothes stay distinct |
| Shading | three tones per material; highlights drift warm, shadows drift toward violet |
| Walls | banded face: cream upper wall, a coloured stripe that matches the room's floor, a wooden wainscot and baseboard; a flat dark ceiling cap on thick walls; contact shadow on the floor below |
| Floors | beveled pale plates with joint lines (reception), fine diagonal hatching on pale blue (desks), wide ochre planks with staggered joints (social area), dithered carpets with a dotted border band (meeting rooms); doorways get a doormat |
| Characters | 16 x 24 px content in an 18 x 26 cell; a 12 x 11 head (over half the sprite height), a 5-row torso and short legs; low-set eyes with a light blush; four directions, idle plus two walking frames; "right" is the mirrored "left" |
| UI | white message frames with a coloured ring and dark lines on both sides; cream panels with an orange header tab; blue message strips; pill buttons with hard shadows; a black triangle cursor; teal scanline background on the join screen; a lavender name plate when entering an area |
| Font | Pixelify Sans (SIL Open Font License 1.1), bundled in `web/src/assets/fonts` with its licence |

## Where the code lives

~~~text
web/src/game/art/pixel.ts        helpers: hue-shifted shading, deterministic hash, outlined slabs and blobs
web/src/game/art/tiles.ts        floors, walls, doorways, furniture, rugs and the whole-map baker
web/src/game/art/characters.ts   character painter, walk frames, per-cell outline, sheet builder
web/src/game/palette.ts          skin, hair, shirt and trouser palettes
web/src/game/avatars.ts          turns a sheet into cached PixiJS textures
web/src/game/mapArt.ts           turns the baked canvas into a texture
web/src/theme-gba.css            the dialog-window UI skin (overrides styles.css)
web/dev/art-preview.*            server-free preview page and the export used by the website
~~~

The painters are plain canvas code with no PixiJS dependency, so they can be previewed and exported without running the game.

## Preview and iterate

~~~bash
cd web && pnpm exec vite --port 5180
# open http://127.0.0.1:5180/dev/art-preview.html?s=8   (sprites at 8x, map at 4x)
~~~

To refresh the images used by the README and the website:

~~~bash
cd e2e
node export-art.mjs   # sprite sheets and the baked map (needs only the Vite preview above)
node art.mjs          # cast, walking GIF and banner (needs Chrome and ffmpeg)
# in-game shots (needs a game server that serves the built client):
TILEWORK_APP=http://127.0.0.1:8091 TILEWORK_API=http://127.0.0.1:8091 node screens.mjs
~~~

`web/dev/default-map.json` is a copy of the starter map from the Go server (`gamemap.Default()`); refresh it if that map changes.

## Adding things

- **A prop**: add its size to the dimensions table and a painter in `tiles.ts`, register the type in the Go map validator (`server/internal/gamemap`), and keep it solid or not in the Go table.
- **A hairstyle**: add a case in each of the front, back and side branches of `characters.ts` and a label in `palette.ts`. The server keeps avatar fields within fixed ranges, so widen those too.
- **A floor**: add an entry to the `FLOORS` table in `tiles.ts` and use its name in the map's areas.
