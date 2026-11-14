# Submission kit: texts for the Space Apps project page

> Ready-made texts for the Space Apps project page.

Challenge: **Build a Junior Astronaut Mission Trainer** (NASA Space Apps Challenge 2026).

## Project name

First Outpost

## High-level summary

First Outpost is a free browser game that lets children aged 7 to 12 command a small outpost on Mars or at the Moon's south pole. Each turn is one week. The player gets a few energy cells and four systems that want them: life support, the greenhouse, the lab and the radiation shield. There are never enough cells, so every week is a trade-off, and the game shows what each choice did. The outpost grows with the player: regolith and metal dug on walks outside become new buildings and tools, and every building except the solar array can be entered and explored in 3D.

The Sun in the game is the real Sun. Every mission replays real dates from NASA's DONKI space-weather records (2010–2026), so the solar storm of May 2024 arrives in the game on the day it arrived in real life. Mars forecasts show the temperatures Curiosity measured on those dates. Radio delay comes from the real Earth–Mars distance: on Mars, Mission Control's advice can arrive too late.

The game runs on phones, tablets and computers with no download and no account, in English and Russian. It explains science words in place, reads text aloud for early readers, and ends each mission with a plain-language review that links results to the choices that caused them.

## Link to project demo

The live game is the demo: <https://first-outpost.vercel.app> (open it, press "New mission"; no install, no account).

## Link to final project

- Play: <https://first-outpost.vercel.app>
- Straight into the May 2024 solar storm: [Mars](https://first-outpost.vercel.app/?play=may2024&world=mars), [Moon](https://first-outpost.vercel.app/?play=may2024&world=moon)

## Detailed project description

**What it does.** The player runs an outpost for 6 or 10 weeks. Every week has the same five steps:

1. **Forecast.** Sunlight for the week, the weather, what the real Sun did in that week, and the radio delay to Earth.
2. **Card.** A problem based on a true NASA story, for example Apollo 13's air filter or the 2018 Space Station leak. Two or three answers, each with a visible cost. The player may ask Mission Control. Near the Moon the answer takes under three seconds. On Mars it can take over half an hour and may come too late.
3. **Power plan.** Share the energy cells between life support, the greenhouse, the lab and the shield-building robot. The screen shows what the week will do before the player commits.
4. **Walk outside (optional).** A third-person walk in real Mars or Moon gravity. Far samples give more science, but the suit uses air every second. In real storm weeks an alert can sound. A crew rover can be driven for speed (faster, with its own cabin air, but a small battery; samples are picked up on foot). Gold stars on the map lead to discoveries based on real finds (the sulfur crystals Curiosity cracked open in 2024, the orange soil of Apollo 17), each with its own Science log card.
5. **Night and report.** What changed, and why.

**A clear start.** The first mission on each world opens with a short 3D film: the crew lands, Mission Control and Lumi explain why they are there, and a mission card shows what keeps the crew alive, how science earns stars, and the four steps of every week. Children know what to do before the first choice.

**Growing the outpost.** Walks also bring back regolith and metal (a short timing game while digging gives a bonus). The builder robot that piles regolith into the radiation wall also builds new buildings from them, as NASA plans to build with local material: a workshop, an oxygen plant, a solar array, a garden dome, an observatory and a storm bunker. The robot builds one thing at a time and needs energy cells, and while it builds the wall waits, so every building is a trade-off. The workshop's 3D printer makes tools that change the walks: more suit air, a drill, a stronger rover battery, a scanner, jump boots and a radiation vest. Each tool is printed in a short game, one layer at a time: what sticks out over the layer below is cut off, as a printer cannot print in thin air.

**Inside the buildings.** Every building except the solar array can be entered and explored in 3D, and so can the lander that brought the crew down, whose cockpit runs a landing simulator. Glowing rings mark what can be used: small games, of which one win a week pays a reward, so the child picks the job the outpost needs most (connect the air pipes in the living module, care for the plants, identify the elements in a rock's light with the lab's laser spectrometer, whose lines sit at their real wavelengths (NIST), land the lander in real Mars or Moon gravity, and send the science data to Earth in time with the radio, which then shows how long the data really takes to arrive that week), the workshop's printer, and machines that tell a true story, such as the water recycler that returns 98% of the Space Station's water.

**Creative mode.** A second mode for free play: unlimited materials, buildings that stand at once wherever the player puts them (a see-through copy shows where, and can be turned), decorations to set out, every room open to explore, and no way to lose.

The mission ends with a review: a chart of air, food and radiation over the whole mission, up to five findings in plain words ("Week 3: the storm caught you outside. Far samples are worth more, but they are far from shelter."), badges, and the Science log cards the player unlocked.

**How it answers the challenge.**

- **Trade-offs, not a safe path.** One currency (energy cells) pays for three things to keep alive (air, food, radiation budget) and for science, which is the goal. A unit test fails if any card option becomes free.
- **Real data in the mechanics, not as decoration.** Storm weeks, storm strength, storm alerts during walks, Mars temperatures, radio delay and sunlight all come from the mission's real dates.
- **Honest about data.** Each forecast marks which values are real records and where they come from. The game says whether its Sun data is the built-in archive, the daily refreshed file, or fetched from NASA in this session. It never calls saved data live. Simplified values are listed as simplified.
- **Made for 7-year-olds.** Short sentences, one new idea per week in the first mission, science words that explain themselves on tap, optional read-aloud, three text sizes, colour-blind patterns, a calm-camera mode.
- **Ready for class.** A teacher's guide ([TEACHERS.md](TEACHERS.md)) gives the learning goals, a 40-minute lesson, questions for the class and links to science standards.
- **Failure teaches.** A failed mission ends with an early flight home, a clear reason and "try again". Nothing is lost.
- **Replay.** Thousands of real start dates, six famous space-weather windows, "the Sun right now", three difficulty levels, random cards, badges, eight discoveries to find outside, six buildings and six tools to choose between, five room games and a printer game that get harder as the mission goes on, and a Science log to complete.

**Why it matters.** Children usually meet space as pictures. Here they meet it as decisions with consequences, which is how mission planners meet it. A child who has had to choose between the greenhouse and the shield during a real solar storm remembers what radiation shielding is for.

**How it is built.** TypeScript, Vite, three.js and Preact. No game engine and no server: the result is a static site (about 505 kB of code and styles, compressed, plus 2.5 to 5.4 MB of 3D models before the game starts; the new buildings and the furniture inside follow in the background) that works from any web host and, after the first visit, without a connection. Every 3D model is built by our own Blender scripts in the repository, with no asset packs; textures, animation and sound are generated by the game's code. The mission rules are separate from the graphics, so they are tested and balanced in Node: unit tests check planet geometry against known Mars close approaches, check the DONKI reducer against known storms, and play about 9,600 missions with robot players to keep the difficulty fair. Four graphics levels plus an automatic one keep the game smooth from old phones to gaming PCs.

**What we would do next.** Classroom mode (one mission, the whole class votes on each card), more languages, testing the game with children in a school, and a third site: a Gateway station in lunar orbit.

## NASA data and resources

| Resource | How the game uses it |
| --- | --- |
| [NASA DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) (CCMC and the Moon to Mars Space Weather Analysis Office): solar flares, solar energetic particle events, geomagnetic storms, WSA-ENLIL model runs, April 2010 to November 2026 | Every mission week is a real week. Storm cards, storm strength, storm alerts and the forecast text come from the records for those dates. Storm cards link to the DONKI record |
| Curiosity REMS weather feed (NASA/JPL-Caltech, CAB CSIC-INTA): 4,717 sols of air temperature and pressure at Gale Crater | Real lowest and highest temperature in each Mars forecast. Very cold real weeks can trigger the "bitter cold" card |
| Curiosity RAD results ([NASA/JPL, 2013](https://www.jpl.nasa.gov/news/nasa-curiosity-first-mars-age-measurement-and-human-exploration-help/); [NASA/JPL, 2024](https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm)) | Weekly cosmic-ray dose on Mars and the size of storm doses |
| [NASA JPL approximate positions of the planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html) | Real Earth–Mars distance for the mission dates: radio delay, sunlight strength, solar conjunction |
| [NASA Veggie fact sheet](https://www.nasa.gov/wp-content/uploads/2023/03/veggie-fact-sheet-508.pdf) and the [NASA Open Science Data Repository](https://osdr.nasa.gov/bio/) | One rounded crop time (4 weeks at normal greenhouse power), close to real Space Station harvests (radishes 27 days, lettuce 33); a Science log card introduces OSDR |
| [NASA-STD-3001](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf) | The 600 mSv career limit that the glossary and the radiation budget refer to |
| NASA mission pages and news releases: MOXIE, LCROSS, InSight, Opportunity, Curiosity, LRO, Blue Ghost, Apollo 13, 15 and 17, the Space Station | The true stories behind the decision cards and the 66 Science log cards. Each one links to its source |
| [NASA Image and Video Library](https://images.nasa.gov/) | 55 NASA photos on 57 of the 66 Science log cards, each with its credit line and a link to its NASA page |

The full list with numbers and what was simplified: [NASA_DATA.md](NASA_DATA.md). Fact sheets with a quote from each source: [sources/](sources/).

## Space agency partner and other data

- **Lunar surface radiation dose:** Chang'E-4 Lunar Lander Neutrons and Dosimetry experiment ([Zhang et al. 2020, _Science Advances_](https://pmc.ncbi.nlm.nih.gov/articles/PMC7518862/)). It is the only direct measurement on the lunar surface so far. The game labels it as not a NASA measurement.
- **REMS instrument:** provided to NASA's Curiosity mission by Spain's Centro de Astrobiología (CSIC-INTA).
- **Mars season angle:** Mars24 algorithm (Allison and McEwen 2000, NASA GISS).
- **Fonts:** Nunito, Unbounded and Philosopher (SIL Open Font License).

## Use of artificial intelligence

AI tools (Anthropic Claude, in Claude Code) wrote the code, the texts in both languages, the Blender scripts that build the 3D models, and the code that makes textures and sounds. The team directed the project and made the design decisions; fact checks and reviews were also done by AI agents against the linked NASA pages, and no child has played the game yet. No AI image, video or audio generator was used: every model is the output of a script in the repository and every texture is drawn by the game's own code, except the NASA photos in the Science log, which are unchanged NASA images with their credit lines. The facts and numbers shown to players were checked against the linked NASA pages; the checks are in `docs/sources/`. NASA logos and branding are not used.

## References

- NASA DONKI: <https://ccmc.gsfc.nasa.gov/tools/DONKI/>
- Curiosity (Mars Science Laboratory): <https://science.nasa.gov/mission/msl-curiosity/>
- Hassler, D. M. et al. (2014). Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover. _Science_ 343.
- Zeitlin, C. et al. (2013). Measurements of energetic particle radiation in transit to Mars on the Mars Science Laboratory. _Science_ 340.
- Guo, J. et al. (2021). Radiation environment for future human exploration on the surface of Mars. _Astron. Astrophys. Rev._ 29: <https://link.springer.com/article/10.1007/s00159-021-00136-5>
- Zhang, S. et al. (2020). First measurements of the radiation dose on the lunar surface. _Science Advances_ 6: <https://pmc.ncbi.nlm.nih.gov/articles/PMC7518862/>
- NASA/JPL (2024). NASA Watches Mars Light Up During Epic Solar Storm: <https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm>
- NASA JPL Solar System Dynamics. Approximate Positions of the Planets: <https://ssd.jpl.nasa.gov/planets/approx_pos.html>
- Allison, M. and McEwen, M. (2000). A post-Pathfinder evaluation of areocentric solar coordinates. _Planetary and Space Science_ 48.
- NASA. Veggie fact sheet: <https://www.nasa.gov/wp-content/uploads/2023/03/veggie-fact-sheet-508.pdf>
- NASA-STD-3001 Volume 1, Revision C: <https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf>
- Colaprete, A. et al. (2010). Detection of water in the LCROSS ejecta plume. _Science_ 330: <https://pubmed.ncbi.nlm.nih.gov/20966242/>
- three.js, Preact, Vite, TypeScript (open-source libraries and tools).
