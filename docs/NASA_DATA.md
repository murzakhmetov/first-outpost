# The NASA data in First Outpost

This page lists every data set and every real number the game uses, where it comes from, how it changes play, and what was simplified. Each item can be checked: follow the link, or run the script that fetched it.

The fact sheets used to check the numbers, with a quote from each source, are in [`sources/`](sources/).

## 1. Space weather: NASA DONKI

- **What it is.** DONKI (Space Weather Database Of Notifications, Knowledge, Information) is NASA's record of solar flares, solar energetic particle events, geomagnetic storms, and model runs of solar eruptions. It is kept by the Community Coordinated Modeling Center and the Moon to Mars Space Weather Analysis Office at NASA Goddard.
- **Link.** <https://ccmc.gsfc.nasa.gov/tools/DONKI/> · web service: `https://ccmc.gsfc.nasa.gov/DONKI/WS/get/{FLR|SEP|GST|WSAEnlilSimulations}?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` (no key; at most 60 days per request)
- **What we fetched.** All records from 1 April 2010 to the build date: 3,406 flares, 494 particle events, 203 geomagnetic storms and 6,692 WSA-ENLIL model runs.
- **How it is stored.** `scripts/fetch-donki.ts` downloads the records and `src/sim/donki.ts` reduces them to one small record per notable day (1,696 days): the strongest flare, the number of M and X flares, the particle-storm level, the highest Kp index, and whether a model run predicted an eruption reaching Mars. Each record keeps the DONKI record number, so the game can link to the original.
- **How it is used.**
  - A mission starts on a real date. Each turn is the next real week. The forecast shows what the Sun did in that week.
  - **Moon.** The Moon sits beside Earth, outside Earth's magnetic shield most of the time. Particle storms measured near Earth are the storms the Moon gets. Storm level: 1 = seen by the SOHO or ACE particle detectors, 2 = GOES proton event above 10 MeV, 3 = GOES protons above 100 MeV.
  - **Mars.** Mars sees a different side of the Sun, so Earth's storms are not Mars's storms. The game uses (a) the three solar events that Curiosity's RAD instrument measured on the ground (11 September 2017, 28 October 2021, 20 May 2024), and (b) WSA-ENLIL model runs in DONKI that predict a direct hit on Mars by an eruption faster than 900 km/s (level 1) or 1,500 km/s (level 2).
  - A storm week brings a decision card (shelter, keep working, or rush the shield), adds radiation dose, and can sound a storm alert during a walk outside. The card links to the DONKI record, or, for the three storms Curiosity's RAD measured, to NASA's report about them.
- **Live data.** `public/data/spaceweather-latest.json` holds the last 90 days. A GitHub Action is scheduled to refresh it in the repository every day (run by hand once on 13 November 2026, it worked); the website serves the copy from its last deploy. A player who is online also gets the last 12 weeks straight from DONKI (the service allows cross-origin requests). The game shows which source it is using and the date it was fetched. It never calls saved data "live".
- **Verified against known events.** The archive contains the X5.8 flare and level-3 particle storm of 11 May 2024 (Kp 9), the X9.0 flare of 3 October 2024, the X8.2 flare of 10 September 2017 and the X1.0 flare of 28 October 2021. A test (`tests/sim.test.ts`) checks them.

## 2. Mars weather: Curiosity REMS

- **What it is.** REMS (Rover Environmental Monitoring Station) is the weather station on NASA's Curiosity rover in Gale Crater. It was provided by Spain's Centro de Astrobiología (CSIC-INTA).
- **Link.** <https://science.nasa.gov/mission/msl-curiosity/> · feed: `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json`
- **What we fetched.** 4,717 sols, 16 August 2012 to 25 August 2026 (`scripts/fetch-rems.ts`). 28 rows with impossible temperatures were dropped. Each kept row has the sol number, the lowest and highest air temperature, the pressure and the season angle.
- **How it is used.** On Mars the forecast shows the real lowest and highest temperature for the week's dates, with the sol number. If the real low is −78 °C or colder, the "bitter cold" card can appear (heat everything, or let something freeze). For dates with no reading the game shows typical Gale Crater values and says so.
- **Note.** The feed is hosted by NASA and used by NASA's own weather page, but it is not a documented API and it lags behind the present.

## 3. Radiation

| Number | Value | Source |
| --- | --- | --- |
| Dose on the Mars surface | about 0.67 mSv per day (measured 2012–2013, near solar maximum) | Curiosity RAD: [NASA/JPL, 9 Dec 2013](https://www.jpl.nasa.gov/news/nasa-curiosity-first-mars-age-measurement-and-human-exploration-help/); Hassler et al. 2014, _Science_ (0.64 ± 0.12) |
| Dose during the trip to Mars | about 1.8 mSv per day | same NASA/JPL release; Zeitlin et al. 2013, _Science_ |
| Cosmic rays over the solar cycle | about 0.21 mGy per day near solar maximum, about 0.32 mGy per day at the 2019–2020 minimum | RAD review: [Guo et al. 2021](https://link.springer.com/article/10.1007/s00159-021-00136-5) |
| Biggest storm measured on Mars | 8,100 micrograys on 20 May 2024, "equivalent to 30 chest X-rays" | [NASA/JPL, 10 June 2024](https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm) |
| Dose on the Moon's surface | 1,369 microsieverts per day (early 2019, solar minimum) | Chang'E-4 lander, [Zhang et al. 2020, _Science Advances_](https://pmc.ncbi.nlm.nih.gov/articles/PMC7518862/). This is not a NASA measurement |
| Radiation on Mars, quiet day and storm peak | about 4.7 µGy per hour (median, 1–7 April 2024); 304 µGy per hour at 06:15 UTC on 20 May 2024, about 64 times more | Curiosity RAD in NASA OSDR [RadLab](https://visualization.osdr.nasa.gov/radlab/gui/data-api/) (instrument MSL-RAD-Surface); the queries are in `docs/sources/facts-radlab.json` (RL1, RL2) |
| Radiation inside the Space Station | about 4.5 µGy per hour (DOSTEL medians, 10–12 May 2024) | NASA OSDR RadLab, ISS DOSTEL (RL3). The highest readings that day came before the storm reached Earth (most likely the South Atlantic Anomaly), so the game does not use them |
| NASA career limit | 600 mSv | [NASA-STD-3001 Vol. 1 Rev. C](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf) |
| August 1972 storm | a moonwalker might have absorbed 400 rem | NASA Science, "Sickening Solar Flares" (2005), reprinted in [NASA's STEREO science guide](https://www.nasa.gov/wp-content/uploads/2015/03/139023main_stereo_science_guide.pdf); [archived copy of the original](https://web.archive.org/web/20160101235659/http://science.nasa.gov/science-news/science-at-nasa/2005/27jan_solarflares) |

**How it is used.**

- **Cosmic rays, every week.** Mars: 0.84 mSv per day at mid-cycle. Moon: 1.07 mSv per day at mid-cycle. A solar-cycle factor (0.8 at solar maximum, 1.28 at solar minimum, from the RAD ratio above) scales it by the mission date. So Mars gets 0.67 at solar maximum and the Moon gets 1.37 at solar minimum: the two measured values.
- **Storms.** A storm adds a one-time dose by level. Mars: 1.5, 4 and 9 mSv (the thin air stops most particles; the top value is set by the 20 May 2024 measurement). Moon: 5, 24 and 60 mSv.
- **Protection.** The regolith wall cuts storm dose by up to 85% and cosmic-ray dose by up to 35% (cosmic rays are much harder to stop). The storm shelter cuts storm dose by 90% but costs two working days.

## 4. Planet positions: NASA JPL

- **What it is.** JPL's "Approximate Positions of the Planets": orbital elements valid from 1800 to 2050. <https://ssd.jpl.nasa.gov/planets/approx_pos.html>
- **How it is used.** `src/sim/ephemeris.ts` computes where Earth and Mars are on the mission dates. From that come the real Earth–Mars distance, the one-way radio delay (3 to 22 minutes), the strength of sunlight at Mars (it changes by about ±19% over a Mars year; the game limits the effect to +12% / −10%), and solar conjunction, when the Sun blocks radio contact.
- **Verified.** Tests check the Mars close approaches of 2003, 2018 and 2020, the conjunctions of 2021 and 2023, and the Mars season angle against the value in Curiosity's own records for four dates (difference under 1.5°).
- **Mars season.** The season angle uses the Mars24 algorithm (Allison & McEwen 2000, NASA GISS). The dusty season (Ls 180°–360°) raises the chance of a dust storm.

## 5. Life support, food and power

| In the game | Real basis | Source |
| --- | --- | --- |
| Crops need about 4 weeks | Radishes were harvested on the Space Station after 27 days (2020); "Outredgeous" lettuce after 33 days (2015) | [NASA Veggie fact sheet](https://www.nasa.gov/wp-content/uploads/2023/03/veggie-fact-sheet-508.pdf) |
| Oxygen maker card (Mars) | MOXIE made 122 g of oxygen from Mars air in 16 runs | [NASA, Sept 2023](https://www.nasa.gov/missions/mars-2020-perseverance/perseverance-rover/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/) |
| Ice melter card (Moon) | LCROSS found water in a permanently shadowed crater (2009) | [Colaprete et al. 2010, _Science_](https://pubmed.ncbi.nlm.nih.gov/20966242/) |
| Dust storm and dusty panels (Mars) | The 2018 global dust storm ended Opportunity's mission; dust cut InSight's power by about 90% | [NASA/JPL](https://www.jpl.nasa.gov/news/six-things-about-opportunitys-recovery-efforts/), [NASA InSight](https://www.nasa.gov/missions/insight/nasas-insight-still-hunting-marsquakes-as-power-levels-diminish/) |
| Dark spells at the lunar pole | Ridges near Shackleton crater are sunlit most of the year; no place is sunlit all the time | [NASA LRO](https://science.nasa.gov/resource/shackleton-craters-illuminated-rim-shadowed-interior/) |
| Eclipse card (Moon) | Real dates of total lunar eclipses 2010–2026; Blue Ghost photographed one from the Moon on 14 March 2025 | [NASA](https://www.nasa.gov/blogs/missions/2025/03/14/nasa-science-data-received-blue-ghost-captures-eclipse-from-moon/) |
| Radio delay | 3 to 22 minutes to Mars, about 1.3 seconds to the Moon | [NASA Science](https://science.nasa.gov/mission/voyager/voyager-1/voyager-1-what-is-a-light-day/) |
| Gravity when walking and jumping | Mars 3.71 m/s², Moon 1.62 m/s² | NASA planetary fact sheets |
| Why the crew grows food (films) | Astronaut menus have 1,900 to 3,200 calories a day; the Space Station gets fresh food every few months; crews on the Moon or Mars will have to grow their own | [Canadian Space Agency](https://www.asc-csa.gc.ca/eng/sciences/food-production/growing-healthy-food-in-space-and-remote-areas.asp) (CSA1) |

Every decision card ends with "A true story" and a link to its source. All 66 Science log cards list their sources.

### Growing the outpost

The new buildings, the tools and the rooms each point to a true story. The checks, with quotes, are in [sources/facts-outpost.json](sources/facts-outpost.json).

| In the game | Real basis | Source |
| --- | --- | --- |
| Regolith and metal dug on walks become buildings | NASA plans to use local material ("in-situ resources"). Moon soil is about 45% oxygen by mass; in 2023 NASA got oxygen (as carbon monoxide) out of simulated Moon soil in a vacuum chamber | [NASA Johnson, 2023](https://www.nasa.gov/centers-and-facilities/johnson/nasa-successfully-extracts-oxygen-from-lunar-soil-simulant/) |
| Metal in the rocks | Moon highlands are rich in aluminium; the lava plains hold ilmenite (iron, titanium, oxygen). Mars is red because the iron in its dust has rusted | [NASA lunar regolith simulant guide, 2024](https://ntrs.nasa.gov/api/citations/20240011783/downloads/Lunar_Regolith_Simulant_Users_Guide_Rev_A_28OCT.pdf), [NASA: Mars facts](https://science.nasa.gov/mars/facts/) |
| The builder robot prints buildings | NASA's 3D-Printed Habitat Challenge (2015–2019); Mars Dune Alpha, printed by ICON, where two crews each lived 378 days | [NASA, 2022](https://www.nasa.gov/centers-and-facilities/marshall/nasa-icon-advance-lunar-construction-technology-for-moon-missions/), [NASA, 2023](https://www.nasa.gov/missions/analog-field-testing/chapea/first-chapea-crew-begins-378-day-mission/), [NASA, 2026](https://www.nasa.gov/centers-and-facilities/johnson/chapea-mission-2-crew-reflects-after-378-days-on-simulated-mars/) |
| Bricks from regolith | ESA baked simulated Moon dust into bricks with focused sunlight (2017), as strong as gypsum | [ESA, 2017](https://www.esa.int/Enabling_Support/Space_Engineering_Technology/Printing_bricks_from_moondust_using_the_Sun_s_heat) |
| The workshop's 3D printer | The first 3D printer in space (Space Station, November 2014); a wrench printed from a design sent from Earth (December 2014) | [NASA, 2014](https://www.nasa.gov/missions/station/open-for-business-3-d-printer-creates-first-object-in-space-on-international-space-station/), [NASA: the wrench](https://www.nasa.gov/image-detail/nasa-2071125-79-7f-2/) |
| Oxygen plant | Mars: MOXIE (above). Moon: oxygen from regolith (above) | see above |
| Solar array (Moon) | NASA's Vertical Solar Array Technology: panels on a mast about 10 m tall, tested in 2024 | [NASA, 2022](https://www.nasa.gov/news-release/three-companies-to-help-nasa-advance-solar-array-technology-for-moon/), [NASA Johnson: the 2024 test](https://www.nasa.gov/centers-and-facilities/johnson/from-houston-to-the-moon-johnsons-thermal-vacuum-chamber-tests-lunar-solar-technology/) |
| Observatory | Moon: the first telescope on the Moon, Apollo 16 (1972), by George Carruthers. Mars: Perseverance filmed Phobos crossing the Sun on 2 April 2022 | [NASA History](https://www.nasa.gov/history/remembering-the-first-moon-based-telescope/), [NASA/JPL, 2022](https://www.jpl.nasa.gov/news/nasas-perseverance-rover-captures-video-of-solar-eclipse-on-mars/) |
| Garden dome | Chile peppers grown on the Space Station in 2021 (137 days, 26 peppers) | [NASA, 2021](https://www.nasa.gov/missions/station/nasas-second-pepper-harvest-sets-record-on-space-station/) |
| Spectrometer room game | ChemCam on Curiosity reads the light of laser sparks on rocks up to 7 m away; one million shots by August 2024. The lines in the game sit at their real wavelengths (380 to 700 nm): a few of the brightest visible lines of hydrogen, sodium, calcium, iron, magnesium and sulfur from the [NIST Atomic Spectra Database](https://physics.nist.gov/PhysRefData/ASD/lines_form.html); how bright each line is drawn is simplified | [NASA/JPL](https://www.jpl.nasa.gov/news/laser-instrument-on-nasa-mars-rover-tops-100000-zaps/), [NASA: one million shots](https://science.nasa.gov/blog/sols-4304-4006-12-years-42-drill-holes-and-now-1-million-chemcam-shots/) |
| Landing simulator in the lander | Real surface gravity: Mars 3.71 m/s², Moon 1.62 m/s² (Earth 9.81). The safe touchdown speeds and the fuel are game numbers | [NASA/JPL Mars 2020 landing facts](https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/quick_facts/), [NASA Moon facts](https://science.nasa.gov/moon/facts/) |
| Radio room game | Radio travels at the speed of light. The game shows the real one-way delay for the mission week (about 1.3 s from the Moon; 3 to 22 minutes from Mars), worked out from the planet positions in section 4 | [NASA: what is a light-day](https://science.nasa.gov/mission/voyager/voyager-1/voyager-1-what-is-a-light-day/) |
| Bigger air tank | A Space Station suit carries oxygen for about 7 hours, plus a 30-minute emergency pack | [NASA OIG, 2017](https://oig.nasa.gov/docs/IG-17-018.pdf), [NASA: Apollo 17](https://www.nasa.gov/missions/apollo/apollo-17-mission-details/) |
| Drill | Apollo 15–17 drilled soil cores 2 to 3 m long; Curiosity's holes are 1.6 cm wide | [NASA ALSJ](https://www.nasa.gov/wp-content/uploads/static/history/alsj/WOTM/WOTM-Drilling.html), [NASA: a Curiosity drill hole](https://science.nasa.gov/resource/sample-collection-drill-hole-on-martian-sandstone-target-windjana/) |
| Radiation vest | AstroRad flew on Artemis I (2022) on the mannequin Zohar; models of a very strong storm give about 40–60% less dose | [Science Advances, 2026](https://doi.org/10.1126/sciadv.adz1892) |

### Discoveries on walks

Each world has four things to discover outside. Each is a real find, told on its own Science log card. The checks, with quotes, are in [sources/facts-discoveries.json](sources/facts-discoveries.json).

| In the game | The real find | Source |
| --- | --- | --- |
| Cracked rock with yellow crystals (Mars) | Curiosity drove over a rock on 30 May 2024 and found pure sulfur inside, the first on Mars | [NASA/JPL, July 2024](https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/) |
| Dark metal rock (Mars) | Curiosity's iron-nickel meteorites "Lebanon" (2014), "Egg Rock" (2016) and "Cacao" (2023) | [NASA/JPL, 2016](https://www.jpl.nasa.gov/news/curiosity-mars-rover-checks-odd-looking-iron-meteorite/) |
| Slab of rounded pebbles (Mars) | The "Hottah" and "Link" outcrops (2012): an old stream, ankle-deep to hip-deep | [NASA/JPL, 2012](https://www.jpl.nasa.gov/news/nasa-rover-finds-old-streambed-on-martian-surface/) |
| Layered rock tower (Mars) | The Murray Buttes (2016): wind-blown dune sand turned to stone, up to about 15 m high | [NASA/JPL, 2016](https://www.jpl.nasa.gov/news/mars-rover-views-spectacular-layered-rock-formations/) |
| Step in the ground (Moon) | Fault scarps of the shrinking Moon; young ones near the south pole (2024) | [NASA, 2019](https://www.nasa.gov/news-release/shrinking-moon-may-be-generating-moonquakes/), [NASA, 2024](https://www.nasa.gov/solar-system/moon/shrinking-moon-causing-moonquakes-and-faults-near-lunar-south-pole/) |
| Orange glass beads (Moon) | Apollo 17, 12 December 1972, Shorty crater: volcanic glass about 3.5 billion years old | [NASA History](https://www.nasa.gov/history/50-years-ago-apollo-17-lands-at-taurus-littrow/) |
| White rock (Moon) | The Genesis Rock, Apollo 15, 1 August 1971: a piece of the ancient crust, about 4 billion years old | [NASA Science](https://science.nasa.gov/solar-system/moon/genesis-rock/) |
| Bright rocks round a young crater (Moon) | More than 200 new craters seen by the Lunar Reconnaissance Orbiter since 2009 | [NASA, 2016](https://www.nasa.gov/news-release/earths-moon-hit-by-surprising-number-of-meteoroids/) |

## 6. What we simplified

A game for 7-year-olds cannot be a mission simulator. These are the simplifications, so nobody mistakes them for measurements.

1. **One turn is one week.** Real outposts are run minute by minute.
2. **Energy comes in whole cells; air and water share one meter.**
3. **Radiation budgets are set for a short training mission** (72 mSv on Mars, 86 mSv on the Moon at the standard level). They are far below NASA's 600 mSv career limit. The Mars budget is smaller because the trip there and back already costs more than a whole career allowance: about 660 mSv for the shortest round trip, against NASA's 600 mSv limit.
4. **Storm doses are scaled estimates,** anchored to the events in the table above. They are not measurements for each storm.
5. **Mars storms from model runs.** A WSA-ENLIL run predicts where an eruption goes, not the radiation dose. We treat a fast, direct hit as a storm risk. The three events that RAD measured keep their real dates; their doses are game levels. The code also accepts DONKI particle events that Mars spacecraft (MAVEN, MSL) measured; the current archive has none, so no mission uses this branch yet.
6. **Lunar sunlight is a simple horizon model:** the Sun circles the horizon once a month (using the real lunar calendar) and two mountain ranges block it for part of each month. The best real sites are dark for at most about 43 hours; our ridge is good, not the best.
7. **The lunar surface dose is not a NASA measurement.** It is the only direct measurement on the surface so far, from China's Chang'E-4 lander, and is labelled as such in the game.
8. **Curiosity's weather is from Gale Crater.** The game places the Mars outpost there so the readings apply.
9. **Discoveries are gathered close to the outpost and drawn larger.** The eight finds on walks are real NASA finds, but in the game they all lie within about 100 m of the outpost. The Mars finds were made by Curiosity in Gale Crater, spread along many kilometres of its drive. Two of the Moon finds come from the Apollo landing sites, far from the lunar south pole where the game's Moon outpost stands; the other two were seen from orbit, and fault scarps like the one in the game have been found near the south pole too. The rock towers on the Mars skyline are bigger than the Murray Buttes, which are up to about 15 m high; the one you can walk to is that size.
10. **Building and tool numbers are game numbers.** Costs, the weeks a building takes, what it adds each week, and what each tool does (20 more seconds of suit air, a vest that halves a storm dose) are chosen for play, not measured. The stories behind them are real (see "Growing the outpost").
11. **Printing takes seconds and seven thick layers.** A real 3D printer lays hundreds of layers, each a fraction of a millimetre thick, and a small part takes hours. The game keeps the idea that matters: a part grows one layer at a time, and a layer cannot hang in thin air over nothing.
12. **The landing simulator is flat.** The lander moves only up, down and sideways, with one main engine; real landers steer in three dimensions with guidance computers. The gravity of each world is the real one.
13. **The radio game is a rhythm game.** Real data is sent as a steady stream by computers; the beat only stands for packets of data going out.
14. **Some Mars dust storms are the game's own.** Only the 2018 global dust storm comes on its real dates. On other dates a dust storm can start by chance (more often in the dusty season), and those weeks are labelled "Game model".
15. **An urgent card can wait 15 minutes for Earth.** The radio round trip is the real one for the mission week. In the months around opposition it is shorter (about 6 to 15 minutes) and Mission Control's advice arrives in time; the rest of the time it is longer (up to about 45 minutes) and the crew decides alone. The sick-plants card follows the same rule. The 15 minutes are a game number.

## 7. Rebuilding the data

```bash
node scripts/fetch-donki.ts          # full DONKI archive -> src/data/spaceweather.json (+ latest file)
node scripts/fetch-donki.ts --latest # last 90 days -> public/data/spaceweather-latest.json
node scripts/fetch-rems.ts           # Curiosity weather -> src/data/mars-weather.json
node scripts/fetch-images.ts         # NASA photos for the Science log -> public/img/codex/
```

Node 22.18 or newer runs these TypeScript files directly. Raw answers are cached in `data/raw/` so a second run only downloads what is new.

## 8. The films: every task explained with a real fact

The opening film walks through every task of a week (the forecast, sharing the energy, air, food, the lab, the shield, walks, choices and the week's report): what it is and why it matters. Each task also has its own short film with a card ("Why?" buttons on every step) that ends with one real fact and its source. Event films show the first solar storm, the first dust storm, a lunar eclipse seen from the Moon (Blue Ghost photographed one on 14 March 2025, see section 5), Mars solar conjunction (the Sun blocks the radio, see section 4), the first harvest, the first new building and the end of the mission. All of them are archived facts, checked on 14 November 2026; none is presented as live.

| Card | Fact (Mars / Moon) | Fact sheet |
| --- | --- | --- |
| Space forecast | the storms are real DONKI events on their real dates | R18 |
| Sharing the energy | InSight stopped after dust covered its panels / panels at the lunar pole stand upright (VSAT) | E5 / O7 |
| Air | MOXIE made 122 g of oxygen from Mars air / moon dust is about 45% oxygen by mass | E6 / O1 |
| Food | 1,900–3,200 calories a day; crews far from Earth must grow food | CSA1 |
| Science | NASA's Open Science Data Repository keeps space-biology results open to everyone | 2026 challenge resources (OSDR) |
| Radiation shield | 4.7 → 304 µGy per hour on Mars, 20 May 2024 / about 4.5 µGy per hour on the Space Station | RL1–RL3 |
| Walking outside | wind cleaned Spirit's and Opportunity's panels / Apollo 17's orange soil | E5 / D6 |
| Choices | Orion's crew builds a storm shelter from storage bags in about an hour | R12 |
| Asking Earth | radio delay 3–22 minutes to Mars, about 1.3 seconds to the Moon | section 4 |
| The week runs | a sol lasts 24 h 39 min / high points near Shackleton crater are sunlit most of the year, none all the time | E3 / E14 |

The texts are in `src/i18n/films.ts`; the film data is in `src/game/films.ts`.
