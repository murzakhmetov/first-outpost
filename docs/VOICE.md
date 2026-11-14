# Voice-over

The films (Mission Control, the storyteller, Lumi), Lumi's speech bubbles and the event cards have recorded voices
made with [ElevenLabs](https://elevenlabs.io). The MP3 files are made once, on a developer's
machine, and shipped as static files in `public/voice/`. The game never calls ElevenLabs while
people play, and no key is ever in the bundle.

How it works in the game (`src/game/voice.ts`):

- `public/voice/manifest.json` lists the lines that have a file: `"<lang>:<text key>"` gives the file,
  the hash, the length and the speaker.
- Films play each beat's line and go on about half a second after it ends (a line with no file goes on
  after the usual reading time). Tap, Space and Skip work as before.
- Lumi speaks by itself (setting `Lumi speaks by itself`, on by default, see below).
- The speaker buttons of the event card (title, then body) and of the result card (result, then story) play
  the recorded lines one after another. `SpeakBtn` takes one voice key or a list of keys in reading order, and
  `parts`, the shown text of each key.
- Setting `Voices` (on by default) switches the recorded voices off.
- Films keep their own rule: a film line that has a recording plays it or stays silent (the device voice never
  reads it); a film line with no file is read by the device voice when "Read texts aloud" is on.

### One rule: when a recording plays and when the device voice reads

The same rule holds for Lumi's bubble, the card speaker buttons and the read-aloud texts. It is the pure function
`decide` in `src/game/voice.ts` (Lumi's bubble goes through `decideAutoSpeak`, which calls it), and `playLines`
follows it:

1. A **recording plays** when Voices is on, the line has a file, the file can be heard (the Sound effects slider is
   above 0) and it loads.
2. Otherwise the **device voice reads the shown text**, if the speaking setting for that text is on: `Lumi speaks
   by itself` for Lumi's lines, `Read texts aloud` for the rest (a tap on a speaker button is always a request to
   read). This covers: Voices off, a line with no file, the list of voices not loaded (or failed to load), Sound
   effects at 0, and a file that fails to load or start. With the setting off the line stays silent.
3. **One voice per line**, never both and never twice. A card whose file fails part-way reads only the parts not
   played yet with the device voice (the title was played, the body fails: only the body is read). A line that is
   already playing is not started again, and a tap on the speaker while it talks stops it.
4. With **Sound effects at 0 no manifest and no voice file is downloaded**: the recording could not be heard, so
   the device voice reads at once.

The "Sound effects" slider (`volume`) sets how loud the game sounds are, and the recorded voices count as game
sounds. It is not a master volume: it does not mute the device voice.

- Mission Control lines get a light radio filter. The music gets quieter while a line plays.

## Lumi speaks by itself

Setting `Lumi speaks by itself` (`autoSpeak` in `Settings`, on by default; an old save gets the default when it
is loaded). It sits in the settings panel next to "Voices". The decision is the small pure function
`decideAutoSpeak` in `src/game/voice.ts` (inputs: the two settings, whether the line has a file, whether a film
plays, the Sound effects volume; output: `'file'`, `'speech'` or `'none'`).

- ON: every new line in Lumi's bubble is spoken at once. With "Voices" on, a file for the line and Sound effects
  above 0, the recorded file plays. Otherwise (Voices off, no file, Sound effects at 0, or a file that fails) the
  device's voice reads the shown text, so Lumi is always heard. That includes the lines that show a name or a number: the device voice reads what is on screen,
  the recorded voice says the `voice.<key>` version.
- OFF: nothing plays until the speaker button on the bubble is tapped. A tap while the line talks stops it (also a
  line Lumi began by itself). Closing the bubble, or a new line / hush / timeout replacing it, stops Lumi's voice.
- In both cases: never over a film (films speak for themselves); one line at a time and a new line stops the
  old one; the same line is not spoken twice in a row within 12 seconds (a hint on every tap of the plan; a line that a film cut off is spoken again when it comes back).
- "Read texts aloud" keeps its meaning for the other texts (the cards, the panels). Lumi's bubble is handled by
  `Lumi speaks by itself` only, so the two settings never read a bubble twice.

## Make or update the voices

You need Node 22.18+ (the repo uses Node 24) and an ElevenLabs API key.

1. Look at the plan first. It sends nothing and needs no key:

   ```bash
   npm run voice -- --dry-run
   ```

   It prints how many lines, characters and credits (0.5 credit per character with
   `eleven_v4_turbo`) each language and speaker needs, then the plan per category (lines, characters, credits
   for films, Lumi, cards and the four parts of the cards) with the total, and which lines are left out.
   Use `--budget 60000` to see the whole set planned: with a small budget the last categories show up as
   "over budget", which is the planner doing its job, not a problem.

2. Generate. Put the key in the environment of your shell without typing it into the command line (a command
   typed with the key stays in the shell history):

   ```bash
   read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY   # Git Bash: paste the key, press Enter
   npm run voice
   unset ELEVENLABS_API_KEY
   ```

   On Windows PowerShell: `$env:ELEVENLABS_API_KEY = Read-Host`, then `npm run voice`. The script runs
   `node --use-system-ca`, so a TLS-inspecting proxy works. Never turn TLS checks off. Remember the `--`
   before the flags (`npm run voice -- --dry-run`); a bare `npm run voice --dry-run` is still treated as a dry run.

3. Commit `public/voice/` (the MP3 files and `manifest.json`).

Flags:

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Print the plan. No network, no files written, no key needed. |
| `--budget <credits>` | Size of the whole voiced set in credits (default 30000). |
| `--only films\|lumi\|cards` | Only the film lines, only Lumi's lines, or only the event-card lines. |
| `--lang en\|ru` | Only one language. |
| `--model <id>` | Another model, for example `eleven_turbo_v2_5` if `eleven_v4_turbo` is refused. It must be listed with its price in `voices.json`. Every hash changes, so all lines are made again. |
| `--prune` | Also remove files and manifest entries that no line uses (whole plan only). |
| `--verbose` | List every line with its spoken text. |

### What is spoken, and the budget

- Categories, in priority order:
  1. **films**: every film beat of every film on both worlds, in both languages. The `{site}` part of a film key
     is resolved to `mars` and `moon`.
  2. **lumi**: ALL the lines Lumi can say, on both worlds: every `lumi.*` key (Mars and Moon variants: keys
     ending `.mars` / `.moon`, the Moon-only lines, the Moon finds and looks) and the keys listed in
     `lumiExtra` in `voices.json` (`eva.edge`, which Lumi says at the edge of the walk). Inside the category the
     lines heard most often come first (the order is `lumiPriority` in `scripts/voice/voices.json`: welcome and
     tutorial, the weekly plan hints, storms, reports, then the rare once-only facts).
  3. **cards**: the texts the speaker buttons of the event cards read, with every variant (`.mars`, `.moon`,
     `.cme`, `.rad`, `.marsNear`), in this order: the **story** of each event (result card), then the **result**
     of each option (result card), then the **titles**, then the **bodies** (event card). They are read by the
     storyteller voice.
- Markup is cleaned: `**bold**` becomes the plain word, `[[term]]` becomes the glossary name, emoji go.
- A line that shows a number, a date or the player's name (`{km}`, `{who}`, `{n}`...) cannot be sent as it is.
  Its spoken version is the text `voice.<original key>` in `src/i18n/voice.ts` (both languages),
  for example `story.mars.2` says "Cadet, this is Mission Control..." instead of the player's name, and
  `ev.eclipse.body` leaves out the date. The name is never sent to any service. A line with `{params}` and no
  `voice.*` text is skipped: it keeps the device voice (the card then reads with the device voice as before).
  Today every Lumi line and every card text has a spoken version, so nothing is skipped. A Lumi key that is left
  out on purpose goes into `lumiSkip` in `voices.json` with the reason.
- Tests (`tests/voice-coverage.test.ts`) read the source for every `say(...)` call and every `lumi.*` key
  (literal keys and template keys such as `lumi.find.${id}`, expanded with the real ids of the finds, rooms,
  tools and buildings) and fail when a key Lumi can say is neither planned in both languages nor in `lumiSkip`.
  A new template key needs its list of ids in `EXPANSIONS` there. They also check that every planned `.mars`
  key has its `.moon` twin planned (and the other way) and that the cards read exactly the planned keys.
- Priority when the budget is short: films, then all Lumi lines, then card stories, then card results, then
  titles and bodies. English and Russian of one line go in or out together.
- The budget counts every voiced line, also those made in earlier runs. So a second run costs nothing
  unless a text changed or you raised `--budget`. Raise it to add the next lines when more credits are
  available.
- How much a full set costs: about 24,400 credits (films about 4,200, Lumi about 10,200, cards about 10,000).
  **One free ElevenLabs key gives 10,000 credits a month**, so a full set needs more than one month or more than
  one key (or a paid plan). Run `npm run voice` with the default budget once a month (or with each new key):
  lines already made cost nothing, and the plan takes the next lines in priority order, so the films come first,
  then Lumi, then the cards.
- Each file is named by a hash of the model, voice id, voice settings, language and text. A line whose
  text, voice or settings changed is made again; every other line is skipped. Two keys with the same
  text share one file.

If the API stops the run (bad key, quota used up, model refused), the script stops cleanly, keeps every
file it already made and writes the manifest. Run it again later.

## Change a voice

Open `scripts/voice/voices.json`. Each speaker has a `voiceId` and `settings` (stability,
similarity_boost, style, use_speaker_boost):

| Speaker | Who | Default voice |
| --- | --- | --- |
| `lumi` | Lumi, the robot helper: playful, bright | Jessica `cgSgspJ2msm6clMCkdW9` |
| `mc` | Mission Control: steady broadcaster | Daniel `onwK4e9ZLuTAKqWW03F9` |
| `caption` | The storyteller | George `JBFqnCBsd6RMkjVDRZzb` |

Swap the `voiceId` (one line), run `npm run voice -- --dry-run` to see the cost, then `npm run voice`.
Because the voice is part of the hash, all lines of that speaker are made again (and cost credits again).
Lumi's settings are a little more lively (lower stability, more style) than Mission Control's.

The model is `model` in the same file (`eleven_v4_turbo`, fallback `eleven_turbo_v2_5`); the credits per
character of each model are in `models`.

## Licence and credits

- On the ElevenLabs **free plan** the output is for **non-commercial** use and needs a credit to
  ElevenLabs. The game shows it in the About panel ("Voices made with ElevenLabs ... used
  non-commercially. The voices are synthetic"). If the game is ever used commercially, move to a paid plan
  and check the licence for the voices used (Jessica, Daniel, George are library voices).
- The voices are synthetic. Do not present them as real people.
- Free plan: 10,000 credits a month.

## Keeping the key safe

- The key lives only in the shell environment of the command (`ELEVENLABS_API_KEY`). The script reads
  it from `process.env`, sends it only in the `xi-api-key` header to `api.elevenlabs.io`, never prints
  it and never writes it to a file.
- Do not put it in `.env`, `.env.local` or any file that Vite or the repository could pick up. Do not
  name it `VITE_...`: Vite puts such variables into the public bundle.
- Players' names and other personal data are never sent: only the fixed texts of the game.

## Offline and caching

The build does not precache the voice files and leaves them out of its fingerprint, like the 3D models.
The service worker saves each MP3 the first time it is played (cache-first, in a cache of its own that
new builds do not delete: the files are named by their content). `voice/manifest.json` is fetched fresh
(newest first, saved copy when offline), so new voices appear without a new build of the game.

## Not checked by tests

The tests use a fake `fetch`: they prove the requests, the cache, the budget and that the key is never
written. They cannot prove how the voices sound, whether `eleven_v4_turbo` accepts `language_code` for
Russian, or the exact error bodies of the API. Listen to the files after the first real run.
