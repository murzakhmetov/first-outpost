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
};

export const voiceRu: Record<string, string> = {
  'set.voice': 'Голоса',
  'set.voiceHint': 'Центр управления, рассказчик и Люми говорят вслух. Их голоса создал компьютер.',
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
};
