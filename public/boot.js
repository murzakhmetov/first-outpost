/* First Outpost loading screen: its language, one space fact, and a message if the game cannot start.
   A separate file (not inline in index.html), so the site can forbid inline scripts. */
// The loading screen speaks the player's language and shares one space fact.
(function () {
  var lang = 'en';
  try {
    lang = localStorage.getItem('fo.lang') || '';
  } catch (error) {
    lang = '';
  }
  if (lang !== 'en' && lang !== 'ru') {
    var first = ((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase();
    // The same languages as the game (src/i18n/index.ts): Russian for these, English for the rest.
    lang = /^(ru|be|uk|kk|ky|uz|tg|hy|az)/.test(first) ? 'ru' : 'en';
  }
  var facts = {
    en: [
      'A trip to the Moon takes about three days. A trip to Mars takes seven to ten months.',
      'On the Space Station, 98% of the water is used again.',
      'A day on Mars is called a sol. It is about 40 minutes longer than a day on Earth.',
      'On the Moon you weigh six times less than on Earth.',
      'A radio message from Earth needs 3 to 22 minutes to reach Mars.',
      'Sunsets on Mars are blue.',
    ],
    ru: [
      'До Луны лететь около трёх дней. До Марса — от семи до десяти месяцев.',
      'На космической станции 98% воды используют снова.',
      'Сутки на Марсе называют «сол». Они примерно на 40 минут длиннее земных.',
      'На Луне ты весишь в шесть раз меньше, чем на Земле.',
      'Радиосообщение с Земли идёт до Марса от 3 до 22 минут.',
      'Закаты на Марсе голубые.',
    ],
  };
  var list = facts[lang];
  var tip = document.getElementById('boot-tip');
  var label = document.createElement('b');
  label.textContent = lang === 'ru' ? 'А ты знаешь?' : 'Did you know?';
  tip.appendChild(label);
  tip.appendChild(document.createTextNode(list[Math.floor(Math.random() * list.length)]));
  if (lang === 'ru') {
    document.getElementById('boot-name').textContent = 'Первый форпост';
    document.documentElement.lang = 'ru';
  }
  // If the game's code cannot start (no connection, a blocked file, a very old browser),
  // say so after a while instead of showing the loading bar for ever.
  window.setTimeout(function () {
    if (window.__foStarted) return;
    var line = document.getElementById('boot-tip');
    if (!line) return;
    line.textContent = lang === 'ru'
      ? 'Игра всё ещё загружается. Если долго ничего не меняется, проверь интернет и обнови страницу.'
      : 'Still loading. If nothing changes for a long time, check the internet connection and reload the page.';
  }, 45000);
})();
