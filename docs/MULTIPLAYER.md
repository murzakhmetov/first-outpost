# Crew mode (play with friends)

Crew mode lets up to four friends fly the very same mission and compare their crews at the end.
It is **opt-in**, it has **no chat and no typed names**, and the single-player game never needs it.

## What a child sees

- Title screen, **Play with friends**. The lobby page says the rules in plain words (the same words are in `src/i18n/crew.ts`):
  - It is your choice. Crew mode is off until you open it.
  - No chat. No typing names. You can only send small stickers.
  - You get a fun crew name, like "Cadet Comet" ("Кадет Комета").
  - Rooms are private. A friend needs your 6-letter room code.
  - Up to 4 players in a room.
  - Only game numbers travel: week, air, food, radiation, science, your suit colour, and where you walk outside.
  - No account. No ads. No tracking. Leave any time: your own game keeps working.
- **Make a room** gives a code such as `K7M2QX`. Friends type it under **Join**. Everybody presses **Ready**; the host picks world, level and length and presses **Start**.
- Everyone flies the same mission: the host's seed and start date go to every friend, so the real NASA space weather, the cards and the sunlight are identical.
- **Friends are in the world.** In a crew mission the two NPC cadets are gone and your friends' astronauts take their place, in each friend's suit colour (the NPCs come back in a solo game).
  - While a friend is on a walk you see them walk (their position is smoothed, and it snaps if they are more than 8 m away). A friend who drives the rover is drawn as the astronaut at the rover's place (no second rover is drawn: the rover is a physics model, and a copy is not cheap). The status message has no "in a building" field, so a friend indoors is noticed by silence: a friend who has just gone out is not drawn until their first position arrives (at most about a second), and if you hear nothing from a walking friend for 3 seconds (a building, or a poor connection) the astronaut goes indoors and the name tag goes. Friends use the same model detail as your own cadet (the light model on low and medium) and are never thinned out by the graphics level.
  - A friend who is not on a walk stands at one of three fixed places by the habitat plaza, with an emote (a drill while planning, a wave at the report). When their game is at night, when they have finished or gone, they are indoors (the NPC cadets also hide in storms; friends do not, so you always see where the crew is).
  - A small name tag floats over each friend (the preset crew name in your language, and a small icon: planning, outside, reading the report) when they are on the screen and within 60 m of what you look at (your walking cadet, or the outpost). A sticker a friend sends also shows as a bubble over their head for 3 seconds, as well as the toast.
  - The corner map shows friends as dots in their suit colour.
- **Weeks go on together.** After the report, **Next week** waits for friends who are still behind (connected, not finished, in an earlier week or at an earlier step of the same week). It says who ("Waiting for the crew: Cadet Comet") and has a **Don't wait** button; it goes on by itself as soon as nobody is behind. A friend who left, finished or lost the connection is never waited for. The last week's **Finish** does not wait (the review shows who is still playing). Solo play is not changed. This is a deliberate change to the "race" mode (each their own base) from before the live avatars: the friends' astronauts, name tags, stickers over heads and this wait all run in it, because the crew is the only multiplayer mode today. The wait is the one place where race mode can hold a player back, so it always has **Don't wait**. When the shared-base mode arrives it keeps its own rules.
- In the game a small **Friends** button opens a dock with each friend's week, air, food, radiation and science, and eight stickers
  (Great, Hooray!, Shield up!, Plants!, Need power, Wow!, Thanks!, Oops). A sticker arrives as a small toast. Stickers are limited to one per second.
- On the debrief a table compares the crews: who kept the crew safest (finished, lowest share of the radiation limit), most science, most stars, and one line per friend about their biggest solar-storm choice
  (took cover / shield on / worked through it / no big storm).
- Offline or blocked network: the lobby says so ("No connection... Your own game still works"). Leaving a room, or going back to the title screen, ends the crew; the single-player flow is not touched.
- One thing crew mode does change: a crew mission is saved like any mission, so it replaces an earlier saved solo mission (the lobby warns about it when a saved mission exists). Your next solo setup (world, level, length) is put back to what it was.

## What goes over the network

| What | Form | Shown as |
| --- | --- | --- |
| A random id of this visit | 10 letters/digits, new every time, never saved | nothing (it is only a key) |
| Crew name | a number 0-15 (place in the preset list) | text from `src/i18n/crew.ts`, in the viewer's language |
| Suit colour | a number 0-5 | a coloured dot |
| Ready / host / started flags | booleans | tags in the lobby |
| Mission choice (host only) | world, level, 6 or 10 weeks, a real-history window id, seed, start date | nothing |
| Status | week, step, air, food, radiation, radiation limit, science, stars, how it ended, the strongest storm so far (week, strength, took cover?, dose the shield saved) | the dock and the debrief |
| Sticker | an id from a fixed list of 8 | preset text |
| Position | x and z in game metres, heading in radians, and a mode: 0 standing, 1 walking, 2 driving the rover | the friend's astronaut in your world and a dot on the corner map. Sent only while the player is on a walk outside (never at the base, in a building, or at night), at most 5 a second, only when it changed, and once a second as a keepalive. It is a place in the game's own world, not a place on Earth |

Nothing the player typed is sent: not their name (the typed cadet name from the Setup screen stays on the device), not their saved progress, not their location. There is no account, no cookie, no analytics. The id changes on every visit, so nobody can be followed from one day to the next.
Every incoming message is checked (`src/net/protocol.ts`): known event, exact shape, number ranges, at most 700 characters; anything else is dropped. Even a hand-made client cannot put words on another child's screen, because the network carries numbers and ids, and the text always comes from the viewer's own language file.

### Honest limits (the trust model)

The channel is public and has no accounts, so the network cannot tell who sent a message. What the game does about it:

- **The room code is the only door.** There is no password. Anyone who learns the code can join an open lobby (31 letters and digits, 6 places, about 887 million codes). Share it only with friends.
- **Only the host can start the mission.** The start is not a message that anyone can send or replay: it is a part of the host's own presence entry (`s` and `p`), and a guest reads it only from the host it locked in when it joined. A stranger who claims to be the host (`h`) is ignored by guests already in the room, and a joiner who finds two hosts in a room refuses to join. Because a presence key is chosen by the client, a stranger could also use the host's id as the key; an id that is used by two different entries is believed for neither, so nobody can speak in the host's name (the price is that such a lobby closes). Not covered: a stranger who copies the host's entry exactly, under the host's key, and waits for the real host's connection to drop for a moment; they could then start a mission for the guests (a real mission from the preset list, never text). This needs a modified client, the room code and exact timing.
- **The host decides who has a seat.** The host lists the seated players (at most four) in its presence; everyone shows exactly that list, so a modified client cannot squeeze in as a fifth player or push a friend out by claiming an early arrival time. A seated stranger cannot be removed by the host in this version (the host can leave and make a new room).
- **Spoofing a friend is still possible.** Someone who knows the code can send stickers or numbers under a friend's id (ids are visible in presence), or use a friend's id as their own key; the "two entries, believe neither" rule then removes that friend from the seat list and the host gives the seat to the next joiner. The worst results are a wrong number, a preset sticker, a friend shown as "finished", or a friend losing a seat. No text can be forged: only numbers and preset ids exist on the wire.
- **A flaky connection can cost a seat.** The same rule applies if a player's own old connection is still listed with different details after an unclean reconnect (it clears by itself after a short while). In the lobby that player may be told the room is full, and can join again.
- **After the start** a room refuses newcomers (their own copy refuses itself; a raw listener who knows the code could still read the numbers, which are not personal). Only the host's own flag says whether the mission has started; a stranger's flag proves nothing.
- A stranger who sits in the lobby without pressing Ready can keep the host from starting. The host can leave and make a new room with a new code.
- Rate limits, sizes and room rules are enforced by every player's copy of the game. A modified client can spam only what other clients drop.
- The Supabase operator can see connection metadata (IP address, time, room code), as any web host can. The game itself writes no table and keeps nothing on the server: it only uses Realtime broadcast and presence.

## Protocol

Transport: Supabase Realtime, one channel per room, `fo-crew-<CODE>`, with `broadcast: { self: false }` and presence keyed by the random player id.
Every broadcast payload carries `from` (the sender's id). The start of the mission is not an event: it travels in the host's presence (see the first row). Events:

| Event | Sent by | Payload | Notes |
| --- | --- | --- | --- |
| presence | everyone | `{ id, n, c, r, h, s, t, v, m, p }` name index, suit index, ready, host, started, join time, protocol version; host only: the seat list `m` (at most 4 ids) and, once started, the mission `p = { choice: { site, difficulty, weeks, windowId }, seed, startDate }` | the lobby list and the start; `id` must equal the presence key; `startDate` must be the one the window gives |
| `status` | each player | `{ from, week, step, air, food, dose, doseLimit, science, stars, end, storm: { w, s, k, a } }` | at most 2 per second, latest wins, unchanged status is not resent |
| `final` | each player, once | same as `status` | marks the friend as finished |
| `react` | each player | `{ from, id }` | `id` is one of `great hooray shield plants power wow thanks oops`; at most 1 per second |
| `pos` | each player, on a walk only | `{ from, x, z, a, m }` metres (to 0.01, within 500), heading (within 10), `m` 0, 1 or 2 | at most 5 per second sent (16 per 2 s accepted); drawn by `src/world/friends.ts`; a position that is not numbers in these ranges is dropped |

Room rules, in `src/net/room.ts`: the host made the room; a joiner who finds no host (or two) sees "no room"; four seats at most, given out by the host (a fifth sees "room full"; a freed seat goes to the next joiner); nobody joins after the start; if the host leaves before the start the room closes after 3.5 seconds; after the start nothing changes when someone leaves (they are marked as gone and their last numbers stay for the debrief); only the host's presence can start the mission (once, and it is a state, so a friend who was busy or lost the connection a moment still gets it); inbound messages from seated players are rate-limited per sender (status 8 per 2 s, stickers 3 per 2 s); coming back after a lost connection re-sends our numbers within the same sending limit.

Code map:

- `src/net/protocol.ts` pure message types, validation, room codes, awards. No network, no screen.
- `src/net/follow.ts` the pure rules of the live avatars: smoothing, staleness, base slots, which friend is doing what, when a position is sent (`PositionSender`), who the next week waits for (`whoIsBehind`).
- `src/world/friends.ts` the friends' astronauts in the 3D world (uses `follow.ts`); `src/ui/CrewDock.tsx` also draws the name tags and sticker bubbles.
- `src/net/room.ts` the room as a state machine over a `Transport`.
- `src/net/transport.ts` the interface, `MemoryTransport` (tests), `LocalTransport` (two tabs, `?crew=local`).
- `src/net/supabase.ts` `SupabaseTransport`; the Supabase library itself is a separate chunk (about 23 kB), downloaded only when a room opens.
- `src/net/crew.ts` signals for the screens and the glue to the game (`startMission`, the `mission` signal). Nothing runs until a player opens crew mode.
- `src/ui/CrewLobby.tsx`, `CrewDock.tsx`, `CrewResults.tsx`, `crew.css`, texts in `src/i18n/crew.ts`.

Crew missions use only the bundled real-history windows (`sunMode: 'featured'`), so every friend's game has exactly the same data even if one of them has fetched newer live data. The simulation never calls `Math.random`; `tests/crew.test.ts` plays whole missions twice with every test bot and checks they are identical.
`startMission` also saves the mission setup to the profile; crew mode puts the player's own setup back right after, so the next solo game is not changed.

## Try it on one computer

Open the game twice in the same browser with `?crew=local`, for example `http://localhost:5173/?crew=local`. The two tabs talk through `BroadcastChannel` (no internet needed). Make a room in one tab, join with the code in the other.

## Pointing it at another Supabase project

1. In the Supabase dashboard of your project, copy the project URL and the **publishable** (anon) key. Do not use a secret or service key; this key is shipped to every browser.
2. Broadcast and presence on public channels need no table and no policy. With the default Realtime settings of a new project they work as they do on the current project (checked with two clients: room, join, start, status, sticker).
3. Set the build variables (a `.env.local` file, or the Vercel project settings):

```
VITE_MP_URL=wss://YOUR-PROJECT-REF.supabase.co/realtime/v1
VITE_MP_KEY=sb_publishable_...
```

4. Allow the project in the Content Security Policy (`vercel.json`, `connect-src`), both the https and the wss host:

```
connect-src 'self' https://ccmc.gsfc.nasa.gov https://YOUR-PROJECT-REF.supabase.co wss://YOUR-PROJECT-REF.supabase.co;
```

The defaults in `src/net/config.ts` point at the project `wvhdhfddtusppjmsgmvn`. Setting `VITE_MP_URL=` or `VITE_MP_KEY=` to an empty value hides crew mode (the "Play with friends" button disappears), except in the developer mode `?crew=local`, which needs no network.

## Tests

`npx vitest run tests/follow.test.ts` tests the live avatars: the smoothing, slots and waiting rules, the position sender (5 a second, only when changed, keepalive) and a position through rooms on the in-memory network. `npx vitest run tests/crew-wait.test.ts` tests the week wait from `src/net/crew.ts` with real rooms and a counter for the director: it goes on at once when nobody is behind, waits and then goes on once, "Don't wait", holding while a menu, film or building is open, release when a friend leaves or finishes, leaving the report, and the last week. `npx vitest run tests/crew.test.ts` runs the rooms on an in-memory network with fake timers: join, lobby, start with the same seed, status flow, stickers, throttles, malformed and oversized messages, a pretend host, a pretend start, the same presence key used twice, flood, room full, host leaves, lost connection, and determinism of the mission. Not covered by automated tests: the real Supabase connection (checked by hand with up to five real clients: room, join, fifth player refused, ready, start, status, sticker), and the screens, including the 3D friends, name tags and the week wait (checked by hand in two browser tabs with `?crew=local`).
