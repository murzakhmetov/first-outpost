/**
 * A Ready pressed on one power plan does not count for another: any change to the plan clears every Ready
 * ("The plan changed. Look again."), including a Ready that was still on its way when the plan changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseIntent } from '../src/sim/coop';
import { commanderAndGuest } from './coop-review-session';
import { pickOption } from './coop-rig';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function toPlan(r: Awaited<ReturnType<typeof commanderAndGuest>>): Promise<void> {
  for (let i = 0; i < 200 && r.host.co.stage !== 'plan'; i++) {
    const stage = r.host.co.stage;
    if (stage === 'event') {
      r.host.submit({ k: 'vote', o: pickOption(r.host.co.mission) });
      r.guest.submit({ k: 'vote', o: pickOption(r.host.co.mission) });
    } else {
      r.host.submit({ k: 'ready', on: true });
      r.guest.submit({ k: 'ready', on: true });
    }
    await r.clock.advance(500);
  }
  expect(r.host.co.stage).toBe('plan');
  await r.clock.advance(1500);
}

describe('ready against a plan that changed underneath it', () => {
  it('a Ready pressed on the old plan, arriving after the plan changed, is not counted', async () => {
    const r = await commanderAndGuest();
    await toPlan(r);
    const before = { ...r.host.co.mission.alloc };
    expect(r.guest.submit({ k: 'ready', on: true })).not.toBeNull();
    // Another child lowers one power row (a change that really alters the plan) before the guest's Ready arrives.
    const lower = (['life', 'farm', 'lab'] as const).find((id) => before[id] > 0)!;
    expect(r.host.submit({ k: 'alloc', a: { ...before, [lower]: before[lower] - 1 } })).toBe('ok');
    expect(r.host.co.mission.alloc).not.toEqual(before);
    await r.clock.advance(1000);
    expect(r.host.co.ready).not.toContain(r.guestId);
  });

  it('a Ready on the plan the commander still has is counted', async () => {
    const r = await commanderAndGuest();
    await toPlan(r);
    expect(r.guest.submit({ k: 'ready', on: true })).not.toBeNull();
    await r.clock.advance(1000);
    expect(r.host.co.ready).toContain(r.guestId);
  });

  it('the plan stamp is checked on the wire: a bad one is dropped whole', () => {
    const base = { from: 'abc1234567', n: 1, w: 1, s: 'plan', k: 'ready', on: true };
    expect(parseIntent({ ...base, a: { life: 1, farm: 1, lab: 1, shield: 1 } })).not.toBeNull();
    expect(parseIntent({ ...base, a: { life: 99, farm: 1, lab: 1, shield: 1 } })).toBeNull();
    expect(parseIntent(base)).not.toBeNull();
  });
});
