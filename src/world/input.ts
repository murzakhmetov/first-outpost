/**
 * Player input from keyboard, mouse, touch and gamepad, gathered into one small state.
 * The on-screen joystick and buttons (in the UI layer) write into the same state.
 */

export interface InputState {
  /** Walk direction, each -1 to 1. x = right, y = forward. */
  moveX: number;
  moveY: number;
  jump: boolean;
  interact: boolean;
  /** Held: run instead of walk. */
  sprint: boolean;
  /** Held: the use key or button (for games that need holding). */
  use: boolean;
  /** Pressed: switch between first and third person. */
  view: boolean;
}

export class Input {
  /** Called when the player drags the view: yaw and pitch change in radians. */
  onLook: ((yaw: number, pitch: number) => void) | null = null;
  /** Called on wheel or pinch: factor > 1 zooms out. */
  onZoom: ((factor: number) => void) | null = null;
  /** Called on any first touch or key, so audio can start. */
  onFirstGesture: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private stickX = 0;
  private stickY = 0;
  private jumpQueued = false;
  private interactQueued = false;
  private viewQueued = false;
  private padView = false;
  private sprintHeld = false;
  private padInteract = false;
  private padJump = false;
  /** The on-screen use button is held down. */
  private useHeld = false;
  private gestured = false;
  enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.onFirstGesture?.();
  }

  private isTyping(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.isTyping(event)) return;
    this.gesture();
    this.keys.add(event.code);
    if (event.code === 'Space') {
      this.jumpQueued = true;
      event.preventDefault();
    }
    if (event.code === 'KeyE' || event.code === 'Enter') this.interactQueued = true;
    if (event.code === 'KeyV' && !event.repeat) this.viewQueued = true;
    if (event.code.startsWith('Arrow')) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.sprintHeld = false;
    this.useHeld = false;
    this.pointers.clear();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.gesture();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* some browsers refuse capture for synthetic events */
    }
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
  };

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer || !this.enabled) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.pointers.size >= 2) {
      const distance = this.currentPinch();
      if (this.pinchDistance > 0 && distance > 0) this.onZoom?.(this.pinchDistance / distance);
      this.pinchDistance = distance;
      return;
    }
    const scale = 2.6 / Math.max(320, this.canvas.clientHeight);
    this.onLook?.(-dx * scale, dy * scale * 0.8);
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.pinchDistance = 0;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    this.onZoom?.(event.deltaY > 0 ? 1.1 : 1 / 1.1);
  };

  /** On-screen joystick. */
  setStick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }

  pressJump(): void {
    this.gesture();
    this.jumpQueued = true;
  }

  /** The on-screen "run" button: true while it is held down. */
  setSprint(held: boolean): void {
    this.sprintHeld = held;
  }

  /** The on-screen view button. */
  pressView(): void {
    this.gesture();
    this.viewQueued = true;
  }

  pressInteract(): void {
    this.gesture();
    this.interactQueued = true;
  }

  /** The on-screen use button: true while it is held down. */
  setUse(held: boolean): void {
    this.gesture();
    this.useHeld = held;
  }

  /** Read and clear one-shot presses. Call once per frame. */
  read(dt = 1 / 60): InputState {
    let x = this.stickX;
    let y = this.stickY;
    const k = this.keys;
    let sprint = this.sprintHeld || k.has('ShiftLeft') || k.has('ShiftRight');
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;

    // Gamepad, if one is plugged in.
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.18) x += ax;
      if (Math.abs(ay) > 0.18) y -= ay;
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      // The right stick turns the view at the same speed on every screen (the step is per 1/60 s), and only when the game is not paused.
      if (this.enabled && (Math.abs(rx) > 0.18 || Math.abs(ry) > 0.18)) this.onLook?.(-rx * 0.045 * dt * 60, ry * 0.03 * dt * 60);
      // One jump per press, not one per frame while the button is held.
      const jumpHeld = !!pad.buttons[0]?.pressed;
      if (jumpHeld && !this.padJump) this.jumpQueued = true;
      this.padJump = jumpHeld;
      if (pad.buttons[5]?.pressed || pad.buttons[7]?.pressed || pad.buttons[10]?.pressed) sprint = true;
      const interactHeld = !!(pad.buttons[2]?.pressed || pad.buttons[1]?.pressed);
      if (interactHeld && !this.padInteract) this.interactQueued = true;
      this.padInteract = interactHeld;
      const viewHeld = !!pad.buttons[3]?.pressed;
      if (viewHeld && !this.padView) this.viewQueued = true;
      this.padView = viewHeld;
      break;
    }

    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    const state: InputState = {
      moveX: this.enabled ? x : 0,
      moveY: this.enabled ? y : 0,
      jump: this.enabled && this.jumpQueued,
      interact: this.enabled && this.interactQueued,
      sprint: this.enabled && sprint,
      use: this.enabled && (this.useHeld || this.padInteract || k.has('KeyE') || k.has('Enter')),
      view: this.enabled && this.viewQueued,
    };
    this.viewQueued = false;
    this.jumpQueued = false;
    this.interactQueued = false;
    return state;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
