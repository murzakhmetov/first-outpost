# Fact sheets

These files record the fact checks done for First Outpost. Every claim was compared with a primary source (NASA pages first, peer-reviewed papers where NASA has no page for the number).

- `facts-radiation.json` — radiation, space weather, health (R1–R18)
- `facts-environment.json` — Mars, the Moon, life support, food, power, radio (E1–E24)
- `facts-discoveries.json` — the eight discoveries on walks outside (D1–D8): Curiosity's sulfur crystals, iron meteorites, old stream bed and the Murray Buttes; the shrinking Moon, Apollo 17's orange soil, Apollo 15's Genesis Rock and the new craters seen by the Lunar Reconnaissance Orbiter. Three first drafts needed corrections: NASA's pages say "more than 200" new craters, not 222; the orange glass is about 3.5 billion years old, not 3.6; and no NASA page says the Genesis Rock lay on a boulder, so the game no longer shows it that way. The cards use the corrected claims
- `facts-outpost.json` — the outpost and its room games: using local materials (ISRU), printed habitats, the space printer, the spectrometer, Mars peppers and more (O1–O13)
- `facts-rover.json` — real rovers, for the Science log card the player unlocks by driving the rover (V1–V4): the Apollo Lunar Roving Vehicle, its speed record, NASA's new Lunar Terrain Vehicle for Artemis and Curiosity's speed and distance. All four first drafts needed corrections (for example, NASA pages give Curiosity more than 38 km driven, not 30; NASA says the new rovers are driven from Earth between crews, not that they drive themselves)
- `story-check.json` — a second, independent pass over the finished texts: 212 claims in the "true story" cards, the glossary and the Science log, and the 83 source links in the texts at that time (cards added later were checked in their own fact sheets). It found 16 problems (a number that did not match its source, links to pages that did not support their story). All 16 are fixed; the file lists each one with its source

Each entry has: the corrected claim, the values, the source link, a short quote from the source, and notes on what was wrong in the first draft. Status is `verified`, `corrected`, `confirmed` (the claim already matched its source: nothing had to be changed) or `unverified`. Claims marked `unverified` are not shown in the game as facts.

The photo list for the Science log (NASA ids and credit lines) is in `data/codex-images.json`.
