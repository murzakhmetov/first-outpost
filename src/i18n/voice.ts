/**
 * Texts of the voice (see game/voice.ts): settings labels and credits, and the spoken
 * versions of lines that show numbers or names on screen. Same rules as en.ts / ru.ts.
 *
 * `voice.<key>` is what the voice SAYS for the line `<key>` when the shown line has {placeholders}.
 * It never has a number or a name in it: the player's name is never sent to a voice service.
 */
export const voiceEn: Record<string, string> = {
  'set.voice': 'Voices',
  'set.voiceHint': 'Mission Control, the storyteller and Lumi speak out loud. Their voices are made by a computer.',
  'set.autoSpeak': 'Lumi speaks by itself',
  'set.autoSpeakHint': 'Off: Lumi speaks only when you tap the speaker.',
  'about.voiceCredit': 'Voices made with ElevenLabs (free plan, used non-commercially). The voices are synthetic: made by a computer, not by real people.',

  // ----- Film lines whose screen text shows a number or a name -----------
  'voice.story.mars.1': 'Mars. Nobody has ever lived here.',
  'voice.story.moon.1': 'The south pole of the Moon. Nobody has ever lived here.',
  'voice.story.mars.2': 'Cadet, this is Mission Control. After seven months in space, you are cleared to land!',
  'voice.story.moon.2': 'Cadet, this is Mission Control. After a few days in space, you are cleared to land!',
  'voice.story.mars.5': 'Your mission: live here, keep the crew safe, and find out as much about Mars as you can.',
  'voice.story.moon.5': 'Your mission: live here, keep the crew safe, and find out as much about the Moon as you can.',
  'voice.story.mars.9': 'One more thing: our radio takes many minutes to reach you, so we cannot help in a hurry. Out there, you are in charge. Good luck!',
  'voice.film.task.earth.say.mars': 'You can ask Mission Control for advice. But from Mars the radio needs many minutes each way, so the answer comes late.',

  // ----- Lumi lines with numbers or names ---------------------------------
  'voice.lumi.welcome.mars': 'Welcome to Mars! Your crew is counting on you. I will help.',
  'voice.lumi.welcome.moon': 'Welcome to the Moon! Your crew is counting on you. I will help.',
  'voice.lumi.plan.airLow': 'Careful: with this plan the air drops.',
  'voice.lumi.plan.foodLow': 'Food is running low. Is the greenhouse growing?',
  'voice.lumi.plan.waste': 'Some power cells will be wasted. Spend them!',
  'voice.lumi.build.ordered': 'Good choice! The builder robot needs power cells for this building. Give it cells in the plan.',

  // ----- Event cards whose screen text shows a date, a number of minutes or a speed ----
  'voice.ev.plants_sick.ra.mars': 'The question needed many minutes to reach Earth, and the answer needed as long to come back. By then some plants were lost.',
  'voice.ev.plants_sick.ra.marsNear': 'Mars is close to Earth these weeks, so the answer came back fast: more fans, cut off the bad leaves. The plants were saved.',
  'voice.ev.school_call.ra.mars': 'The video will take many minutes to arrive. Their reply will take just as long.',
  'voice.ev.solar_storm.body.moon': 'The Sun has thrown out a cloud of very fast particles. NASA satellites near Earth and the Moon measured this real storm. Thin walls cannot stop it.',
  'voice.ev.solar_storm.body.rad': 'A solar storm is hitting Mars. NASA’s Curiosity rover measured this real storm on the ground.',
  'voice.ev.solar_storm.body.cme': 'NASA’s computer model shows a solar eruption on its way to Mars, and it is fast. Fast eruptions push a wave of particles ahead of them.',
  'voice.ev.cold_snap.body.mars': 'The nights will get very cold. NASA’s Curiosity rover really measured this cold on Mars. The heaters need more power.',
  'voice.ev.eclipse.body': 'People on Earth saw a total eclipse of the Moon. From here it looks different: Earth slides in front of the Sun, with a thin red ring around it. For a few hours no sunlight reaches the panels.',
  'voice.ev.school_call.body.moon': 'Children on Earth want to ask the crew questions. Radio takes only a few seconds each way, so you can chat with short pauses.',
  'voice.ev.school_call.body.mars': 'Children on Earth want to ask the crew questions. But today radio takes many minutes each way. You cannot chat. You can only send a video message.',
};

export const voiceRu: Record<string, string> = {
  'set.voice': 'Голоса',
  'set.voiceHint': 'Центр управления, рассказчик и Люми говорят вслух. Их голоса создал компьютер.',
  'set.autoSpeak': 'Люми говорит без нажатия',
  'set.autoSpeakHint': 'Выключено: Люми говорит, только когда нажмёшь на динамик.',
  'about.voiceCredit': 'Голоса сделаны в ElevenLabs (бесплатный тариф, некоммерческое использование). Голоса синтетические: их создал компьютер, а не живые люди.',

  'voice.story.mars.1': 'Марс. Здесь ещё никто никогда не жил.',
  'voice.story.moon.1': 'Южный полюс Луны. Здесь ещё никто никогда не жил.',
  'voice.story.mars.2': 'Кадет, на связи Центр управления. Семь месяцев полёта позади — посадку разрешаем!',
  'voice.story.moon.2': 'Кадет, на связи Центр управления. Несколько дней полёта позади — посадку разрешаем!',
  'voice.story.mars.5': 'Твоя задача: прожить здесь всю миссию, сберечь экипаж и узнать о Марсе как можно больше.',
  'voice.story.moon.5': 'Твоя задача: прожить здесь всю миссию, сберечь экипаж и узнать о Луне как можно больше.',
  'voice.story.mars.9': 'И ещё: наше радио идёт до вас много минут, быстро помочь мы не сможем. На месте решаешь ты. Удачи!',
  'voice.film.task.earth.say.mars': 'Можно спросить совета у Центра управления. Но с Марса радио идёт много минут в одну сторону, поэтому ответ приходит поздно.',

  'voice.lumi.welcome.mars': 'Добро пожаловать на Марс! На тебя рассчитывает весь экипаж. Я помогу.',
  'voice.lumi.welcome.moon': 'Добро пожаловать на Луну! На тебя рассчитывает весь экипаж. Я помогу.',
  'voice.lumi.plan.airLow': 'Осторожно: с таким планом воздух упадёт.',
  'voice.lumi.plan.foodLow': 'Еды осталось мало. В теплице что-нибудь растёт?',
  'voice.lumi.plan.waste': 'Часть ячеек энергии пропадёт. Лучше потрать их!',
  'voice.lumi.build.ordered': 'Отличный выбор! Роботу нужны ячейки энергии для этого здания. Дай ему ячейки в плане.',

  'voice.ev.plants_sick.ra.mars': 'Вопрос летел до Земли много минут, и ответ летел обратно столько же. За это время часть растений начала гибнуть.',
  'voice.ev.plants_sick.ra.marsNear': 'В эти недели Марс близко к Земле, и ответ пришёл быстро: включить больше вентиляторов и срезать больные листья. Растения спасены.',
  'voice.ev.school_call.ra.mars': 'Видео долетит не сразу, через много минут. Ответ детей будет лететь столько же.',
  'voice.ev.solar_storm.body.moon': 'Солнце выбросило облако очень быстрых частиц. Это настоящая буря: её измерили спутники NASA возле Земли и Луны. Тонкие стены её не остановят.',
  'voice.ev.solar_storm.body.rad': 'На Марс обрушилась солнечная буря. Это настоящая буря: её измерил на поверхности марсоход NASA Curiosity.',
  'voice.ev.solar_storm.body.cme': 'Компьютерная модель NASA показывает: до Марса идёт солнечный выброс, и он быстрый. Быстрые выбросы гонят перед собой волну частиц.',
  'voice.ev.cold_snap.body.mars': 'Ночью станет очень холодно. Такой холод на Марсе настоящий: его измерил марсоход NASA Curiosity. Обогревателям нужно больше энергии.',
  'voice.ev.eclipse.body': 'Люди на Земле видели полное лунное затмение. Отсюда всё выглядит иначе: Земля наползает на Солнце, а вокруг неё светится тонкое красное кольцо. Несколько часов на панели не попадает солнечный свет.',
  'voice.ev.school_call.body.moon': 'Дети на Земле хотят задать экипажу вопросы. Радиосигнал летит всего несколько секунд в одну сторону, так что можно разговаривать с короткими паузами.',
  'voice.ev.school_call.body.mars': 'Дети на Земле хотят задать экипажу вопросы. Но сегодня радиосигнал летит в одну сторону много минут. Поговорить не получится. Можно только отправить видеосообщение.',
};
