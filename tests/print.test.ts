import { describe, expect, it } from 'vitest';
import { PRINT, artAfterDrop, dropLayer, layerSpeed, printAccuracy, printStars, sweep } from '../src/sim/print';

describe('the workshop printer game', () => {
  const base = PRINT.base;

  it('snaps a layer laid almost exactly on the one below', () => {
    const drop = dropLayer(base, { left: base.left + PRINT.perfect * 0.8, width: base.width });
    expect(drop.kind).toBe('perfect');
    if (drop.kind === 'perfect') expect(drop.layer).toEqual(base);
  });

  it('cuts off what sticks out, on the side where it sticks out', () => {
    for (const shift of [-0.1, 0.13]) {
      const moving = { left: base.left + shift, width: base.width };
      const drop = dropLayer(base, moving);
      expect(drop.kind).toBe('trim');
      if (drop.kind !== 'trim') continue;
      // What stays and what falls add up to the moving layer.
      expect(drop.layer.width + drop.cut.width).toBeCloseTo(moving.width, 9);
      expect(drop.layer.width).toBeCloseTo(base.width - Math.abs(shift), 9);
      // The kept part sits on the layer below; the cut part is outside it.
      expect(drop.layer.left).toBeGreaterThanOrEqual(base.left - 1e-9);
      expect(drop.layer.left + drop.layer.width).toBeLessThanOrEqual(base.left + base.width + 1e-9);
      if (shift < 0) expect(drop.cut.left + drop.cut.width).toBeCloseTo(base.left, 9);
      else expect(drop.cut.left).toBeCloseTo(base.left + base.width, 9);
    }
  });

  it('counts a layer that misses the one below as a miss (it is tried again, nothing breaks)', () => {
    expect(dropLayer(base, { left: base.left + base.width + 0.01, width: base.width }).kind).toBe('miss');
    expect(dropLayer(base, { left: base.left - base.width + 0.005, width: base.width }).kind).toBe('miss');
  });

  it('keeps the sliding layer on the plate, starting from alternate sides', () => {
    for (const width of [base.width, 0.3, 0.05]) {
      for (let s = 0; s < 12; s += 0.037) {
        for (const fromRight of [false, true]) {
          const left = sweep(s, width, layerSpeed(3), fromRight);
          expect(left).toBeGreaterThanOrEqual(-1e-9);
          expect(left + width).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
      expect(sweep(0, width, 1, false)).toBeCloseTo(0, 9);
      expect(sweep(0, width, 1, true)).toBeCloseTo(1 - width, 9);
    }
  });

  it('keeps the picture of the tool straight on a snapped layer and moves it with a sloppy one', () => {
    // A snapped layer: the picture stays where it was in the layer below.
    const near = { left: base.left + PRINT.perfect * 0.5, width: base.width };
    const snapped = dropLayer(base, near);
    expect(snapped.kind).toBe('perfect');
    expect(artAfterDrop(base, base.left, snapped, near.left)).toBeCloseTo(base.left, 9);
    // A layer laid too far right (or left): the picture moves just as far, on both sides.
    for (const shift of [-0.12, 0.09]) {
      const moving = { left: base.left + shift, width: base.width };
      const drop = dropLayer(base, moving);
      expect(drop.kind).toBe('trim');
      expect(artAfterDrop(base, base.left, drop, moving.left)).toBeCloseTo(base.left + shift, 9);
      // Shifts add up layer after layer.
      expect(artAfterDrop(base, base.left + 0.05, drop, moving.left)).toBeCloseTo(base.left + 0.05 + shift, 9);
    }
    // A miss: the piece that falls carries its band of the picture with it.
    const far = { left: base.left + base.width + 0.05, width: base.width };
    const missed = dropLayer(base, far);
    expect(missed.kind).toBe('miss');
    expect(artAfterDrop(base, base.left, missed, far.left)).toBeCloseTo(far.left, 9);
  });

  it('gets faster layer by layer', () => {
    for (let i = 1; i < PRINT.layers; i++) expect(layerSpeed(i)).toBeGreaterThan(layerSpeed(i - 1));
  });

  it('grades a print by how much of its width it kept', () => {
    expect(printAccuracy(base)).toBe(1);
    expect(printStars(printAccuracy(base))).toBe(3);
    expect(printStars(PRINT.saving)).toBe(3);
    expect(printStars(0.6)).toBe(2);
    expect(printStars(0.2)).toBe(1);
    // A perfect run of layers keeps the full width: a neat print is always possible.
    let top = base;
    for (let i = 0; i < PRINT.layers; i++) {
      const drop = dropLayer(top, { left: top.left, width: top.width });
      expect(drop.kind).toBe('perfect');
      if (drop.kind === 'perfect') top = drop.layer;
    }
    expect(printAccuracy(top)).toBe(1);
  });
});
