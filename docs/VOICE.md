# Voice-over

The films (Mission Control, the storyteller, Lumi) and Lumi's speech bubbles have recorded voices
made with [ElevenLabs](https://elevenlabs.io). The MP3 files are made once, on a developer's
machine, and shipped as static files in `public/voice/`. The game never calls ElevenLabs while
people play, and no key is ever in the bundle.

How it works in the game (`src/game/voice.ts`):

- `public/voice/manifest.json` lists the lines that have a file: `"<lang>:<text key>"` gives the file,
  the hash, the length and the speaker.
- Films play each beat's line and go on about half a second after it ends (a line with no file goes on
  after the usual reading time). Tap, Space and Skip work as before.
- Lumi's bubble has a speaker button. With "Read texts aloud" on, new lines play by themselves.
- A line with no file is read by the device's own voice only when "Read texts aloud" is on, as before.
- Setting `Voices` (on by default) switches the recorded voices off. Players can also turn off the
  sound effects volume, which silences the voice too (it uses that volume).
- Mission Control lines get a light radio filter. The music gets quieter while a line plays.

## Make or update the voices

You need Node 22.18+ (the repo uses Node 24) and an ElevenLabs API key.

1. Look at the plan first. It sends nothing and needs no key:

   ```bash
   npm run voice -- --dry-run
   ```

   It prints how many lines, characters and credits (0.5 credit per character with
   `eleven_v4_turbo`) each language and speaker needs, and which lines are left out.

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
| `--budget <credits>` | Size of the whole voiced set in credits (default 9000). |
| `--only films\|lumi` | Only the film lines, or only Lumi's bubble lines. |
| `--lang en\|ru` | Only one language. |
| `--model <id>` | Another model, for example `eleven_turbo_v2_5` if `eleven_v4_turbo` is refused. It must be listed with its price in `voices.json`. Every hash changes, so all lines are made again. |
| `--prune` | Also remove files and manifest entries that no line uses (whole plan only). |
| `--verbose` | List every line with its spoken text. |

### What is spoken, and the budget

- Every film beat of every film on both worlds, in both languages, then Lumi's bubble lines
  (`lumi.*` keys). The `{site}` part of a film key is resolved to `mars` and `moon`.
- Markup is cleaned: `**bold**` becomes the plain word, `[[term]]` becomes the glossary name, emoji go.
- A line that shows a number or the player's name (`{km}`, `{who}`, `{n}`...) cannot be sent as it is.
  Its spoken version is the text `voice.<original key>` in `src/i18n/voice.ts` (both languages),
  for example `story.mars.2` says "Cadet, this is Mission Control..." instead of the player's name.
  The name is never sent to any service. A Lumi line with `{params}` and no `voice.*` text is skipped:
  it keeps the browser voice.
- Priority when the budget is short: all film lines first, then Lumi's lines, the ones heard most often
  first (the order is `lumiPriority` in `scripts/voice/voices.json`: welcome and tutorial, the weekly plan
  hints, storms, reports, then the rare once-only facts). English and Russian of one line go in or out together.
- The budget counts every voiced line, also those made in earlier runs. So a second run costs nothing
  unless a text changed or you raised `--budget`. Raise it (for example `--budget 9600`) to add the next
  Lumi lines when more credits are available.
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
