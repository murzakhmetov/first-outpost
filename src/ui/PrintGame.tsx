/**
 * The workshop's 3D printer: the chosen tool is printed one layer at a time.
 * Press when the sliding layer is right above the one below; whatever sticks out
 * over the edge is cut off. Every layer carries its own band of the tool's
 * picture, so the stack grows into the tool itself: neat layers make a straight
 * tool, sloppy ones a wobbly tool. At the end the support material melts away
 * and the stars land one by one. The rules are in src/sim/print.ts.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audio } from '../game/audio';
import { cancelPrint, finishPrint } from '../game/director';
import { mission, settings } from '../game/store';
import { t } from '../i18n';
import { isCreative } from '../sim/outpost';
import type { ToolId } from '../sim/outpost';
import { PRINT, artAfterDrop, dropLayer, layerSpeed, printAccuracy, printStars, sweep } from '../sim/print';
import type { Layer } from '../sim/print';
import { Btn } from './common';
import { Icon } from './icons';
import { ItemArt } from './ItemArt';
import { Burst, HintHand, StarRow, calmMotion, tapRing, useFirstHint, useStarReveal } from './minigames/kit';
import { TOOL_ICON } from './Outpost';
import './minigames/minigames.css';
import './print.css';

const INK = '#2b2440';

/** Filament colours (light, dark) for each tool. */
const FILAMENT: Record<ToolId, [string, string]> = {
  tank: ['#8fe9ff', '#2f9fd6'],
  drill: ['#ffbd7a', '#e0662b'],
  battery: ['#a8ffb2', '#2fae57'],
  scanner: ['#dcc2ff', '#8a5fe0'],
  boots: ['#a9ccff', '#4d78d6'],
  vest: ['#ffe58f', '#dd9f22'],
};

/** A laid layer, and where the tool's picture sits in it (a share of the plate, like `left`). */
interface Laid extends Layer {
  art: number;
}

interface Piece {
  id: number;
  left: number;
  width: number;
  art: number;
  level: number;
  side: 'l' | 'r';
}

const pct = (share: number): string => `${(share * 100).toFixed(3)}%`;
/** CSS for the bottom of a layer at a level (0 = the first layer, on the plate). */
const atLevel = (level: number): string => `calc(var(--plate) + ${level} * var(--layer))`;

/**
 * The tool's whole picture, placed so that its bottom sits on the plate; the layer around it
 * shows only its own band.
 */
function Slice({ tool, layer, art, level }: { tool: ToolId; layer: Layer; art: number; level: number }): JSX.Element {
  return (
    <span
      class="print-slice"
      style={{
        left: pct((art - layer.left) / layer.width),
        width: pct(PRINT.base.width / layer.width),
        bottom: `${-level * 100}%`,
        height: `${(PRINT.layers + 1) * 100}%`,
      }}
      aria-hidden="true"
    >
      <ItemArt item={{ kind: 'tool', id: tool }} size={100} />
    </span>
  );
}

/** The printer's frame: two posts, the beam with its belt and light strip, and the spool of filament. */
function PrinterFrame(): JSX.Element {
  return (
    <svg class="print-frame" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {[5, 381].map((x) => (
        <g key={x}>
          <rect x={x} y="0" width="14" height="300" fill="#7f8ab0" />
          <rect x={x} y="0" width="7" height="300" fill="#c9d0e4" />
          <rect x={x} y="-2" width="14" height="304" fill="none" stroke={INK} stroke-width="2.5" />
          <path d={`M${x + 7} 70v26M${x + 7} 150v26M${x + 7} 230v26`} stroke={INK} stroke-width="2.4" stroke-linecap="round" opacity="0.55" />
        </g>
      ))}
      <rect x="4" y="6" width="392" height="22" rx="5" fill="#7f8ab0" />
      <rect x="4" y="6" width="392" height="11" rx="5" fill="#dde2f0" />
      <rect x="4" y="6" width="392" height="22" rx="5" fill="none" stroke={INK} stroke-width="2.5" />
      <path d="M12 12h70" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" />
      <path class="print-led" d="M40 25H360" />
      <path d="M26 34H374" stroke={INK} stroke-width="3" />
      <circle cx="26" cy="34" r="5.5" fill="#dde2f0" stroke={INK} stroke-width="2" />
      <circle cx="374" cy="34" r="5.5" fill="#dde2f0" stroke={INK} stroke-width="2" />
      <g transform="translate(352 58)">
        <circle r="19" class="print-spool-dark" stroke={INK} stroke-width="2.5" />
        <circle r="15" class="print-spool" />
        <path d="M-15 0a15 15 0 0 1 30 0M-11 6a12 12 0 0 0 22 0" fill="none" stroke="rgba(255, 255, 255, 0.35)" stroke-width="1.6" />
        <circle r="6.5" fill="#e9eef8" stroke={INK} stroke-width="2" />
        <circle r="2.2" fill={INK} />
        <path d="M-11-10a15 15 0 0 1 8-4" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" />
      </g>
    </svg>
  );
}

/** The print head: a box with a fan, a brass heater and a glowing nozzle at the bottom. */
function PrintHead(): JSX.Element {
  return (
    <svg class="print-head-art" viewBox="0 0 60 54" aria-hidden="true" focusable="false">
      <rect x="6" y="3" width="48" height="31" rx="7" class="print-head-dark" />
      <rect x="6" y="3" width="33" height="26" rx="7" class="print-head-light" />
      <rect x="6" y="3" width="48" height="31" rx="7" fill="none" stroke={INK} stroke-width="2.5" />
      <circle cx="22" cy="18.5" r="9" fill={INK} />
      <g class="print-fan">
        <path d="M22 18.5c0-5 3-7 5-6s-1 5-5 6ZM22 18.5c5 0 7 3 6 5s-5-1-6-5ZM22 18.5c0 5-3 7-5 6s1-5 5-6ZM22 18.5c-5 0-7-3-6-5s5 1 6 5Z" fill="#7d89b4" />
      </g>
      <circle cx="22" cy="18.5" r="2.4" fill="#dde2f0" />
      <circle cx="46.5" cy="11" r="2.6" class="print-head-led" />
      <path d="M41 21h10M41 26h10" stroke={INK} stroke-width="2" stroke-linecap="round" opacity="0.6" />
      <path d="M10 8.5h14" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" opacity="0.85" />
      <path d="M22 34h16l-3 8.5H25Z" fill="#f2c46d" stroke={INK} stroke-width="2.2" stroke-linejoin="round" />
      <path d="M26.5 42.5h7l-2.2 7.5h-2.6Z" fill="#c9973f" stroke={INK} stroke-width="2" stroke-linejoin="round" />
      <circle cx="30" cy="51.5" r="2.6" class="print-head-hot" />
    </svg>
  );
}

/** What the print gave, after the stars: the tool itself, and the metal a neat print saves. */
function PrintResult({ tool, accuracy, saving, onTake }: { tool: ToolId; accuracy: number; saving: boolean; onTake: () => void }): JSX.Element {
  const stars = printStars(accuracy);
  const [chips, setChips] = useState(false);
  const lit = useStarReveal(stars, () => {
    setChips(true);
    audio.play('collect', saving ? 4 : 2);
  });
  return (
    <footer class="print-result">
      <span class="print-trophy" aria-hidden="true">
        <ItemArt item={{ kind: 'tool', id: tool }} size={58} />
      </span>
      <strong class="print-done">{t('print.done')}</strong>
      <StarRow stars={stars} lit={lit} won big={46} small={36} />
      <span class="print-grade">
        {t(`print.grade.${stars}`)} · {t('print.accuracy', { n: Math.round(accuracy * 100) })}
      </span>
      <span class="print-chips" aria-live="polite">
        {chips && (
          <>
            <span class="print-chip is-tool">
              <Icon name={TOOL_ICON[tool]} size={16} /> {t('mg.print.ready', { tool: t(`tool.${tool}.name`) })}
            </span>
            {saving && (
              <span class="print-chip is-saved">
                <Icon name="metal" size={16} /> {t('print.saved')}
              </span>
            )}
          </>
        )}
      </span>
      <p class="print-fact">{t('print.fact')}</p>
      <Btn kind="primary" icon="check" wide autoFocus onClick={onTake}>
        {t('print.take')}
      </Btn>
    </footer>
  );
}

export function PrintGame({ tool }: { tool: ToolId }): JSX.Element {
  const [stack, setStack] = useState<Laid[]>([{ ...PRINT.base, art: PRINT.base.left }]);
  const [perfects, setPerfects] = useState<boolean[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [flash, setFlash] = useState<{ id: number; kind: 'perfect' | 'miss'; level: number } | null>(null);
  const [tries, setTries] = useState(0);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(0);
  const moving = useRef<HTMLDivElement>(null);
  const nozzle = useRef<HTMLDivElement>(null);
  const spot = useRef(0);
  const counter = useRef(0);
  const lastDrop = useRef(0);
  const hint = useFirstHint('print');

  const top = stack[stack.length - 1];
  const index = stack.length - 1; // the layer being laid, 0 = the first one the player lays
  const fromRight = index % 2 === 1;
  const accuracy = printAccuracy(top);
  const state = mission.value;
  const saving = done && accuracy >= PRINT.saving && !!state && !isCreative(state);
  const calm = settings.value.lessMotion || calmMotion();
  const [light, dark] = FILAMENT[tool];
  // Perfect layers laid one after another, up to now.
  let streak = 0;
  for (let i = perfects.length - 1; i >= 0 && perfects[i]; i--) streak += 1;

  // The layer slides from side to side; the print head rides along above it.
  useEffect(() => {
    if (done) return;
    const width = top.width;
    const speed = layerSpeed(index) * (calm ? 0.8 : 1);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const left = sweep((now - start) / 1000, width, speed, fromRight);
      spot.current = left;
      if (moving.current) moving.current.style.left = pct(left);
      if (nozzle.current) nozzle.current.style.left = pct(left + width / 2);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stack.length, tries, done]);

  const addPiece = (piece: Omit<Piece, 'id'>): void => {
    const id = ++counter.current;
    setPieces((list) => [...list.slice(-5), { ...piece, id }]);
    window.setTimeout(() => setPieces((list) => list.filter((item) => item.id !== id)), 900);
  };

  const drop = (): void => {
    // Two presses in the same moment (a tap and a key) lay one layer, not two.
    const now = performance.now();
    if (done || now - lastDrop.current < 140) return;
    lastDrop.current = now;
    const below = top;
    const left = spot.current;
    const level = stack.length;
    const result = dropLayer(below, { left, width: below.width });
    const art = artAfterDrop(below, below.art, result, left);
    const id = ++counter.current;
    if (hint.on) hint.done();
    if (result.kind === 'miss') {
      audio.play('deny');
      addPiece({ left, width: below.width, art, level, side: left < below.left ? 'l' : 'r' });
      setFlash({ id, kind: 'miss', level });
      setTries((n) => n + 1);
      // A gentle wobble of the printer, only when calm mode is off.
      if (!calm) {
        setShake(id);
        window.setTimeout(() => setShake((now) => (now === id ? 0 : now)), 420);
      }
      return;
    }
    if (result.kind === 'perfect') {
      audio.play(streak >= 1 ? 'collect' : 'good', Math.min(4, streak + 1));
      setFlash({ id, kind: 'perfect', level });
    } else {
      audio.play('thunk');
      addPiece({ ...result.cut, art, level, side: result.cut.left < result.layer.left ? 'l' : 'r' });
    }
    const next = [...stack, { ...result.layer, art }];
    setStack(next);
    setPerfects((list) => [...list, result.kind === 'perfect']);
    if (next.length - 1 >= PRINT.layers) {
      setDone(true);
      window.setTimeout(() => audio.play('signal'), 180);
      window.setTimeout(() => audio.play('whoosh'), 420);
    }
  };

  const take = (): void => finishPrint(accuracy);

  // Space, Enter or E lays a layer (and takes the tool at the end); Escape stops.
  const keys = useRef({ drop, take, done });
  keys.current = { drop, take, done };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const code = event.code;
      if (code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (keys.current.done) keys.current.take();
        else cancelPrint();
        return;
      }
      if (code !== 'Space' && code !== 'Enter' && code !== 'NumpadEnter' && code !== 'KeyE' && code !== 'ArrowDown') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (keys.current.done) keys.current.take();
      else keys.current.drop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const style = { '--fil-a': light, '--fil-b': dark } as unknown as JSX.CSSProperties;
  const startLeft = sweep(0, top.width, 1, fromRight);
  const laidCount = perfects.length;

  return (
    <div class="print-back" role="dialog" aria-modal="true" aria-label={t('print.title')}>
      <div class={`print-card ${done ? 'is-done' : ''}`} style={style}>
        <header class="print-head">
          <span class="print-badge">
            <Icon name={TOOL_ICON[tool]} size={22} />
          </span>
          <span class="print-titles">
            <small>{t('print.title')}</small>
            <strong>{t('print.making', { tool: t(`tool.${tool}.name`) })}</strong>
          </span>
          {!done && (
            <button type="button" class="print-close" aria-label={t('print.cancel')} title={t('print.cancel')} onClick={() => cancelPrint()}>
              <Icon name="close" size={20} />
            </button>
          )}
        </header>
        {!done && <p class="print-hint">{t('print.hint')}</p>}

        <div
          class={`print-stage ${calm ? 'is-calm' : ''} ${done ? 'is-done' : ''} ${shake ? 'is-shake' : ''}`}
          onPointerDown={(event) => {
            if (done) return;
            event.preventDefault();
            tapRing(event);
            drop();
          }}
        >
          <PrinterFrame />
          <i class="print-plate" />
          {!done && <i class="print-target" style={{ left: pct(top.left), width: pct(top.width), bottom: atLevel(stack.length) }} />}
          {stack.map((layer, level) => (
            <div
              key={level}
              class={`print-layer ${level === 0 ? 'is-base' : ''} ${level > 0 && perfects[level - 1] ? 'is-perfect' : ''}`}
              style={{ left: pct(layer.left), width: pct(layer.width), bottom: atLevel(level), animationDelay: `${level * 0.07}s` }}
            >
              <Slice tool={tool} layer={layer} art={layer.art} level={level} />
            </div>
          ))}
          {!done && (
            <div ref={moving} class="print-layer is-moving" style={{ left: pct(startLeft), width: pct(top.width), bottom: atLevel(stack.length) }}>
              <Slice tool={tool} layer={{ left: top.left, width: top.width }} art={top.art} level={stack.length} />
            </div>
          )}
          {pieces.map((piece) => (
            <div key={piece.id} class={`print-layer print-piece side-${piece.side}`} style={{ left: pct(piece.left), width: pct(piece.width), bottom: atLevel(piece.level) }}>
              <Slice tool={tool} layer={piece} art={piece.art} level={piece.level} />
            </div>
          ))}
          {!done && (
            <div ref={nozzle} class="print-nozzle" style={{ left: pct(startLeft + top.width / 2), bottom: atLevel(stack.length + 1) }}>
              <i class="print-rod" />
              <PrintHead />
            </div>
          )}
          {flash && (
            <span key={flash.id} class={`print-flash is-${flash.kind}`} style={{ bottom: atLevel(flash.level + 1.4) }}>
              {t(flash.kind === 'perfect' ? 'print.perfect' : 'print.miss')}
            </span>
          )}
          {!done && streak >= 2 && (
            <span key={`streak-${streak}`} class="print-streak">
              <Icon name="star" size={14} /> {t('mg.print.streak', { n: streak })}
            </span>
          )}
          {!done && hint.on && laidCount === 0 && (
            <HintHand
              x={pct(top.left + top.width / 2)}
              y={`calc(100% - var(--plate) - ${stack.length + 0.5} * var(--layer))`}
              label={t('mg.print.hintTap')}
            />
          )}
          {done && (
            <>
              <span class="print-shine" aria-hidden="true" />
              <Burst count={14} class="print-done-burst" />
            </>
          )}
        </div>

        {!done ? (
          <footer class="print-foot">
            <div class="print-dots" aria-label={t('print.layer', { n: Math.min(PRINT.layers, index + 1), total: PRINT.layers })}>
              {Array.from({ length: PRINT.layers }, (_, n) => (
                <i key={n} class={n < perfects.length ? (perfects[n] ? 'is-perfect' : 'is-laid') : n === perfects.length ? 'is-now' : ''} />
              ))}
              <span>{t('print.layer', { n: Math.min(PRINT.layers, index + 1), total: PRINT.layers })}</span>
            </div>
            <Btn kind="primary" icon="build" onClick={drop}>
              {t('print.drop')}
            </Btn>
          </footer>
        ) : (
          <PrintResult tool={tool} accuracy={accuracy} saving={saving} onTake={take} />
        )}
      </div>
    </div>
  );
}
