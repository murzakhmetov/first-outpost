/**
 * Science log: the fact cards the player collects.
 *
 * Every card is written from the checked fact sheets in research/
 * (facts-radiation.json, facts-environment.json, images.json) or from a NASA
 * page that was opened and read for this file. Each number on a card can be
 * found on one of the card's sources.
 *
 * Texts are plain text for readers aged 7-12: no markup, no placeholders.
 * `image` is an id from data/codex-images.json (NASA Image and Video Library). Two closely
 * related pairs of cards share a picture; cards with no honest photo show a drawn scene.
 */

export type CodexTopic = 'radiation' | 'sun' | 'power' | 'air' | 'food' | 'radio' | 'worlds' | 'people' | 'data';

export interface CodexText {
  title: string;
  body: string;
  numbers: [string, string][];
}

export interface CodexCard {
  id: string;
  topic: CodexTopic;
  image?: string;
  en: CodexText;
  ru: CodexText;
  sources: { title: string; url: string }[];
}

export const CODEX: CodexCard[] = [
  // ----- The Sun -------------------------------------------------------------
  {
    id: 'space_weather',
    topic: 'sun',
    image: 'img-solar-flare',
    en: {
      title: 'Solar storms',
      body: 'In a solar storm the Sun throws out a bright flash, called a solar flare, and a spray of tiny, very fast particles. The fastest particles cross the 150 million km to Earth and the Moon in less than an hour. That leaves astronauts very little time to take cover. The photo shows a giant flare on 6 September 2017.',
      numbers: [
        ['Sun to Earth', '150 million km'],
        ['Fastest particles arrive', 'in less than 1 hour'],
        ['Warning time in a 2017 NASA study', 'about 45 minutes'],
      ],
    },
    ru: {
      title: 'Солнечные бури',
      body: 'Солнечная буря — это когда на Солнце происходит яркая вспышка, а в космос летит поток крошечных, очень быстрых частиц. Самые быстрые из них пролетают 150 миллионов км до Земли и Луны меньше чем за час. Поэтому у астронавтов почти нет времени, чтобы укрыться. На фото — огромная вспышка 6 сентября 2017 года.',
      numbers: [
        ['От Солнца до Земли', '150 млн км'],
        ['Самые быстрые частицы долетают', 'меньше чем за 1 час'],
        ['Предупреждение в исследовании NASA 2017 года', 'примерно за 45 минут'],
      ],
    },
    sources: [
      {
        title: 'How NASA Will Protect Astronauts From Space Radiation at the Moon',
        url: 'https://science.nasa.gov/science-research/heliophysics/how-nasa-will-protect-astronauts-from-space-radiation-at-the-moon/',
      },
      {
        title: 'NASA Scientists Demonstrate Technique to Improve Particle Warnings that Protect Astronauts',
        url: 'https://www.nasa.gov/general/nasa-scientists-demonstrate-technique-to-improve-particle-warnings-that-protect-astronauts/',
      },
    ],
  },
  {
    id: 'solar_cycle',
    topic: 'sun',
    en: {
      title: 'The Sun’s 11-year rhythm',
      body: 'The Sun is not always the same. Roughly every 11 years it swings from calm to stormy and back, and this is called the solar cycle. In October 2024 NASA and its partners announced that the Sun had entered its stormiest period, called solar maximum. The strongest flare of this cycle so far, a flash classed X9.0, came on 3 October 2024; X marks the most powerful flares.',
      numbers: [
        ['Length of one cycle', 'about 11 years'],
        ['Solar maximum announced', '15 October 2024'],
        ['Strongest flare so far', 'X9.0, 3 October 2024'],
        ['A big flare in 2026', 'X8.1, 1 February 2026'],
      ],
    },
    ru: {
      title: '11-летний ритм Солнца',
      body: 'Солнце не всегда одинаковое. Примерно раз в 11 лет оно из спокойного становится бурным, а потом снова затихает — это называют солнечным циклом. В октябре 2024 года NASA и его партнёры объявили, что у Солнца начался самый бурный период — солнечный максимум. Самая мощная вспышка этого цикла на сегодня, класса X9.0, случилась 3 октября 2024 года; буквой X обозначают самые сильные вспышки.',
      numbers: [
        ['Длина одного цикла', 'около 11 лет'],
        ['Объявлен солнечный максимум', '15 октября 2024 года'],
        ['Самая сильная вспышка цикла', 'X9.0, 3 октября 2024 года'],
        ['Большая вспышка 2026 года', 'X8.1, 1 февраля 2026 года'],
      ],
    },
    sources: [
      {
        title: 'NASA, NOAA: Sun Reaches Maximum Phase in 11-Year Solar Cycle',
        url: 'https://science.nasa.gov/science-research/heliophysics/nasa-noaa-sun-reaches-maximum-phase-in-11-year-solar-cycle/',
      },
      {
        title: 'Sun Releases 4 Strong Solar Flares',
        url: 'https://science.nasa.gov/blogs/solar-cycle-25/2026/02/02/sun-releases-4-strong-solar-flares/',
      },
    ],
  },
  {
    id: 'may_2024',
    topic: 'sun',
    image: 'img-curiosity-storm-specks',
    en: {
      title: 'The storms of May 2024',
      body: 'May 2024 was a very stormy month for the Sun. On 10–11 May a storm reached Earth and hit G5, the top level of the scale for magnetic storms, for the first time since 2003. On 20 May another blast struck Mars. The Curiosity rover measured its biggest radiation surge since landing: 8,100 micrograys (a unit of radiation dose), which NASA compares to 30 chest X-rays.',
      numbers: [
        ['Storm at Earth', '10–11 May 2024, level G5'],
        ['Previous G5 storm', '2003'],
        ['Surge at Mars, 20 May 2024', '8,100 micrograys'],
        ['NASA’s comparison', '30 chest X-rays'],
      ],
    },
    ru: {
      title: 'Бури мая 2024 года',
      body: 'Май 2024 года выдался на Солнце очень бурным. 10–11 мая буря дошла до Земли и достигла уровня G5 — высшего по шкале магнитных бурь; такого не было с 2003 года. А 20 мая новый выброс ударил по Марсу. Марсоход Curiosity измерил самый сильный всплеск радиации со дня посадки: 8100 микрогрей (это единица дозы радиации) — NASA сравнивает это с 30 рентгеновскими снимками грудной клетки.',
      numbers: [
        ['Буря у Земли', '10–11 мая 2024 года, уровень G5'],
        ['Предыдущая буря G5', '2003 год'],
        ['Всплеск на Марсе, 20 мая 2024 года', '8100 микрогрей'],
        ['Сравнение NASA', '30 рентгеновских снимков грудной клетки'],
      ],
    },
    sources: [
      {
        title: 'How NASA Tracked the Most Intense Solar Storm in Decades',
        url: 'https://science.nasa.gov/science-research/heliophysics/how-nasa-tracked-the-most-intense-solar-storm-in-decades/',
      },
      {
        title: 'NASA Watches Mars Light Up During Epic Solar Storm',
        url: 'https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm',
      },
    ],
  },
  {
    id: 'aurora_mars',
    topic: 'sun',
    image: 'img-mars-aurora-2017',
    en: {
      title: 'Auroras on Mars',
      body: 'An aurora is a glow in the night sky, made when particles from the Sun hit the air. Mars has them too. After a solar storm in September 2017, NASA’s MAVEN spacecraft saw one all around Mars, more than 25 times brighter than any it had seen. On 18 March 2024 the Perseverance rover spotted a faint green aurora, the first ever seen from the surface of another planet.',
      numbers: [
        ['Aurora all around Mars', 'September 2017'],
        ['Its brightness', 'more than 25 times the earlier record'],
        ['Green aurora seen from the ground', '18 March 2024'],
      ],
    },
    ru: {
      title: 'Сияния в небе Марса',
      body: 'Полярное сияние — это свечение ночного неба; оно возникает, когда частицы от Солнца врезаются в воздух. На Марсе такое тоже бывает. После солнечной бури в сентябре 2017 года аппарат NASA MAVEN увидел сияние вокруг всей планеты — более чем в 25 раз ярче всех, что он видел раньше. А 18 марта 2024 года марсоход Perseverance заметил слабое зелёное сияние — первое, которое увидели с поверхности другой планеты.',
      numbers: [
        ['Сияние вокруг всего Марса', 'сентябрь 2017 года'],
        ['Его яркость', 'более чем в 25 раз выше прежнего рекорда'],
        ['Зелёное сияние, увиденное с поверхности', '18 марта 2024 года'],
      ],
    },
    sources: [
      {
        title: 'Large Solar Storm Sparks Global Aurora and Doubles Radiation Levels on the Martian Surface',
        url: 'https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/',
      },
      {
        title: 'NASA Observes First Visible-light Auroras at Mars',
        url: 'https://science.nasa.gov/solar-system/planets/mars/nasa-observes-first-visible-light-auroras-at-mars/',
      },
    ],
  },

  // ----- Radiation -----------------------------------------------------------
  {
    id: 'storm_shelter',
    topic: 'radiation',
    en: {
      title: 'The storm shelter',
      body: 'When a solar storm is coming, the crew hides behind as much stuff as possible. In NASA’s Orion spacecraft they stack bags of food, water and supplies into a shelter within an hour. A NASA scientist estimated that the August 1972 storm could have given an astronaut on the Moon about 4,000 millisieverts (mSv) of radiation, but under 350 inside an Apollo spacecraft. Luckily, nobody was on the Moon then.',
      numbers: [
        ['Time to build Orion’s shelter', 'within 1 hour'],
        ['Longest stay inside', 'up to 24 hours'],
        ['August 1972 storm, on the Moon (estimate)', 'about 4,000 mSv'],
        ['Same storm, inside an Apollo spacecraft', 'less than 350 mSv'],
      ],
    },
    ru: {
      title: 'Укрытие от бури',
      body: 'Когда приближается солнечная буря, экипаж прячется за всем, что есть на борту. В корабле NASA Orion астронавты за час складывают укрытие из сумок с едой, водой и припасами. Учёный NASA подсчитал: буря августа 1972 года могла дать астронавту на Луне около 4000 миллизивертов (мЗв) радиации, а внутри корабля Apollo — меньше 350. К счастью, на Луне тогда никого не было.',
      numbers: [
        ['Собрать укрытие в Orion', 'за 1 час'],
        ['Сколько можно пробыть внутри', 'до 24 часов'],
        ['Буря августа 1972 года, на Луне (оценка)', 'около 4000 мЗв'],
        ['Та же буря, внутри корабля Apollo', 'меньше 350 мЗв'],
      ],
    },
    sources: [
      {
        title: 'Scientists and Engineers Evaluate Orion Radiation Protection Plan',
        url: 'https://www.nasa.gov/missions/artemis/orion/scientists-and-engineers-evaluate-orion-radiation-protection-plan/',
      },
      {
        title: 'Sickening Solar Flares (reprinted in NASA’s STEREO science guide)',
        url: 'https://www.nasa.gov/wp-content/uploads/2015/03/139023main_stereo_science_guide.pdf',
      },
    ],
  },
  {
    id: 'cosmic_rays',
    topic: 'radiation',
    image: 'img-tycho-remnant',
    en: {
      title: 'Cosmic rays never stop',
      body: 'Galactic cosmic rays are tiny, very fast particles from exploded stars far away in our galaxy. They are like a steady drizzle that never stops. When the Sun is busy, its magnetic bubble pushes some of them away; when it is quiet, more get in. On Mars, Curiosity measured about 0.2 milligrays (a unit of radiation dose) a day when the Sun was busy and 0.32 when it was quietest.',
      numbers: [
        ['Sun busy (2012–2015)', 'about 0.2 mGy per day'],
        ['Sun quiet (2019–2020)', 'about 0.32 mGy per day'],
        ['Increase', 'about 50%'],
      ],
    },
    ru: {
      title: 'Космические лучи не кончаются',
      body: 'Галактические космические лучи — это крошечные, очень быстрые частицы от взорвавшихся звёзд в нашей Галактике. Они похожи на мелкий дождик, который никогда не прекращается. Когда Солнце активно, его магнитный пузырь отталкивает часть этих частиц, а когда оно затихает, их долетает больше. На Марсе Curiosity измерил около 0,2 миллигрея (это единица дозы радиации) в сутки при активном Солнце и 0,32 — при самом спокойном.',
      numbers: [
        ['Активное Солнце (2012–2015)', 'около 0,2 мГр в сутки'],
        ['Спокойное Солнце (2019–2020)', 'около 0,32 мГр в сутки'],
        ['Рост', 'примерно на 50%'],
      ],
    },
    sources: [
      {
        title: 'Radiation environment for future human exploration on the surface of Mars: the current understanding based on MSL/RAD dose measurements',
        url: 'https://link.springer.com/article/10.1007/s00159-021-00136-5',
      },
      {
        title: 'How NASA Will Protect Astronauts From Space Radiation at the Moon',
        url: 'https://science.nasa.gov/science-research/heliophysics/how-nasa-will-protect-astronauts-from-space-radiation-at-the-moon/',
      },
    ],
  },
  {
    id: 'curiosity_rad',
    topic: 'radiation',
    image: 'img-curiosity-selfie',
    en: {
      title: 'Curiosity counts radiation',
      body: 'The Curiosity rover carries an instrument called RAD that measures radiation: fast, invisible particles that can harm living cells. On the flight to Mars it counted about 1.8 mSv (millisieverts, a unit of radiation dose) a day inside the spacecraft. On the ground of Mars it counted about 0.67 mSv a day. NASA uses these numbers to plan how to keep future crews safe.',
      numbers: [
        ['On the way to Mars', 'about 1.8 mSv per day'],
        ['On the surface of Mars', 'about 0.67 mSv per day'],
        ['A whole round trip (NASA estimate)', 'about 1,000 mSv'],
      ],
    },
    ru: {
      title: 'Curiosity считает радиацию',
      body: 'На марсоходе Curiosity стоит прибор RAD: он измеряет радиацию — быстрые невидимые частицы, которые вредят живым клеткам. По пути к Марсу прибор насчитал внутри корабля около 1,8 мЗв в сутки (мЗв, миллизиверт, — единица дозы радиации). На поверхности Марса — около 0,67 мЗв в сутки. По этим числам NASA планирует, как защитить будущие экипажи.',
      numbers: [
        ['По пути к Марсу', 'около 1,8 мЗв в сутки'],
        ['На поверхности Марса', 'около 0,67 мЗв в сутки'],
        ['Весь полёт туда и обратно (оценка NASA)', 'около 1000 мЗв'],
      ],
    },
    sources: [
      {
        title: 'NASA Curiosity: First Mars Age Measurement and Human Exploration Help',
        url: 'https://www.jpl.nasa.gov/news/nasa-curiosity-first-mars-age-measurement-and-human-exploration-help/',
      },
      {
        title: 'Data From NASA Rover’s Voyage to Mars Aids Planning',
        url: 'https://www.jpl.nasa.gov/news/data-from-nasa-rovers-voyage-to-mars-aids-planning/',
      },
    ],
  },
  {
    id: 'dose_limits',
    topic: 'radiation',
    image: 'img-wearable-dosimeter',
    en: {
      title: 'How much is too much?',
      body: 'Radiation dose is counted in millisieverts, or mSv. One chest X-ray gives about 0.1 mSv, and nature gives everyone on Earth about 2.4 mSv a year. On the Space Station an astronaut gets up to about 0.5 mSv every day. NASA’s rule is that an astronaut’s whole career in space must stay under 600 mSv.',
      numbers: [
        ['One chest X-ray', 'about 0.1 mSv'],
        ['One year on Earth (natural)', 'about 2.4 mSv'],
        ['One day on the Space Station', 'up to about 0.5 mSv'],
        ['NASA career limit', '600 mSv'],
      ],
    },
    ru: {
      title: 'Сколько радиации — слишком много?',
      body: 'Дозу радиации считают в миллизивертах, сокращённо мЗв. Один рентгеновский снимок грудной клетки — это примерно 0,1 мЗв, а от природы каждый человек на Земле получает около 2,4 мЗв в год. На космической станции астронавт получает примерно до 0,5 мЗв каждый день. Правило NASA: за все полёты в жизни астронавт должен набрать меньше 600 мЗв.',
      numbers: [
        ['Один рентген грудной клетки', 'около 0,1 мЗв'],
        ['Год на Земле (природный фон)', 'около 2,4 мЗв'],
        ['Один день на космической станции', 'примерно до 0,5 мЗв'],
        ['Предел NASA на всю карьеру', '600 мЗв'],
      ],
    },
    sources: [
      {
        title: 'The Lifetime Surveillance of Astronaut Health Newsletter, October 2023',
        url: 'https://www.nasa.gov/wp-content/uploads/2023/10/lsah-newsletter-2023-vol28-issue2.pdf',
      },
      {
        title: 'Why Space Radiation Matters',
        url: 'https://www.nasa.gov/missions/analog-field-testing/why-space-radiation-matters/',
      },
    ],
  },
  {
    id: 'moon_radiation',
    topic: 'radiation',
    en: {
      title: 'Radiation on the Moon',
      body: 'The Moon has no magnetic field of its own to push radiation away, so particles from space reach the ground. In 2019 China’s Chang’E-4 lander measured a dose of 1,369 microsieverts a day there, which is about 1.4 mSv. On 28 October 2021 a blast from the Sun was measured on three worlds at once for the first time: Earth, the Moon and Mars.',
      numbers: [
        ['Moon’s surface (Chang’E-4, 2019)', '1,369 microsieverts per day'],
        ['Three-world solar event', '28 October 2021'],
        ['That event, in orbit around the Moon', '31 mGy'],
        ['That event, on the ground of Mars', '0.3 mGy'],
      ],
    },
    ru: {
      title: 'Радиация на Луне',
      body: 'У Луны нет своего магнитного поля, которое отталкивало бы радиацию, поэтому частицы из космоса долетают до самой поверхности. В 2019 году китайский аппарат Chang’E-4 измерил там дозу 1369 микрозивертов в сутки — это примерно 1,4 мЗв. А 28 октября 2021 года выброс Солнца впервые измерили сразу на трёх мирах: на Земле, Луне и Марсе.',
      numbers: [
        ['Поверхность Луны (Chang’E-4, 2019)', '1369 микрозивертов в сутки'],
        ['Событие на трёх мирах', '28 октября 2021 года'],
        ['То же событие на орбите у Луны', '31 мГр'],
        ['То же событие на поверхности Марса', '0,3 мГр'],
      ],
    },
    sources: [
      {
        title: 'First measurements of the radiation dose on the lunar surface',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7518862/',
      },
      {
        title: 'Giant solar eruption felt on Earth, Moon and Mars',
        url: 'https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Exploration/ExoMars/Giant_solar_eruption_felt_on_Earth_Moon_and_Mars',
      },
    ],
  },
  {
    id: 'regolith_shield',
    topic: 'radiation',
    image: 'img-apollo11-bootprint',
    en: {
      title: 'A shield of Moon soil',
      body: 'Regolith is the loose dust and broken rock that covers the Moon. It is free and already there, so engineers want to pile it over shelters as a radiation shield. In a NASA study, 3 metres cut the dose to about 50 mSv a year, and 7 metres to about 5. NASA is also paying a company to develop machines that 3D-print landing pads and shelters from Moon materials.',
      numbers: [
        ['Under 3 m of regolith', 'about 50 mSv per year'],
        ['Under 7 m of regolith', 'about 5 mSv per year'],
        ['NASA’s 3D-printing contract', '$57.2 million, running to 2028'],
      ],
    },
    ru: {
      title: 'Щит из лунного грунта',
      body: 'Реголит — это рыхлая пыль и битый камень, которыми покрыта Луна. Он бесплатный и уже лежит на месте, поэтому инженеры хотят насыпать его поверх укрытий как щит от радиации. В расчётах NASA слой в 3 метра снижал дозу примерно до 50 мЗв в год, а в 7 метров — примерно до 5. Ещё NASA платит компании за разработку машин, которые будут печатать на 3D-принтере посадочные площадки и укрытия из лунного материала.',
      numbers: [
        ['Под 3 м реголита', 'около 50 мЗв в год'],
        ['Под 7 м реголита', 'около 5 мЗв в год'],
        ['Контракт NASA на 3D-печать', '57,2 млн долларов, до 2028 года'],
      ],
    },
    sources: [
      {
        title: 'Design Analysis for Lunar Safe Haven Concepts',
        url: 'https://ntrs.nasa.gov/citations/20210024725',
      },
      {
        title: 'NASA, ICON Advance Lunar Construction Technology for Moon Missions',
        url: 'https://www.nasa.gov/centers-and-facilities/marshall/nasa-icon-advance-lunar-construction-technology-for-moon-missions/',
      },
    ],
  },
  {
    id: 'artemis_radiation',
    topic: 'radiation',
    image: 'img-helga-zohar',
    en: {
      title: 'Helga, Zohar and Artemis',
      body: 'In 2022 the Artemis I flight sent NASA’s Orion spacecraft around the Moon without a crew, carrying two mannequins named Helga and Zohar. They were fitted with radiation sensors, and Zohar wore a protective vest so scientists could compare. The measurements showed that the dose depends on where you sit inside the spacecraft. In April 2026 four astronauts flew around the Moon and back on Artemis II.',
      numbers: [
        ['Radiation sensors on Artemis I', '5,600 passive and 34 active'],
        ['Length of Artemis I', '25.5 days'],
        ['Artemis II', '1–10 April 2026'],
        ['Artemis II crew', '4 astronauts'],
      ],
    },
    ru: {
      title: 'Хельга, Зохар и Artemis',
      body: 'В 2022 году в полёте Artemis I корабль NASA Orion облетел Луну без экипажа: в креслах сидели два манекена, Хельга и Зохар. На них закрепили датчики радиации, а на Зохар надели защитный жилет, чтобы сравнить результаты. Измерения показали: доза зависит от того, в каком месте корабля ты находишься. А в апреле 2026 года четверо астронавтов облетели Луну и вернулись на Землю в полёте Artemis II.',
      numbers: [
        ['Датчики радиации в Artemis I', '5600 пассивных и 34 активных'],
        ['Длительность Artemis I', '25,5 суток'],
        ['Artemis II', '1–10 апреля 2026 года'],
        ['Экипаж Artemis II', '4 астронавта'],
      ],
    },
    sources: [
      {
        title: 'Artemis I Radiation Measurements Validate Orion Safety for Astronauts',
        url: 'https://www.nasa.gov/centers-and-facilities/johnson/artemis-i-radiation-measurements-validate-orion-safety-for-astronauts/',
      },
      {
        title: 'NASA Welcomes Record-Setting Artemis II Moonfarers Back to Earth',
        url: 'https://www.nasa.gov/news-release/nasa-welcomes-record-setting-artemis-ii-moonfarers-back-to-earth/',
      },
    ],
  },

  // ----- Power ---------------------------------------------------------------
  {
    id: 'dust_storm',
    topic: 'power',
    image: 'img-dust-storm-map',
    en: {
      title: 'A planet-wide dust storm',
      body: 'In June 2018 a dust storm grew until it covered all of Mars. Above the solar-powered rover Opportunity the sky turned dustier than any ever measured on Mars. On 10 June its panels gathered only about 21 watt-hours of energy, the lowest ever, and the rover fell silent. NASA tried for months to wake it, then ended the mission on 13 February 2019.',
      numbers: [
        ['Energy on 10 June 2018', 'about 21 Wh'],
        ['Last signal from Opportunity', '10 June 2018'],
        ['Commands sent to wake it', 'more than 1,000'],
        ['Mission ended', '13 February 2019'],
      ],
    },
    ru: {
      title: 'Пыльная буря на весь Марс',
      body: 'В июне 2018 года пыльная буря разрослась и накрыла весь Марс. Над марсоходом Opportunity, который работал от солнечных панелей, пыли стало больше, чем когда-либо измеряли на Марсе. 10 июня его панели собрали всего около 21 ватт-часа энергии — меньше, чем когда-либо, — и марсоход замолчал. NASA много месяцев пыталось его разбудить, а 13 февраля 2019 года завершило миссию.',
      numbers: [
        ['Энергия за 10 июня 2018 года', 'около 21 Вт·ч'],
        ['Последний сигнал Opportunity', '10 июня 2018 года'],
        ['Команд, чтобы разбудить марсоход', 'больше 1000'],
        ['Миссия завершена', '13 февраля 2019 года'],
      ],
    },
    sources: [
      {
        title: 'On Mars, Light Is Energy',
        url: 'https://science.nasa.gov/resource/on-mars-light-is-energy/',
      },
      {
        title: 'NASA’s Opportunity Rover Mission on Mars Comes to End',
        url: 'https://science.nasa.gov/missions/mer/nasas-opportunity-rover-mission-on-mars-comes-to-end/',
      },
    ],
  },
  {
    id: 'cleaning_events',
    topic: 'power',
    image: 'img-insight-dust',
    en: {
      title: 'Dust and lucky winds',
      body: 'On Mars, dust slowly settles on solar panels. NASA’s InSight lander made about 5,000 watt-hours of energy each sol (Mars day) in 2018, but only about 500 by May 2022. The rovers Spirit and Opportunity were luckier than InSight: now and then a gust of wind blew their panels clean. In 2009 one such gust lifted Spirit’s daily energy from 210 to 240 watt-hours.',
      numbers: [
        ['InSight at landing (2018)', 'about 5,000 Wh per sol'],
        ['InSight in May 2022', 'about 500 Wh per sol'],
        ['Spirit before a wind cleaning (2009)', '210 Wh per day'],
        ['Spirit after it', '240 Wh per day'],
      ],
    },
    ru: {
      title: 'Пыль и удачный ветер',
      body: 'На Марсе пыль понемногу оседает на солнечных панелях. В 2018 году панели аппарата NASA InSight давали около 5000 ватт-часов энергии за сол (так называют марсианские сутки), а к маю 2022 года — всего около 500. Марсоходам Spirit и Opportunity везло больше, чем InSight: время от времени порыв ветра сдувал пыль с их панелей. В 2009 году один такой порыв поднял дневной запас энергии Spirit с 210 до 240 ватт-часов.',
      numbers: [
        ['InSight после посадки (2018)', 'около 5000 Вт·ч за сол'],
        ['InSight в мае 2022 года', 'около 500 Вт·ч за сол'],
        ['Spirit до очистки ветром (2009)', '210 Вт·ч в день'],
        ['Spirit после неё', '240 Вт·ч в день'],
      ],
    },
    sources: [
      {
        title: 'NASA’s InSight Still Hunting Marsquakes as Power Levels Diminish',
        url: 'https://www.nasa.gov/missions/insight/nasas-insight-still-hunting-marsquakes-as-power-levels-diminish/',
      },
      {
        title: 'Spirit Gets Energy Boost from Cleaner Solar Panels',
        url: 'https://www.jpl.nasa.gov/news/spirit-gets-energy-boost-from-cleaner-solar-panels/',
      },
    ],
  },
  {
    id: 'polar_light',
    topic: 'power',
    image: 'img-lunar-south-pole',
    en: {
      title: 'Light at the Moon’s pole',
      body: 'At the Moon’s south pole the Sun never climbs high: it stays low near the horizon. So NASA is developing upright solar panels on masts up to about 10 metres tall, where hills cannot block the sideways light. No place is sunlit all the time. But the best small spots are in sunlight for nearly 94% of the year, and their longest dark spell lasts about 43 hours.',
      numbers: [
        ['Best spots in sunlight', 'nearly 94% of the year'],
        ['Longest dark spell there', 'about 43 hours'],
        ['Height of the solar masts', 'up to about 10 m'],
      ],
    },
    ru: {
      title: 'Свет на полюсе Луны',
      body: 'На южном полюсе Луны Солнце никогда не поднимается высоко: оно держится у самого горизонта. Поэтому NASA разрабатывает вертикальные солнечные панели на мачтах высотой примерно до 10 метров — там холмы не заслоняют косые лучи. Мест, где светло всегда, нет. Но в лучших точках Солнце светит почти 94% года, а самая долгая темнота длится около 43 часов.',
      numbers: [
        ['Лучшие точки освещены', 'почти 94% года'],
        ['Самая долгая темнота там', 'около 43 часов'],
        ['Высота мачт с панелями', 'примерно до 10 м'],
      ],
    },
    sources: [
      {
        title: 'Five Years Later: Revisiting an Old Friend',
        url: 'https://lroc.im-ldi.com/images/789',
      },
      {
        title: 'Three Companies to Help NASA Advance Solar Array Technology for Moon',
        url: 'https://www.nasa.gov/news-release/three-companies-to-help-nasa-advance-solar-array-technology-for-moon/',
      },
    ],
  },
  {
    id: 'fission_power',
    topic: 'power',
    image: 'img-fission-power-unit',
    en: {
      title: 'A reactor for the Moon',
      body: 'Solar panels need sunlight, but an outpost needs power all the time. So NASA is planning a small nuclear reactor for the Moon: a machine that makes electricity from the heat of splitting atoms, with or without sunshine. The earlier goal was 40 kilowatts of power, enough to run 30 homes. In 2025 NASA raised the goal to at least 100 kilowatts on the Moon by 2030.',
      numbers: [
        ['Earlier goal', 'at least 40 kW'],
        ['That is enough for', '30 homes for 10 years'],
        ['Goal set in 2025', 'at least 100 kW'],
        ['Target date', 'by 2030'],
      ],
    },
    ru: {
      title: 'Реактор для Луны',
      body: 'Солнечным панелям нужен свет, а базе энергия нужна всегда. Поэтому NASA планирует поставить на Луне небольшой ядерный реактор — установку, которая получает электричество из тепла от деления атомов, есть солнце или нет. Прежней целью было 40 киловатт мощности — этого хватит на 30 домов. В 2025 году NASA подняло планку: не меньше 100 киловатт на Луне к 2030 году.',
      numbers: [
        ['Прежняя цель', 'не меньше 40 кВт'],
        ['Этого хватит на', '30 домов на 10 лет'],
        ['Цель с 2025 года', 'не меньше 100 кВт'],
        ['Срок', 'к 2030 году'],
      ],
    },
    sources: [
      {
        title: 'NASA Names Glenn’s Steven Sinacore to Lead Fission Surface Power',
        url: 'https://www.nasa.gov/centers-and-facilities/glenn/nasa-names-glenns-steven-sinacore-to-lead-fission-surface-power/',
      },
      {
        title: 'Fission Surface Power',
        url: 'https://www.nasa.gov/exploration-systems-development-mission-directorate/fission-surface-power/',
      },
    ],
  },
  {
    id: 'eclipse',
    topic: 'power',
    image: 'img-lunar-eclipse-2025',
    en: {
      title: 'An eclipse from the Moon',
      body: 'On 14 March 2025 people on Earth watched a total lunar eclipse, when Earth’s shadow covers the Moon. The Blue Ghost lander was standing on the Moon and saw the same event from the other side: Earth slid in front of the Sun and hid it. No sunlight means no solar power. A Moon outpost must save energy in its batteries for moments like that.',
      numbers: [
        ['Eclipse seen from the Moon', '14 March 2025'],
        ['Blue Ghost landed', '2 March 2025'],
        ['From the Moon, Earth looks wider than the Sun', 'about 4 times'],
      ],
    },
    ru: {
      title: 'Затмение, вид с Луны',
      body: '14 марта 2025 года на Земле наблюдали полное лунное затмение — это когда тень Земли накрывает Луну. Аппарат Blue Ghost в это время стоял на Луне и увидел то же событие с другой стороны: Земля встала перед Солнцем и закрыла его. Нет солнечного света — нет и энергии от панелей. Лунной базе нужно запасать энергию в аккумуляторах на такие случаи.',
      numbers: [
        ['Затмение, увиденное с Луны', '14 марта 2025 года'],
        ['Посадка Blue Ghost', '2 марта 2025 года'],
        ['С Луны Земля выглядит шире Солнца', 'примерно в 4 раза'],
      ],
    },
    sources: [
      {
        title: 'NASA Science Data Received, Blue Ghost Captures Eclipse From Moon',
        url: 'https://www.nasa.gov/blogs/missions/2025/03/14/nasa-science-data-received-blue-ghost-captures-eclipse-from-moon/',
      },
      {
        title: 'APOD: 2025 March 19 – Blue Ghost’s Diamond Ring',
        url: 'https://science.nasa.gov/image-article/apod-2025-march-19-blue-ghost-s-diamond-ring/',
      },
    ],
  },
  {
    id: 'cold',
    topic: 'power',
    en: {
      title: 'How cold it gets',
      body: 'Space outposts must cope with deep cold. Mars averages about −60 °C. Near the Moon’s equator temperatures swing from about 121 °C in daylight to −133 °C at night, and craters that never see the Sun are below −246 °C. Heaters run on electricity, so the colder it gets, the more power an outpost must spend just to stay warm.',
      numbers: [
        ['Mars, average', 'about −60 °C'],
        ['Moon’s equator, daytime', 'about 121 °C'],
        ['Moon’s equator, night', 'about −133 °C'],
        ['Moon’s always-dark craters', 'below −246 °C'],
      ],
    },
    ru: {
      title: 'Как холодно бывает',
      body: 'Базам в космосе приходится выдерживать сильный холод. На Марсе в среднем около −60 °C. У экватора Луны температура скачет от примерно 121 °C днём до −133 °C ночью, а в кратерах, куда никогда не заглядывает Солнце, она ниже −246 °C. Обогреватели работают от электричества: чем холоднее, тем больше энергии уходит просто на тепло.',
      numbers: [
        ['Марс, в среднем', 'около −60 °C'],
        ['Экватор Луны, день', 'около 121 °C'],
        ['Экватор Луны, ночь', 'около −133 °C'],
        ['Вечно тёмные кратеры Луны', 'ниже −246 °C'],
      ],
    },
    sources: [
      {
        title: 'Mars Fact Sheet',
        url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
      },
      {
        title: 'Weather on the Moon',
        url: 'https://science.nasa.gov/moon/weather-on-the-moon/',
      },
    ],
  },
  {
    id: 'batteries',
    topic: 'power',
    image: 'img-battery-spacewalk',
    en: {
      title: 'Batteries for the dark',
      body: 'The Space Station circles Earth and keeps flying through night, when its solar panels get no sunlight. Batteries store power for those dark stretches. Astronauts swapped 48 ageing batteries for 24 new lithium-ion ones, a more powerful kind, so half as many now do the job. The work took four years and 14 spacewalks, and ended on 1 February 2021.',
      numbers: [
        ['Old batteries removed', '48'],
        ['New lithium-ion batteries', '24'],
        ['Spacewalks for the job', '14'],
        ['Work finished', '1 February 2021'],
      ],
    },
    ru: {
      title: 'Аккумуляторы на тёмное время',
      body: 'Космическая станция летает вокруг Земли и раз за разом попадает в ночь, когда на её солнечные панели не падает свет. На это время энергию запасают аккумуляторы. Астронавты заменили 48 старых аккумуляторов на 24 новых, литий-ионных — они мощнее, поэтому хватает вдвое меньшего числа. Работа заняла четыре года и 14 выходов в открытый космос и закончилась 1 февраля 2021 года.',
      numbers: [
        ['Снято старых аккумуляторов', '48'],
        ['Новых литий-ионных', '24'],
        ['Выходов в открытый космос', '14'],
        ['Работа закончена', '1 февраля 2021 года'],
      ],
    },
    sources: [
      {
        title: 'Spacewalkers Wrap Up Battery Work and Camera Installations',
        url: 'https://www.nasa.gov/blogs/spacestation/2021/02/01/spacewalkers-wrap-up-battery-work-and-camera-installations/',
      },
      {
        title: 'Two Astronauts Begin Spacewalk for Battery and Camera Upgrades',
        url: 'https://www.nasa.gov/blogs/spacestation/2021/02/01/two-astronauts-begin-spacewalk-for-battery-and-camera-upgrades/',
      },
    ],
  },
  {
    id: 'micrometeoroids',
    topic: 'power',
    image: 'img-lro-camera',
    en: {
      title: 'Hit by a speck',
      body: 'Tiny bits of rock, called meteoroids, fly through space very fast. On 13 October 2014 one struck a camera on NASA’s Lunar Reconnaissance Orbiter, which circles the Moon, and its picture came out wild and jittery. The team worked out that the rock was only about 0.8 mm across, half the size of a pinhead. The camera survived and kept working.',
      numbers: [
        ['Date of the hit', '13 October 2014'],
        ['Size of the meteoroid', 'about 0.8 mm'],
        ['Speed used in the estimate', 'about 7 km per second'],
      ],
    },
    ru: {
      title: 'Удар песчинки',
      body: 'В космосе с огромной скоростью летают крошечные камешки — метеороиды. 13 октября 2014 года один из них попал в камеру аппарата NASA Lunar Reconnaissance Orbiter, который летает вокруг Луны, и снимок получился дёрганым, весь в зигзагах. Учёные вычислили: камешек был всего около 0,8 мм — вполовину меньше булавочной головки. Камера уцелела и продолжила работать.',
      numbers: [
        ['Дата удара', '13 октября 2014 года'],
        ['Размер метеороида', 'около 0,8 мм'],
        ['Скорость в расчёте', 'около 7 км в секунду'],
      ],
    },
    sources: [
      {
        title: 'Camera on NASA’s Lunar Orbiter Survived 2014 Meteoroid Hit',
        url: 'https://www.nasa.gov/missions/lro/camera-on-nasas-lunar-orbiter-survived-2014-meteoroid-hit/',
      },
    ],
  },

  // ----- Air and water -------------------------------------------------------
  {
    id: 'apollo13',
    topic: 'air',
    image: 'img-apollo13-mailbox',
    en: {
      title: 'The Apollo 13 mailbox',
      body: 'In April 1970 the three Apollo 13 astronauts had to shelter in their lunar module, a landing craft built for two people for two days. Soon carbon dioxide, the gas we breathe out, rose to a dangerous level. The spare air filters were square, but the openings were round. Mission control invented an adapter from plastic bags, cardboard and tape, nicknamed the “mailbox”, and the crew built it.',
      numbers: [
        ['Lunar module was built for', '2 people for 2 days'],
        ['It had to support', '3 people for about 4 days'],
        ['Mission dates', '11–17 April 1970'],
      ],
    },
    ru: {
      title: '«Почтовый ящик» Apollo 13',
      body: 'В апреле 1970 года троим астронавтам Apollo 13 пришлось укрыться в лунном модуле — посадочном аппарате, рассчитанном на двоих на два дня. Вскоре углекислого газа, который мы выдыхаем, стало опасно много. Запасные фильтры для воздуха были квадратными, а гнёзда для них — круглыми. В Центре управления придумали переходник из пластиковых пакетов, картона и клейкой ленты, его прозвали «почтовым ящиком», и экипаж собрал его сам.',
      numbers: [
        ['Лунный модуль рассчитан на', '2 человек на 2 дня'],
        ['Пришлось выдержать', '3 человек около 4 дней'],
        ['Даты полёта', '11–17 апреля 1970 года'],
      ],
    },
    sources: [
      {
        title: 'Apollo 13: Mission Details',
        url: 'https://www.nasa.gov/missions/apollo/apollo-13-mission-details/',
      },
      {
        title: 'Apollo 13 Lunar Module ‘Mail Box’',
        url: 'https://www.nasa.gov/image-article/apollo-13-lunar-module-mail-box/',
      },
    ],
  },
  {
    id: 'iss_leak',
    topic: 'air',
    image: 'img-soyuz-ms09-spacewalk',
    en: {
      title: 'A tiny hole in space',
      body: 'On the night of 29 August 2018, flight controllers on Earth noticed that the Space Station was slowly losing air while the crew slept. Next morning the crew found a hole about 2 mm wide in a docked Soyuz spacecraft. First they covered it with tape, then a cosmonaut plugged it with epoxy, a strong glue, on a gauze wipe. NASA said the crew was never in danger.',
      numbers: [
        ['Leak noticed', 'night of 29 August 2018'],
        ['Leak found and sealed', '30 August 2018'],
        ['Width of the hole', 'about 2 mm'],
      ],
    },
    ru: {
      title: 'Маленькая дырочка в космосе',
      body: 'Ночью 29 августа 2018 года, пока экипаж спал, операторы на Земле заметили, что из космической станции понемногу уходит воздух. Утром экипаж нашёл отверстие шириной около 2 мм в пристыкованном корабле «Союз». Сначала его заклеили лентой, а потом космонавт заделал его салфеткой с эпоксидным клеем — он очень прочный. В NASA сказали, что экипажу ничто не угрожало.',
      numbers: [
        ['Утечку заметили', 'ночью 29 августа 2018 года'],
        ['Отверстие нашли и заделали', '30 августа 2018 года'],
        ['Ширина отверстия', 'около 2 мм'],
      ],
    },
    sources: [
      {
        title: 'International Space Station Status',
        url: 'https://www.nasa.gov/blogs/spacestation/2018/08/30/international-space-station-status-2/',
      },
      {
        title: 'International Space Station Status',
        url: 'https://www.nasa.gov/blogs/spacestation/2018/08/30/international-space-station-status-3/',
      },
    ],
  },
  {
    id: 'water_recycling',
    topic: 'air',
    image: 'img-water-recovery',
    en: {
      title: 'Water, again and again',
      body: 'On the Space Station almost no water is wasted. Urine, sweat and even the moisture in the crew’s breath are cleaned and turned back into drinking water; in 2023 NASA reported that 98% is recovered. It was not always smooth. In weightlessness bones lose calcium, a mineral that ends up in urine, and it once formed solid bits that clogged the urine recycler.',
      numbers: [
        ['Water recovered (2023)', '98%'],
        ['Before the newest upgrade', '93–94%'],
        ['Urine recycler was designed to recover', '85%'],
      ],
    },
    ru: {
      title: 'Вода по кругу',
      body: 'На космической станции вода почти не пропадает. Мочу, пот и даже влагу из дыхания экипажа очищают и снова превращают в питьевую воду; в 2023 году NASA сообщило, что возвращается 98%. Но не всё шло гладко. В невесомости кости теряют кальций; этот минерал попадает в мочу и однажды выпал твёрдым осадком, который забил установку для её переработки.',
      numbers: [
        ['Возвращается воды (2023)', '98%'],
        ['До последнего улучшения', '93–94%'],
        ['Установка для мочи рассчитана вернуть', '85%'],
      ],
    },
    sources: [
      {
        title: 'NASA Achieves Water Recovery Milestone on International Space Station',
        url: 'https://www.nasa.gov/missions/station/iss-research/nasa-achieves-water-recovery-milestone-on-international-space-station/',
      },
      {
        title: 'Preventing Precipitation in the ISS Urine Processor',
        url: 'https://ntrs.nasa.gov/citations/20170008985',
      },
    ],
  },
  {
    id: 'moxie',
    topic: 'air',
    image: 'img-moxie',
    en: {
      title: 'Oxygen from Mars air',
      body: 'The air on Mars is mostly carbon dioxide, a gas people cannot breathe. A machine the size of a microwave oven, called MOXIE, rode inside the Perseverance rover and made oxygen from that air. It ran 16 times and made 122 grams in all, about what a small dog breathes in 10 hours. It was only a test, but it proved the idea works on Mars.',
      numbers: [
        ['Oxygen made in total', '122 g'],
        ['Number of runs', '16'],
        ['Best rate', '12 g per hour'],
        ['Final run', '7 August 2023'],
      ],
    },
    ru: {
      title: 'Кислород из воздуха Марса',
      body: 'Воздух Марса почти целиком состоит из углекислого газа, которым люди дышать не могут. Прибор MOXIE размером с микроволновку, установленный внутри марсохода Perseverance, делал из этого воздуха кислород. Он включался 16 раз и выработал всего 122 грамма — примерно столько вдыхает маленькая собака за 10 часов. Это был только опыт, но он доказал: на Марсе такой способ работает.',
      numbers: [
        ['Всего получено кислорода', '122 г'],
        ['Число включений', '16'],
        ['Лучший результат', '12 г в час'],
        ['Последнее включение', '7 августа 2023 года'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Oxygen-Generating Experiment MOXIE Completes Mars Mission',
        url: 'https://www.nasa.gov/missions/mars-2020-perseverance/perseverance-rover/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/',
      },
    ],
  },
  {
    id: 'lunar_ice',
    topic: 'air',
    image: 'img-lunar-south-pole',
    en: {
      title: 'Ice in a dark crater',
      body: 'Some craters near the Moon’s south pole never see sunlight. On 9 October 2009 NASA’s LCROSS mission crashed an empty rocket stage into one, called Cabeus, and studied the cloud that flew up. Its instruments saw about 155 kg of water, as vapour and ice, so about 5.6% of the soil there is ice. Water can be drunk, or split to make oxygen for breathing.',
      numbers: [
        ['Impact date', '9 October 2009'],
        ['Water seen in the cloud', 'about 155 kg'],
        ['Ice in the soil there', 'about 5.6% by weight'],
      ],
    },
    ru: {
      title: 'Лёд в тёмном кратере',
      body: 'В некоторые кратеры у южного полюса Луны никогда не попадает солнечный свет. 9 октября 2009 года миссия NASA LCROSS направила пустую ступень ракеты в один из них, кратер Кабео (Cabeus), и изучила поднявшееся облако. Приборы увидели в нём около 155 кг воды — в виде пара и льда; значит, в тамошнем грунте примерно 5,6% льда. Воду можно пить, а ещё из неё можно получать кислород для дыхания.',
      numbers: [
        ['Дата удара', '9 октября 2009 года'],
        ['Воды в облаке', 'около 155 кг'],
        ['Льда в грунте кратера', 'около 5,6% по массе'],
      ],
    },
    sources: [
      {
        title: 'Detection of Water in the LCROSS Ejecta Plume',
        url: 'https://pubmed.ncbi.nlm.nih.gov/20966242/',
      },
      {
        title: 'LCROSS',
        url: 'https://science.nasa.gov/mission/lcross/',
      },
    ],
  },
  {
    id: 'daily_needs',
    topic: 'air',
    image: 'img-iss-meal',
    en: {
      title: 'What one astronaut needs',
      body: 'How much does one astronaut use up in a day? NASA’s planning numbers say about 0.84 kg of oxygen, 1.6 kg of drinking water and 0.62 kg of dry food. Add the water inside food and for cooking, and it comes to about 5 kg for each person, every day. Multiply that by a whole crew and many months, and you see why outposts recycle.',
      numbers: [
        ['Oxygen', 'about 0.84 kg per day'],
        ['Drinking water', 'about 1.6 kg per day'],
        ['Dry food', 'about 0.62 kg per day'],
        ['All together', 'about 5 kg per day'],
      ],
    },
    ru: {
      title: 'Что нужно одному астронавту',
      body: 'Сколько всего тратит один астронавт за сутки? По расчётным нормам NASA — около 0,84 кг кислорода, 1,6 кг питьевой воды и 0,62 кг сухой еды. Если добавить воду, которая есть в самой еде и уходит на готовку, выйдет примерно 5 кг на человека в день. Умножь это на весь экипаж и на много месяцев — и станет ясно, зачем на базе всё перерабатывают.',
      numbers: [
        ['Кислород', 'около 0,84 кг в сутки'],
        ['Питьевая вода', 'около 1,6 кг в сутки'],
        ['Сухая еда', 'около 0,62 кг в сутки'],
        ['Всё вместе', 'около 5 кг в сутки'],
      ],
    },
    sources: [
      {
        title: 'Design Rules for Life Support Systems',
        url: 'https://ntrs.nasa.gov/api/citations/20040012725/downloads/20040012725.pdf',
      },
    ],
  },

  // ----- Food and supplies ---------------------------------------------------
  {
    id: 'space_farming',
    topic: 'food',
    image: 'img-veggie-lettuce',
    en: {
      title: 'A garden in orbit',
      body: 'Fresh food can grow in space, but it takes time. On 10 August 2015 astronauts ate red lettuce that had grown for 33 days in a small garden called Veggie. It was the first time a crop grown on the Space Station was officially on the crew’s menu. Radishes were faster: in 2020 they were ready to harvest after 27 days.',
      numbers: [
        ['Red lettuce (2015)', '33 days'],
        ['Radishes (2020)', '27 days'],
        ['Lettuce eaten on the Space Station', '10 August 2015'],
        ['Radish plants harvested', '20'],
      ],
    },
    ru: {
      title: 'Огород на орбите',
      body: 'Свежую еду можно вырастить и в космосе, но на это нужно время. 10 августа 2015 года астронавты съели красный салат, который 33 дня рос в маленькой теплице Veggie. Тогда урожай, выращенный на космической станции, впервые официально попал в меню экипажа. Редис оказался быстрее: в 2020 году он созрел за 27 дней.',
      numbers: [
        ['Красный салат (2015)', '33 дня'],
        ['Редис (2020)', '27 дней'],
        ['Салат съели на станции', '10 августа 2015 года'],
        ['Собрано растений редиса', '20'],
      ],
    },
    sources: [
      {
        title: 'Veggie (NASAfacts)',
        url: 'https://www.nasa.gov/wp-content/uploads/2023/03/veggie-fact-sheet-508.pdf',
      },
      {
        title: 'Astronauts Harvest Radish Crop on International Space Station',
        url: 'https://www.nasa.gov/missions/station/astronauts-harvest-radish-crop-on-international-space-station/',
      },
    ],
  },
  {
    id: 'zinnias',
    topic: 'food',
    image: 'img-zinnia',
    en: {
      title: 'The zinnia gardener',
      body: 'In late 2015 the zinnia flowers growing on the Space Station grew mould and looked sick. Astronaut Scott Kelly told the team on Earth that he should decide when to water them, like a gardener at home. The team agreed and sent a one-page guide, and in January 2016 the zinnias bloomed. Far from Earth, crews will often have to decide for themselves.',
      numbers: [
        ['Zinnias planted', '16 November 2015'],
        ['Kelly reports trouble', '27 December 2015'],
        ['First bloom', '16 January 2016'],
      ],
    },
    ru: {
      title: 'Садовник и циннии',
      body: 'В конце 2015 года цинниям, которые росли на космической станции, стало плохо: на них появилась плесень. Астронавт Скотт Келли сказал команде на Земле, что будет сам решать, когда поливать цветы, — как садовник у себя дома. Команда согласилась и прислала памятку всего на одну страницу, а в январе 2016 года циннии зацвели. Вдали от Земли экипажам часто придётся решать самим.',
      numbers: [
        ['Циннии посажены', '16 ноября 2015 года'],
        ['Келли сообщил о беде', '27 декабря 2015 года'],
        ['Первый цветок', '16 января 2016 года'],
      ],
    },
    sources: [
      {
        title: 'First Flower Grown in Space Station’s Veggie Facility',
        url: 'https://www.nasa.gov/image-article/first-flower-grown-space-stations-veggie-facility-2/',
      },
      {
        title: 'ZINNIAS FROM SPACE! NASA Studies the Multiple Benefits of Gardening',
        url: 'https://www.nasa.gov/humans-in-space/zinnias-from-space-nasa-studies-the-multiple-benefits-of-gardening/',
      },
    ],
  },
  {
    id: 'launch_windows',
    topic: 'food',
    image: 'img-mars2020-launch',
    en: {
      title: 'No quick deliveries to Mars',
      body: 'Earth and Mars circle the Sun at different speeds, so they line up well for a trip only about once every 26 months. That chance is called a launch window. Even then the flight takes seven to ten months. So a Mars outpost cannot order a quick delivery: it must bring, grow or recycle what it needs.',
      numbers: [
        ['Launch window opens', 'about every 26 months'],
        ['Flight to Mars', '7 to 10 months'],
        ['Flight to the Moon, for comparison', 'about 3 days'],
      ],
    },
    ru: {
      title: 'На Марс быстро не привезти',
      body: 'Земля и Марс движутся вокруг Солнца с разной скоростью, поэтому удобно для перелёта они выстраиваются лишь примерно раз в 26 месяцев. Такой момент называют стартовым окном. Но и тогда полёт длится от семи до десяти месяцев. Поэтому марсианская база не может заказать срочную доставку: всё нужное приходится везти с собой, выращивать или перерабатывать.',
      numbers: [
        ['Стартовое окно открывается', 'примерно раз в 26 месяцев'],
        ['Полёт до Марса', 'от 7 до 10 месяцев'],
        ['Для сравнения: полёт до Луны', 'около 3 дней'],
      ],
    },
    sources: [
      {
        title: 'How Long Does it Take to Get to the Moon... Mars... Jupiter? We Asked a NASA Expert: Episode 51',
        url: 'https://www.nasa.gov/directorates/smd/how-long-does-it-take-to-get-to-the-moon-mars-jupiter-we-asked-a-nasa-expert-episode-51/',
      },
      {
        title: 'Mars Mission Timeline',
        url: 'https://science.nasa.gov/planetary-science/programs/mars-exploration/mission-timeline/',
      },
    ],
  },
  {
    id: 'three_days',
    topic: 'food',
    image: 'img-orion-earth-moon',
    en: {
      title: 'Three days to the Moon',
      body: 'The Moon is close enough to reach in about three days: the fastest Apollo flight, Apollo 8, took just under three. Today NASA also pays companies to deliver cargo there. In March 2025 the robotic lander Blue Ghost carried 10 NASA instruments to the Moon’s surface. A Moon outpost can be resupplied far more easily than one on Mars.',
      numbers: [
        ['Flight to the Moon', 'about 3 days'],
        ['Fastest Apollo flight (Apollo 8)', 'just under 3 days'],
        ['Blue Ghost landed', '2 March 2025'],
        ['NASA instruments it carried', '10'],
      ],
    },
    ru: {
      title: 'До Луны три дня',
      body: 'Луна достаточно близко: долететь до неё можно примерно за три дня. Самый быстрый из кораблей Apollo, Apollo 8, добрался чуть меньше чем за трое суток. Теперь NASA ещё и платит компаниям за доставку грузов: в марте 2025 года автоматический аппарат Blue Ghost привёз на поверхность Луны 10 приборов NASA. Снабжать лунную базу гораздо проще, чем марсианскую.',
      numbers: [
        ['Полёт до Луны', 'около 3 дней'],
        ['Самый быстрый Apollo (Apollo 8)', 'чуть меньше 3 суток'],
        ['Посадка Blue Ghost', '2 марта 2025 года'],
        ['Приборов NASA на борту', '10'],
      ],
    },
    sources: [
      {
        title: 'How Long Does it Take to Get to the Moon... Mars... Jupiter? We Asked a NASA Expert: Episode 51',
        url: 'https://www.nasa.gov/directorates/smd/how-long-does-it-take-to-get-to-the-moon-mars-jupiter-we-asked-a-nasa-expert-episode-51/',
      },
      {
        title: 'NASA Science Continues After Firefly’s First Moon Mission Concludes',
        url: 'https://www.nasa.gov/news-release/nasa-science-continues-after-fireflys-first-moon-mission-concludes/',
      },
    ],
  },

  // ----- Radio ---------------------------------------------------------------
  {
    id: 'comm_delay',
    topic: 'radio',
    image: 'img-earth-moon-from-mars',
    en: {
      title: 'Waiting for an answer',
      body: 'Radio signals travel at the speed of light, the fastest speed there is, but space is very big. A message reaches the Moon in about 1.3 seconds. To Mars it takes from 3 to 22 minutes, depending on how far apart the two planets are. So an answer to a question from Mars can take up to 44 minutes, and crews there must handle urgent problems themselves.',
      numbers: [
        ['Earth to the Moon', 'about 1.3 seconds'],
        ['Earth to Mars, nearest', 'about 3 minutes'],
        ['Earth to Mars, farthest', 'about 22 minutes'],
        ['There and back, Mars at its farthest', 'about 44 minutes'],
      ],
    },
    ru: {
      title: 'В ожидании ответа',
      body: 'Радиосигнал летит со скоростью света — быстрее не бывает, — но космос очень велик. До Луны сообщение идёт примерно 1,3 секунды. До Марса — от 3 до 22 минут: всё зависит от того, как далеко друг от друга планеты. Значит, ответа на вопрос с Марса иногда приходится ждать до 44 минут, и срочные задачи экипаж должен решать сам.',
      numbers: [
        ['От Земли до Луны', 'около 1,3 секунды'],
        ['От Земли до Марса, ближе всего', 'около 3 минут'],
        ['От Земли до Марса, дальше всего', 'около 22 минут'],
        ['Туда и обратно при самом далёком Марсе', 'около 44 минут'],
      ],
    },
    sources: [
      {
        title: 'Voyager 1: What Is a Light-Day',
        url: 'https://science.nasa.gov/mission/voyager/voyager-1/voyager-1-what-is-a-light-day/',
      },
    ],
  },
  {
    id: 'conjunction',
    topic: 'radio',
    image: 'img-curiosity-conjunction-day',
    en: {
      title: 'When the Sun blocks Mars',
      body: 'About every two years Earth and Mars end up on opposite sides of the Sun; this is called solar conjunction. Hot gas from the Sun can scramble radio signals, so NASA stops sending commands to its Mars spacecraft for about two weeks. In 2023 the pause lasted from 11 to 25 November. The spacecraft are not idle: they follow to-do lists sent in advance.',
      numbers: [
        ['How often', 'about every 2 years'],
        ['Pause in commands', 'about 2 weeks'],
        ['Pause in 2023', '11–25 November'],
        ['Pause in 2021', '2–16 October'],
      ],
    },
    ru: {
      title: 'Когда Марс прячется за Солнцем',
      body: 'Примерно раз в два года Земля и Марс оказываются по разные стороны от Солнца — это называют солнечным соединением. Горячий газ от Солнца может исказить радиосигнал, поэтому NASA примерно на две недели перестаёт отправлять команды своим аппаратам у Марса. В 2023 году пауза длилась с 11 по 25 ноября. Аппараты при этом не простаивают: они выполняют список дел, присланный заранее.',
      numbers: [
        ['Как часто', 'примерно раз в 2 года'],
        ['Пауза в командах', 'около 2 недель'],
        ['Пауза в 2023 году', '11–25 ноября'],
        ['Пауза в 2021 году', '2–16 октября'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Mars Fleet Will Still Conduct Science While Lying Low',
        url: 'https://www.nasa.gov/solar-system/planets/mars/nasas-mars-fleet-will-still-conduct-science-while-lying-low/',
      },
      {
        title: 'NASA’s Mars Fleet Lies Low With Sun Between Earth and Red Planet',
        url: 'https://www.nasa.gov/solar-system/nasas-mars-fleet-lies-low-with-sun-between-earth-and-red-planet/',
      },
    ],
  },
  {
    id: 'deep_space_network',
    topic: 'radio',
    image: 'img-dsn-goldstone',
    en: {
      title: 'Earth’s giant radio dishes',
      body: 'NASA talks to faraway spacecraft through the Deep Space Network: giant radio dishes at three places on Earth, in California, Spain and Australia. The three sites are about 120 degrees apart around the globe, a third of the way round each. So as Earth turns and one site loses sight of a spacecraft, the next one picks up its signal. Each site has one huge dish 70 metres wide.',
      numbers: [
        ['Sites', '3: California, Spain, Australia'],
        ['Distance between sites', 'about 120° around the globe'],
        ['Largest dish at each site', '70 m wide'],
      ],
    },
    ru: {
      title: 'Гигантские антенны Земли',
      body: 'С далёкими аппаратами NASA разговаривает через Deep Space Network — сеть дальней космической связи: это гигантские антенны-тарелки в трёх местах Земли — в Калифорнии, Испании и Австралии. Станции разнесены примерно на 120 градусов, то есть на треть окружности планеты. Поэтому, когда Земля поворачивается и одна станция теряет аппарат из виду, сигнал подхватывает следующая. На каждой станции есть огромная тарелка шириной 70 метров.',
      numbers: [
        ['Станций', '3: Калифорния, Испания, Австралия'],
        ['Расстояние между станциями', 'около 120° по окружности Земли'],
        ['Самая большая тарелка на каждой', '70 м в ширину'],
      ],
    },
    sources: [
      {
        title: 'What is the Deep Space Network?',
        url: 'https://www.nasa.gov/directorates/somd/space-communications-navigation-program/what-is-the-deep-space-network/',
      },
    ],
  },

  // ----- Worlds --------------------------------------------------------------
  {
    id: 'gravity',
    topic: 'worlds',
    image: 'img-apollo-moonwalk',
    en: {
      title: 'Lighter on other worlds',
      body: 'Gravity is the pull that holds you to the ground. On Mars it is only 38% as strong as on Earth, and on the Moon about one sixth. Jump just as hard and you would rise about 2.6 times higher on Mars, and about six times higher on the Moon. That is why astronauts on the Moon seem to bounce as they walk.',
      numbers: [
        ['Gravity on Mars', 'about 38% of Earth’s'],
        ['Gravity on the Moon', 'one sixth of Earth’s'],
        ['The same jump on Mars', 'about 2.6 times higher'],
        ['The same jump on the Moon', 'about 6 times higher'],
      ],
    },
    ru: {
      title: 'Легче, чем на Земле',
      body: 'Сила тяжести — это то, что прижимает тебя к земле. На Марсе она составляет всего 38% от земной, а на Луне — примерно одну шестую. Оттолкнись с той же силой — и на Марсе ты подпрыгнешь примерно в 2,6 раза выше, а на Луне — примерно в шесть раз выше. Вот почему астронавты на Луне ходят будто вприпрыжку.',
      numbers: [
        ['Сила тяжести на Марсе', 'около 38% от земной'],
        ['Сила тяжести на Луне', 'одна шестая земной'],
        ['Тот же прыжок на Марсе', 'примерно в 2,6 раза выше'],
        ['Тот же прыжок на Луне', 'примерно в 6 раз выше'],
      ],
    },
    sources: [
      {
        title: 'Mars 2020 Perseverance Landing Press Kit',
        url: 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/quick_facts/',
      },
      {
        title: 'Moon Facts',
        url: 'https://science.nasa.gov/moon/facts/',
      },
    ],
  },
  {
    id: 'sol',
    topic: 'worlds',
    image: 'img-insight-sunrise',
    en: {
      title: 'A day called sol',
      body: 'A day on Mars has its own name: a sol. Mars turns a little more slowly than Earth, so one sol lasts 24 hours, 39 minutes and 35 seconds. That is about 40 minutes longer than a day on Earth. Mars missions count their time in sols, so a rover’s diary says “sol 100”, not “day 100”.',
      numbers: [
        ['One sol', '24 h 39 min 35 s'],
        ['Longer than an Earth day by', 'about 40 minutes'],
        ['One sol in hours', 'about 24.66 hours'],
      ],
    },
    ru: {
      title: 'Сутки по имени сол',
      body: 'У марсианских суток есть своё имя — сол. Марс вращается чуть медленнее Земли, поэтому один сол длится 24 часа 39 минут 35 секунд. Это примерно на 40 минут дольше земных суток. Марсианские миссии считают время солами, так что в дневнике марсохода написано «сол 100», а не «день 100».',
      numbers: [
        ['Один сол', '24 ч 39 мин 35 с'],
        ['Дольше земных суток на', 'примерно 40 минут'],
        ['Один сол в часах', 'около 24,66 часа'],
      ],
    },
    sources: [
      {
        title: 'Mars 2020 Perseverance Landing Press Kit',
        url: 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/quick_facts/',
      },
      {
        title: 'Mars Fact Sheet',
        url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
      },
    ],
  },
  {
    id: 'mars_sunset',
    topic: 'worlds',
    image: 'img-mars-sunset',
    en: {
      title: 'Blue sunsets on Mars',
      body: 'On Earth sunsets glow red and orange, but on Mars they are blue. The air there is full of very fine dust, which lets blue light through more easily. That blue light stays close to the Sun, while the rest of the sky looks yellow to orange. The Curiosity rover photographed its first colour sunset on 15 April 2015.',
      numbers: [
        ['Colour near the setting Sun', 'blue'],
        ['Colour of the rest of the sky', 'yellow to orange'],
        ['Curiosity’s first colour sunset', '15 April 2015 (sol 956)'],
      ],
    },
    ru: {
      title: 'Голубые закаты Марса',
      body: 'На Земле закаты красные и оранжевые, а на Марсе — голубые. В марсианском воздухе много очень мелкой пыли, и она лучше пропускает голубой свет. Этот свет держится рядом с Солнцем, а остальное небо выглядит жёлтым или оранжевым. Свой первый цветной закат марсоход Curiosity снял 15 апреля 2015 года.',
      numbers: [
        ['Цвет неба возле заходящего Солнца', 'голубой'],
        ['Цвет остального неба', 'от жёлтого до оранжевого'],
        ['Первый цветной закат Curiosity', '15 апреля 2015 года (сол 956)'],
      ],
    },
    sources: [
      {
        title: 'What Do Sunrises and Sunsets Look Like on Mars?',
        url: 'https://science.nasa.gov/solar-system/planets/mars/what-does-a-sunrise-sunset-look-like-on-mars/',
      },
      {
        title: 'Sunset in Mars’ Gale Crater',
        url: 'https://science.nasa.gov/resource/sunset-in-mars-gale-crater/',
      },
    ],
  },
  {
    id: 'sound_on_mars',
    topic: 'worlds',
    image: 'img-perseverance-mic',
    en: {
      title: 'How Mars sounds',
      body: 'The Perseverance rover carries microphones, so we know how Mars sounds. Sound travels through air, and the air on Mars is thin, cold and mostly carbon dioxide. So everything sounds quieter and more muffled, and sound moves more slowly: about 240 metres a second, against about 340 on Earth. One scientist said it was so quiet that the team thought the microphone was broken.',
      numbers: [
        ['Speed of sound on Mars', 'about 240 m/s'],
        ['High-pitched sounds on Mars', 'about 250 m/s'],
        ['Speed of sound on Earth', 'about 340 m/s'],
      ],
    },
    ru: {
      title: 'Как звучит Марс',
      body: 'На марсоходе Perseverance есть микрофоны, поэтому мы знаем, как звучит Марс. Звук бежит по воздуху, а воздух на Марсе разреженный, холодный и состоит в основном из углекислого газа. Поэтому всё слышно тише и глуше, а звук движется медленнее: около 240 метров в секунду против примерно 340 на Земле. Один учёный рассказал: было так тихо, что команда подумала, будто микрофон сломался.',
      numbers: [
        ['Скорость звука на Марсе', 'около 240 м/с'],
        ['Высокие звуки на Марсе', 'около 250 м/с'],
        ['Скорость звука на Земле', 'около 340 м/с'],
      ],
    },
    sources: [
      {
        title: 'Sounds of Mars',
        url: 'https://science.nasa.gov/mission/mars-2020-perseverance/sounds-of-mars/',
      },
      {
        title: 'What Sounds Captured by NASA’s Perseverance Rover Reveal About Mars',
        url: 'https://www.nasa.gov/solar-system/what-sounds-captured-by-nasas-perseverance-rover-reveal-about-mars/',
      },
    ],
  },
  {
    id: 'quakes',
    topic: 'worlds',
    image: 'img-insight-seismometer',
    en: {
      title: 'Marsquakes and moonquakes',
      body: 'The ground shakes on other worlds too. NASA’s InSight lander placed a seismometer, an instrument that feels the ground tremble, on Mars and detected 1,319 marsquakes. On the Moon, instruments left by Apollo astronauts recorded 28 shallow moonquakes between 1969 and 1977. The Moon is slowly cooling and shrinking, like a grape wrinkling into a raisin, and its cracking crust may cause such quakes.',
      numbers: [
        ['Marsquakes detected by InSight', '1,319'],
        ['Shallow moonquakes recorded', '28'],
        ['Apollo instruments recorded them', '1969–1977'],
        ['Strength of those moonquakes', 'about 2 to 5 on the Richter scale'],
      ],
    },
    ru: {
      title: 'Марсотрясения и лунотрясения',
      body: 'Грунт дрожит не только на Земле. Аппарат NASA InSight поставил на Марсе сейсмометр — прибор, который чувствует дрожь грунта, — и засёк 1319 марсотрясений. На Луне приборы, оставленные астронавтами Apollo, с 1969 по 1977 год записали 28 неглубоких лунотрясений. Луна медленно остывает и сжимается, как виноградина, которая превращается в изюм; её кора трескается, и, возможно, от этого и случаются такие толчки.',
      numbers: [
        ['Марсотрясений, которые засёк InSight', '1319'],
        ['Неглубоких лунотрясений записано', '28'],
        ['Приборы Apollo записывали их', 'в 1969–1977 годах'],
        ['Сила этих лунотрясений', 'примерно от 2 до 5 по шкале Рихтера'],
      ],
    },
    sources: [
      {
        title: 'NASA Retires InSight Mars Lander Mission After Years of Science',
        url: 'https://www.nasa.gov/missions/insight/nasa-retires-insight-mars-lander-mission-after-years-of-science/',
      },
      {
        title: 'Shrinking Moon May Be Generating Moonquakes',
        url: 'https://www.nasa.gov/news-release/shrinking-moon-may-be-generating-moonquakes/',
      },
    ],
  },
  {
    id: 'samples',
    topic: 'worlds',
    image: 'img-perseverance-sample',
    en: {
      title: 'Rock cores in tubes',
      body: 'The Perseverance rover collects pieces of Mars. Its drill cuts out a core, a stick of rock the size of a piece of chalk, and the rover seals it in an airtight tube of titanium metal. It carried 43 tubes to Mars and sealed its first rock core on 6 September 2021. The tubes are kept so that a future mission could bring them to Earth.',
      numbers: [
        ['Width of a core', '13 mm'],
        ['Length of a core', '60 mm'],
        ['Sample tubes carried', '43'],
        ['First rock core sealed', '6 September 2021'],
      ],
    },
    ru: {
      title: 'Керны в пробирках',
      body: 'Марсоход Perseverance собирает кусочки Марса. Его бур вырезает керн — столбик породы размером с кусок школьного мела, — и марсоход запечатывает его в герметичную пробирку из титана. Он привёз на Марс 43 пробирки и запечатал первый керн 6 сентября 2021 года. Пробирки хранят для того, чтобы будущая миссия могла доставить их на Землю.',
      numbers: [
        ['Ширина керна', '13 мм'],
        ['Длина керна', '60 мм'],
        ['Пробирок на борту', '43'],
        ['Первый керн запечатан', '6 сентября 2021 года'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Perseverance Rover Collects First Mars Rock Sample',
        url: 'https://www.jpl.nasa.gov/news/nasas-perseverance-rover-collects-first-mars-rock-sample/',
      },
      {
        title: 'Why Scientists Are Intrigued by Air in NASA’s Mars Sample Tubes',
        url: 'https://www.jpl.nasa.gov/news/why-scientists-are-intrigued-by-air-in-nasas-mars-sample-tubes/',
      },
    ],
  },
  {
    id: 'earth_from_moon',
    topic: 'worlds',
    image: 'img-earthrise',
    en: {
      title: 'Earth in the Moon’s sky',
      body: 'The Moon is about 384,400 km from Earth and always keeps the same side turned towards us. So for someone standing on that side, Earth never rises or sets: it hangs in almost the same spot in the sky, wobbling only a little. The famous “Earthrise” photo was taken on 24 December 1968 from Apollo 8 as it circled the Moon. From the moving spacecraft, Earth seemed to rise.',
      numbers: [
        ['Average distance to Earth', '384,400 km'],
        ['Earth-sized planets that would fit in between', '30'],
        ['Apollo 8 “Earthrise” photo', '24 December 1968'],
      ],
    },
    ru: {
      title: 'Земля в небе Луны',
      body: 'Луна находится примерно в 384 400 км от Земли и всегда повёрнута к нам одной и той же стороной. Поэтому для того, кто стоит на этой стороне, Земля не восходит и не заходит: она висит почти в одной точке неба и лишь слегка покачивается. Знаменитый снимок «Восход Земли» сделали 24 декабря 1968 года с корабля Apollo 8, который летел вокруг Луны. Из движущегося корабля казалось, что Земля восходит.',
      numbers: [
        ['Среднее расстояние до Земли', '384 400 км'],
        ['Сколько планет размером с Землю поместилось бы между ними', '30'],
        ['Снимок «Восход Земли» с Apollo 8', '24 декабря 1968 года'],
      ],
    },
    sources: [
      {
        title: 'Moon Facts',
        url: 'https://science.nasa.gov/moon/facts/',
      },
      {
        title: 'NASA Releases New High-Resolution Earthrise Image',
        url: 'https://www.nasa.gov/image-article/nasa-releases-new-high-resolution-earthrise-image-2/',
      },
    ],
  },

  // ----- People --------------------------------------------------------------
  {
    id: 'crew_rest',
    topic: 'people',
    image: 'img-ared-exercise',
    en: {
      title: 'Two hours of exercise',
      body: 'On Earth your bones work all day, holding you up against gravity. In space you float, and bones that do no work grow weaker. Without exercise, the bones that carry your weight lose about 1% to 1.5% of their minerals, the stuff that makes them strong, every month. That is why Space Station crews exercise for about two hours every day.',
      numbers: [
        ['Bone mineral lost in space', '1% to 1.5% per month'],
        ['Daily exercise on the Space Station', 'about 2 hours'],
      ],
    },
    ru: {
      title: 'Два часа зарядки',
      body: 'На Земле твои кости весь день работают: держат тебя, несмотря на силу тяжести. В космосе ты паришь, а кости без нагрузки слабеют. Если не тренироваться, кости, на которые обычно приходится вес тела, каждый месяц теряют от 1 до 1,5% минералов — веществ, которые делают их прочными. Поэтому экипаж космической станции занимается физкультурой примерно по два часа в день.',
      numbers: [
        ['Потеря минералов в костях в космосе', 'от 1 до 1,5% в месяц'],
        ['Тренировки на космической станции', 'около 2 часов в день'],
      ],
    },
    sources: [
      {
        title: 'The Human Body in Space',
        url: 'https://www.nasa.gov/humans-in-space/the-human-body-in-space/',
      },
      {
        title: 'Counteracting Bone and Muscle Loss in Microgravity',
        url: 'https://www.nasa.gov/missions/station/iss-research/counteracting-bone-and-muscle-loss-in-microgravity/',
      },
    ],
  },
  {
    id: 'twins_study',
    topic: 'people',
    image: 'img-kelly-twins',
    en: {
      title: 'The Twins Study',
      body: 'Scott and Mark Kelly are identical twins, and both became astronauts. Scott spent 340 days on the Space Station while Mark stayed on Earth, and ten teams of scientists compared the brothers. Most of the changes in Scott’s body went back to normal after he landed; a few lasted longer. It was a study of just one pair of twins, so it shows what can happen, not what always happens.',
      numbers: [
        ['Scott Kelly’s time in space', '340 days'],
        ['Research teams', '10'],
        ['Gene activity changes that went back to normal', 'about 91.3%'],
      ],
    },
    ru: {
      title: 'Исследование близнецов',
      body: 'Скотт и Марк Келли — близнецы с одинаковыми генами, и оба стали астронавтами. Скотт провёл 340 дней на космической станции, а Марк оставался на Земле, и десять научных команд сравнивали братьев. Большинство изменений в организме Скотта после возвращения прошло, но некоторые держались дольше. Изучали всего одну пару близнецов, поэтому работа показывает, что может случиться, а не что случается всегда.',
      numbers: [
        ['Скотт Келли в космосе', '340 дней'],
        ['Научных команд', '10'],
        ['Изменений в работе генов, которые прошли', 'около 91,3%'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Twins Study Results Published',
        url: 'https://www.nasa.gov/humans-in-space/nasas-twins-study-results-published-in-science-journal/',
      },
      {
        title: 'FAQs – NASA Twins Study',
        url: 'https://www.nasa.gov/humans-in-space/twins-study/faqs-nasa-twins-study/',
      },
    ],
  },

  // ----- NASA data -----------------------------------------------------------
  {
    id: 'donki',
    topic: 'data',
    en: {
      title: 'DONKI, a storm diary',
      body: 'DONKI is NASA’s diary of space weather. The name stands for Space Weather Database Of Notifications, Knowledge, Information. It is kept at NASA’s Goddard Space Flight Center, where forecasters log each solar flare and storm, and anyone can read it online for free. The solar storms in this game are real ones taken from DONKI.',
      numbers: [
        ['Kept at', 'NASA Goddard Space Flight Center'],
        ['Records since', '2010'],
        ['Logged by the Moon to Mars office since', '2020'],
        ['Example record', 'X9.0 flare, 3 October 2024'],
      ],
    },
    ru: {
      title: 'DONKI — дневник бурь',
      body: 'DONKI — это дневник космической погоды, который ведёт NASA. Название расшифровывается как Space Weather Database Of Notifications, Knowledge, Information — база данных с уведомлениями и сведениями о космической погоде. Она хранится в Центре космических полётов имени Годдарда: синоптики записывают туда каждую вспышку и бурю, а читать записи может бесплатно любой человек. Солнечные бури в этой игре — настоящие, они взяты из DONKI.',
      numbers: [
        ['Где хранится', 'Центр космических полётов имени Годдарда (NASA)'],
        ['Записи ведутся с', '2010 года'],
        ['Отдел Moon to Mars ведёт записи с', '2020 года'],
        ['Пример записи', 'вспышка X9.0, 3 октября 2024 года'],
      ],
    },
    sources: [
      {
        title: 'CCMC DONKI System',
        url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
      },
      {
        title: 'DONKI | FLR | 33693 | 4',
        url: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/33693/-1',
      },
    ],
  },
  {
    id: 'osdr',
    topic: 'data',
    image: 'img-veggie-lettuce',
    en: {
      title: 'A library of space life',
      body: 'What happens to living things in space? NASA keeps the answers in a free online library called the Open Science Data Repository, or OSDR. It holds data from experiments on plants, animals, microbes and people, in space and on the ground. Every study has a number: OSD-267 is about lettuce grown on the Space Station, and OSD-476 is about plants grown in real Moon soil from Apollo.',
      numbers: [
        ['Lettuce grown on the Space Station', 'OSD-267'],
        ['Plants grown in Apollo Moon soil', 'OSD-476'],
        ['Mice living in Moon gravity', 'OSD-714'],
      ],
    },
    ru: {
      title: 'Библиотека жизни в космосе',
      body: 'Что происходит с живыми существами в космосе? Ответы NASA собирает в бесплатной интернет-библиотеке — Open Science Data Repository, сокращённо OSDR. В ней хранятся данные опытов с растениями, животными, микробами и людьми — и в космосе, и на Земле. У каждого исследования есть номер: OSD-267 — про салат, выращенный на космической станции, а OSD-476 — про растения, выращенные в настоящем лунном грунте, который привезли экспедиции Apollo.',
      numbers: [
        ['Салат, выращенный на космической станции', 'OSD-267'],
        ['Растения в лунном грунте Apollo', 'OSD-476'],
        ['Мыши при лунной силе тяжести', 'OSD-714'],
      ],
    },
    sources: [
      {
        title: 'About OSDR',
        url: 'https://science.nasa.gov/biological-physical/data/osdr/',
      },
      {
        title: 'NASA OSDR: Open Science for Life in Space',
        url: 'https://osdr.nasa.gov/bio/repo/search',
      },
    ],
  },
  {
    id: 'rems',
    topic: 'data',
    image: 'img-rems-boom',
    en: {
      title: 'A weather station on Mars',
      body: 'The Curiosity rover carries a weather station called REMS, supplied by a science centre in Spain. Every sol, or Mars day, it records how warm and how cold the air gets in Gale Crater. In its first spring on Mars, afternoons reached about 0 °C and nights fell to about −70 °C. The Mars weather in this game comes from these real readings.',
      numbers: [
        ['Afternoons, first Mars spring', 'about 0 °C'],
        ['Nights, first Mars spring', 'about −70 °C'],
        ['Warmest air in its first two Mars years', '15.9 °C'],
        ['Coldest air in those years', '−100 °C'],
      ],
    },
    ru: {
      title: 'Метеостанция на Марсе',
      body: 'На марсоходе Curiosity работает метеостанция REMS; её предоставил научный центр из Испании. Каждый сол, то есть марсианские сутки, она записывает, насколько тёплым и холодным бывает воздух в кратере Гейл. В её первую марсианскую весну днём воздух прогревался примерно до 0 °C, а ночью остывал примерно до −70 °C. Марсианская погода в этой игре взята из этих настоящих измерений.',
      numbers: [
        ['Днём, первая марсианская весна', 'около 0 °C'],
        ['Ночью, первая марсианская весна', 'около −70 °C'],
        ['Самый тёплый воздух за первые два марсианских года', '15,9 °C'],
        ['Самый холодный за те же годы', '−100 °C'],
      ],
    },
    sources: [
      {
        title: 'Steady Temperatures at Mars’ Gale Crater',
        url: 'https://science.nasa.gov/resource/steady-temperatures-at-mars-gale-crater/',
      },
      {
        title: 'Second Cycle of Martian Seasons Completing for Curiosity Rover',
        url: 'https://www.jpl.nasa.gov/news/second-cycle-of-martian-seasons-completing-for-curiosity-rover/',
      },
    ],
  },

  // ----- Discoveries on walks outside (see src/sim/finds.ts) ------------------
  {
    id: 'sulfur',
    topic: 'worlds',
    image: 'img-sulfur-crystals',
    en: {
      title: 'Yellow crystals on Mars',
      body: 'On 30 May 2024 the Curiosity rover drove over a rock, and the rock cracked open. Inside were yellow crystals. An instrument on the rover’s arm showed that they are pure sulfur, the first ever found on Mars. Rovers had found sulfur before, but always mixed with other things. Nearby lay a whole field of these bright stones. “It shouldn’t be there, so now we have to explain it,” said Ashwin Vasavada, the rover’s project scientist.',
      numbers: [
        ['Rock cracked open', '30 May 2024'],
        ['Where', 'Gediz Vallis channel, Mount Sharp'],
        ['Smell of pure sulfur', 'none at all'],
      ],
    },
    ru: {
      title: 'Жёлтые кристаллы на Марсе',
      body: '30 мая 2024 года марсоход Curiosity наехал на камень, и камень раскололся. Внутри оказались жёлтые кристаллы. Прибор на руке марсохода показал, что это чистая сера — на Марсе такую нашли впервые. Серу марсоходы встречали и раньше, но всегда смешанной с другими веществами. Рядом лежало целое поле таких светлых камней. «Их здесь не должно быть, так что теперь нам нужно это объяснить», — сказал Ашвин Васавада, научный руководитель проекта.',
      numbers: [
        ['Камень раскололся', '30 мая 2024 года'],
        ['Где', 'русло Гедиз-Валлис на горе Шарп'],
        ['Запах чистой серы', 'никакого'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Curiosity Rover Discovers a Surprise in a Martian Rock',
        url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-rover-discovers-a-surprise-in-a-martian-rock/',
      },
      {
        title: 'Curiosity Views Sulfur Crystals Within a Crushed Rock (PIA26309)',
        url: 'https://science.nasa.gov/photojournal/curiosity-views-sulfur-crystals-within-a-crushed-rock/',
      },
      {
        title: 'NASA’s Curiosity Mars Rover Takes a Last Look at Mysterious Sulfur',
        url: 'https://www.jpl.nasa.gov/news/nasas-curiosity-mars-rover-takes-a-last-look-at-mysterious-sulfur/',
      },
    ],
  },
  {
    id: 'meteorite',
    topic: 'worlds',
    image: 'img-lebanon-meteorite',
    en: {
      title: 'Iron from space',
      body: 'Not every rock on Mars comes from Mars. Curiosity has found several meteorites made of iron and nickel lying on the ground. One, nicknamed “Lebanon”, is about 2 metres wide. “Egg Rock”, found in 2016, is the size of a golf ball: the rover zapped it with its laser to find out what it is made of. In 2023 came “Cacao”, about 30 cm across. Iron meteorites like these usually come from the metal core of an asteroid that once melted.',
      numbers: [
        ['“Lebanon” (2014)', 'about 2 m wide'],
        ['“Egg Rock” (2016)', 'golf-ball size'],
        ['“Cacao” (2023)', 'about 30 cm across'],
      ],
    },
    ru: {
      title: 'Железо из космоса',
      body: 'Не все камни на Марсе — марсианские. Curiosity нашёл на поверхности несколько метеоритов из железа и никеля. Один из них, по прозвищу «Ливан», шириной около 2 метров. «Камень-яйцо», найденный в 2016 году, размером с мячик для гольфа: марсоход выстрелил в него лазером, чтобы узнать, из чего он сделан. В 2023 году попался «Какао» — около 30 см в поперечнике. Такие железные метеориты обычно бывают кусочками металлического ядра астероида, который когда-то расплавился.',
      numbers: [
        ['«Ливан» (2014)', 'около 2 м в ширину'],
        ['«Камень-яйцо» (2016)', 'с мячик для гольфа'],
        ['«Какао» (2023)', 'около 30 см в поперечнике'],
      ],
    },
    sources: [
      {
        title: 'Curiosity Mars Rover Checks Odd-looking Iron Meteorite',
        url: 'https://www.jpl.nasa.gov/news/curiosity-mars-rover-checks-odd-looking-iron-meteorite/',
      },
      {
        title: 'Curiosity Finds Iron Meteorite on Mars (PIA18387)',
        url: 'https://www.jpl.nasa.gov/images/pia18387-curiosity-finds-iron-meteorite-on-mars/',
      },
      {
        title: 'Curiosity Finds a Meteorite, Cacao',
        url: 'https://science.nasa.gov/resource/curiosity-finds-a-meteorite-cacao/',
      },
    ],
  },
  {
    id: 'stream_pebbles',
    topic: 'worlds',
    image: 'img-link-outcrop',
    en: {
      title: 'A stream on Mars',
      body: 'In its first weeks on Mars in 2012, Curiosity photographed rocks made of pebbles stuck together. Many of the pebbles are round. Stones get round when flowing water carries them a long way and they knock against each other, and these were too big to have been blown by the wind. From their sizes, scientists worked out that a stream once flowed here, at least as fast as you walk and between ankle-deep and hip-deep.',
      numbers: [
        ['Announced', '27 September 2012'],
        ['Speed of the water', 'about 1 m a second, or more'],
        ['Depth of the water', 'ankle-deep to hip-deep'],
        ['Pebble sizes', 'from a grain of sand to a golf ball'],
      ],
    },
    ru: {
      title: 'Ручей на Марсе',
      body: 'В 2012 году, в первые недели на Марсе, Curiosity сфотографировал камни из слипшейся гальки. Многие камешки в них круглые. Камни становятся круглыми, когда вода долго несёт их и они бьются друг о друга, а эти были слишком большими, чтобы их принёс ветер. По их размеру учёные рассчитали, что здесь когда-то тёк ручей — не медленнее, чем ты ходишь, глубиной от щиколотки до бедра.',
      numbers: [
        ['Об открытии объявили', '27 сентября 2012 года'],
        ['Скорость воды', 'около 1 м в секунду или больше'],
        ['Глубина ручья', 'от щиколотки до бедра'],
        ['Размер камешков', 'от песчинки до мячика для гольфа'],
      ],
    },
    sources: [
      {
        title: 'NASA Rover Finds Old Streambed on Martian Surface',
        url: 'https://www.jpl.nasa.gov/news/nasa-rover-finds-old-streambed-on-martian-surface/',
      },
      {
        title: 'Pebbly Rocks Testify to Old Streambed on Mars',
        url: 'https://www.jpl.nasa.gov/news/pebbly-rocks-testify-to-old-streambed-on-mars/',
      },
    ],
  },
  {
    id: 'murray_buttes',
    topic: 'worlds',
    image: 'img-murray-butte',
    en: {
      title: 'Towers of old sand dunes',
      body: 'In August and September 2016, Curiosity spent just over a month driving among the Murray Buttes on Mount Sharp. These flat-topped hills are up to about 15 m high. They are made of sandstone: long ago, wind piled sand up into moving dunes, and the dunes later turned to stone. Each hill wears a cap of hard rock that the wind cannot wear away easily. The cap protected the hill while the sandstone around it was worn away.',
      numbers: [
        ['Curiosity among the buttes', 'August–September 2016'],
        ['Tallest mesa NASA measured there', 'about 15 m high'],
        ['The same mesa near its top', 'about 60 m wide'],
        ['Name of the sandstone layer', 'Stimson formation'],
      ],
    },
    ru: {
      title: 'Башни из древних дюн',
      body: 'В августе и сентябре 2016 года Curiosity больше месяца ездил среди холмов Мюррей на горе Шарп. Это холмы с плоскими вершинами, высотой до 15 м. Они сложены из песчаника: давным-давно ветер нагонял песок в кочующие дюны, а потом эти дюны превратились в камень. Сверху у каждого холма — шапка из твёрдой породы, которую ветер стачивает с трудом. Эта шапка защитила холм, пока песчаник вокруг него стирался.',
      numbers: [
        ['Curiosity среди холмов', 'август–сентябрь 2016 года'],
        ['Самая высокая из измеренных столовых гор', 'около 15 м'],
        ['Её ширина у вершины', 'около 60 м'],
        ['Название слоя песчаника', 'формация Стимсон'],
      ],
    },
    sources: [
      {
        title: 'Mars Rover Views Spectacular Layered Rock Formations',
        url: 'https://www.jpl.nasa.gov/news/mars-rover-views-spectacular-layered-rock-formations/',
      },
      {
        title: 'Full-Circle Vista from NASA Mars Rover Curiosity Shows ‘Murray Buttes’',
        url: 'https://www.jpl.nasa.gov/news/full-circle-vista-from-nasa-mars-rover-curiosity-shows-murray-buttes/',
      },
      {
        title: 'Mars Curiosity Rover Says Farewell to Murray Buttes',
        url: 'https://www.nasa.gov/image-article/mars-curiosity-rover-says-farewell-murray-buttes/',
      },
    ],
  },
  {
    id: 'shrinking_moon',
    topic: 'worlds',
    image: 'img-lobate-scarps',
    en: {
      title: 'The shrinking Moon',
      body: 'The inside of the Moon is still hot. As it cools, the Moon slowly shrinks: over the last few hundred million years it has become more than about 50 m skinnier. “Just as a grape wrinkles as it shrinks down to a raisin, the Moon gets wrinkles as it shrinks,” says NASA. But the Moon’s crust is brittle, so it cracks, and one piece is pushed up over the next. That makes long, step-shaped cliffs called fault scarps. Shrinking may still cause moonquakes, and in 2024 scientists found young faults near the Moon’s south pole, where Artemis astronauts may land.',
      numbers: [
        ['Skinnier over a few hundred million years', 'more than about 50 m'],
        ['A fault scarp', 'tens of metres high, a few km long'],
        ['Shallow moonquakes recorded by Apollo seismometers, 1969–1977', '28, up to about magnitude 5'],
      ],
    },
    ru: {
      title: 'Луна сжимается',
      body: 'Внутри Луна всё ещё горячая. Остывая, она понемногу сжимается: за последние несколько сотен миллионов лет она «похудела» больше чем примерно на 50 м. «Как виноградина, превращаясь в изюм, покрывается морщинками, так и Луна сморщивается, когда сжимается», — объясняет NASA. Но кора Луны хрупкая, поэтому она трескается, и один её кусок наползает на соседний. Так появляются длинные обрывы-ступеньки — тектонические уступы. Сжатие, возможно, и сейчас вызывает лунотрясения, а в 2024 году учёные нашли молодые разломы у южного полюса Луны, там, где могут высадиться астронавты Artemis.',
      numbers: [
        ['«Похудела» за несколько сотен миллионов лет', 'больше чем примерно на 50 м'],
        ['Тектонический уступ', 'десятки метров в высоту, несколько км в длину'],
        ['Неглубоких лунотрясений записали сейсмометры Apollo, 1969–1977', '28, магнитудой примерно до 5'],
      ],
    },
    sources: [
      {
        title: 'Shrinking Moon May Be Generating Moonquakes',
        url: 'https://www.nasa.gov/news-release/shrinking-moon-may-be-generating-moonquakes/',
      },
      {
        title: 'Shrinking Moon Causing Moonquakes and Faults Near Lunar South Pole',
        url: 'https://www.nasa.gov/solar-system/moon/shrinking-moon-causing-moonquakes-and-faults-near-lunar-south-pole/',
      },
    ],
  },
  {
    id: 'orange_soil',
    topic: 'worlds',
    image: 'img-orange-soil',
    en: {
      title: 'Orange soil on the Moon',
      body: 'On 12 December 1972, on Apollo 17’s second moonwalk, the geologist Jack Schmitt called out in surprise: “There is orange soil!” His crewmate Gene Cernan walked over and saw it too. Back on Earth, scientists found that the soil is made of tiny beads of orange glass, each no bigger than a tenth of a millimetre. Most scientists think a fountain of lava sprayed them out, about 3.5 billion years ago.',
      numbers: [
        ['Found', '12 December 1972'],
        ['Where', 'Shorty crater, Taurus-Littrow valley'],
        ['Size of most beads', '0.04 to 0.06 mm'],
        ['Age of the glass', 'about 3.5 billion years'],
      ],
    },
    ru: {
      title: 'Оранжевый грунт на Луне',
      body: '12 декабря 1972 года, во время второго выхода на поверхность в миссии Apollo 17, геолог Джек Шмитт удивлённо крикнул: «Здесь оранжевый грунт!» Его напарник Юджин Сернан подошёл и тоже его увидел. На Земле учёные выяснили, что этот грунт состоит из крошечных бусинок оранжевого стекла — каждая не больше десятой доли миллиметра. Большинство учёных считают, что их выбросил фонтан лавы около 3,5 миллиарда лет назад.',
      numbers: [
        ['Найден', '12 декабря 1972 года'],
        ['Где', 'кратер Шорти, долина Тавр-Литтров'],
        ['Размер большинства бусинок', 'от 0,04 до 0,06 мм'],
        ['Возраст стекла', 'около 3,5 миллиарда лет'],
      ],
    },
    sources: [
      {
        title: '50 Years Ago: Apollo 17 Lands at Taurus-Littrow',
        url: 'https://www.nasa.gov/history/50-years-ago-apollo-17-lands-at-taurus-littrow/',
      },
      {
        title: 'Apollo 17 photo AS17-137-20990: orange soil near Shorty crater',
        url: 'https://nssdc.gsfc.nasa.gov/imgcat/html/object_page/a17_h_137_20990.html',
      },
      {
        title: 'Sample 74220 (NASA Lunar Petrographic Thin Section Set study guide)',
        url: 'https://curator.jsc.nasa.gov/education/lpetss/74220.cfm',
      },
    ],
  },
  {
    id: 'genesis_rock',
    topic: 'worlds',
    image: 'img-genesis-rock',
    en: {
      title: 'The Genesis Rock',
      body: 'On 1 August 1971, on their second moonwalk, Apollo 15 astronauts Dave Scott and Jim Irwin spotted a white rock at Spur crater. “Guess what we just found,” Scott told Mission Control. The rock is anorthosite: it is made almost entirely of one mineral, and it is a piece of the Moon’s ancient crust. It was nicknamed the Genesis Rock (“genesis” means “beginning”), because it was thought to be among the oldest samples. Geologists later found it to be about 4 billion years old.',
      numbers: [
        ['Found', '1 August 1971'],
        ['Where', 'Spur crater, Hadley-Apennine'],
        ['NASA sample number', '15415'],
        ['Weight', '269 g'],
        ['Age', 'about 4 billion years'],
      ],
    },
    ru: {
      title: 'Камень Бытия',
      body: '1 августа 1971 года, во время второго выхода на поверхность, астронавты Apollo 15 Дэвид Скотт и Джеймс Ирвин заметили у кратера Спур белый камень. «Угадайте, что мы только что нашли», — сказал Скотт Центру управления. Этот камень — анортозит: он почти целиком состоит из одного минерала. Это кусочек древней коры Луны. Его прозвали «Камнем Бытия», то есть камнем начала, потому что считали одним из самых древних образцов. Позже геологи выяснили, что ему около 4 миллиардов лет.',
      numbers: [
        ['Найден', '1 августа 1971 года'],
        ['Где', 'кратер Спур, район Хэдли — Апеннины'],
        ['Номер образца в NASA', '15415'],
        ['Вес', '269 г'],
        ['Возраст', 'около 4 миллиардов лет'],
      ],
    },
    sources: [
      {
        title: 'Genesis Rock',
        url: 'https://science.nasa.gov/solar-system/moon/genesis-rock/',
      },
      {
        title: '50 Years Ago: Apollo 15 on the Moon at Hadley-Apennine',
        url: 'https://www.nasa.gov/history/50-years-ago-apollo-15-on-the-moon-at-hadley-apennine/',
      },
      {
        title: 'History of Lunar Exploration',
        url: 'https://science.nasa.gov/solar-system/moon/history-of-lunar-exploration/',
      },
    ],
  },
  {
    id: 'new_craters',
    topic: 'worlds',
    en: {
      title: 'New craters on the Moon',
      body: 'Space rocks still hit the Moon. Since 2009, NASA’s Lunar Reconnaissance Orbiter has taken before-and-after pictures of the same places. In them, scientists found more than 200 new craters, from about 3 to 43 m across: about a third more than they expected. The hits also stir up the top layer of soil much faster than people thought, so the Apollo astronauts’ footprints will be gone in tens of thousands of years, not millions. A base on the Moon may have to be built sturdier.',
      numbers: [
        ['Orbiting the Moon since', 'June 2009'],
        ['New craters found (2016 study)', 'more than 200'],
        ['Their size', 'about 3 to 43 m across'],
        ['Speed of the bits an impact throws out', 'up to about 500 m a second'],
      ],
    },
    ru: {
      title: 'Новые кратеры на Луне',
      body: 'В Луну до сих пор врезаются камни из космоса. С 2009 года лунный орбитальный аппарат NASA снимает одни и те же места «до» и «после». На этих снимках учёные нашли больше 200 новых кратеров размером примерно от 3 до 43 м — примерно на треть больше, чем ожидали. Удары к тому же перемешивают верхний слой грунта гораздо быстрее, чем думали раньше: следы астронавтов Apollo исчезнут через десятки тысяч лет, а не через миллионы. Базу на Луне, возможно, придётся строить прочнее.',
      numbers: [
        ['На орбите Луны', 'с июня 2009 года'],
        ['Новых кратеров нашли (исследование 2016 года)', 'больше 200'],
        ['Их размер', 'примерно от 3 до 43 м'],
        ['Скорость осколков, которые выбрасывает удар', 'до 500 м в секунду'],
      ],
    },
    sources: [
      {
        title: 'Earth’s Moon Hit by Surprising Number of Meteoroids',
        url: 'https://www.nasa.gov/news-release/earths-moon-hit-by-surprising-number-of-meteoroids/',
      },
      {
        title: 'Why Study Moon Craters?',
        url: 'https://science.nasa.gov/moon/lunar-craters/why-study-craters/',
      },
      {
        title: 'Gardening Rates on the Moon (NASA Scientific Visualization Studio)',
        url: 'https://svs.gsfc.nasa.gov/4505',
      },
    ],
  },
  {
    id: 'rovers',
    topic: 'worlds',
    image: 'img-apollo15-rover',
    en: {
      title: 'Cars on the Moon, rovers on Mars',
      body: 'Astronauts on Apollo 15, 16 and 17 (1971–1972) drove a battery-powered Lunar Roving Vehicle on the Moon. It travelled folded up inside the lander, and each of its four wheels had its own electric motor. Its batteries could not be recharged, and mission rules kept the crews close enough to walk back to the lander if they had to. Mars rovers are much slower: Curiosity’s top speed on flat ground is 4 cm a second. For Artemis, NASA has chosen two companies to build new rovers. Astronauts will drive them near the Moon’s south pole, and between crew visits they can be driven from Earth.',
      numbers: [
        ['Mass of the Apollo rover', '210 kg'],
        ['Its estimated top speed', 'about 13 km/h'],
        ['Driven on Apollo 15 / 16 / 17', 'about 28 / 27 / 36 km'],
        ['Curiosity’s top speed on flat ground', '4 cm a second'],
        ['Curiosity, driven since 2012', 'more than 38 km (October 2026)'],
      ],
    },
    ru: {
      title: 'Машины на Луне, роверы на Марсе',
      body: 'Астронавты Apollo 15, 16 и 17 (1971–1972) ездили по Луне на лунном автомобиле с электрическими батареями. В полёте он лежал сложенным внутри посадочного модуля, а у каждого из четырёх его колёс был свой электромотор. Батареи нельзя было подзарядить, и по правилам миссии экипажи не уезжали дальше, чем смогли бы при нужде вернуться пешком. Марсоходы ездят гораздо медленнее: максимальная скорость Curiosity на ровной поверхности — 4 см в секунду. Для программы Artemis NASA выбрало две компании, которые строят новые роверы. Астронавты будут водить их у южного полюса Луны, а между экспедициями ими можно управлять с Земли.',
      numbers: [
        ['Масса лунного автомобиля Apollo', '210 кг'],
        ['Его расчётная максимальная скорость', 'около 13 км/ч'],
        ['Пробег на Apollo 15 / 16 / 17', 'около 28 / 27 / 36 км'],
        ['Максимальная скорость Curiosity на ровном', '4 см в секунду'],
        ['Пробег Curiosity с 2012 года', 'больше 38 км (октябрь 2026)'],
      ],
    },
    sources: [
      {
        title: 'The Apollo Lunar Roving Vehicle (NASA NSSDCA)',
        url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo_lrv.html',
      },
      {
        title: 'Apollo Expeditions to the Moon (NASA SP-350), Touring the Moon',
        url: 'https://www.nasa.gov/wp-content/uploads/static/history/SP-350/ch-14-8.html',
      },
      {
        title: 'Lunar Terrain Vehicle (NASA)',
        url: 'https://www.nasa.gov/moonbase/lunar-terrain-vehicle/',
      },
      {
        title: 'Learn About Me: Curiosity (NASA)',
        url: 'https://mars.nasa.gov/multimedia/interactives/learncuriosity/index-2.html',
      },
      {
        title: 'NASA’s Perseverance Sets Off-World Record for Total Distance Driven',
        url: 'https://www.jpl.nasa.gov/news/nasas-perseverance-sets-off-world-record-for-total-distance-driven/',
      },
    ],
  },
  {
    id: 'isru',
    topic: 'air',
    en: {
      title: 'Living off the land',
      body: 'Astronauts can’t carry everything from Earth, so NASA wants to use what is already on the Moon. Moon rock and dust are almost half oxygen (about 45% of their mass), but the oxygen is locked inside the minerals. In 2023 a NASA team melted look-alike Moon soil with a laser inside a vacuum chamber, and the oxygen came out joined to carbon, as a gas called carbon monoxide, which other machines can turn into oxygen to breathe.',
      numbers: [
        ['Oxygen in Moon soil', 'about 45% of its mass'],
        ['First test', '2023, NASA Johnson'],
      ],
    },
    ru: {
      title: 'Жить за счёт того, что рядом',
      body: 'Астронавты не могут привезти с Земли всё, что нужно, поэтому NASA хочет использовать то, что уже есть на Луне. Лунные камни и пыль почти наполовину состоят из кислорода (около 45% их массы), но он крепко заперт внутри минералов. В 2023 году команда NASA расплавила лазером искусственный лунный грунт в вакуумной камере, и кислород вышел из него вместе с углеродом — в виде угарного газа, из которого другие машины умеют получать кислород для дыхания.',
      numbers: [
        ['Кислорода в лунном грунте', 'около 45% массы'],
        ['Первый опыт', '2023, NASA Johnson'],
      ],
    },
    sources: [
      {
        title: 'NASA Successfully Extracts Oxygen from Lunar Soil Simulant (NASA Johnson, published 25 Apr 2023, updated 14 Sep 2023)',
        url: 'https://www.nasa.gov/centers-and-facilities/johnson/nasa-successfully-extracts-oxygen-from-lunar-soil-simulant/',
      },
    ],
  },
  {
    id: 'printed_habitats',
    topic: 'worlds',
    image: 'img-chapea-habitat',
    en: {
      title: 'Houses from a printer',
      body: 'Big 3D printers can build a house by laying down building material layer after layer. NASA ran a contest for 3D-printed space homes from 2015 to 2019, and later the company ICON printed Mars Dune Alpha, a pretend Mars home of 1,700 square feet (about 158 square metres), in Houston. Two crews of four volunteers have each lived inside it for 378 days, as if they were on Mars.',
      numbers: [
        ['Mars Dune Alpha', 'about 158 m²'],
        ['Each crew lived inside', '378 days'],
      ],
    },
    ru: {
      title: 'Дома из принтера',
      body: 'Большие 3D-принтеры умеют строить дома, укладывая строительный материал слой за слоем. С 2015 по 2019 год NASA проводило конкурс на напечатанный дом для космоса, а потом компания ICON напечатала в Хьюстоне Mars Dune Alpha — «марсианский» дом площадью около 158 квадратных метров. В нём уже пожили два экипажа по четыре добровольца, каждый по 378 дней, будто на Марсе.',
      numbers: [
        ['Mars Dune Alpha', 'около 158 м²'],
        ['Каждый экипаж прожил внутри', '378 дней'],
      ],
    },
    sources: [
      {
        title: 'NASA, ICON Advance Lunar Construction Technology for Moon Missions (NASA Marshall, 29 Nov 2022)',
        url: 'https://www.nasa.gov/centers-and-facilities/marshall/nasa-icon-advance-lunar-construction-technology-for-moon-missions/',
      },
      {
        title: 'First CHAPEA Crew Begins 378-Day Mission (NASA, 10 Jul 2023)',
        url: 'https://www.nasa.gov/missions/analog-field-testing/chapea/first-chapea-crew-begins-378-day-mission/',
      },
      {
        title: 'CHAPEA Mission 2 Crew Reflects After 378 Days on Simulated Mars (NASA, 9 Nov 2026)',
        url: 'https://www.nasa.gov/centers-and-facilities/johnson/chapea-mission-2-crew-reflects-after-378-days-on-simulated-mars/',
      },
    ],
  },
  {
    id: 'space_printer',
    topic: 'people',
    image: 'img-iss-3d-printer',
    en: {
      title: 'A printer in orbit',
      body: 'In November 2014 astronaut Butch Wilmore set up the first 3D printer in space, on the International Space Station. Its very first print was a small cover plate for the printer itself, which showed that a printer can make its own spare parts. In December 2014 engineers on Earth sent up the design of a ratchet wrench, and the station printed the tool.',
      numbers: [
        ['First 3D printer in space', 'November 2014'],
        ['First tool from a design sent from Earth', 'a wrench, December 2014'],
      ],
    },
    ru: {
      title: 'Принтер на орбите',
      body: 'В ноябре 2014 года астронавт Бутч Уилмор установил на Международной космической станции первый в космосе 3D-принтер. Самой первой его деталью стала небольшая крышка для самого принтера — так проверили, что принтер может печатать запчасти сам для себя. В декабре 2014 года инженеры отправили с Земли чертёж ключа-трещотки, и на станции этот инструмент напечатали.',
      numbers: [
        ['Первый 3D-принтер в космосе', 'ноябрь 2014'],
        ['Первый инструмент по чертежу с Земли', 'ключ, декабрь 2014'],
      ],
    },
    sources: [
      {
        title: 'Open for Business: 3-D Printer Creates First Object in Space on International Space Station (NASA, Beth Ridgeway, 25 Nov 2014)',
        url: 'https://www.nasa.gov/missions/station/open-for-business-3-d-printer-creates-first-object-in-space-on-international-space-station/',
      },
      {
        title: 'Made in Space: Producing Tools on Demand (NASA image page, photo dated 16 Dec 2014)',
        url: 'https://www.nasa.gov/image-detail/nasa-2071125-79-7f-2/',
      },
    ],
  },
  {
    id: 'astrorad',
    topic: 'radiation',
    image: 'img-mare-postflight',
    en: {
      title: 'A vest against radiation',
      body: 'On the Artemis I flight around the Moon in 2022, two model human bodies named Helga and Zohar rode in the Orion spacecraft, packed with radiation sensors. Only Zohar wore AstroRad, a 26 kg vest made of thousands of small plastic rods. There was no solar storm on the trip, so scientists used the measurements and computer models: in a very strong solar storm the vest would cut the dose by about 40 to 60 percent, depending on the storm.',
      numbers: [
        ['Mass of the vest', '26 kg'],
        ['Dose cut in a very strong storm (model)', 'about 40–60%'],
      ],
    },
    ru: {
      title: 'Жилет от радиации',
      body: 'Во время полёта Artemis I вокруг Луны в 2022 году в корабле Orion летели два манекена, Хельга и Зохар, с датчиками радиации внутри. Только на Зохар надели AstroRad — жилет массой 26 кг из тысяч маленьких пластиковых стерженьков. Солнечной бури в полёте не случилось, поэтому учёные взяли измерения и компьютерные модели: в очень сильную солнечную бурю жилет уменьшил бы дозу радиации примерно на 40–60%, в зависимости от бури.',
      numbers: [
        ['Масса жилета', '26 кг'],
        ['Снижение дозы в очень сильную бурю (модель)', 'примерно 40–60%'],
      ],
    },
    sources: [
      {
        title: 'Houri J. M., Berger T., ... Milstein O., ’First evaluation of wearable radiation protection for human deep space exploration, as flown on Artemis I’, Science Advances 12, eadz1892 (12 Aug 2026), open access CC BY 4.0',
        url: 'https://doi.org/10.1126/sciadv.adz1892',
      },
    ],
  },
  {
    id: 'space_peppers',
    topic: 'food',
    image: 'img-chile-peppers',
    en: {
      title: 'Chile peppers in space',
      body: 'In July 2021 astronauts planted 48 chile pepper seeds in the Advanced Plant Habitat, the biggest plant-growing chamber on the space station. On 29 October 2021 the crew became the first astronauts to eat peppers grown in space, and even put some in tacos. When the experiment ended after 137 days, the plants had grown 26 peppers, and NASA called it the longest plant experiment in the station’s history up to then.',
      numbers: [
        ['Days of growing', '137'],
        ['Peppers grown', '26'],
        ['First eaten', '29 October 2021'],
      ],
    },
    ru: {
      title: 'Перцы в космосе',
      body: 'В июле 2021 года астронавты посадили 48 семян перца чили в Advanced Plant Habitat — самую большую камеру для выращивания растений на космической станции. 29 октября 2021 года экипаж первым в истории попробовал перцы, выращенные в космосе, и даже положил их в тако. Опыт закончился через 137 дней: на растениях выросло 26 перцев, и NASA назвало его самым долгим опытом с растениями за всю историю станции на тот момент.',
      numbers: [
        ['Дней роста', '137'],
        ['Выросло перцев', '26'],
        ['Первая дегустация', '29 октября 2021'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Second Pepper Harvest Sets Record on Space Station (NASA Kennedy, Jason Costa, 30 Nov 2021)',
        url: 'https://www.nasa.gov/missions/station/nasas-second-pepper-harvest-sets-record-on-space-station/',
      },
    ],
  },
  {
    id: 'moon_telescope',
    topic: 'worlds',
    image: 'img-apollo16-uv-camera',
    en: {
      title: 'The first telescope on the Moon',
      body: 'In April 1972 the Apollo 16 astronauts set up the first telescope on the Moon, a gold-coated camera built by the scientist George Carruthers. It saw ultraviolet light, which our eyes cannot see, and photographed the glow of Earth’s outermost air, called the geocorona, as well as star clusters and a nearby galaxy. The telescope is still standing on the Moon today.',
      numbers: [
        ['Mission', 'Apollo 16, April 1972'],
        ['Built by', 'George Carruthers'],
      ],
    },
    ru: {
      title: 'Первый телескоп на Луне',
      body: 'В апреле 1972 года астронавты Apollo 16 установили на Луне первый телескоп — позолоченную камеру, которую создал учёный Джордж Каррутерс. Она видела ультрафиолетовый свет, невидимый для наших глаз, и сфотографировала свечение самого внешнего слоя воздуха Земли — геокорону, а ещё звёздные скопления и соседнюю галактику. Этот телескоп и сейчас стоит на Луне.',
      numbers: [
        ['Миссия', 'Apollo 16, апрель 1972'],
        ['Создатель', 'Джордж Каррутерс'],
      ],
    },
    sources: [
      {
        title: 'Remembering the First Moon-Based Telescope (NASA, Elizabeth R. Landau, 15 Jul 2019, updated 15 Apr 2025)',
        url: 'https://www.nasa.gov/history/remembering-the-first-moon-based-telescope/',
      },
    ],
  },
  {
    id: 'vertical_solar',
    topic: 'power',
    en: {
      title: 'Solar panels on a tall mast',
      body: 'At the Moon’s south pole the Sun stays low near the horizon, so long shadows can hide flat solar panels. NASA is developing solar panels that rise on a tall mast, about 10 metres high (masts up to 20 metres are being studied), and fold back down so they can be moved. In summer 2024 two companies tested their prototypes in a giant vacuum chamber in Houston, and NASA hopes to set one up near the south pole by the end of this decade.',
      numbers: [
        ['Height tested', 'about 10 m'],
        ['Tested', 'summer 2024, Houston'],
      ],
    },
    ru: {
      title: 'Солнечные панели на мачте',
      body: 'На южном полюсе Луны Солнце всё время висит низко над горизонтом, и длинные тени могут закрыть плоские солнечные панели. NASA разрабатывает панели, которые поднимаются на высокой мачте — примерно на 10 метров (изучают и мачты до 20 метров) — и складываются обратно, чтобы их можно было перевезти. Летом 2024 года две компании испытали свои образцы в огромной вакуумной камере в Хьюстоне, а до конца этого десятилетия NASA надеется поставить такую установку у южного полюса.',
      numbers: [
        ['Испытанная высота', 'около 10 м'],
        ['Испытания', 'лето 2024, Хьюстон'],
      ],
    },
    sources: [
      {
        title: 'Three Companies to Help NASA Advance Solar Array Technology for Moon (NASA release 22-090, 23 Aug 2022)',
        url: 'https://www.nasa.gov/news-release/three-companies-to-help-nasa-advance-solar-array-technology-for-moon/',
      },
      {
        title: 'From Houston to the Moon: Johnson’s Thermal Vacuum Chamber Tests Lunar Solar Technology (NASA Johnson, 19 Nov 2024, updated 22 Jun 2026)',
        url: 'https://www.nasa.gov/centers-and-facilities/johnson/from-houston-to-the-moon-johnsons-thermal-vacuum-chamber-tests-lunar-solar-technology/',
      },
    ],
  },
  {
    id: 'laser_spectrometer',
    topic: 'worlds',
    image: 'img-chemcam-spark',
    en: {
      title: 'A laser that reads rocks',
      body: 'The Curiosity rover carries a laser called ChemCam that zaps rocks up to 7 metres away and turns a pinhead-sized spot into a tiny glowing spark. Each chemical element glows in its own colours, so the light from the spark tells scientists what the rock is made of. By August 2024 ChemCam had fired its laser one million times, and the Perseverance rover carries a similar tool called SuperCam.',
      numbers: [
        ['Reach', 'up to 7 m'],
        ['Laser shots by August 2024', '1,000,000'],
      ],
    },
    ru: {
      title: 'Лазер, который читает камни',
      body: 'У марсохода Curiosity есть лазерный прибор ChemCam: он стреляет по камням на расстоянии до 7 метров и превращает пятнышко размером с булавочную головку в крошечную светящуюся искру. Каждый химический элемент светится своими цветами, поэтому по свету искры учёные узнают, из чего состоит камень. К августу 2024 года ChemCam выстрелил лазером миллион раз, а у марсохода Perseverance есть похожий прибор — SuperCam.',
      numbers: [
        ['Дальность', 'до 7 м'],
        ['Выстрелов к августу 2024', '1 000 000'],
      ],
    },
    sources: [
      {
        title: 'Laser Instrument on NASA Mars Rover Tops 100,000 Zaps (NASA/JPL news, 5 Dec 2013)',
        url: 'https://www.jpl.nasa.gov/news/laser-instrument-on-nasa-mars-rover-tops-100000-zaps/',
      },
      {
        title: '12 Years, 42 Drill Holes, and Now… 1 Million ChemCam Shots! (NASA Science Curiosity blog, written by Susanne Schwenzer, 13 Sep 2024)',
        url: 'https://science.nasa.gov/blog/sols-4304-4006-12-years-42-drill-holes-and-now-1-million-chemcam-shots/',
      },
      {
        title: 'Perseverance Science Instruments (NASA Science, page last updated 27 Oct 2026)',
        url: 'https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/',
      },
    ],
  },
  {
    id: 'phobos_eclipse',
    topic: 'worlds',
    image: 'img-phobos-eclipse',
    en: {
      title: 'An eclipse on Mars',
      body: 'Mars has a small, potato-shaped moon called Phobos. On 2 April 2022 the Perseverance rover filmed Phobos sliding across the Sun: this Martian solar eclipse lasted a little over 40 seconds. Phobos is slowly getting closer to Mars and will crash into it in tens of millions of years.',
      numbers: [
        ['Filmed', '2 April 2022'],
        ['Length', 'a little over 40 s'],
      ],
    },
    ru: {
      title: 'Затмение на Марсе',
      body: 'У Марса есть маленькая луна Фобос, похожая на картофелину. 2 апреля 2022 года марсоход Perseverance снял, как Фобос проплывает по диску Солнца: это марсианское солнечное затмение длилось чуть больше 40 секунд. Фобос медленно приближается к Марсу и через десятки миллионов лет упадёт на него.',
      numbers: [
        ['Снято', '2 апреля 2022'],
        ['Длительность', 'чуть больше 40 с'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Perseverance Rover Captures Video of Solar Eclipse on Mars (NASA/JPL news, 20 Apr 2022)',
        url: 'https://www.jpl.nasa.gov/news/nasas-perseverance-rover-captures-video-of-solar-eclipse-on-mars/',
      },
    ],
  },
  {
    id: 'suit_oxygen',
    topic: 'air',
    image: 'img-emu-spacesuits',
    en: {
      title: 'How long a spacesuit lasts',
      body: 'A spacesuit backpack works like a tiny spaceship: it gives the astronaut oxygen, keeps them cool and cleans the air they breathe out. The space station suit carries oxygen for about 7 hours, plus an emergency pack with 30 more minutes, and spacewalks usually last 6 to 8 hours. On Apollo 17 in 1972, one moonwalk lasted 7 hours and 37 minutes.',
      numbers: [
        ['Oxygen in a space station suit', 'about 7 hours'],
        ['Emergency pack', '30 more minutes'],
        ['Longest Apollo moonwalk', '7 h 37 min'],
      ],
    },
    ru: {
      title: 'На сколько хватает скафандра',
      body: 'Рюкзак скафандра похож на крошечный космический корабль: он даёт астронавту кислород, не даёт ему перегреться и очищает выдыхаемый воздух. В скафандре для космической станции кислорода хватает примерно на 7 часов, и ещё есть аварийный запас на 30 минут, а выходы в открытый космос обычно длятся 6–8 часов. В 1972 году в полёте Apollo 17 одна прогулка по Луне длилась 7 часов 37 минут.',
      numbers: [
        ['Кислорода в скафандре станции', 'около 7 часов'],
        ['Аварийный запас', 'ещё 30 минут'],
        ['Самая долгая прогулка Apollo', '7 ч 37 мин'],
      ],
    },
    sources: [
      {
        title: 'NASA’s Management and Development of Spacesuits (NASA Office of Inspector General, Report IG-17-018, 26 Apr 2017)',
        url: 'https://oig.nasa.gov/docs/IG-17-018.pdf',
      },
      {
        title: 'Apollo 17: Mission Details (NASA, updated 29 Sep 2023)',
        url: 'https://www.nasa.gov/missions/apollo/apollo-17-mission-details/',
      },
    ],
  },
  {
    id: 'lunar_drill',
    topic: 'worlds',
    image: 'img-apollo17-drill',
    en: {
      title: 'Drilling the Moon',
      body: 'On the last three Apollo missions, astronauts dug into the Moon with a battery-powered drill that spun and hammered at the same time. Its hollow tubes brought back columns of Moon soil 2 to 3 metres long. The Curiosity rover’s drill on Mars makes much smaller holes: 1.6 cm wide and about 6.5 cm deep.',
      numbers: [
        ['Apollo soil cores', '2 to 3 m long'],
        ['Curiosity drill hole', '1.6 cm wide, about 6.5 cm deep'],
      ],
    },
    ru: {
      title: 'Бурение Луны',
      body: 'В последних трёх полётах Apollo астронавты бурили Луну электродрелью с батареей, которая одновременно вращалась и стучала, как перфоратор. Её полые трубки достали столбики лунного грунта длиной 2–3 метра. Бур марсохода Curiosity делает на Марсе отверстия гораздо меньше: шириной 1,6 см и глубиной около 6,5 см.',
      numbers: [
        ['Керны Apollo', 'длиной 2–3 м'],
        ['Отверстие бура Curiosity', '1,6 см в ширину, около 6,5 см в глубину'],
      ],
    },
    sources: [
      {
        title: 'Drilling Tasks (’Working on the Moon’ pages on NASA’s Apollo Lunar Surface Journal site, last revised 15 Mar 2014)',
        url: 'https://www.nasa.gov/wp-content/uploads/static/history/alsj/WOTM/WOTM-Drilling.html',
      },
      {
        title: 'Sample-Collection Drill Hole on Martian Sandstone Target ‘Windjana’ (NASA Science, 6 May 2014)',
        url: 'https://science.nasa.gov/resource/sample-collection-drill-hole-on-martian-sandstone-target-windjana/',
      },
    ],
  },
  {
    id: 'regolith_bricks',
    topic: 'worlds',
    en: {
      title: 'Bricks from Moon dust',
      body: 'Bricks for a Moon base could be made from Moon dust and sunshine. In 2017 a team in Europe used 147 curved mirrors to focus sunlight and bake look-alike Moon dust at 1000 °C, one layer of 0.1 mm at a time. A brick 20 × 10 × 3 cm took about five hours and came out as strong as gypsum (plaster).',
      numbers: [
        ['Mirrors', '147'],
        ['Baking heat', '1000 °C'],
        ['Time for one brick', 'about 5 hours'],
      ],
    },
    ru: {
      title: 'Кирпичи из лунной пыли',
      body: 'Кирпичи для лунной базы можно сделать из лунной пыли и солнечного света. В 2017 году европейские учёные собрали солнечные лучи с помощью 147 изогнутых зеркал и запекали искусственную лунную пыль при 1000 °C, слой за слоем толщиной по 0,1 мм. Кирпич размером 20 × 10 × 3 см печатался около пяти часов и получился прочным, как гипс.',
      numbers: [
        ['Зеркал', '147'],
        ['Температура', '1000 °C'],
        ['Время на один кирпич', 'около 5 часов'],
      ],
    },
    sources: [
      {
        title: 'Printing bricks from moondust using the Sun’s heat (ESA, Enabling & Support / Space Engineering & Technology, 3 May 2017)',
        url: 'https://www.esa.int/Enabling_Support/Space_Engineering_Technology/Printing_bricks_from_moondust_using_the_Sun_s_heat',
      },
    ],
  },
  {
    id: 'moon_metal',
    topic: 'worlds',
    image: 'img-lunar-basalt-micrograph',
    en: {
      title: 'Metal in the soil',
      body: 'Moon soil is made of the same main elements as rocks on Earth, including the metals aluminium and iron. The highlands are rich in a mineral full of aluminium, the dark lava plains contain ilmenite, made of iron, titanium and oxygen, and tiny meteorite hits have even left specks of iron metal, far too small to see. Mars looks red because iron in its dust has rusted.',
      numbers: [
        ['Moon lava plains', 'ilmenite: iron, titanium, oxygen'],
        ['Mars looks red because', 'its iron has rusted'],
      ],
    },
    ru: {
      title: 'Металл в грунте',
      body: 'Лунный грунт состоит из тех же главных элементов, что и камни на Земле, в том числе из металлов — алюминия и железа. На лунных возвышенностях много минерала, богатого алюминием, в тёмных лавовых равнинах есть ильменит — минерал из железа, титана и кислорода, а крошечные метеориты при ударах даже оставили в пыли частички металлического железа, слишком маленькие, чтобы их разглядеть. Марс выглядит красным, потому что железо в его пыли заржавело.',
      numbers: [
        ['Лунные лавовые равнины', 'ильменит: железо, титан, кислород'],
        ['Марс красный, потому что', 'его железо заржавело'],
      ],
    },
    sources: [
      {
        title: 'Lunar Regolith Simulant User’s Guide, Revision A (NASA/TM-20240011783; Slabic, Gruener, Kovtun, Rickman et al.; NASA JSC/MSFC, October 2024)',
        url: 'https://ntrs.nasa.gov/api/citations/20240011783/downloads/Lunar_Regolith_Simulant_Users_Guide_Rev_A_28OCT.pdf',
      },
      {
        title: 'Mars: Facts (NASA Science, page last updated 10 Jul 2026)',
        url: 'https://science.nasa.gov/mars/facts/',
      },
    ],
  },
];
