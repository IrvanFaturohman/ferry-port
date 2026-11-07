// Visual effects: particles, floating text, world-anchored UI, camera shake.
import * as THREE from 'three';
import { rand, pick } from './util';

type P = {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
  grow: number;
  spin: THREE.Vector3;
  baseScale: number;
  fade: boolean;
  op0: number;
  active: boolean;
  flatGrow?: boolean;
};

const GEO = {
  sphere: new THREE.IcosahedronGeometry(1, 0),
  plane: new THREE.PlaneGeometry(1, 1),
  star: new THREE.OctahedronGeometry(1, 0),
  ring: new THREE.RingGeometry(0.75, 1, 20).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
};

const CONFETTI = [0xff5a5f, 0xffd23f, 0x3ccf5a, 0x4dabf7, 0xb57bff, 0xff9f43];

export class Particles {
  private pool: P[] = [];
  constructor(private scene: THREE.Scene, size = 320) {
    for (let i = 0; i < size; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(GEO.sphere, m);
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.pool.push({ mesh, mat: m, vel: new THREE.Vector3(), life: 0, max: 1, gravity: 0, grow: 0, spin: new THREE.Vector3(), baseScale: 1, fade: true, op0: 1, active: false });
    }
  }

  private get(): P | null {
    for (const p of this.pool) if (!p.active) return p;
    return null;
  }

  private spawn(geo: THREE.BufferGeometry, pos: THREE.Vector3, color: number, o: {
    vel: THREE.Vector3; life: number; scale: number; gravity?: number; grow?: number; spin?: number; opacity?: number; fade?: boolean;
  }) {
    const p = this.get();
    if (!p) return;
    p.active = true;
    p.mesh.geometry = geo;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    if (geo === GEO.ring || geo === GEO.disc) p.mesh.rotation.set(0, 0, 0);
    p.mat.color.setHex(color);
    p.mat.opacity = o.opacity ?? 1;
    p.op0 = p.mat.opacity;
    p.vel.copy(o.vel);
    p.life = 0;
    p.max = o.life;
    p.gravity = o.gravity ?? 0;
    p.grow = o.grow ?? 0;
    p.baseScale = o.scale;
    p.mesh.scale.setScalar(o.scale);
    p.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(o.spin ?? 0);
    p.fade = o.fade ?? true;
  }

  puff(pos: THREE.Vector3, count = 8, color = 0xffffff, size = 0.35, spread = 1) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      this.spawn(GEO.sphere, pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.3 * spread, rand(0, 0.2), Math.sin(a) * 0.3 * spread)), color, {
        vel: new THREE.Vector3(Math.cos(a) * rand(1.2, 2.2) * spread, rand(0.6, 1.4), Math.sin(a) * rand(1.2, 2.2) * spread),
        life: rand(0.45, 0.7), scale: size * rand(0.7, 1.2), grow: 1.2, gravity: -1, opacity: 0.9,
      });
    }
  }

  smoke(pos: THREE.Vector3, color = 0xdfe6ee) {
    this.spawn(GEO.sphere, pos.clone(), color, {
      vel: new THREE.Vector3(rand(-0.2, 0.2), rand(1.2, 1.8), rand(0.2, 0.6)), life: rand(1.2, 1.8), scale: rand(0.2, 0.3), grow: 1.4, opacity: 0.85,
    });
  }

  confetti(pos: THREE.Vector3, count = 40, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(1.5, 4.5) * power;
      this.spawn(GEO.plane, pos.clone(), pick(CONFETTI), {
        vel: new THREE.Vector3(Math.cos(a) * sp, rand(5, 9) * power, Math.sin(a) * sp),
        life: rand(1.2, 1.9), scale: rand(0.14, 0.22), gravity: 12, spin: 12,
      });
    }
  }

  sparkle(pos: THREE.Vector3, count = 10, color = 0xffe066) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawn(GEO.star, pos.clone(), color, {
        vel: new THREE.Vector3(Math.cos(a) * rand(1, 3), rand(2, 4), Math.sin(a) * rand(1, 3)),
        life: rand(0.4, 0.7), scale: rand(0.07, 0.13), gravity: 6, spin: 8,
      });
    }
  }

  splash(pos: THREE.Vector3, count = 16, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawn(GEO.sphere, pos.clone(), i % 3 ? 0xffffff : 0xbfeefa, {
        vel: new THREE.Vector3(Math.cos(a) * rand(1, 3) * power, rand(3, 6) * power, Math.sin(a) * rand(1, 3) * power),
        life: rand(0.5, 0.9), scale: rand(0.08, 0.16), gravity: 14,
      });
    }
    this.ring(pos, 0xffffff, 1.6);
  }

  ring(pos: THREE.Vector3, color = 0xffffff, size = 1.2, life = 0.5) {
    const p0 = pos.clone();
    p0.y += 0.05;
    this.spawn(GEO.ring, p0, color, { vel: new THREE.Vector3(), life, scale: size * 0.4, grow: size * 3.5, opacity: 0.9 });
  }

  wake(pos: THREE.Vector3, size = 0.6) {
    const p0 = pos.clone();
    p0.y = 0.06;
    this.spawn(GEO.disc, p0, 0xffffff, { vel: new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)), life: rand(1.4, 2.0), scale: size, grow: 0.9, opacity: 0.7 });
  }

  feathers(pos: THREE.Vector3, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      this.spawn(GEO.plane, pos.clone(), 0xffffff, {
        vel: new THREE.Vector3(Math.cos(a) * rand(1, 2.5), rand(1, 3), Math.sin(a) * rand(1, 2.5)),
        life: rand(0.9, 1.4), scale: rand(0.12, 0.2), gravity: 2.5, spin: 6,
      });
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.vel.y < 0 && p.mesh.position.y < 0.05 && p.gravity > 0) {
        p.mesh.position.y = 0.05;
        p.vel.multiplyScalar(0.3);
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (p.grow) p.mesh.scale.setScalar(p.baseScale * (1 + p.grow * k));
      if (p.fade) p.mat.opacity = p.op0 * (k > 0.6 ? (1 - k) / 0.4 : 1);
    }
  }
}

// ---------------- World-anchored DOM UI ----------------

export type Anchor = THREE.Object3D | THREE.Vector3 | (() => THREE.Vector3);

type Label = { el: HTMLElement; anchor: Anchor; offsetY: number; visible: boolean };
type Floater = { el: HTMLElement; pos: THREE.Vector3; t: number; dur: number; rise: number };

export class WorldUI {
  private labels = new Set<Label>();
  private floaters: Floater[] = [];
  private tmp = new THREE.Vector3();
  constructor(private root: HTMLElement, private camera: THREE.Camera) {}

  private resolve(a: Anchor, out: THREE.Vector3) {
    if (a instanceof THREE.Object3D) return a.getWorldPosition(out);
    if (a instanceof THREE.Vector3) return out.copy(a);
    return out.copy(a());
  }

  add(className: string, html: string, anchor: Anchor, offsetY = 0): Label {
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    this.root.appendChild(el);
    const l: Label = { el, anchor, offsetY, visible: true };
    this.labels.add(l);
    return l;
  }

  remove(l: Label | null | undefined) {
    if (!l) return;
    l.el.remove();
    this.labels.delete(l);
  }

  show(l: Label, v: boolean) {
    if (l.visible === v) return;
    l.visible = v;
    l.el.style.display = v ? '' : 'none';
  }

  float(pos: THREE.Vector3, text: string, color = '#ffffff', size = 20, dur = 1.0, rise = 70) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = `${size}px`;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0, dur, rise });
  }

  private project(p: THREE.Vector3) {
    this.tmp.copy(p).project(this.camera);
    const w = this.root.clientWidth, h = this.root.clientHeight;
    return { x: (this.tmp.x * 0.5 + 0.5) * w, y: (-this.tmp.y * 0.5 + 0.5) * h, behind: this.tmp.z > 1 };
  }

  update(dt: number) {
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (!l.visible) continue;
      this.resolve(l.anchor, v);
      v.y += l.offsetY;
      const s = this.project(v);
      l.el.style.left = `${s.x}px`;
      l.el.style.top = `${s.y}px`;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const s = this.project(f.pos);
      const pop = k < 0.15 ? 0.5 + (k / 0.15) * 0.8 : k < 0.25 ? 1.3 - ((k - 0.15) / 0.1) * 0.3 : 1;
      f.el.style.left = `${s.x}px`;
      f.el.style.top = `${s.y - k * f.rise}px`;
      f.el.style.opacity = `${k > 0.7 ? (1 - k) / 0.3 : 1}`;
      f.el.style.transform = `translate(-50%, -50%) scale(${pop})`;
    }
  }

  clear() {
    for (const l of this.labels) l.el.remove();
    this.labels.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
  }
}

// ---------------- Camera shake ----------------

export class Shake {
  private amount = 0;
  offset = new THREE.Vector3();
  add(a: number) { this.amount = Math.min(0.6, this.amount + a); }
  update(dt: number) {
    this.amount = Math.max(0, this.amount - dt * 1.8);
    const a = this.amount * this.amount;
    this.offset.set(rand(-1, 1) * a, rand(-1, 1) * a, rand(-1, 1) * a);
  }
}
