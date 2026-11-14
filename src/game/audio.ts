/**
 * All sound is made by code with the Web Audio API: no audio files.
 *
 * Small truths kept on purpose:
 *   - the Moon has no air, so outside you hear only your own suit;
 *   - Mars air is thin, so the wind is faint and muffled.
 */

import { has, t } from '../i18n';

export type Sfx =
  | 'click'
  | 'up'
  | 'down'
  | 'deny'
  | 'confirm'
  | 'card'
  | 'collect'
  | 'chore'
  | 'step'
  | 'jump'
  | 'land'
  | 'night'
  | 'harvest'
  | 'discover'
  | 'good'
  | 'bad'
  | 'win'
  | 'lose'
  | 'signal'
  | 'alarm'
  | 'blip'
  // Room games (src/ui/minigames, the printer):
  | 'star'
  | 'pop'
  | 'ratchet'
  | 'zap'
  | 'whoosh'
  | 'thunk';

export type Ambience = 'none' | 'base' | 'mars' | 'moonSuit' | 'storm';

const NOTE = (semitonesFromA4: number): number => 440 * 2 ** (semitonesFromA4 / 12);
// A minor pentatonic, one octave above A4: bright and never sour.
const BELL_NOTES = [0, 3, 5, 7, 10, 12, 15].map((n) => NOTE(n + 12));
const CHORDS = [
  [-24, -12, -9, -5, 3],
  [-28, -16, -9, -4, 0],
  [-21, -14, -9, -2, 2],
  [-26, -14, -7, -4, 5],
].map((chord) => chord.map(NOTE));

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambienceBus!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private ambienceNodes: AudioNode[] = [];
  private ambience: Ambience = 'none';
  private musicTimer = 0;
  private bellTimer = 0;
  private chordIndex = 0;
  private musicOn = false;
  private alarmTimer = 0;
  private sfxVolume = 0.8;
  private musicVolume = 0.5;
  private lastStep = 0;

  /** Browsers allow sound only after the player touches something. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.master.connect(limiter).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.ambienceBus.connect(this.master);

    // A soft echo for the music.
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    this.musicBus.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    damp.connect(this.master);

    // Two seconds of noise, reused for wind, steps and whooshes.
    const length = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // Slightly "pink": softer than plain white noise.
      last = last * 0.82 + (Math.random() * 2 - 1) * 0.18;
      data[i] = last * 3;
    }
    this.applyVolumes();
    this.setAmbience(this.ambience, true);
    if (this.musicOn) this.scheduleMusic();

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume * 0.9, now, 0.05);
    this.ambienceBus.gain.setTargetAtTime(this.sfxVolume * 0.5, now, 0.2);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.42, now, 0.2);
  }

  private tone(
    frequency: number,
    duration: number,
    options: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number; bus?: GainNode; attack?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const oscillator = ctx.createOscillator();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, start + duration);
    const gain = ctx.createGain();
    const peak = options.gain ?? 0.2;
    const attack = options.attack ?? 0.008;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(options.bus ?? this.sfxBus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  private noise(
    duration: number,
    options: { frequency?: number; q?: number; gain?: number; delay?: number; type?: BiquadFilterType; slideTo?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(options.frequency ?? 800, start);
    if (options.slideTo) filter.frequency.exponentialRampToValueAtTime(options.slideTo, start + duration);
    filter.Q.value = options.q ?? 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.2, start + Math.min(0.03, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.sfxBus);
    source.start(start, Math.random() * 1.5);
    source.stop(start + duration + 0.05);
  }

  /** Play a short sound. `value` changes the pitch or length for some sounds. */
  play(name: Sfx, value = 0): void {
    if (!this.ctx || this.sfxVolume <= 0) return;
    switch (name) {
      case 'click':
        this.tone(720, 0.07, { type: 'triangle', gain: 0.14, slideTo: 940 });
        break;
      case 'up':
        this.tone(NOTE(3 + value * 2), 0.11, { type: 'triangle', gain: 0.16 });
        this.tone(NOTE(10 + value * 2), 0.13, { type: 'sine', gain: 0.09, delay: 0.03 });
        break;
      case 'down':
        this.tone(NOTE(5 + value * 2), 0.12, { type: 'triangle', gain: 0.14, slideTo: NOTE(value * 2) });
        break;
      case 'deny':
        this.tone(190, 0.16, { type: 'square', gain: 0.07, slideTo: 150 });
        break;
      case 'confirm':
        this.tone(NOTE(3), 0.12, { type: 'triangle', gain: 0.16 });
        this.tone(NOTE(10), 0.2, { type: 'triangle', gain: 0.16, delay: 0.09 });
        break;
      case 'card':
        this.noise(0.25, { frequency: 1800, slideTo: 500, gain: 0.07 });
        this.tone(NOTE(-2), 0.3, { type: 'sine', gain: 0.14, delay: 0.05 });
        this.tone(NOTE(5), 0.4, { type: 'sine', gain: 0.12, delay: 0.16 });
        break;
      case 'collect': {
        const steps = [0, 4, 7, 12, 16].slice(0, 3 + Math.min(2, Math.floor(value / 2)));
        steps.forEach((semitone, index) =>
          this.tone(NOTE(semitone + 12), 0.22, { type: 'sine', gain: 0.16, delay: index * 0.07 }),
        );
        break;
      }
      case 'chore':
        [0, 5, 9, 12].forEach((semitone, index) =>
          this.tone(NOTE(semitone + 5), 0.2, { type: 'triangle', gain: 0.14, delay: index * 0.08 }),
        );
        break;
      case 'step': {
        const now = performance.now();
        if (now - this.lastStep < 110) return;
        this.lastStep = now;
        // value 1 = Moon: a dull thud felt through the boots, not heard through air.
        this.noise(0.08, { frequency: value ? 140 : 420, q: 0.8, gain: value ? 0.09 : 0.06, type: 'lowpass' });
        break;
      }
      case 'jump':
        this.tone(260, 0.2, { type: 'sine', gain: 0.1, slideTo: 520 });
        break;
      case 'land':
        this.noise(0.14, { frequency: 180, gain: 0.14, type: 'lowpass' });
        this.tone(110, 0.14, { type: 'sine', gain: 0.12, slideTo: 60 });
        break;
      case 'night':
        this.noise(1.6, { frequency: 300, slideTo: 2400, gain: 0.07, q: 0.6 });
        [0, 7, 12].forEach((semitone, index) =>
          this.tone(NOTE(semitone - 12), 1.6, { type: 'sine', gain: 0.08, delay: index * 0.35, attack: 0.4 }),
        );
        break;
      case 'harvest':
        [0, 4, 7, 11, 12].forEach((semitone, index) =>
          this.tone(NOTE(semitone + 3), 0.3, { type: 'triangle', gain: 0.14, delay: index * 0.09 }),
        );
        break;
      case 'discover':
        // A rising sparkle: something new was found.
        [0, 7, 12, 16, 19].forEach((semitone, index) =>
          this.tone(NOTE(semitone + 5), 0.42, { type: 'sine', gain: 0.13, delay: index * 0.075 }),
        );
        this.tone(NOTE(29), 0.7, { type: 'triangle', gain: 0.08, delay: 0.42 });
        break;
      case 'good':
        this.tone(NOTE(7), 0.14, { type: 'triangle', gain: 0.14 });
        this.tone(NOTE(12), 0.24, { type: 'triangle', gain: 0.14, delay: 0.1 });
        break;
      case 'bad':
        this.tone(NOTE(-5), 0.22, { type: 'triangle', gain: 0.14 });
        this.tone(NOTE(-9), 0.34, { type: 'triangle', gain: 0.14, delay: 0.14 });
        break;
      case 'win':
        [0, 4, 7, 12, 16, 19, 24].forEach((semitone, index) =>
          this.tone(NOTE(semitone), 0.5, { type: 'triangle', gain: 0.15, delay: index * 0.11 }),
        );
        break;
      case 'lose':
        [7, 3, 0, -5].forEach((semitone, index) =>
          this.tone(NOTE(semitone - 12), 0.6, { type: 'sine', gain: 0.15, delay: index * 0.22, attack: 0.05 }),
        );
        break;
      case 'signal':
        [0, 1, 2].forEach((index) =>
          this.tone(1320, 0.09, { type: 'sine', gain: 0.1, delay: index * 0.16 }),
        );
        break;
      case 'alarm':
        this.tone(880, 0.22, { type: 'square', gain: 0.06 });
        this.tone(660, 0.22, { type: 'square', gain: 0.06, delay: 0.24 });
        break;
      case 'blip':
        this.tone(NOTE(12 + (value % 5) * 2), 0.05, { type: 'sine', gain: 0.06 });
        break;
      case 'star': {
        // A bright chime for each star of a result; `value` 0, 1, 2 climbs a major chord.
        const step = [0, 4, 7, 12][Math.max(0, Math.min(3, Math.round(value)))];
        this.tone(NOTE(step + 12), 0.34, { type: 'triangle', gain: 0.15 });
        this.tone(NOTE(step + 24), 0.5, { type: 'sine', gain: 0.07, delay: 0.035 });
        this.noise(0.14, { frequency: 7000, q: 0.7, gain: 0.025, type: 'highpass' });
        break;
      }
      case 'pop':
        // A soft bubble pop; `value` raises it by whole tones.
        this.tone(520 * 2 ** ((value * 2) / 12), 0.09, { type: 'sine', gain: 0.12, slideTo: 980 * 2 ** ((value * 2) / 12) });
        break;
      case 'ratchet':
        // A metal part clicks a quarter turn round.
        this.noise(0.05, { frequency: 2600, q: 2.5, gain: 0.07 });
        this.tone(330, 0.045, { type: 'square', gain: 0.03, slideTo: 250 });
        this.noise(0.05, { frequency: 3200, q: 2.5, gain: 0.05, delay: 0.06 });
        break;
      case 'zap':
        // The laser of the spectrometer: a quick falling buzz and a crackle.
        this.tone(1900, 0.2, { type: 'sawtooth', gain: 0.035, slideTo: 260 });
        this.noise(0.22, { frequency: 4200, q: 0.8, gain: 0.07, type: 'highpass' });
        break;
      case 'whoosh':
        // Air rushing through a pipe, or a beam of data leaving the dish.
        this.noise(0.55, { frequency: 420, slideTo: 2600, gain: 0.12, q: 0.9 });
        break;
      case 'thunk':
        // The printer lays a layer down.
        this.tone(190, 0.12, { type: 'sine', gain: 0.14, slideTo: 95 });
        this.noise(0.06, { frequency: 900, gain: 0.05, type: 'lowpass' });
        break;
    }
  }

  private motor: { low: OscillatorNode; whine: OscillatorNode; gain: GainNode } | null = null;
  private motorStop = 0;

  /**
   * The rover motor: a low hum and a rising whine. `level` is 0 (still) to 1 (full speed);
   * a level of 0 lets the sound fade out and stops it.
   */
  setMotor(level: number, driving = level > 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    window.clearTimeout(this.motorStop);
    if (!driving) {
      const motor = this.motor;
      if (!motor) return;
      motor.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      this.motorStop = window.setTimeout(() => {
        try {
          motor.low.stop();
          motor.whine.stop();
        } catch {
          /* already stopped */
        }
        motor.gain.disconnect();
        if (this.motor === motor) this.motor = null;
      }, 600);
      return;
    }
    if (!this.motor) {
      const low = ctx.createOscillator();
      low.type = 'triangle';
      const whine = ctx.createOscillator();
      whine.type = 'sine';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      low.connect(filter);
      whine.connect(filter);
      filter.connect(gain).connect(this.sfxBus);
      low.start();
      whine.start();
      this.motor = { low, whine, gain };
    }
    const now = ctx.currentTime;
    const level01 = Math.max(0, Math.min(1, level));
    this.motor.low.frequency.setTargetAtTime(48 + level01 * 62, now, 0.1);
    this.motor.whine.frequency.setTargetAtTime(190 + level01 * 330, now, 0.1);
    this.motor.gain.gain.setTargetAtTime(0.03 + level01 * 0.05, now, 0.12);
  }

  /** Repeat the alarm until stopped. */
  setAlarm(on: boolean): void {
    window.clearInterval(this.alarmTimer);
    if (!on) return;
    this.play('alarm');
    // A hidden tab has a frozen audio clock: notes queued now would all sound at once on return.
    this.alarmTimer = window.setInterval(() => {
      if (!document.hidden) this.play('alarm');
    }, 900);
  }

  setAmbience(kind: Ambience, force = false): void {
    if (kind === this.ambience && !force) return;
    this.ambience = kind;
    const ctx = this.ctx;
    if (!ctx) return;
    for (const node of this.ambienceNodes) {
      try {
        (node as AudioScheduledSourceNode).stop?.();
      } catch {
        /* already stopped */
      }
      node.disconnect();
    }
    this.ambienceNodes = [];
    if (kind === 'none') return;

    const wind = (frequency: number, level: number, wobble: number): void => {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = level;
      // A slow wave makes the wind rise and fall.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = wobble;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = level * 0.6;
      lfo.connect(lfoGain).connect(gain.gain);
      source.connect(filter).connect(gain).connect(this.ambienceBus);
      source.start();
      lfo.start();
      this.ambienceNodes.push(source, lfo, filter, gain, lfoGain);
    };
    const hum = (frequency: number, level: number): void => {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = level;
      oscillator.connect(gain).connect(this.ambienceBus);
      oscillator.start();
      this.ambienceNodes.push(oscillator, gain);
    };

    if (kind === 'mars') wind(380, 0.05, 0.13);
    if (kind === 'storm') {
      wind(300, 0.16, 0.21);
      wind(900, 0.05, 0.37);
    }
    if (kind === 'base') {
      hum(92, 0.02);
      wind(1400, 0.008, 0.09);
    }
    if (kind === 'moonSuit') {
      // Only the suit: a fan and a faint hum. Nothing from outside.
      hum(118, 0.03);
      wind(2100, 0.012, 0.5);
    }
  }

  setMusic(on: boolean): void {
    if (on === this.musicOn) return;
    this.musicOn = on;
    window.clearTimeout(this.musicTimer);
    window.clearTimeout(this.bellTimer);
    if (on && this.ctx) this.scheduleMusic();
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicOn) return;
    window.clearTimeout(this.musicTimer);
    window.clearTimeout(this.bellTimer);
    const playChord = (): void => {
      if (!this.ctx || !this.musicOn) return;
      if (document.hidden) {
        this.musicTimer = window.setTimeout(playChord, 7600);
        return;
      }
      const chord = CHORDS[this.chordIndex % CHORDS.length];
      this.chordIndex++;
      chord.forEach((frequency, index) => {
        this.tone(frequency, 9.5, { type: index < 2 ? 'sine' : 'triangle', gain: index < 2 ? 0.1 : 0.045, attack: 2.6, bus: this.musicBus });
      });
      this.musicTimer = window.setTimeout(playChord, 7600);
    };
    const playBell = (): void => {
      if (!this.ctx || !this.musicOn) return;
      if (document.hidden) {
        this.bellTimer = window.setTimeout(playBell, 4000);
        return;
      }
      const note = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)];
      this.tone(note, 2.4, { type: 'sine', gain: 0.05, attack: 0.02, bus: this.musicBus });
      this.bellTimer = window.setTimeout(playBell, 1800 + Math.random() * 4200);
    };
    playChord();
    this.bellTimer = window.setTimeout(playBell, 2500);
  }
}

export const audio = new AudioEngine();

// ----- Reading texts aloud ----------------------------------------------------

let speaking = false;

/** A voice that runs on this device. Voices that run on a company's server are skipped: texts can hold the child's name. */
function localVoice(language: string): SpeechSynthesisVoice | null {
  return window.speechSynthesis.getVoices().find((voice) => voice.localService && voice.lang.toLowerCase().startsWith(language)) ?? null;
}

// Some browsers list their voices only after a moment; ask once so they are ready for the first line.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
  } catch {
    /* no voices on this device */
  }
}

/** Reading aloud works here (for a language: the device has its own voice for it). */
export function canSpeak(language?: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  if (!language) return true;
  // Some browsers list their voices only after a moment; speak() checks again.
  if (!window.speechSynthesis.getVoices().length) return true;
  return !!localVoice(language);
}

/**
 * Read a text aloud with the device's own voice. Markup is removed first.
 * With `queue`, a text that is being read is not cut off: the new one follows it (a card and Lumi's bubble can appear together).
 */
export function speak(text: string, language: string, queue = false): void {
  if (!canSpeak()) return;
  const busy = window.speechSynthesis.speaking && !window.speechSynthesis.pending;
  if (!queue || !busy) stopSpeaking();
  // Glossary words are read as they are shown, not by their key.
  const clean = text.replace(/\*\*/g, '').replace(/\[\[(\w+)\]\]/g, (_, term: string) => (has(`gloss.${term}.name`) ? t(`gloss.${term}.name`) : term));
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = language === 'ru' ? 'ru-RU' : 'en-US';
  utterance.rate = 0.95;
  const voice = localVoice(language);
  if (!voice) return; // no voice of this device's own for this language
  utterance.voice = voice;
  utterance.onend = () => {
    speaking = false;
  };
  speaking = true;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  if (speaking || window.speechSynthesis.speaking) window.speechSynthesis.cancel();
  speaking = false;
}
