/**
 * A build or a room win that is still in flight when the commander goes on to another daytime stage is still
 * good: docs/MULTIPLAYER.md says build, print and room games work in any daytime stage, so only day or night
 * guards them, never the exact stage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILDINGS } from '../src/sim/outpost';
import { commanderAndGuest } from './coop-review-session';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a free intent that crosses a stage change', () => {
  it('a build sent in the briefing and delivered after Go on is made', async () => {
    const r = await commanderAndGuest();
    await r.clock.advance(500);
    expect(r.host.co.stage).toBe('briefing');
    r.guest.submit({ k: 'build', id: BUILDINGS[0].id });
    r.clock.t += 21_000;
    expect(r.host.submit({ k: 'go' })).toBe('ok');
    expect(r.host.co.stage).not.toBe('briefing');
    await r.clock.advance(3000);
    expect(r.host.co.mission.buildings?.some((b) => b.id === BUILDINGS[0].id)).toBe(true);
    expect(r.guest.pending).toBe(0);
  });

  it('a room win sent in the briefing and delivered after Go on is paid', async () => {
    const r = await commanderAndGuest();
    await r.clock.advance(500);
    r.guest.submit({ k: 'room', room: 'hab', game: 'pipes' });
    r.clock.t += 21_000;
    expect(r.host.submit({ k: 'go' })).toBe('ok');
    await r.clock.advance(3000);
    expect(r.host.co.mission.now.games ?? []).toContain('hab:pipes');
    expect(r.guest.pending).toBe(0);
  });
});
