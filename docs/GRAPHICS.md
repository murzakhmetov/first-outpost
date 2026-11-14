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
| Sun light shafts (Mars) | no | no | yes, screen-space, 20 samples | yes, volumetric dust (G10, 18 steps against the shadow map), screen-space where it cannot run |
| World colour grade + anime glow | no | no | yes | yes |
| Film look for cutscenes | stronger vignette only | stronger vignette only | vignette, colour fringes, soft focus | same |
| Sky: Phobos, Deimos, Earth star, meteors, glare, soft clouds | no | no | yes | yes |
| Anime suit shading, glass sky reflection, night glow on lights | no | no | yes | yes |
| Anti-aliasing after the picture (FXAA, G9) | no | no | yes | yes |
| Ground micro-relief (`groundDetail`, G2) | no | no | yes | yes |
| Pebble scatter (`scatter`, G5) | no | no | 2000 | 6000 |
| Painted sky (G6), contact-shadow upsample (G7) | no | no | yes | yes |
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
- **Ground micro-relief** (`materials.ts` `ground({ relief: true })`, flag `G2` for the dev A/B switch and quality option `groundDetail` for the tier, high and ultra). Own shader program (cache key `ground-relief`, define `USE_RELIEF`); low and medium keep the `ground` program unchanged. The normal is tilted by the analytic gradient of two noise octaves (about 1.5 and 6 cycles per metre) in world XZ, fading out between 25 m and 110 m and at grazing angles; on Mars the sand ripple term tilts the normal too. It breaks up the light/shadow band edge and gives grain at low sun. Cost at 1080p and 1440p: under 0.15 ms.
- **Ground macro variation and rock top light** (flag `G12`, high and ultra, `materials.ts`, `terrain.ts`, `props.ts`). In the `ground-relief` program the sampling position of the colour terms is bent by two slow noises (up to about 4 m and 0.45 m), so blob rows and ripples do not repeat in lines; the long stroke term is isotropic and about half as strong (it drew the long smeared streaks); the fine pale blobs and pebble specks fade towards a grazing view (they squashed into dashes); wind ripples are masked by a slow noise. Three painted colour patches from noises at about 90, 35 and 14 m (Mars: ochre, dust, rust; Moon: grey-beige, cool grey, dark), with soft edges, weights 0.14 to 0.17, and a gentle brightness drift. Rocks (`toon({ rockLight })`, program key `toon-cr`, set when `scatter > 0`) get a soft gradient from lit top to darker underside and a thin warm rim on the sun side, scaled by `uAnime * uMacro`; the pebbles share that material. Low and medium render identically (gfxlab.diff 0 on a second read after the scene settles; the ground colour code has two separate branches, `#ifdef USE_RELIEF` new and `#else` the old source unchanged, so medium compiles the same maths as before). Checked in close-ups on Mars and Moon rocks (lit top, darker underside, thin warm rim). Patch noises use two octaves (`gMac`) and the fine warp one noise, to keep the cost down. Cost measured on a noisy GPU (paired off/on, 14 to 16 pairs, alternating order; paired median delta high mars-overview +0.3 ms, high moon-overview +0.5 ms, ultra mars-overview +0.4 ms, best-of-N equal within 0.2 ms; earlier 20 pairs): ultra moon-overview +0.1 to +0.5 ms, ultra mars-overview +0.1 ms, ultra mars-walk 0 to +0.5 ms, high overview 0 to +0.6 ms.
- **Anime finish** (flag `G8`, high and ultra). Ink lines take their colour from the picture (local colour, darker and richer, a little toward the ink tone; define `USE_ANIME_INK` in the final pass, set when outlines and grade are on) and are about 1.5 px near, 1 px far, with the same five depth taps. Glass, the habitat dome and the helmet visor get one broad and one thin crisp white strip (`STREAK_GLSL` in `materials.ts`) placed from the view-space normal and the Sun direction, scaled by `uAnime * uStreak`. Cost under 0.2 ms.
- **FXAA** (flag `G9`, quality option `fxaa`, high and ultra). The final pass draws into one half-float image (so the 8-bit quantization happens once, after the dither), then an inline FXAA 3.11 pass (12 steps, subpixel 0.5) draws to the screen. Film specks and the dither move to the FXAA pass (define `FINISH_LATER` in the final pass) so they are not blurred. Low and medium have no image and no pass. The half-float image keeps the dither intact: the only 8-bit quantization is the final write, after the dither, same as the off path (an RGBA8 image quantized before the dither and made contour bands in dark skies; fixed). Without half-float render support there is no FXAA image and no pass. Cost at 1080p: within noise (about 0.1 ms). Known limit: A/B shots of the same frame can still differ in animated actors (they move between the two renders).
- **Volumetric dust** (flag `G10`, quality option `shaftsVolumetric`, ultra, Mars). Replaces the screen-space shaft pass with `SHAFT_VOL_FRAG` in the same half-size target: 18 steps from the camera to each pixel's world position (capped at 120 m, jittered start, samples above a 25 m dust layer skipped), each tested against the Sun's shadow map (an RGBA8 packed-depth image in three 0.170, read with a plain sampler and `unpackRGBAToDepth` maths), weighted by dust, Sun colour and a Henyey-Greenstein phase. Strength still comes from `Daylight` (zero at night, indoors, on the Moon). High keeps the screen-space shafts. Look (second tuning, after a review found far lit mesas turning blue-white): the pass writes an amount from 0 to about 0.2, never more. Optical depth is `sum * stepLen * density * 0.004` and goes through `1 - exp(-x)`, scaled by 0.45 and by a Henyey-Greenstein factor (0.35 to 1), so the haze is a warm veil that keeps the colour of what is behind it. Shadowed ground gets 0.3x of the sunlit haze (`reach` is four shadow-map taps around the pixel, so shadow texel stairs do not show). Fixed per-pixel jitter, no time term, so nothing shimmers. Samples outside the shadow box count as a neutral 0.75, blended in over the outer 12 % of the box, so box edges and box-size steps leave no seam. The pass also runs on ultra Mars views where the screen-space pass would skip (Sun behind the camera), so draw calls are +1 there with the flag on; low, medium and high are unchanged. `shaftsVol` is disposed when a tier without it is applied. Cost: 1080p within noise (about 3 to 4 ms total on ultra, limit 12); 2560x1440 proxy about +0.2 to +0.4 ms for the pass, under the 1.5 ms limit.
- **Sun shadow coverage** (flag `G1`, quality option `shadowWide`, high and ultra, `daylight.ts`). The sun shadow box widens in steps (base, 80 m, 110 m) with hysteresis as the camera moves away from its focus, so the overview shot is covered; the box centre snaps to whole shadow texels and the normal bias grows with the texel size. A radius-based softer edge is plumbed (`shadowRadius`, `sun.shadow.radius`) but every tier has `shadowRadius: 1`, so it does nothing today; the engine no longer switches shadow filter by flag. Cost: within noise.
- **Bounce light and shadow tint** (flag `G3`, high and ultra, `materials.ts`, `daylight.ts`, `interior.ts`). Sky colour from above, ground colour from below and side colour by normal, added to toon lighting on characters, props and ground (half weight on ground), and the shadow band takes the world's shadow tint. Scaled by `GLOBALS.anime`, so low and medium are unchanged. Cost: within noise.
- **Terrain colour detail** (flag `G4`, high and ultra, `terrain.ts`). Crater rims, bowls and ejecta rays on the Moon and sand stains on Mars baked into vertex colours at build time. Both colour sets are kept; the flag only picks which one is on the GPU. Cost: none per frame.
- **Pebble scatter** (flag `G5`, quality option `scatter`, high and ultra, `props.ts`). Instanced small stones on bare ground. Cost: one draw call, within noise.
- **Painted sky** (flag `G6`, only where `SKY_FANCY` is compiled in, high and ultra, `sky.ts`). Cel-shaded cloud edges and painted horizon bands, all mixed by `uStylize` (0 gives the old sky). Cost: within noise.
- **Contact shadow upsample** (flag `G7`, high and ultra, `post.ts`). The half-size occlusion is read with a four-tap depth-aware upsample (no grey halo across silhouettes) and the occluded part takes the world's shadow colour. Cost: within noise.
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

Per-flag check (G1 to G10, each switched off alone, 60 frames x 5 batches, ultra mars-walk, 1080p): every flag is within +-0.25 ms of the all-on frame (2.3 ms); ultra mars-overview about 3.5 ms. The first measurement after a scene change reads about 0.4 ms slow (warm-up), so read differences below that as zero.

The title, overview and walk rows above were taken in separate runs, and the scene had a different number of
animated objects each time (a "before" and "after" row is not the same frame), so the draw-call drop on
the high walk row (421 to 371) is scene variation, not a saving from this branch. Do not read the
table as the cost of the new passes. The reliable numbers are the per-flag check above (every flag within
the 0.3 ms noise of this measurement) and the later run on the final branch (1920 x 1080, 60 frames x 5
batches): ultra mars-walk 2.5 ms, ultra mars-overview 3.1 ms, high mars-walk 2.1 ms. The new passes
add 3 to 7 draw calls (pebbles 2, shafts and FXAA 1 each). They were **not** measured on a weak GPU or an
integrated one. Those stay on low and medium by default, and dynamic resolution is the safety net for a
high or ultra tier on a slower card.

Low and medium, mars-walk, same run: low 1.0 ms, 115 to 117 draw calls; medium 2.0 ms, 323 draw calls.
Toggling the FXAA flag changes neither tier's draw calls (the count moves by 2 on low between identical
runs, from a blinking actor), and `gfxlab.diff('G9')` returns 0 different pixels on low and 1 (maxDelta 1)
on medium. Both tiers have no FXAA image, no shaft pass and no relief or scatter (quality options false or 0).
There is no pre-change build in this worktree, so low and medium are not compared against a baseline
build here.

Tier switches compile their post programs at once: `Post.resize()` calls `precompile()`, which runs
`renderer.compile` for the final pass (with its defines), FXAA, shafts, volumetric shafts, AO and focus
materials, so the first frame after a switch does not wait on shader compiles. The rock material variant used by the pebbles is
still compiled on its first draw. The hitch was not timed.

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
    gfxlab.diff('flagId')                      // {different, maxDelta}: no files saved (noise floor with an unused flag, measured on ultra mars-overview: ~100 px, maxDelta 1; on medium mars-overview it can reach a few hundred to a thousand px at maxDelta ~100 because of moving actors, so judge medium by a still scene such as mars-walk, where it is 0 to 1 px)
    gfxlab.live()                              // give the game its own loop back

Every new effect reads `flag('id')` from `src/world/devflags.ts` (true in production). `scene()` freezes time
(clock 100 s), seeds `Math.random`, and stops the real-time loop; call `gfxlab.live()` to resume play.
