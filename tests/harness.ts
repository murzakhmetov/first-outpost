/** Shared fake World + browser shims for driving src/game/director.ts in Node. */
export const shims = (): void => {
  const store = new Map<string, string>();
  const g = globalThis as any;
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  g.window = globalThis;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.innerWidth = 1280;
  g.innerHeight = 800;
  g.matchMedia = () => ({ matches: false });
  g.document = {
    documentElement: { style: { setProperty() {} }, lang: 'en' },
    body: { classList: { toggle() {}, add() {}, contains() { return false; } } },
    hidden: false,
    createElement() { throw new Error('no DOM in this test'); },
  };
};

/** Mirrors the parts of src/world/world.ts the director talks to. */
export class FakeWorld {
  site: 'mars' | 'moon' = 'mars';
  mode = 'overview';
  paused = false;
  calm = false;
  ready = true;
  calls: string[] = [];
  engine = { maxFps: 60, quality: { tier: 'medium' }, setViewShift() {} };
  input = { onFirstGesture: null as null | (() => void) };
  eva: any = {
    active: false, onHud: null, onEvent: null, onFinish: null, alertLevel: 0,
    abort: () => { this.eva.active = false; },
    leave: () => {
      if (!this.eva.active) return;
      this.eva.active = false;
      this.eva.onFinish?.({ seconds: 20, samples: 0, science: 0, chore: false, caught: false, alerted: false, finds: [], materials: { regolith: 0, metal: 0 } }, 'recall');
    },
    recall: () => { this.eva.leave(); return true; },
  };
  interior: any = { onHud: null, onUse: null, onStep: null, active: false, setDone() {} };
  annex = { ghost: () => ({}), colliderOf: () => null };
  placer: any = { onChange: null, onPlace: null, active: false, start() { this.active = true; }, stop() { this.active = false; }, rotate() {}, confirm() { return false; } };
  astronaut = { play: (e: string) => this.calls.push('astronaut.play:' + e) };
  onCine: any = null;
  onSight: any = null;
  evaConfig: unknown = null;
  private clock = 0.4;
  private clockGoal = 0.4;
  private clockSpeed = 0;
  private clockDone: null | (() => void) = null;
  build(site: 'mars' | 'moon') { this.site = site; this.calls.push('build:' + site); }
  start() {}
  refreshModels() {}
  setSuitColor() {}
  setView() {}
  setOutpost() {}
  setDecor() {}
  setMood() {}
  setQuality() {}
  setCrewOutside() {}
  setWeather() {}
  dustDevilAcrossPanels() {}
  setMode(mode: string) { this.mode = mode; this.calls.push('setMode:' + mode); }
  lookAt(spot: string) { this.mode = 'focus'; this.calls.push('lookAt:' + spot); }
  startEva(config: unknown) { this.mode = 'eva'; this.eva.active = true; this.calls.push('startEva'); this.evaConfig = config; }
  enterRoom(room: string) { this.interior.active = true; this.calls.push('enterRoom:' + room); }
  leaveRoom() { if (!this.interior.active) return; this.interior.active = false; this.calls.push('leaveRoom'); }
  startCinema(landing: boolean) { this.calls.push('startCinema:' + landing); }
  shake(amount: number) { this.calls.push('shake:' + amount); }
  cinematic(shot: string) { this.calls.push('cinematic:' + shot); }
  endCinematic() { this.calls.push('endCinematic'); }
  stats() { return { fps: 60, calls: 0, triangles: 0, scale: 1 }; }
  setClock(value: number) { this.clock = this.clockGoal = value; this.clockSpeed = 0; const done = this.clockDone; this.clockDone = null; done?.(); }
  getClock() { return this.clock; }
  /** Same as World.hurryClock. */
  hurryClock(seconds = 0.35) { if (this.clockDone && this.clockSpeed !== 0) this.clockSpeed = (this.clockGoal - this.clock) / Math.max(0.01, seconds); }
  /** Same as World.runClock (world.ts:583-594). */
  runClock(to: number, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.clockDone?.();
      this.clockGoal = to;
      this.clockSpeed = (to - this.clock) / Math.max(0.01, seconds);
      if (this.clockSpeed === 0) { resolve(); return; }
      this.clockDone = resolve;
    });
  }
  /** One frame of World.update's clock part (world.ts:633-654): inside a room nothing runs, a pause stops the clock. */
  frame(dt: number): void {
    if (this.interior.active) return;
    if (this.clockSpeed !== 0 && !this.paused) {
      this.clock += this.clockSpeed * dt;
      const arrived = (this.clockSpeed > 0 && this.clock >= this.clockGoal) || (this.clockSpeed < 0 && this.clock <= this.clockGoal);
      if (arrived) { this.clock = this.clockGoal; this.clockSpeed = 0; const done = this.clockDone; this.clockDone = null; done?.(); }
    }
  }
}
