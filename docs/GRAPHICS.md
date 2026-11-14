# Graphics

The goal is a clearly prettier, consistent stylised anime look on **high** and **ultra**, while
**low** and **medium** (phones, school laptops) keep the cost they had. It is not "Genshin
Impact on max settings": that is not reachable in a browser game for phones.

All new passes are switched by flags in `src/world/quality.ts`; with a flag off, the pass is not drawn
and its shader code is compiled out. What low and medium still carry: the toon, glass, visor and
final-pass shaders have a few extra uniform operations (checked: pixel-identical output on those
tiers); `glow()` lights have their own shader program; Lumi's screen lights itself a little; the
`_low` models have about 8 percent more triangles (new stripes and lights); and the film look makes
the vignette stronger on every tier.

## What each tier does

| | low | medium | high | ultra |
|---|---|---|---|---|
| Scene picture | 0.8 scale, no HDR | full, HDR, MSAA 2 | full, HDR, MSAA 4 | pixel ratio up to 2, MSAA 4 |
| Bloom, ink outlines | no | yes | yes | yes (6 levels) |
| Contact shadows (AO) | no | no | yes, 8 samples, half size | yes, 14 samples, half size |
| Sun light shafts (Mars) | no | no | yes, 20 samples | yes, 32 samples |
| World colour grade + anime glow | no | no | yes | yes |
| Film look for cutscenes | stronger vignette only | stronger vignette only | vignette, colour fringes, soft focus | same |
| Sky: Phobos, Deimos, Earth star, meteors, glare, soft clouds | no | no | yes | yes |
| Anime suit shading, glass sky reflection, night glow on lights | no | no | yes | yes |
| Models | `_low` | `_low` | full | full |
| Dynamic resolution | yes | yes | yes | yes |

`guessTier()` picks **ultra** by itself only for clearly strong desktop cards (RTX 3070 / 4070 / 5070
and up, RX 6700 / 7700 and up, Apple M Pro / Max / Ultra) with 8+ cores and 8+ GB reported memory,
and not for cards named Laptop, Max-Q or Mobile, nor for AMD "M" or "S" suffix cards (RX 6800M and so
on). Apple M Pro / Max / Ultra are included, whether in a laptop or a desktop. Dynamic resolution stays on for ultra, and Auto steps down one
level when the frame rate cannot be held. A player can still choose any level by hand.

## The effects

All of them live in `src/world/post.ts` unless said otherwise.

- **Contact shadows.** Alchemy-style ambient occlusion from the existing depth texture, drawn at half
  size, then two bilateral blur passes that keep object edges sharp. The result multiplies the HDR
  picture before bloom and tone mapping. It fades out with distance and ignores the sky.
- **Light shafts.** A half-size pass marches from every pixel towards the Sun's place on the screen and
  counts how much open sky it passes over. Strength comes from `Daylight`: strongest with a low Sun and
  in dust, zero at night, on the Moon (no air) and indoors.
- **World look.** `post.look` holds tints for shadows and highlights (Mars: warm gold with violet
  shadows; Moon: cool silver with deep blue shadows) and a glow amount. The glow is an Orton-style
  screen blend of the bloom image over the picture after tone mapping.
- **Film look.** `post.setCinematic(true|false)`. It eases in and out. On high and ultra it adds
  colour fringes towards the corners and a soft background: a quarter-size copy of the picture is
  blended in by distance from a focus point that follows the depth at the middle of the screen. On
  every tier it only makes the vignette stronger. `post.lessMotion = true` removes the colour fringes
  and softens the effect.
- **Sky** (`sky.ts`, Mars only unless said otherwise). Phobos and Deimos are lit discs with a day
  side and a night side. Their size next to the Sun is real (Phobos about 0.57 of its width, Deimos
  about 0.1) and scales with the game's enlarged Sun. Phobos crosses the sky west to east in about
  90 seconds of game time. Earth is a blue-white star in the star frame. Meteors: one slot every 7
  seconds, about a third of them used. Clouds have wider soft edges and animate; a thin cirrus layer
  drifts over them. The sun glare (core, bloom, spokes) is drawn on both worlds. The Moon keeps its
  real Earth.
- **Materials** (`materials.ts`, `astronaut.ts`). `GLOBALS.anime` is 1 on high and ultra. It sharpens
  the light/shadow edge on characters, tints the rim light with the sky colour, adds a small sun glint
  to suits, makes glass and the helmet visor mirror a sky gradient (ground, horizon, zenith), and
  makes `glow()` lights up to 1.9 times brighter at full night (the factor follows `GLOBALS.night`;
rooms use 0.65, so their lights are about 1.6 times brighter). Lumi's antenna glow is drawn only on
these tiers. These are uniforms, not shader variants, so
  the compiled programs are shared by every tier.
- **Ground micro-relief** (`materials.ts` `ground({ relief: true })`, flag `groundDetail`, high and ultra). Own shader program (cache key `ground-relief`, define `USE_RELIEF`); low and medium keep the `ground` program unchanged. The normal is tilted by the analytic gradient of two noise octaves (about 1.5 and 6 cycles per metre) in world XZ, fading out between 25 m and 110 m and at grazing angles; on Mars the sand ripple term tilts the normal too. It breaks up the light/shadow band edge and gives grain at low sun. Cost at 1080p and 1440p: under 0.15 ms.
- **Anime finish** (flag `G8`, high and ultra). Ink lines take their colour from the picture (local colour, darker and richer, a little toward the ink tone; define `USE_ANIME_INK` in the final pass, set when outlines and grade are on) and are about 1.5 px near, 1 px far, with the same five depth taps. Glass, the habitat dome and the helmet visor get one broad and one thin crisp white strip (`STREAK_GLSL` in `materials.ts`) placed from the view-space normal and the Sun direction, scaled by `uAnime * uStreak`. Cost under 0.2 ms.
- **Colour grade outdoors.** `Daylight` now resets saturation, contrast, tint, bloom and vignette every
  frame outdoors, so a room's own grade cannot stay on after the cadet walks out.

## Settings the game must pass on

- `world.engine.post.setCinematic(on)` when a film starts and ends.
- `world.engine.post.lessMotion = settings.lessMotion` (the post module cannot read the store).

Rooms are drawn from their own scene; `Engine` sets `post.indoor` for that, which turns off shafts and
the world look indoors. Contact shadows and the glow stay on.

## Measured cost

Measured on an RTX 3070, Chrome, 1920 x 1080, pixel ratio 1, by drawing 60 frames in a loop with
`Engine.step()` and waiting for the GPU (so it is frame time, not display refresh). "Before" is the
same tier with the new flags off.

| scene | tier | before | after |
|---|---|---|---|
| title | high | 2.2 ms, 423 draw calls | 2.1 ms, 426 |
| title | ultra | 2.5 ms, 431 | 2.8 ms, 438 |
| overview | high | 3.3 ms, 535 | 2.5 ms, 540 |
| overview | ultra | 2.6 ms, 537 | 2.8 ms, 542 |
| walk | high | 2.5 ms, 421 | 2.6 ms, 371 |
| walk | ultra | 2.2 ms, 370 | 2.2 ms, 373 |

The new passes add 3 to 7 draw calls (the walk row differs because the scene itself had a different
number of objects when each run started) and cost less than the noise of this measurement (about
0.3 ms) on this card. They were **not** measured on a weak GPU or an integrated one. Those stay on low and
medium by default, and dynamic resolution is the safety net for a high or ultra tier on a slower card.

## Models: cadet and Lumi

`scripts/models/astronaut.py` and `scripts/models/lumi.py`. Built with **Blender 5.2** (the same version
that made the existing files: `asset.generator` says "Khronos glTF Blender I/O v5.2.41").

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts/models/build.py -- astronaut lumi
```

Pass other names (or none, for all models) to rebuild them. Both the full and the `_low` file are
written. The model files are fetched with `?v=__MODELS_VERSION__`; `vite.config.ts` computes that
value as a hash of the files in `public/models`, so it changes by itself when a model changes.

What changed on the cadet: a bigger head and a rounder, roomier helmet bubble (radius 0.372 to 0.395);
chunkier boots (wider, thicker soles, bigger toe); accent stripes on the arms, legs and boots; three
more status lights down the back of the pack plus two light bars; the aerial moved onto a mount behind
the helmet so the bigger helmet does not hide it. Node names, pivots and material names are unchanged
(`astronaut.ts` animates `torso`, `head`, `armL/R`, `forearmL/R`, `legL/R`, `shinL/R`).

What changed on Lumi: a thin ring of light round the screen frame (the existing `glow_warm` material).
In code (`lumi.ts`): the screen lights itself a little, and the antenna light has a pulsing glow that
turns red and quick on alert.

| file | triangles before | after | size before | after |
|---|---|---|---|---|
| astronaut.glb | 26 292 | 28 556 | 720 800 B | 770 548 B |
| astronaut_low.glb | 10 499 | 11 405 | 309 872 B | 331 064 B |
| lumi.glb | 5 728 | 6 160 | 135 800 B | 145 300 B |
| lumi_low.glb | 2 576 | 2 772 | 62 384 B | 66 700 B |

## Pictures

In `docs/img/upgrade/`: `mars_*_before/after.jpg`, `moon_before/after.jpg` (same tier with the new
flags off, and ultra), `mars_cinematic.jpg`, `moon_cinematic.jpg`, `sky_phobos.jpg`,
`sky_night_earth_star.jpg`, `cadet_front.jpg`, `cadet_back.jpg`, `lumi.jpg`.

## How to measure

Dev only (`npm run dev`); production bundles do not contain `src/dev/gfxlab.ts`. The browser pane is small and
capped at 60 fps, so never judge from pane screenshots. Use `window.gfxlab` instead.

Start the shot saver once (it keeps running; default folder is `gfx-shots2` next to the worktree's scratchpad):

    node scripts/dev/shot-saver.mjs [folder] [port]      # port 5199

In the page console (or the browser tool's javascript tool):

    await gfxlab.tier('ultra')                 // low | medium | high | ultra
    await gfxlab.scene('mars-overview')        // mars-overview mars-lowsun mars-walk moon-overview moon-walk title interior
    await gfxlab.shot('name')                  // 1920x1080 JPEG q0.95 -> saved path; {png: true} as 4th arg for PNG
    gfxlab.frameMs(frames=60, batches=7)         // {median, min, max, drawCalls, triangles} at 1920x1080, GPU-synced
    gfxlab.set('flagId', false); gfxlab.flags()
    await gfxlab.ab('name', 'flagId')          // name_off + name_on, the SAME frame
    gfxlab.diff('flagId')                      // {different, maxDelta}: no files saved (noise floor with an unused flag: ~100 px, maxDelta 1)
    gfxlab.live()                              // give the game its own loop back

Every new effect reads `flag('id')` from `src/world/devflags.ts` (true in production). `scene()` freezes time
(clock 100 s), seeds `Math.random`, and stops the real-time loop; call `gfxlab.live()` to resume play.
