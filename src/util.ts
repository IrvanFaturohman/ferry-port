import * as THREE from 'three';

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const ease = {
  linear: (t: number) => t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

type Tween = { t: number; dur: number; delay: number; fn: (k: number) => void; done?: () => void; easing: (t: number) => void | number };

class Tweens {
  private list: Tween[] = [];
  add(dur: number, fn: (k: number) => void, opts: { delay?: number; easing?: (t: number) => number; done?: () => void } = {}) {
    const tw: Tween = { t: 0, dur, delay: opts.delay ?? 0, fn, done: opts.done, easing: opts.easing ?? ease.linear };
    this.list.push(tw);
    return tw;
  }
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      if (tw.delay > 0) { tw.delay -= dt; continue; }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.easing(k) as number);
      if (k >= 1) {
        this.list.splice(i, 1);
        tw.done?.();
      }
    }
  }
  clear() { this.list.length = 0; }
}
export const tweens = new Tweens();

/** Pop an object in from scale 0 with overshoot. */
export function popIn(obj: THREE.Object3D, dur = 0.45, delay = 0, target = 1) {
  obj.scale.setScalar(0.0001);
  tweens.add(dur, (k) => obj.scale.setScalar(Math.max(0.0001, k * target)), { delay, easing: ease.outBack });
}

/** Quick squash & stretch bounce. */
export function squash(obj: THREE.Object3D, amount = 0.25, dur = 0.3, base = 1) {
  tweens.add(dur, (k) => {
    const s = Math.sin(k * Math.PI) * amount * (1 - k * 0.5);
    obj.scale.set(base * (1 + s), base * (1 - s), base * (1 + s));
  }, { done: () => obj.scale.setScalar(base) });
}

/** Move along an arc from A to B. */
export function arcMove(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3 | (() => THREE.Vector3), dur: number, height: number, done?: () => void, spin = 0) {
  const a = from.clone();
  tweens.add(dur, (k) => {
    const b = typeof to === 'function' ? to() : to;
    obj.position.lerpVectors(a, b, k);
    obj.position.y += Math.sin(k * Math.PI) * height;
    if (spin) obj.rotation.y = k * spin;
  }, { easing: ease.inOutQuad, done });
}

export function vibrate(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}
