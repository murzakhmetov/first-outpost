import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { getWorld } from '../game/director';

/** On-screen stick for touch screens (outside and inside the buildings). */
export function Joystick(): JSX.Element {
  const pad = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = pad.current;
    if (!element) return;
    let active: number | null = null;
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== active) return;
      const rect = element.getBoundingClientRect();
      const radius = rect.width / 2;
      let x = (event.clientX - rect.left - radius) / radius;
      let y = (event.clientY - rect.top - radius) / radius;
      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      if (knob.current) knob.current.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
      // A small dead zone, then full speed: easy for small thumbs.
      const strength = Math.min(1, Math.max(0, (Math.hypot(x, y) - 0.15) / 0.55));
      const norm = Math.hypot(x, y) || 1;
      getWorld()?.input.setStick((x / norm) * strength, (-y / norm) * strength);
    };
    const down = (event: PointerEvent): void => {
      active = event.pointerId;
      element.setPointerCapture(event.pointerId);
      move(event);
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerId !== active) return;
      active = null;
      if (knob.current) knob.current.style.transform = '';
      getWorld()?.input.setStick(0, 0);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      getWorld()?.input.setStick(0, 0);
    };
  }, []);
  return (
    <div ref={pad} class="stick" aria-hidden="true">
      <div ref={knob} class="stick-knob" />
    </div>
  );
}
