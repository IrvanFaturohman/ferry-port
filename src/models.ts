// Low-poly models built from primitives. Flat colors, toy proportions.
import * as THREE from 'three';

const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: number | string, opts: { flat?: boolean; emissive?: number } = {}) {
  const key = `${color}|${opts.flat ?? false}|${opts.emissive ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: opts.flat ?? false, emissive: opts.emissive ?? 0 });
    matCache.set(key, m);
  }
  return m;
}

export const COLORS = {
  sand: 0xf2e2b6,
  grass: 0x7fd84f,
  grassDark: 0x62bf3c,
  road: 0x5d6574,
  roadLine: 0xffd94a,
  wood: 0xc28a52,
  woodDark: 0x9a6638,
  concrete: 0xe9edf2,
  water: 0x3ec7e8,
  white: 0xffffff,
  red: 0xff5a5f,
  navy: 0x2f4a73,
  yellow: 0xffd23f,
  orange: 0xff9f43,
  skin: 0xffd1a8,
  box: 0xd9a066,
  boxTape: 0xf5e1b8,
  lobster: 0xff4b3e,
  cash: 0x3ccf5a,
  cashDark: 0x23a03e,
};

function box(w: number, h: number, d: number, color: number, flat = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, { flat }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rb: number, h: number, color: number, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function sphere(r: number, color: number, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), mat(color));
  m.castShadow = true;
  return m;
}
function rbox(w: number, h: number, d: number, r: number, color: number) {
  // rounded box via extruded rounded rect
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------- Characters ----------------

export type Person = THREE.Group & { userData: { body: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D; carryAnchor: THREE.Object3D } };

export function makePerson(shirt: number, opts: { cap?: number; pants?: number; skin?: number; scale?: number } = {}): Person {
  const g = new THREE.Group() as Person;
  const body = new THREE.Group();
  g.add(body);
  const pants = opts.pants ?? 0x3a4a6b;
  const legL = cyl(0.11, 0.1, 0.42, pants, 8);
  legL.position.set(-0.13, 0.21, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  g.add(legL, legR);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.32, 4, 10), mat(shirt));
  torso.position.y = 0.72;
  torso.castShadow = true;
  body.add(torso);
  const head = sphere(0.24, opts.skin ?? COLORS.skin, 14);
  head.position.y = 1.2;
  body.add(head);
  // eyes
  const eyeM = mat(0x23324a);
  for (const sx of [-0.08, 0.08]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeM);
    e.position.set(sx, 1.24, 0.215);
    body.add(e);
  }
  if (opts.cap !== undefined) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(opts.cap));
    cap.position.y = 1.25;
    body.add(cap);
    const brim = box(0.34, 0.04, 0.2, opts.cap);
    brim.position.set(0, 1.27, 0.2);
    body.add(brim);
  }
  const armL = cyl(0.07, 0.07, 0.42, shirt, 6);
  armL.geometry.translate(0, -0.18, 0);
  armL.position.set(-0.33, 0.95, 0.02);
  const armR = armL.clone();
  armR.position.x = 0.33;
  body.add(armL, armR);
  const carryAnchor = new THREE.Object3D();
  carryAnchor.position.set(0, 0.62, 0.42);
  g.add(carryAnchor);
  g.userData = { body, legL, legR, armL, armR, carryAnchor };
  if (opts.scale) g.scale.setScalar(opts.scale);
  return g;
}

/** Walk cycle + carry pose. */
export function animatePerson(p: Person, t: number, moving: number, carrying: boolean) {
  const { legL, legR, armL, armR, body } = p.userData;
  const sw = Math.sin(t * 14) * 0.6 * moving;
  legL.rotation.x = sw;
  legR.rotation.x = -sw;
  body.position.y = Math.abs(Math.sin(t * 14)) * 0.06 * moving;
  if (carrying) {
    armL.rotation.x = -1.3;
    armR.rotation.x = -1.3;
  } else {
    armL.rotation.x = -sw * 0.8;
    armR.rotation.x = sw * 0.8;
  }
}

// ---------------- Items ----------------

export function makeParcel() {
  const g = new THREE.Group();
  const b = box(0.52, 0.32, 0.42, COLORS.box);
  b.position.y = 0.16;
  g.add(b);
  const tape = box(0.53, 0.33, 0.08, COLORS.boxTape);
  tape.position.y = 0.16;
  g.add(tape);
  const label = box(0.16, 0.01, 0.12, 0xffffff);
  label.position.set(0.12, 0.325, 0.1);
  g.add(label);
  g.userData.h = 0.32;
  return g;
}

export function makeLobster() {
  const g = new THREE.Group();
  const red = COLORS.lobster;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 4, 8), mat(red));
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.11;
  body.castShadow = true;
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.14, 6), mat(0xe8392d));
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, 0.1, -0.3);
  g.add(tail);
  for (const s of [-1, 1]) {
    const arm = box(0.05, 0.05, 0.18, red);
    arm.position.set(0.1 * s, 0.12, 0.2);
    arm.rotation.y = 0.5 * s;
    g.add(arm);
    const claw = sphere(0.085, 0xe8392d, 8);
    claw.scale.set(1, 0.7, 1.4);
    claw.position.set(0.17 * s, 0.13, 0.32);
    g.add(claw);
    const eye = sphere(0.025, 0x111111, 6);
    eye.position.set(0.045 * s, 0.2, 0.2);
    g.add(eye);
  }
  g.userData.h = 0.22;
  return g;
}

export function makeRoll() {
  const g = new THREE.Group();
  const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.32, 4, 8), mat(0xf0b765));
  bun.rotation.z = Math.PI / 2;
  bun.scale.set(1, 1, 0.8);
  bun.position.y = 0.11;
  g.add(bun);
  const fill = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 4, 8), mat(0xff6f5e));
  fill.rotation.z = Math.PI / 2;
  fill.position.y = 0.2;
  g.add(fill);
  const lettuce = box(0.42, 0.03, 0.16, 0x8be04e);
  lettuce.position.y = 0.17;
  g.add(lettuce);
  g.userData.h = 0.26;
  return g;
}

export function makeCash() {
  const g = new THREE.Group();
  const b = box(0.46, 0.12, 0.26, COLORS.cash);
  b.position.y = 0.06;
  g.add(b);
  const band = box(0.1, 0.13, 0.27, 0xffffff);
  band.position.y = 0.06;
  g.add(band);
  g.userData.h = 0.12;
  return g;
}

export function makeItem(kind: 'box' | 'lobster' | 'roll') {
  if (kind === 'box') return makeParcel();
  if (kind === 'lobster') return makeLobster();
  return makeRoll();
}

// ---------------- Vehicles ----------------

export type VehicleType = 'bike' | 'sedan' | 'pickup' | 'rv';
export const VEHICLE_LEN: Record<VehicleType, number> = { bike: 1.1, sedan: 2.1, pickup: 2.3, rv: 3.3 };
export const VEHICLE_UNITS: Record<VehicleType, number> = { bike: 1, sedan: 2, pickup: 2, rv: 3 };

function wheel() {
  const w = cyl(0.22, 0.22, 0.18, 0x2b2f38, 10);
  w.rotation.z = Math.PI / 2;
  return w;
}

export function makeVehicle(type: VehicleType, color: number) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const glass = 0x9fe3ff;
  if (type === 'bike') {
    const f = box(0.22, 0.25, 0.9, color);
    f.position.y = 0.42;
    body.add(f);
    for (const z of [-0.4, 0.4]) {
      const w = wheel();
      w.scale.set(0.8, 0.8, 0.8);
      w.position.set(0, 0.2, z);
      body.add(w);
    }
    const rider = makePerson(0xff7a59, { cap: 0x222222, scale: 0.75 });
    rider.position.set(0, 0.3, -0.05);
    rider.userData.armL.rotation.x = -1.2;
    rider.userData.armR.rotation.x = -1.2;
    body.add(rider);
  } else if (type === 'sedan') {
    const b = rbox(1.15, 0.45, 2.0, 0.25, color);
    b.position.y = 0.28;
    body.add(b);
    const cab = rbox(0.98, 0.38, 1.0, 0.2, glass);
    cab.position.set(0, 0.73, -0.1);
    body.add(cab);
    const roof = rbox(1.0, 0.08, 0.9, 0.2, color);
    roof.position.set(0, 1.1, -0.1);
    body.add(roof);
  } else if (type === 'pickup') {
    const b = rbox(1.2, 0.5, 2.25, 0.2, color);
    b.position.y = 0.3;
    body.add(b);
    const cab = rbox(1.05, 0.45, 0.8, 0.15, glass);
    cab.position.set(0, 0.8, 0.35);
    body.add(cab);
    const roof = rbox(1.08, 0.08, 0.75, 0.15, color);
    roof.position.set(0, 1.24, 0.35);
    body.add(roof);
    const bed = box(1.0, 0.1, 0.95, 0x3b3f48);
    bed.position.set(0, 0.81, -0.55);
    body.add(bed);
  } else {
    const b = rbox(1.3, 1.25, 3.2, 0.3, 0xfdfdfd);
    b.position.y = 0.3;
    body.add(b);
    const stripe = box(1.32, 0.18, 3.0, color);
    stripe.position.set(0, 0.85, 0);
    body.add(stripe);
    const win = box(1.1, 0.3, 0.05, glass);
    win.position.set(0, 1.15, 1.6);
    body.add(win);
    for (const s of [-1, 1]) {
      const sw = box(0.03, 0.3, 0.7, glass);
      sw.position.set(0.66 * s, 1.15, -0.3);
      body.add(sw);
    }
    const ac = box(0.6, 0.2, 0.6, 0xdcdcdc);
    ac.position.set(0, 1.65, -0.6);
    body.add(ac);
  }
  if (type !== 'bike') {
    const len = VEHICLE_LEN[type];
    const halfW = type === 'rv' ? 0.62 : 0.55;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const w = wheel();
      w.position.set(halfW * sx, 0.22, (len / 2 - 0.45) * sz);
      body.add(w);
    }
    for (const sx of [-1, 1]) {
      const hl = box(0.2, 0.12, 0.05, 0xfff6c2);
      hl.position.set(0.35 * sx, 0.5, len / 2 - 0.02);
      body.add(hl);
    }
  }
  g.userData = { body, type };
  return g;
}

// ---------------- Ferry ----------------

export function makeFerry(rows: number) {
  const g = new THREE.Group();
  const deckLen = rows * 2.4 + 1.6; // vehicle area length
  const cargoLen = 2.4;
  const totalLen = deckLen + cargoLen + 1.4;
  const width = 5.2;
  // hull
  const hullShape = new THREE.Shape();
  const hw = width / 2;
  hullShape.moveTo(-hw, 0);
  hullShape.lineTo(hw, 0);
  hullShape.lineTo(hw, totalLen - 1.6);
  hullShape.quadraticCurveTo(hw, totalLen, 0, totalLen + 0.4);
  hullShape.quadraticCurveTo(-hw, totalLen, -hw, totalLen - 1.6);
  hullShape.lineTo(-hw, 0);
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 0.95, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1, bevelSegments: 1 });
  hullGeo.rotateX(-Math.PI / 2);
  // shape y -> -z (forward = -z)
  const hull = new THREE.Mesh(hullGeo, mat(COLORS.white));
  hull.position.y = -0.6;
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);
  const stripe = new THREE.Mesh(hullGeo, mat(COLORS.red));
  stripe.scale.set(1.01, 0.22, 1.004);
  stripe.position.y = -0.08;
  g.add(stripe);
  // deck
  const deck = box(width - 0.2, 0.12, totalLen - 0.3, 0x6b7380);
  deck.position.set(0, 0.54, -(totalLen - 0.3) / 2 - 0.05);
  deck.castShadow = false;
  g.add(deck);
  // lane lines
  for (let i = 0; i < rows * 2; i++) {
    const l = box(0.08, 0.02, 0.9, COLORS.roadLine);
    l.position.set(0, 0.61, -0.8 - i * 1.2);
    g.add(l);
  }
  // cargo area (front)
  const cargoZ = -(deckLen + cargoLen / 2 + 0.2);
  const cargoPad = box(width - 0.8, 0.04, cargoLen - 0.3, 0x8a6a4a);
  cargoPad.position.set(0, 0.62, cargoZ);
  g.add(cargoPad);
  // side rails
  for (const s of [-1, 1]) {
    const rail = box(0.12, 0.35, totalLen - 1.6, COLORS.white);
    rail.position.set((hw - 0.15) * s, 0.78, -(totalLen - 1.6) / 2 - 0.2);
    g.add(rail);
  }
  // bridge tower on the right side
  const bridge = new THREE.Group();
  const tower = box(1.3, 1.6, 2.4, COLORS.white);
  tower.position.y = 1.4;
  bridge.add(tower);
  const win = box(1.32, 0.35, 2.2, 0x2f4a73);
  win.position.y = 1.85;
  bridge.add(win);
  const roof = box(1.5, 0.15, 2.6, COLORS.red);
  roof.position.y = 2.28;
  bridge.add(roof);
  const funnel = cyl(0.28, 0.32, 0.9, COLORS.red, 10);
  funnel.position.set(0, 2.75, -0.6);
  bridge.add(funnel);
  const funnelTop = cyl(0.3, 0.3, 0.18, 0x2b2f38, 10);
  funnelTop.position.set(0, 3.25, -0.6);
  bridge.add(funnelTop);
  bridge.position.set(hw + 0.55, 0, cargoZ + 0.4);
  g.add(bridge);
  // sponson under bridge
  const spon = box(1.4, 0.9, 2.8, COLORS.white);
  spon.position.set(hw + 0.5, 0.05, cargoZ + 0.4);
  g.add(spon);
  // stern ramp (pivot at stern edge)
  const rampPivot = new THREE.Group();
  rampPivot.position.set(0, 0.6, 0.15);
  const ramp = box(3.4, 0.12, 1.6, 0x8a929e);
  ramp.position.z = 0.8;
  rampPivot.add(ramp);
  g.add(rampPivot);
  // flag
  const pole = cyl(0.03, 0.03, 1.2, 0xdddddd, 6);
  pole.position.set(0, 1.2, -totalLen + 0.4);
  g.add(pole);
  const flag = box(0.5, 0.3, 0.02, COLORS.red);
  flag.position.set(0.25, 1.6, -totalLen + 0.4);
  g.add(flag);

  g.userData = {
    rampPivot,
    funnelTop: new THREE.Vector3(hw + 0.55, 3.4, cargoZ - 0.2),
    deckY: 0.6,
    deckStartZ: -0.9,
    rowLen: 2.4,
    cargoZ,
    totalLen,
    flag,
  };
  return g;
}

// ---------------- Buildings & props ----------------

export function makeBooth() {
  const g = new THREE.Group();
  const base = rbox(1.6, 1.3, 1.6, 0.2, COLORS.white);
  g.add(base);
  const band = box(1.62, 0.25, 1.62, COLORS.navy);
  band.position.y = 1.0;
  g.add(band);
  const win = box(1.62, 0.5, 1.0, 0x9fe3ff);
  win.position.y = 1.45;
  g.add(win);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.7, 4), mat(COLORS.red, { flat: true }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.35;
  roof.castShadow = true;
  g.add(roof);
  const top = box(1.75, 0.2, 1.75, COLORS.white);
  top.position.y = 1.9;
  g.add(top);
  const sign = box(1.2, 0.3, 0.06, COLORS.yellow);
  sign.position.set(0, 2.05, 0.9);
  g.add(sign);
  return g;
}

export function makeBarrier() {
  const g = new THREE.Group();
  const post = box(0.3, 0.9, 0.3, COLORS.yellow);
  post.position.y = 0.45;
  g.add(post);
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 0.8, 0);
  const arm = new THREE.Group();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const seg = box(0.5, 0.1, 0.1, i % 2 ? COLORS.white : COLORS.red);
    seg.position.x = 0.25 + i * 0.5;
    arm.add(seg);
  }
  armPivot.add(arm);
  g.add(armPivot);
  g.userData.arm = armPivot;
  return g;
}

export function makeShed() {
  const g = new THREE.Group();
  const walls = box(3.4, 2.0, 2.8, 0x6fa8dc);
  walls.position.y = 1.0;
  g.add(walls);
  for (const sz of [-1, 1]) {
    const slab = box(3.7, 0.14, 1.75, 0xe9edf2);
    slab.position.set(0, 2.32, 0.7 * sz);
    slab.rotation.x = 0.5 * sz;
    g.add(slab);
  }
  const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.55, 0.75, 3, 1), mat(0x6fa8dc, { flat: true }));
  gable.rotation.z = Math.PI / 2;
  gable.rotation.y = Math.PI / 2;
  gable.scale.set(1, 4.4, 1);
  gable.position.y = 2.2;
  void gable;
  const door = box(1.6, 1.5, 0.06, 0x4c7fb3);
  door.position.set(-1.71, 0.8, 0);
  door.rotation.y = Math.PI / 2;
  g.add(door);
  for (let i = 0; i < 4; i++) {
    const s = box(1.5, 0.05, 0.07, 0x3d6a96);
    s.position.set(-1.75, 0.3 + i * 0.35, 0);
    s.rotation.y = Math.PI / 2;
    g.add(s);
  }
  const sign = box(0.06, 0.45, 1.8, COLORS.orange);
  sign.position.set(-1.72, 1.85, 0);
  g.add(sign);
  // conveyor out the front (to -x)
  const conv = box(1.4, 0.4, 0.9, 0x5d6574);
  conv.position.set(-2.3, 0.2, -0.9);
  g.add(conv);
  return g;
}

export function makeStand(awning: number) {
  const g = new THREE.Group();
  const counter = rbox(2.4, 0.95, 1.0, 0.12, COLORS.white);
  g.add(counter);
  const front = box(2.42, 0.4, 1.02, awning);
  front.position.y = 0.25;
  g.add(front);
  for (const s of [-1, 1]) {
    const post = box(0.12, 2.2, 0.12, COLORS.woodDark);
    post.position.set(1.1 * s, 1.1, -0.45);
    g.add(post);
    const post2 = post.clone();
    post2.position.z = 0.45;
    post2.scale.y = 1;
    g.add(post2);
  }
  // striped awning
  for (let i = 0; i < 6; i++) {
    const strip = box(0.42, 0.08, 1.5, i % 2 ? COLORS.white : awning);
    strip.position.set(-1.05 + i * 0.42, 2.25, 0.1);
    strip.rotation.x = -0.25;
    g.add(strip);
  }
  const sign = box(1.6, 0.4, 0.08, COLORS.navy);
  sign.position.set(0, 2.55, -0.5);
  g.add(sign);
  const ice = box(2.1, 0.06, 0.8, 0xd9f6ff);
  ice.position.y = 0.97;
  g.add(ice);
  return g;
}

export function makeShack() {
  const g = new THREE.Group();
  const walls = box(3.0, 1.9, 2.4, 0xff8a7a);
  walls.position.y = 0.95;
  g.add(walls);
  // clapboard lines
  for (let i = 0; i < 5; i++) {
    const l = box(3.02, 0.04, 2.42, 0xf06f60);
    l.position.y = 0.3 + i * 0.35;
    g.add(l);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.1, 4), mat(0x5b6b8c, { flat: true }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.8);
  roof.position.y = 2.45;
  roof.castShadow = true;
  g.add(roof);
  const win = box(1.6, 0.7, 0.06, 0x9fe3ff);
  win.position.set(0, 1.25, 1.22);
  g.add(win);
  const counter = box(2.0, 0.12, 0.5, COLORS.wood);
  counter.position.set(0, 0.9, 1.4);
  g.add(counter);
  const sign = box(2.0, 0.45, 0.1, COLORS.white);
  sign.position.set(0, 2.15, 1.25);
  g.add(sign);
  const lob = makeLobster();
  lob.scale.setScalar(1.6);
  lob.position.set(0, 2.15, 1.32);
  lob.rotation.x = Math.PI / 2;
  g.add(lob);
  const chimney = box(0.35, 0.8, 0.35, 0x9aa3b5);
  chimney.position.set(0.9, 2.6, -0.5);
  g.add(chimney);
  g.userData.chimney = new THREE.Vector3(0.9, 3.1, -0.5);
  return g;
}

export function makeOffice() {
  const g = new THREE.Group();
  const walls = box(3.2, 1.8, 2.2, 0xfff2cc);
  walls.position.y = 0.9;
  g.add(walls);
  const roof = box(3.5, 0.25, 2.5, 0x2f4a73);
  roof.position.y = 1.9;
  g.add(roof);
  const door = box(0.8, 1.2, 0.06, 0x2f4a73);
  door.position.set(0, 0.6, 1.11);
  g.add(door);
  for (const s of [-1, 1]) {
    const w = box(0.7, 0.6, 0.06, 0x9fe3ff);
    w.position.set(1.0 * s, 1.1, 1.11);
    g.add(w);
  }
  const sign = box(1.6, 0.35, 0.1, COLORS.yellow);
  sign.position.set(0, 2.2, 0.9);
  g.add(sign);
  return g;
}

export function makeLighthouse() {
  const g = new THREE.Group();
  const base = cyl(1.4, 1.6, 0.6, 0x8a929e, 10);
  base.position.y = 0.3;
  g.add(base);
  for (let i = 0; i < 4; i++) {
    const seg = cyl(0.9 - i * 0.1, 1.0 - i * 0.1, 1.2, i % 2 ? COLORS.white : COLORS.red, 12);
    seg.position.y = 1.2 + i * 1.2;
    g.add(seg);
  }
  const room = cyl(0.65, 0.65, 0.8, 0xfff6c2, 10);
  room.position.y = 5.8;
  g.add(room);
  const lightM = new THREE.MeshBasicMaterial({ color: 0xfff1a0 });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lightM);
  light.position.y = 5.8;
  g.add(light);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.8, 10), mat(COLORS.red));
  cap.position.y = 6.6;
  g.add(cap);
  const rail = cyl(0.9, 0.9, 0.08, 0x2b2f38, 12);
  rail.position.y = 5.35;
  g.add(rail);
  g.userData.light = light;
  return g;
}

export function makeHouse(color: number, roofColor: number) {
  const g = new THREE.Group();
  const w = box(2.6, 1.8, 2.2, color);
  w.position.y = 0.9;
  g.add(w);
  for (let i = 0; i < 4; i++) {
    const l = box(2.62, 0.04, 2.22, 0xffffff);
    l.position.y = 0.35 + i * 0.4;
    g.add(l);
  }
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.7, 1.2, 4, 1), mat(roofColor, { flat: true }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.15, 1, 0.95);
  roof.position.y = 2.4;
  roof.castShadow = true;
  g.add(roof);
  const door = box(0.6, 1.0, 0.06, 0x2f4a73);
  door.position.set(0, 0.5, 1.11);
  g.add(door);
  for (const s of [-1, 1]) {
    const win = box(0.5, 0.5, 0.06, 0x9fe3ff);
    win.position.set(0.8 * s, 1.15, 1.11);
    g.add(win);
  }
  return g;
}

export function makeTree(scale = 1) {
  const g = new THREE.Group();
  const trunk = cyl(0.12, 0.16, 0.8, COLORS.woodDark, 6);
  trunk.position.y = 0.4;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 7), mat(0x3fae4a, { flat: true }));
  leaves.position.y = 1.5;
  leaves.castShadow = true;
  g.add(leaves);
  const l2 = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 7), mat(0x4cc257, { flat: true }));
  l2.position.y = 2.2;
  l2.castShadow = true;
  g.add(l2);
  g.scale.setScalar(scale);
  return g;
}

export function makeBuoy(color: number) {
  const g = new THREE.Group();
  const b = sphere(0.35, color, 10);
  b.scale.y = 0.8;
  g.add(b);
  const top = cyl(0.05, 0.05, 0.6, color, 6);
  top.position.y = 0.4;
  g.add(top);
  return g;
}

export function makeGull() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.35, 4, 8), mat(0xffffff));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const head = sphere(0.14, 0xffffff, 8);
  head.position.set(0, 0.1, 0.3);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), mat(COLORS.yellow));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.08, 0.47);
  g.add(beak);
  const wings: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.12 * s, 0.05, 0);
    const w = box(0.6, 0.04, 0.28, 0xd8dde6);
    w.position.x = 0.3 * s;
    pivot.add(w);
    const tip = box(0.18, 0.045, 0.26, 0x3b3f48);
    tip.position.x = 0.62 * s;
    pivot.add(tip);
    g.add(pivot);
    wings.push(pivot);
  }
  for (const s of [-1, 1]) {
    const eye = sphere(0.025, 0x111111, 6);
    eye.position.set(0.08 * s, 0.15, 0.38);
    g.add(eye);
  }
  g.userData.wings = wings;
  return g;
}

export function makeCrate() {
  const g = new THREE.Group();
  const b = box(0.8, 0.5, 0.6, COLORS.wood);
  b.position.y = 0.25;
  g.add(b);
  for (const y of [0.12, 0.38]) {
    const s = box(0.82, 0.06, 0.62, COLORS.woodDark);
    s.position.y = y;
    g.add(s);
  }
  return g;
}

export function makeBollard() {
  const b = cyl(0.14, 0.18, 0.4, 0x2b2f38, 8);
  b.position.y = 0.2;
  return b;
}
