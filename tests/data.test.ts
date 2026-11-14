/**
 * The live NASA data layer (src/game/data.ts): a bad or empty answer from DONKI never replaces
 * the real storms the game already has, and a copy is only called "live" after a real request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type FakeAnswer = { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };

function answer(body: string, status = 200): FakeAnswer {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) };
}

/** A fresh copy of the module for each test (it keeps its data in module variables). */
async function freshData(donki: (url: string) => FakeAnswer) {
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    const address = String(url);
    if (address.includes('spaceweather-latest.json')) return answer('', 404);
    return donki(address);
  });
  const data = await import('../src/game/data');
  await data.loadData();
  return data;
}

const today = new Date().toISOString().slice(0, 10);
const from = new Date(Date.parse(today + 'T00:00:00Z') - 83 * 86_400_000).toISOString().slice(0, 10);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('live DONKI data', () => {
  it('an error message instead of a list keeps the stored storms and is not called live', async () => {
    const data = await freshData(() => answer('{"error":{"code":"OVER_RATE_LIMIT","message":"try later"}}'));
    const days = () => Object.keys(data.simData().sun).filter((day) => day >= from).length;
    const before = days();
    expect(await data.refreshLive()).toBe(false);
    expect(days()).toBe(before);
    expect(data.dataInfo.value.live).toBe(false);
  });

  it('twelve weeks with no record of any kind count as a failed request', async () => {
    const data = await freshData(() => answer(''));
    const days = () => Object.keys(data.simData().sun).filter((day) => day >= from).length;
    const before = days();
    expect(await data.refreshLive()).toBe(false);
    expect(days()).toBe(before);
    expect(data.dataInfo.value.live).toBe(false);
  });

  it('a real answer is merged and called live', async () => {
    const flare = JSON.stringify([
      { flrID: `${today}T01:00:00-FLR-001`, beginTime: `${today}T01:00Z`, peakTime: `${today}T01:10Z`, classType: 'X1.2', link: 'https://example.invalid' },
    ]);
    const data = await freshData((url) => (url.includes('/FLR?') ? answer(flare) : answer('[]')));
    expect(await data.refreshLive()).toBe(true);
    expect(data.dataInfo.value.live).toBe(true);
    expect(data.dataInfo.value.sunTo).toBe(today);
  });
});
