// Game logic: player, ferry, traffic, shops, workers, events, progression.
import * as THREE from 'three';
import { CFG, type ItemKind } from './config';
import { LAYOUT, WALKABLE, COLLIDERS, addCollider } from './world';
import * as M from './models';
import { Particles, WorldUI, Shake } from './fx';
import { Stack, Pile, CashPile, Pad } from './parts';
import { sfx } from './audio';
import { rand, pick, clamp, damp, ease, tweens, popIn, squash, arcMove, vibrate } from './util';

type Label = ReturnType<WorldUI['add']>;
const V = (x: number, z: number, y = 0) => new THREE.Vector3(x, y, z);
const flatDist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const SHIRTS = [0xff6b6b, 0x4dabf7, 0x51cf66, 0xfcc419, 0xcc5de8, 0xff922b, 0x20c997, 0xf06595, 0x748ffc];
const CAR_COLORS = [0xff5a5f, 0x4dabf7, 0xffd23f, 0x51cf66, 0xff922b, 0x9775fa, 0x2f4a73, 0xf8f9fa];

function angleDamp(a: number, b: number, lambda: number, dt: number) {
  const diff = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + diff * (1 - Math.exp(-lambda * dt));
}

function stepTowards(obj: THREE.Object3D, target: THREE.Vector3, speed: number, dt: number, turn = 12): boolean {
  const dx = target.x - obj.position.x, dz = target.z - obj.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.04) return true;
  const step = Math.min(d, speed * dt);
  obj.position.x += (dx / d) * step;
  obj.position.z += (dz / d) * step;
  obj.rotation.y = angleDamp(obj.rotation.y, Math.atan2(dx, dz), turn, dt);
  return d - step < 0.04;
}

function inWalkable(x: number, z: number) {
  return WALKABLE.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

function resolveMove(pos: THREE.Vector3, nx: number, nz: number, radius = 0.38) {
  let x = nx, z = nz;
  if (!inWalkable(x, pos.z)) x = pos.x;
  if (!inWalkable(x, z)) z = pos.z;
  for (const c of COLLIDERS) {
    const cx = clamp(x, c.minX, c.maxX), cz = clamp(z, c.minZ, c.maxZ);
    const dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d > 1e-4) {
      x = cx + (dx / d) * radius;
      z = cz + (dz / d) * radius;
    } else {
      const pushes = [x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z];
      const m = Math.min(...pushes);
      if (m === pushes[0]) x = c.minX - radius;
      else if (m === pushes[1]) x = c.maxX + radius;
      else if (m === pushes[2]) z = c.minZ - radius;
      else z = c.maxZ + radius;
    }
  }
  pos.x = x;
  pos.z = z;
}

/** Flat ground marker telling the player where to stand. */
function makeZonePlate(icon: string, size = 1.7, color = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.strokeStyle = color;
  c.lineWidth = 7;
  c.setLineDash([14, 9]);
  c.beginPath();
  c.roundRect(8, 8, 112, 112, 26);
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fill();
  c.setLineDash([]);
  c.font = '54px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(icon, 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.y = 0.08;
  m.renderOrder = 1;
  return m;
}

function makeProgressRing(r = 0.95, color = 0xffd23f) {
  const segs = 40;
  const g = new THREE.RingGeometry(r, r + 0.16, segs, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
  m.position.y = 0.11;
  m.rotation.y = Math.PI / 2;
  m.renderOrder = 4;
  const set = (p: number) => {
    const n = Math.floor(clamp(p, 0, 1) * segs);
    g.setDrawRange(0, n * 6);
    m.visible = n > 0;
  };
  set(0);
  return { mesh: m, set };
}

// =====================================================================
// Entities
// =====================================================================

type VState = 'queue' | 'boarding' | 'aboard' | 'disembark';

class Vehicle {
  mesh: THREE.Group;
  len: number;
  state: VState = 'queue';
  paid = false;
  serveT = 0;
  slotLocal = new THREE.Vector3();
  col = 0;
  path: THREE.Vector3[] = [];
  bubble: Label | null = null;
  bubbleKind = '';
  speed = CFG.vehicles.speed;
  waitT = 0;
  constructor(public type: M.VehicleType, public vip = false) {
    this.mesh = M.makeVehicle(type, vip ? 0xffd23f : pick(CAR_COLORS));
    this.len = M.VEHICLE_LEN[type];
  }
}

class Customer {
  person: M.Person;
  want: number;
  got: THREE.Object3D[] = [];
  state: 'walk' | 'leave' = 'walk';
  bubble: Label | null = null;
  bubbleKey = '';
  waitT = 0;
  constructor(want: number, tourist: boolean) {
    this.person = M.makePerson(pick(SHIRTS), { cap: tourist || Math.random() < 0.4 ? pick([0xff5a5f, 0xffffff, 0x2f4a73, 0xfcc419]) : undefined, pants: pick([0x3a4a6b, 0x5c4033, 0x2b2f38, 0x4a6fa5]) });
    this.want = want;
  }
}

class Shop {
  built = false;
  group: THREE.Group | null = null;
  queue: Customer[] = [];
  leaving: Customer[] = [];
  spawnT = 0;
  takeT = 0;
  cookT = 0;
  stock: Pile;
  input: Pile | null = null;
  cash: CashPile;
  stockLabel: Label | null = null;
  speedMul = 1;
  constructor(
    public kind: 'stand' | 'shack',
    public scene: THREE.Scene,
    public product: ItemKind,
    public price: number,
    public queueOrigin: THREE.Vector3,
    public spawnFrom: THREE.Vector3,
    public spawnInterval: number,
    public maxQueue: number,
    stockOrigin: THREE.Vector3,
    stockMax: number,
    cashOrigin: THREE.Vector3,
    cols: number,
    rows: number,
  ) {
    this.stock = new Pile(scene, stockOrigin, product, stockMax, cols, rows, 0.48, 0.36, stockOrigin.y);
    this.cash = new CashPile(scene, cashOrigin);
  }
  slot(i: number) {
    return V(this.queueOrigin.x, this.queueOrigin.z + i * 0.95);
  }
}

type Role = 'clerk' | 'dockhand' | 'unloader';

class Worker {
  person: M.Person;
  stack: Stack;
  state: 'toSource' | 'loading' | 'toDest' | 'unloading' = 'toSource';
  t = 0;
  anim = 0;
  dest: 'cargo' | 'stand' | 'shack' = 'cargo';
  moving = 0;
  constructor(public role: Role, scene: THREE.Scene) {
    const shirt = role === 'clerk' ? 0x2f4a73 : role === 'dockhand' ? 0xff922b : 0x20c997;
    this.person = M.makePerson(shirt, { cap: role === 'clerk' ? 0x2f4a73 : 0xffd23f, pants: 0x2b2f38 });
    this.stack = new Stack(this.person.userData.carryAnchor, scene, CFG.workers.capacity);
  }
}

// =====================================================================
// Ferry
// =====================================================================

type FState = 'docked' | 'leaving' | 'island' | 'returning' | 'unloading';

class Ferry {
  group!: THREE.Group;
  rows: number;
  cargoCap: number;
  level = 0;
  pendingLevel = -1;
  state: FState = 'docked';
  timer: number = CFG.ferry.dockTime;
  stateT = 0;
  colUsed = [0, 0];
  aboard: Vehicle[] = [];
  incoming = 0;
  cargo: THREE.Object3D[] = [];
  cargoArriving = 0;
  arrivals: Vehicle[] = [];
  lobsters: THREE.Object3D[] = [];
  returns = 0;
  deliveredCargo = 0;
  rampAngle = 0.32;
  rampTarget = 0.32;
  unloadT = 0;
  wakeT = 0;
  hornPlayed = false;
  label!: Label;
  constructor(private scene: THREE.Scene) {
    this.rows = CFG.ferry.rowsByLevel[0];
    this.cargoCap = CFG.ferry.cargoByLevel[0];
    this.build();
  }
  build() {
    const old = this.group;
    this.group = M.makeFerry(this.rows);
    this.group.position.copy(old ? old.position : LAYOUT.ferryStern);
    this.group.rotation.copy(old ? old.rotation : new THREE.Euler());
    if (old) {
      for (const ch of [...old.children]) if (ch.userData.keep) this.group.attach(ch);
      old.removeFromParent();
    }
    this.scene.add(this.group);
    this.applyRamp();
  }
  get colLen() { return this.rows * 2.4 + 1.0; }
  canFit(len: number) {
    let best = -1;
    for (let c = 0; c < 2; c++) {
      if (this.colUsed[c] + len <= this.colLen && (best < 0 || this.colUsed[c] < this.colUsed[best])) best = c;
    }
    return best;
  }
  reserve(col: number, len: number) {
    const z = -(0.9 + this.colUsed[col] + len / 2);
    this.colUsed[col] += len + 0.3;
    return V(col === 0 ? -1.15 : 1.15, z, this.group.userData.deckY + 0.02);
  }
  get deckFull() { return this.colUsed.every((u) => this.colLen - u < 1.15); }
  get cargoCount() { return this.cargo.length + this.cargoArriving; }
  get cargoFull() { return this.cargoCount >= this.cargoCap; }
  get canLoad() { return this.state === 'docked' && this.rampAngle > 0.2; }
  cargoSlotLocal(i: number) {
    const per = 6;
    const layer = Math.floor(i / per);
    const j = i % per;
    return V(-1.3 + (j % 3) * 1.3, this.group.userData.cargoZ + (Math.floor(j / 3) - 0.5) * 0.85, 0.62 + layer * 0.34);
  }
  lobsterSlotLocal(i: number) {
    const per = 9;
    const layer = Math.floor(i / per);
    const j = i % per;
    return V(-1.3 + (j % 3) * 1.3, this.group.userData.cargoZ + (Math.floor(j / 3) - 1) * 0.7, 0.64 + layer * 0.26);
  }
  applyRamp() {
    (this.group.userData.rampPivot as THREE.Object3D).rotation.x = this.rampAngle;
  }
}

// =====================================================================
// Pad definitions
// =====================================================================

type PadDef = {
  id: string;
  title: string;
  icon: string;
  price: number;
  stars: number;
  level: number;
  pos: THREE.Vector3;
  reveal: () => boolean;
  build: () => void;
  repeat?: () => { price: number; title: string } | null; // next tier, or null when maxed
  pad?: Pad;
  done?: boolean;
  needExit?: boolean;
};

// =====================================================================
// Game
// =====================================================================

export type HudEls = {
  money: HTMLElement;
  moneyBox: HTMLElement;
  levelNum: HTMLElement;
  levelFill: HTMLElement;
  levelText: HTMLElement;
  levelStar: HTMLElement;
  objective: HTMLElement;
  objectiveText: HTMLElement;
  banner: HTMLElement;
  stage: HTMLElement;
};

export class Game {
  time = 0;
  money = CFG.startMoney;
  shownMoney = CFG.startMoney;
  stars = 0;
  pendingStars = 0;
  level = 1;

  player!: M.Person;
  stack!: Stack;
  playerVel = new THREE.Vector3();
  playerSpeed = CFG.player.speed;
  capLevel = 0;
  speedLevel = 0;
  pickT = 0;
  dropT = 0;
  input = new THREE.Vector2();

  ferry!: Ferry;
  queue: Vehicle[] = [];
  outbound: Vehicle[] = [];
  spawnT = 1.5;
  barrier!: THREE.Group;
  barrierOpen = 0;
  barrierTarget = 0;
  barrierCloseT = 0;
  boothRing = makeProgressRing(0.75);

  booth: THREE.Group | null = null;
  boothCash!: CashPile;
  shedPile: Pile | null = null;
  shedT = 0;
  shed: THREE.Group | null = null;
  unloadPile!: Pile;
  cargoCash!: CashPile;
  stand!: Shop;
  shack!: Shop;
  office: THREE.Group | null = null;
  zonePlates: Record<string, THREE.Mesh> = {};

  workers: Worker[] = [];
  clerkHired = false;

  pads: PadDef[] = [];
  stats = { tickets: 0, cargo: 0, lobstersStocked: 0, lobstersSold: 0, rolls: 0, collected: 0, fullShips: 0 };

  // objective
  objectiveKey = '';
  arrow!: THREE.Group;
  marker!: THREE.Mesh;
  objTarget: THREE.Vector3 | null = null;

  // events
  gull: { mesh: THREE.Group; state: 'in' | 'sit' | 'out'; t: number; carrying: THREE.Object3D | null; label: Label | null; from: THREE.Vector3 } | null = null;
  gullT = 40;
  vipT = 30;
  ended = false;

  constructor(
    public scene: THREE.Scene,
    public camera: THREE.PerspectiveCamera,
    public fx: Particles,
    public ui: WorldUI,
    public shake: Shake,
    public hud: HudEls,
  ) {
    this.setup();
  }

  // -------------------------------------------------------------------
  setup() {
    const s = this.scene;
    // player
    this.player = M.makePerson(0xff5a5f, { cap: 0x2f4a73, pants: 0x2f4a73 });
    this.player.position.copy(LAYOUT.playerStart);
    this.player.rotation.y = Math.PI;
    s.add(this.player);
    this.stack = new Stack(this.player.userData.carryAnchor, s, CFG.upgrades.capacity[0], true);
    const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    shadowDisc.position.y = 0.07;
    this.player.add(shadowDisc);

    // ferry
    this.ferry = new Ferry(s);
    this.ferry.label = this.ui.add('timer-bar', '<div></div><span></span>', () => this.ferry.group.localToWorld(V(0, -2.2, 3.4)));

    // barrier (exists from start; cars wait here)
    this.barrier = M.makeBarrier();
    this.barrier.position.copy(LAYOUT.barrier);
    s.add(this.barrier);

    // booth progress ring
    this.boothRing.mesh.position.set(LAYOUT.boothZone.x, 0.11, LAYOUT.boothZone.z);
    s.add(this.boothRing.mesh);

    // piles
    this.boothCash = new CashPile(s, LAYOUT.boothCash);
    this.cargoCash = new CashPile(s, LAYOUT.cargoCash);
    this.unloadPile = new Pile(s, LAYOUT.unloadPile, 'lobster', 60, 3, 3, 0.55, 0.5, 0.12);

    // shops (not built yet)
    this.stand = new Shop('stand', s, 'lobster', CFG.stand.lobsterPrice, LAYOUT.standQueue, LAYOUT.customerSpawnW, CFG.stand.spawnInterval, CFG.stand.maxQueue,
      V(LAYOUT.stand.x, LAYOUT.stand.z, 1.01), CFG.stand.stockMax, LAYOUT.standCash, 4, 2);
    this.shack = new Shop('shack', s, 'roll', CFG.shack.rollPrice, LAYOUT.shackQueue, LAYOUT.customerSpawnW2, CFG.shack.spawnInterval, CFG.shack.maxQueue,
      V(LAYOUT.shack.x, LAYOUT.shack.z + 1.42, 0.97), CFG.shack.outputMax, LAYOUT.shackCash, 4, 1);
    this.shack.stock.sz = 0.3;
    this.shack.input = new Pile(s, V(-5.15, 8.1), 'lobster', CFG.shack.inputMax, 2, 2, 0.5, 0.5, 0.06);

    // zone plates (hidden until relevant)
    const zp = (key: string, icon: string, pos: THREE.Vector3, size = 1.7) => {
      const m = makeZonePlate(icon, size);
      m.position.x = pos.x;
      m.position.z = pos.z;
      m.position.y = pos.z < -0.8 ? 0.13 : 0.08;
      m.visible = false;
      s.add(m);
      this.zonePlates[key] = m;
    };
    zp('booth', '🎟️', LAYOUT.boothZone, 1.5);
    zp('shed', '📦', LAYOUT.shedPile, 2.0);
    zp('cargo', '⛴️', LAYOUT.cargoPad, 2.2);
    zp('unload', '🦞', LAYOUT.unloadPile, 2.2);
    zp('stand', '🦞', LAYOUT.standDrop, 1.5);
    zp('shack', '🦞', LAYOUT.shackDrop, 1.5);

    // objective arrow + marker
    this.arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.7), new THREE.MeshBasicMaterial({ color: 0xff5d73 }));
    shaft.position.z = 0.35;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 3).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5d73 }));
    head.position.z = 0.9;
    head.rotation.z = Math.PI;
    this.arrow.add(shaft, head);
    this.arrow.position.y = 0.12;
    s.add(this.arrow);
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4).rotateX(Math.PI), new THREE.MeshLambertMaterial({ color: 0xff5d73, emissive: 0x551020 }));
    s.add(this.marker);

    this.definePads();
    this.updateHud(true);
  }

  // -------------------------------------------------------------------
  definePads() {
    const P = LAYOUT;
    const capTier = () => {
      const i = this.capLevel;
      if (i >= CFG.upgrades.capacityPrice.length) return null;
      return { price: CFG.upgrades.capacityPrice[i], title: `Carry ${CFG.upgrades.capacity[i + 1]}` };
    };
    const speedTier = () => {
      const i = this.speedLevel;
      if (i >= CFG.upgrades.speedPrice.length) return null;
      return { price: CFG.upgrades.speedPrice[i], title: `Speed Lv${i + 2}` };
    };
    const built = (id: string) => this.pads.find((p) => p.id === id)?.done ?? false;
    const defs: PadDef[] = [
      { id: 'booth', title: 'Ticket Booth', icon: '🎟️', price: 20, stars: 2, level: 1, pos: V(-3.5, 3.0), reveal: () => true, build: () => this.buildBooth() },
      { id: 'shed', title: 'Cargo Shed', icon: '📦', price: 40, stars: 2, level: 1, pos: P.shed.clone().add(V(-0.6, 0)), reveal: () => built('booth') && this.stats.tickets >= 3, build: () => this.buildShed() },
      { id: 'stand', title: 'Seafood Stand', icon: '🦞', price: 60, stars: 3, level: 1, pos: P.stand.clone(), reveal: () => built('shed') && this.ferry.returns >= 1, build: () => this.buildStand() },
      { id: 'clerk', title: 'Hire Clerk', icon: '🧑‍💼', price: 80, stars: 3, level: 2, pos: P.padClerk, reveal: () => built('stand'), build: () => this.hireWorker('clerk') },
      { id: 'cap', title: 'Carry 8', icon: '💪', price: CFG.upgrades.capacityPrice[0], stars: 1, level: 2, pos: P.padCapacity, reveal: () => built('stand'), build: () => this.upgradeCapacity(), repeat: capTier },
      { id: 'speed', title: 'Speed Lv2', icon: '👟', price: CFG.upgrades.speedPrice[0], stars: 1, level: 2, pos: P.padSpeed, reveal: () => built('stand'), build: () => this.upgradeSpeed(), repeat: speedTier },
      { id: 'dockhand', title: 'Hire Dockhand', icon: '📦', price: 120, stars: 3, level: 2, pos: P.padDockhand, reveal: () => built('stand'), build: () => this.hireWorker('dockhand') },
      { id: 'ferry1', title: 'Bigger Ferry', icon: '⛴️', price: 150, stars: 4, level: 3, pos: P.padFerry, reveal: () => built('clerk'), build: () => this.upgradeFerry(1) },
      { id: 'shack', title: 'Lobster Shack', icon: '🌭', price: 200, stars: 4, level: 3, pos: P.shack.clone(), reveal: () => built('clerk'), build: () => this.buildShack() },
      { id: 'unloader', title: 'Hire Unloader', icon: '🦞', price: 180, stars: 3, level: 3, pos: P.padUnloader, reveal: () => built('dockhand'), build: () => this.hireWorker('unloader') },
      { id: 'standUp', title: 'Stand Upgrade', icon: '⭐', price: 260, stars: 3, level: 4, pos: P.padStandUp, reveal: () => built('shack'), build: () => this.upgradeStand() },
      { id: 'ferry2', title: 'Bigger Ferry II', icon: '⛴️', price: 420, stars: 4, level: 4, pos: P.padFerry, reveal: () => built('ferry1'), build: () => this.upgradeFerry(2) },
      { id: 'route2', title: 'Apple Orchard Isle', icon: '🍎', price: 650, stars: 5, level: 5, pos: P.padRoute2, reveal: () => built('ferry1') && built('shack'), build: () => this.openRoute2() },
    ];
    for (const d of defs) {
      d.pad = new Pad(this.scene, d.pos, d.title, d.price, d.level, d.icon);
      this.pads.push(d);
    }
  }

  // -------------------------------------------------------------------
  // Money, stars, levels
  // -------------------------------------------------------------------

  addMoney(n: number) {
    this.money += n;
    this.stats.collected += Math.max(0, n);
  }

  addStars(n: number, from: THREE.Vector3) {
    // fly a DOM star from the world position to the level box
    const p = from.clone().project(this.camera);
    const stage = this.hud.stage.getBoundingClientRect();
    const target = this.hud.levelStar.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.textContent = '⭐';
      el.style.cssText = `position:absolute;font-size:30px;left:${(p.x * 0.5 + 0.5) * stage.width}px;top:${(-p.y * 0.5 + 0.5) * stage.height}px;transform:translate(-50%,-50%);z-index:15;pointer-events:none;transition:left .7s cubic-bezier(.5,-0.3,.7,1), top .7s cubic-bezier(.3,0,.6,1.4), transform .7s;`;
      this.hud.stage.appendChild(el);
      const delay = 120 + i * 90;
      setTimeout(() => {
        el.style.left = `${target.left - stage.left + target.width / 2}px`;
        el.style.top = `${target.top - stage.top + target.height / 2}px`;
        el.style.transform = 'translate(-50%,-50%) scale(0.6) rotate(200deg)';
      }, delay);
      setTimeout(() => {
        el.remove();
        this.stars += 1;
        sfx.pop();
        this.hud.levelStar.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 250 });
        this.checkLevel();
      }, delay + 720);
    }
  }

  checkLevel() {
    const L = CFG.levels;
    while (this.level < L.length && this.stars >= L[this.level]) {
      this.level++;
      sfx.levelUp();
      vibrate(30);
      this.fx.confetti(this.player.position.clone().add(V(0, 0, 2)), 70, 1.1);
      const newly = this.pads.filter((p) => p.level === this.level && !p.done).map((p) => p.title);
      this.showBanner('LEVEL UP!', newly.length ? `New: ${newly.slice(0, 2).join(', ')}` : 'Keep growing!', this.level);
      for (const d of this.pads) if (d.pad && d.pad.locked && this.level >= d.level) { d.pad.locked = false; d.pad.draw(true); popIn(d.pad.group, 0.4); }
    }
  }

  showBanner(title: string, sub: string, starNum?: number) {
    const b = this.hud.banner;
    b.innerHTML = `${starNum !== undefined ? `<div class="bstar">${starNum}</div>` : ''}<div class="ribbon-red">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // -------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    this.updatePlayer(dt);
    this.updateFerry(dt);
    this.updateTraffic(dt);
    this.updateShed(dt);
    this.updateShop(this.stand, dt);
    this.updateShop(this.shack, dt);
    this.updateShack(dt);
    this.updateWorkers(dt);
    this.updatePads(dt);
    this.updateEvents(dt);
    this.updateObjective(dt);
    this.updateHud(false, dt);
  }

  // -------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------

  updatePlayer(dt: number) {
    const p = this.player;
    const inp = this.input;
    const mag = Math.min(1, inp.length());
    const targetVel = V(inp.x, inp.y).normalize().multiplyScalar(this.playerSpeed * mag);
    if (mag < 0.05) targetVel.set(0, 0, 0);
    this.playerVel.x = damp(this.playerVel.x, targetVel.x, 14, dt);
    this.playerVel.z = damp(this.playerVel.z, targetVel.z, 14, dt);
    const sp = Math.hypot(this.playerVel.x, this.playerVel.z);
    resolveMove(p.position, p.position.x + this.playerVel.x * dt, p.position.z + this.playerVel.z * dt);
    // stand on pier slightly higher
    p.position.y = damp(p.position.y, p.position.z < -0.8 ? 0.1 : 0.03, 12, dt);
    if (sp > 0.3) p.rotation.y = angleDamp(p.rotation.y, Math.atan2(this.playerVel.x, this.playerVel.z), 14, dt);
    M.animatePerson(p, this.time, Math.min(1, sp / 4), this.stack.count > 0);
    this.stack.update(dt, sp);

    // footstep dust
    if (sp > 3 && Math.random() < dt * 6) this.fx.puff(p.position.clone().add(V(0, 0, 0.1)), 1, 0xffffff, 0.12, 0.3);

    this.pickT += dt;
    this.dropT += dt;
    const pos = p.position;

    // pick up from piles
    const tryPick = (pile: Pile | null, kind: ItemKind, r: number) => {
      if (!pile || this.stack.full || pile.count === 0) return false;
      if (flatDist(pos, pile.origin) > r) return false;
      if (this.pickT < CFG.player.pickupInterval) return true;
      const m = pile.take();
      if (m) {
        this.stack.receive(kind, m);
        this.pickT = 0;
        vibrate(6);
      }
      return true;
    };
    tryPick(this.shedPile, 'box', 1.25);
    tryPick(this.unloadPile, 'lobster', 1.45);
    if (this.stack.full && (flatDist(pos, LAYOUT.shedPile) < 1.25 || flatDist(pos, LAYOUT.unloadPile) < 1.45)) this.maxNotice();

    // drop to destinations
    if (this.dropT >= CFG.player.dropInterval) {
      if (flatDist(pos, LAYOUT.cargoPad) < 1.4 && this.stack.has('box')) {
        if (this.ferry.canLoad && !this.ferry.cargoFull) {
          const m = this.stack.take('box');
          if (m) { this.loadCargo(m); this.dropT = 0; }
        } else this.notice(LAYOUT.cargoPad, this.ferry.state === 'docked' ? 'Cargo full!' : 'Ferry is away');
      } else if (this.stand.built && flatDist(pos, LAYOUT.standDrop) < 1.25 && this.stack.has('lobster') && this.stand.stock.space > 0) {
        const m = this.stack.take('lobster');
        if (m) { this.stand.stock.receive(m); this.stats.lobstersStocked++; this.dropT = 0; sfx.drop(this.stand.stock.count); vibrate(5); }
      } else if (this.shack.built && flatDist(pos, LAYOUT.shackDrop) < 1.25 && this.stack.has('lobster') && this.shack.input!.space > 0) {
        const m = this.stack.take('lobster');
        if (m) { this.shack.input!.receive(m); this.dropT = 0; sfx.drop(this.shack.input!.count); vibrate(5); }
      }
    }

    // collect cash
    const chest = () => this.player.localToWorld(V(0, 0.2, 0.9));
    for (const cp of [this.boothCash, this.cargoCash, this.stand.cash, this.shack.cash]) {
      if (cp.value > 0 && flatDist(pos, cp.origin) < CFG.player.collectRadius) {
        const total = Math.round(cp.value);
        if (cp.collect(chest, (a) => this.addMoney(a))) {
          this.ui.float(cp.origin.clone().add(V(0, 0, 1.2)), `+$${total}`, '#7CFF8A', 24);
          sfx.chaChing();
          vibrate(12);
        }
      }
    }
  }

  private noticeT = 0;
  notice(at: THREE.Vector3, text: string) {
    if (this.time - this.noticeT < 1.4) return;
    this.noticeT = this.time;
    this.ui.float(at.clone().add(V(0, 0, 1.5)), text, '#ffd23f', 18, 1.1);
  }
  private maxT = 0;
  maxNotice() {
    if (this.time - this.maxT < 1.5) return;
    this.maxT = this.time;
    this.ui.float(this.player.position.clone().add(V(0, 0, 3.0)), 'MAX', '#ff6b6b', 22, 0.8);
  }

  loadCargo(mesh: THREE.Object3D) {
    const f = this.ferry;
    const idx = f.cargoCount;
    f.cargoArriving++;
    const target = () => f.group.localToWorld(f.cargoSlotLocal(idx));
    sfx.drop(idx);
    vibrate(5);
    arcMove(mesh, mesh.position.clone(), target, 0.32, 2.2, () => {
      f.group.attach(mesh);
      mesh.position.copy(f.cargoSlotLocal(idx));
      mesh.rotation.set(0, 0, 0);
      f.cargoArriving--;
      f.cargo.push(mesh);
      this.stats.cargo++;
      squash(mesh, 0.3, 0.2);
      this.fx.puff(mesh.getWorldPosition(new THREE.Vector3()), 3, 0xffffff, 0.12, 0.4);
      if (f.cargoFull) this.ui.float(f.group.localToWorld(V(0, f.group.userData.cargoZ, 1.5)), 'CARGO FULL!', '#7CFF8A', 20);
    });
  }

  // -------------------------------------------------------------------
  // Ferry
  // -------------------------------------------------------------------

  updateFerry(dt: number) {
    const f = this.ferry;
    f.stateT += dt;
    // ramp animation
    f.rampAngle = damp(f.rampAngle, f.rampTarget, 6, dt);
    f.applyRamp();
    // bobbing
    const bobY = Math.sin(this.time * 1.4) * 0.05;
    f.group.position.y = bobY;
    f.group.rotation.z = Math.sin(this.time * 1.1) * 0.012;
    const flag = f.group.userData.flag as THREE.Object3D;
    flag.rotation.y = Math.sin(this.time * 6) * 0.25;

    const docked = LAYOUT.ferryStern, away = LAYOUT.ferryAway;
    const label = f.label;
    const bar = label.el.firstElementChild as HTMLElement;
    const txt = label.el.lastElementChild as HTMLElement;

    const wake = () => {
      f.wakeT += dt;
      if (f.wakeT > 0.07) {
        f.wakeT = 0;
        const stern = f.group.localToWorld(V(rand(-2, 2), rand(0, 1.2), 0));
        this.fx.wake(stern, rand(0.4, 0.8));
      }
      if (Math.random() < dt * 4) this.fx.smoke(f.group.localToWorld((f.group.userData.funnelTop as THREE.Vector3).clone()));
    };

    switch (f.state) {
      case 'docked': {
        const loaded = f.aboard.length > 0 || f.cargo.length > 0;
        if (loaded) f.timer -= dt;
        const busy = f.incoming > 0 || f.cargoArriving > 0;
        const full = f.deckFull && f.cargoFull;
        this.ui.show(label, true);
        if (!loaded) {
          bar.style.width = '100%';
          txt.textContent = this.booth ? 'Waiting for cars' : 'Ferry ready';
        } else {
          bar.style.width = `${clamp(f.timer / CFG.ferry.dockTime, 0, 1) * 100}%`;
          txt.textContent = full ? 'FULL! Departing' : `Departs in ${Math.ceil(Math.max(0, f.timer))}s`;
        }
        if (f.timer < 2.2 && loaded && !f.hornPlayed) {
          f.hornPlayed = true;
          sfx.horn();
        }
        if (!busy && loaded && (full || f.timer <= 0)) this.depart(full);
        break;
      }
      case 'leaving': {
        const k = clamp(f.stateT / CFG.ferry.sailOut, 0, 1);
        f.group.position.z = docked.z + (away.z - docked.z) * ease.inQuad(k);
        wake();
        if (k >= 1) this.atIsland();
        break;
      }
      case 'island':
        if (f.stateT >= CFG.ferry.atIsland) {
          f.state = 'returning';
          f.stateT = 0;
        }
        break;
      case 'returning': {
        const k = clamp(f.stateT / CFG.ferry.sailBack, 0, 1);
        f.group.position.z = away.z + (docked.z - away.z) * ease.outCubic(k);
        this.ui.show(label, k > 0.6);
        txt.textContent = 'Arriving...';
        bar.style.width = `${k * 100}%`;
        wake();
        if (k >= 1) {
          f.state = 'unloading';
          f.stateT = 0;
          f.rampTarget = 0.32;
          sfx.splash();
          this.shake.add(0.25);
          this.fx.splash(f.group.localToWorld(V(-2.4, -1, 0)), 14, 0.8);
          this.fx.splash(f.group.localToWorld(V(2.4, -1, 0)), 14, 0.8);
          this.ui.float(f.group.localToWorld(V(0, -3, 2)), `🦞 x${f.lobsters.length}`, '#ffffff', 24, 1.4);
        }
        break;
      }
      case 'unloading': {
        txt.textContent = 'Unloading...';
        bar.style.width = '100%';
        if (f.stateT < 0.5) break;
        f.unloadT += dt;
        // vehicles roll off one by one
        if (f.arrivals.length && f.unloadT > 0.45) {
          f.unloadT = 0;
          const v = f.arrivals.shift()!;
          this.scene.attach(v.mesh);
          v.state = 'disembark';
          const colX = v.mesh.position.x;
          v.path = [V(colX, -5.2), V(LAYOUT.laneOut, -2.6), V(LAYOUT.laneOut, LAYOUT.roadStartZ + 2)];
          v.speed = 6.5;
          this.outbound.push(v);
          if (Math.random() < 0.4) sfx.honk();
        }
        // lobsters fly to the unload pile
        if (f.lobsters.length && f.stateT > 0.8) {
          if (Math.random() < 0.5 || f.lobsters.length > 0) {
            const m = f.lobsters.pop()!;
            this.scene.attach(m);
            this.unloadPile.receive(m, 0.35);
            sfx.drop(f.lobsters.length);
            this.zonePlates.unload.visible = true;
          }
        }
        if (!f.arrivals.length && !f.lobsters.length && f.stateT > 1.4) {
          f.state = 'docked';
          f.stateT = 0;
          f.timer = CFG.ferry.dockTime;
          f.hornPlayed = false;
          f.returns++;
          // apply pending ferry upgrade now that it is empty
          if (f.pendingLevel >= 0) this.rebuildFerry();
        }
        break;
      }
    }
  }

  depart(full: boolean) {
    const f = this.ferry;
    f.state = 'leaving';
    f.stateT = 0;
    f.rampTarget = -1.25;
    if (!f.hornPlayed) sfx.horn();
    this.shake.add(0.2);
    for (let i = 0; i < 4; i++) this.fx.smoke(f.group.localToWorld((f.group.userData.funnelTop as THREE.Vector3).clone()));
    f.deliveredCargo = f.cargo.length;
    const cargoPay = f.cargo.length * CFG.ferry.cargoPrice;
    if (cargoPay > 0) {
      this.cargoCash.add(cargoPay, f.group.localToWorld(V(0, f.group.userData.cargoZ, 1)));
      this.ui.float(LAYOUT.cargoCash.clone().add(V(0, 0, 1.4)), `Cargo +$${cargoPay}`, '#7CFF8A', 20);
    }
    if (full) {
      const bonus = CFG.ferry.fullBonus + this.ferry.level * 10;
      this.cargoCash.add(bonus, f.group.localToWorld(V(0, -3, 1.5)));
      this.fx.confetti(f.group.localToWorld(V(0, -3, 1.5)), 60, 1.1);
      sfx.bonus();
      this.showBanner('SHIP FULL!', `Bonus +$${bonus}`);
      this.stats.fullShips++;
    }
  }

  atIsland() {
    const f = this.ferry;
    f.state = 'island';
    f.stateT = 0;
    for (const v of f.aboard) v.mesh.removeFromParent();
    f.aboard.length = 0;
    for (const c of f.cargo) c.removeFromParent();
    f.cargo.length = 0;
    f.colUsed = [0, 0];
    if (f.pendingLevel >= 0) this.rebuildFerry();
    // passengers coming back from the island
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const type: M.VehicleType = pick(['sedan', 'sedan', 'pickup', 'bike']);
      const col = f.canFit(M.VEHICLE_LEN[type]);
      if (col < 0) break;
      const v = new Vehicle(type);
      v.slotLocal.copy(f.reserve(col, v.len));
      f.group.add(v.mesh);
      v.mesh.position.copy(v.slotLocal);
      v.mesh.rotation.y = 0; // facing the stern -> toward land
      v.state = 'aboard';
      f.arrivals.push(v);
    }
    f.colUsed = [0, 0];
    // lobsters from Lobster Cove
    const lob = Math.min(18, CFG.ferry.lobstersBase + f.deliveredCargo * CFG.ferry.lobstersPerCargo);
    for (let i = 0; i < lob; i++) {
      const m = M.makeLobster();
      m.position.copy(f.lobsterSlotLocal(i));
      m.rotation.y = rand(-0.4, 0.4);
      f.group.add(m);
      f.lobsters.push(m);
    }
  }

  rebuildFerry() {
    const f = this.ferry;
    const lvl = f.pendingLevel;
    f.pendingLevel = -1;
    f.level = lvl;
    f.rows = CFG.ferry.rowsByLevel[lvl];
    f.cargoCap = CFG.ferry.cargoByLevel[lvl];
    // keep anything currently attached (arrivals/lobsters)
    for (const v of f.arrivals) v.mesh.userData.keep = true;
    for (const l of f.lobsters) l.userData.keep = true;
    f.build();
    if (f.state === 'docked') {
      squash(f.group, 0.15, 0.5);
      this.fx.confetti(f.group.localToWorld(V(0, -4, 2)), 50);
      sfx.unlock();
      this.ui.float(f.group.localToWorld(V(0, -4, 2)), 'BIGGER FERRY!', '#ffd23f', 24, 1.5);
    }
  }

  // -------------------------------------------------------------------
  // Traffic & ticket booth
  // -------------------------------------------------------------------

  queueTargetZ(i: number) {
    let z = LAYOUT.gateZ + 0.2;
    for (let k = 0; k <= i; k++) {
      const v = this.queue[k];
      if (k > 0) z += this.queue[k - 1].len / 2 + 0.55;
      z += k === 0 ? v.len / 2 : v.len / 2;
      if (k < i) z += 0;
      if (k === i) return z;
      z += v.len / 2;
      z -= v.len / 2;
    }
    return z;
  }

  spawnVehicle(vip = false) {
    const type: M.VehicleType = vip ? 'rv' : pick(['sedan', 'sedan', 'sedan', 'pickup', 'pickup', 'bike', 'bike']);
    const v = new Vehicle(type, vip);
    v.mesh.position.set(LAYOUT.laneIn, 0.04, LAYOUT.roadStartZ + 1 + this.queue.length * 0.5);
    v.mesh.rotation.y = Math.PI;
    this.scene.add(v.mesh);
    this.queue.push(v);
    if (vip) {
      v.bubble = this.ui.add('bubble vip', '⭐ VIP x3', v.mesh, 2.6);
      v.bubbleKind = 'vip';
    }
  }

  updateTraffic(dt: number) {
    const f = this.ferry;
    // spawn
    this.spawnT += dt;
    const interval = CFG.vehicles.spawnInterval * (this.booth ? 1 : 2.5);
    if (this.spawnT >= interval && this.queue.length < CFG.vehicles.maxQueue) {
      this.spawnT = 0;
      this.spawnVehicle();
    }

    // queue movement
    let z = LAYOUT.gateZ + 0.2;
    for (let i = 0; i < this.queue.length; i++) {
      const v = this.queue[i];
      if (i > 0) z += this.queue[i - 1].len / 2 + 0.55 + v.len / 2;
      else z += v.len / 2;
      const target = V(LAYOUT.laneIn, z);
      const was = v.mesh.position.z;
      stepTowards(v.mesh, target, v.speed, dt, 0);
      v.mesh.rotation.y = Math.PI;
      const moving = Math.abs(was - v.mesh.position.z) > 0.001;
      const body = v.mesh.userData.body as THREE.Object3D;
      body.position.y = moving ? Math.abs(Math.sin(this.time * 18 + i)) * 0.03 : 0;
      v.mesh.position.y = 0.04;
    }

    // serve the front vehicle
    const front = this.queue[0];
    const playerAtBooth = !!this.booth && flatDist(this.player.position, LAYOUT.boothZone) < 0.95;
    const staffed = this.booth && (playerAtBooth || this.clerkHired);
    let ringP = 0;
    if (front) {
      const atGate = Math.abs(front.mesh.position.z - (LAYOUT.gateZ + 0.2 + front.len / 2)) < 0.08;
      if (atGate && !front.paid) {
        if (staffed) {
          front.serveT += dt;
          const need = playerAtBooth ? CFG.ticket.serveTime : CFG.ticket.clerkServeTime;
          ringP = front.serveT / need;
          if (front.serveT >= need) this.sellTicket(front);
          this.setBubble(front, front.vip ? 'vip' : '', front.vip ? '⭐ VIP x3' : '');
        } else {
          front.waitT += dt;
          this.setBubble(front, 'ticket', '🎟️ Ticket?');
        }
      }
      if (front.paid) {
        if (f.canLoad && f.canFit(front.len) >= 0) {
          this.boardVehicle(front);
        } else {
          this.setBubble(front, 'wait', f.state === 'docked' ? '⛴️ Ferry full' : '⛴️ Waiting for ferry');
        }
      }
    }
    this.boothRing.set(ringP);

    // barrier
    this.barrierCloseT -= dt;
    if (this.barrierCloseT <= 0) this.barrierTarget = 0;
    this.barrierOpen = damp(this.barrierOpen, this.barrierTarget, 10, dt);
    (this.barrier.userData.arm as THREE.Object3D).rotation.z = this.barrierOpen * 1.35;

    // boarding vehicles
    for (const v of [...f.aboard, ...this.boarding]) void v;
    for (let i = this.boarding.length - 1; i >= 0; i--) {
      const v = this.boarding[i];
      const target = v.path.length ? v.path[0] : f.group.localToWorld(v.slotLocal.clone());
      const arrived = stepTowards(v.mesh, target, v.speed, dt, 10);
      v.mesh.position.y = this.vehicleY(v.mesh.position.z);
      if (arrived) {
        if (v.path.length) v.path.shift();
        else {
          f.group.attach(v.mesh);
          v.mesh.position.copy(v.slotLocal);
          v.mesh.rotation.set(0, Math.PI, 0);
          v.state = 'aboard';
          f.aboard.push(v);
          f.incoming--;
          this.boarding.splice(i, 1);
          squash(v.mesh, 0.12, 0.25);
          sfx.drop(2);
          if (f.deckFull) this.ui.float(f.group.localToWorld(V(0, -2, 2)), 'DECK FULL!', '#7CFF8A', 20);
        }
      }
    }

    // outbound vehicles
    for (let i = this.outbound.length - 1; i >= 0; i--) {
      const v = this.outbound[i];
      const target = v.path[0];
      if (!target) {
        v.mesh.removeFromParent();
        this.outbound.splice(i, 1);
        continue;
      }
      if (stepTowards(v.mesh, target, v.speed, dt, 10)) v.path.shift();
      v.mesh.position.y = this.vehicleY(v.mesh.position.z);
    }
  }

  boarding: Vehicle[] = [];

  vehicleY(z: number) {
    const deckY = this.ferry.group.position.y + 0.62;
    if (z > -0.9) return 0.04;
    if (z > -4.6) return 0.12;
    if (z < -6.3) return deckY;
    return 0.12 + (deckY - 0.12) * ((-4.6 - z) / 1.7);
  }

  setBubble(v: Vehicle, kind: string, text: string) {
    if (v.bubbleKind === kind) return;
    this.ui.remove(v.bubble);
    v.bubble = null;
    v.bubbleKind = kind;
    if (!text) return;
    const cls = kind === 'vip' ? 'bubble vip' : kind === 'wait' ? 'bubble warn' : 'bubble';
    v.bubble = this.ui.add(cls, text, v.mesh, v.type === 'rv' ? 2.6 : 2.0);
    popInEl(v.bubble.el);
  }

  sellTicket(v: Vehicle) {
    v.paid = true;
    const price = (CFG.ticket.price[v.type] ?? 5) * (v.vip ? CFG.ticket.vipMultiplier : 1);
    const window = V(LAYOUT.booth.x, LAYOUT.booth.z, 1.4);
    this.boothCash.add(price, window);
    this.ui.float(v.mesh.position.clone().add(V(0, 0, 2.2)), `+$${price}`, v.vip ? '#ffd23f' : '#7CFF8A', v.vip ? 26 : 22);
    sfx.chaChing();
    if (v.vip) { sfx.bonus(); this.fx.sparkle(v.mesh.position.clone().add(V(0, 0, 1.5)), 16); }
    squash(v.mesh, 0.1, 0.25);
    if (this.booth) squash(this.booth, 0.08, 0.25);
    this.stats.tickets++;
    this.setBubble(v, '', '');
  }

  boardVehicle(v: Vehicle) {
    const f = this.ferry;
    const col = f.canFit(v.len);
    v.slotLocal.copy(f.reserve(col, v.len));
    v.col = col;
    this.queue.shift();
    this.setBubble(v, '', '');
    v.state = 'boarding';
    f.incoming++;
    const colX = col === 0 ? -1.15 : 1.15;
    v.path = [V(LAYOUT.laneIn, -1.2), V(colX, -5.4)];
    this.boarding.push(v);
    this.barrierTarget = 1;
    this.barrierCloseT = 1.0;
    sfx.whoosh();
  }

  // -------------------------------------------------------------------
  // Cargo shed
  // -------------------------------------------------------------------

  updateShed(dt: number) {
    if (!this.shedPile) return;
    this.shedT += dt;
    if (this.shedT >= CFG.shed.interval && this.shedPile.count < CFG.shed.max) {
      this.shedT = 0;
      this.shedPile.addNew(LAYOUT.shed.clone().add(V(-2.2, -0.9, 0.6)));
    }
  }

  // -------------------------------------------------------------------
  // Shops & customers
  // -------------------------------------------------------------------

  updateShop(shop: Shop, dt: number) {
    if (!shop.built) return;
    shop.spawnT += dt;
    const interval = shop.spawnInterval / shop.speedMul;
    if (shop.spawnT >= interval && shop.queue.length < shop.maxQueue) {
      shop.spawnT = 0;
      const want = shop.kind === 'stand' ? 1 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
      const c = new Customer(want, shop.kind === 'shack');
      c.person.position.copy(shop.spawnFrom).add(V(0, rand(-0.6, 0.6)));
      this.scene.add(c.person);
      shop.queue.push(c);
    }
    shop.takeT += dt;
    for (let i = 0; i < shop.queue.length; i++) {
      const c = shop.queue[i];
      const slot = shop.slot(i);
      const arrived = stepTowards(c.person, slot, 2.6, dt, 10);
      if (arrived) c.person.rotation.y = angleDamp(c.person.rotation.y, Math.PI, 10, dt);
      M.animatePerson(c.person, this.time + i, arrived ? 0 : 1, c.got.length > 0);
      if (i === 0 && arrived) {
        c.waitT += dt;
        if (shop.stock.count > 0 && c.got.length < c.want && shop.takeT >= 0.32) {
          shop.takeT = 0;
          const m = shop.stock.take()!;
          const anchor = c.person.userData.carryAnchor;
          const idx = c.got.length;
          c.got.push(m);
          arcMove(m, m.position.clone(), () => anchor.localToWorld(V(0, 0, idx * 0.25)), 0.22, 0.6, () => {
            anchor.attach(m);
            m.position.set(0, idx * 0.25, 0);
            m.rotation.set(0, 0, 0);
          });
          sfx.serve();
          c.waitT = 0;
        }
        if (c.got.length >= c.want && shop.takeT > 0.3) {
          this.customerPays(shop, c);
          shop.queue.shift();
          i--;
          continue;
        }
        const icon = shop.product === 'roll' ? '🌭' : '🦞';
        const key = `${c.got.length}/${c.want}|${shop.stock.count === 0 && c.waitT > 3}`;
        if (c.bubbleKey !== key) {
          c.bubbleKey = key;
          this.ui.remove(c.bubble);
          const warn = shop.stock.count === 0 && c.waitT > 3;
          c.bubble = this.ui.add(warn ? 'bubble warn' : 'bubble', `${icon} ${c.got.length}/${c.want}`, c.person, 2.0);
        }
      }
    }
    // leaving customers
    for (let i = shop.leaving.length - 1; i >= 0; i--) {
      const c = shop.leaving[i];
      const tgt = shop.spawnFrom.clone().add(V(0, 1.5));
      M.animatePerson(c.person, this.time, 1, true);
      if (stepTowards(c.person, tgt, 3.0, dt, 10)) {
        c.person.removeFromParent();
        shop.leaving.splice(i, 1);
      }
    }
  }

  customerPays(shop: Shop, c: Customer) {
    const amount = c.want * shop.price;
    shop.cash.add(amount, c.person.position.clone().add(V(0, 0, 1.2)));
    this.ui.remove(c.bubble);
    c.bubble = null;
    this.ui.float(c.person.position.clone().add(V(0, 0, 2.4)), `+$${amount}`, '#7CFF8A', 22);
    this.ui.float(c.person.position.clone().add(V(0.4, 0, 2.0)), pick(['😍', '😋', '🤩', '❤️']), '#fff', 26, 1.2, 50);
    sfx.chaChing();
    if (shop.product === 'lobster') this.stats.lobstersSold += c.want;
    else this.stats.rolls += c.want;
    c.state = 'leave';
    shop.leaving.push(c);
  }

  updateShack(dt: number) {
    const sh = this.shack;
    if (!sh.built || !sh.input) return;
    if (sh.input.count >= CFG.shack.perRoll && sh.stock.space > 0) {
      sh.cookT += dt;
      if (Math.random() < dt * 5 && sh.group) this.fx.smoke(sh.group.localToWorld((sh.group.userData.chimney as THREE.Vector3).clone()), 0xeeeeee);
      if (sh.cookT >= CFG.shack.cookTime) {
        sh.cookT = 0;
        for (let i = 0; i < CFG.shack.perRoll; i++) {
          const m = sh.input.take();
          if (m) {
            arcMove(m, m.position.clone(), LAYOUT.shack.clone().add(V(0, 0, 1.0)), 0.25, 1.0, () => m.removeFromParent());
          }
        }
        sh.stock.addNew(LAYOUT.shack.clone().add(V(0, 1.4)).setY(1.5));
        sfx.pop();
        this.fx.sparkle(LAYOUT.shack.clone().add(V(0, 1.4)).setY(1.5), 6, 0xffb36b);
      }
    }
  }

  // -------------------------------------------------------------------
  // Workers
  // -------------------------------------------------------------------

  hireWorker(role: Role) {
    const w = new Worker(role, this.scene);
    const spawnAt = role === 'clerk' ? LAYOUT.padClerk : role === 'dockhand' ? LAYOUT.padDockhand : LAYOUT.padUnloader;
    w.person.position.copy(spawnAt);
    this.scene.add(w.person);
    popIn(w.person, 0.5);
    this.fx.puff(spawnAt.clone().setY(0.3), 12, 0xffffff, 0.35);
    this.fx.sparkle(spawnAt.clone().setY(1.2), 14);
    this.workers.push(w);
    this.ui.float(spawnAt.clone().setY(2.6), role === 'clerk' ? 'Clerk hired!' : role === 'dockhand' ? 'Dockhand hired!' : 'Unloader hired!', '#ffd23f', 22, 1.4);
    if (role === 'clerk') this.clerkHired = true;
  }

  updateWorkers(dt: number) {
    for (const w of this.workers) {
      w.t += dt;
      w.anim += dt;
      const p = w.person;
      let moving = 0;
      if (w.role === 'clerk') {
        const spot = LAYOUT.boothZone.clone().add(V(-0.55, 0.2));
        const arrived = stepTowards(p, spot, CFG.workers.speed, dt);
        if (arrived) p.rotation.y = angleDamp(p.rotation.y, Math.PI, 8, dt);
        moving = arrived ? 0 : 1;
        M.animatePerson(p, w.anim, moving, false);
        continue;
      }
      const isDock = w.role === 'dockhand';
      const srcPile = isDock ? this.shedPile : this.unloadPile;
      const srcPos = isDock ? LAYOUT.shedPile.clone().add(V(-0.8, 0)) : LAYOUT.unloadPile.clone().add(V(0.9, 0.6));
      const kind: ItemKind = isDock ? 'box' : 'lobster';
      const destPos = () => {
        if (isDock) return LAYOUT.cargoPad.clone().add(V(-0.6, 0.6));
        return w.dest === 'stand' ? LAYOUT.standDrop.clone().add(V(0.4, 0)) : LAYOUT.shackDrop.clone().add(V(0.4, 0));
      };
      switch (w.state) {
        case 'toSource': {
          const arrived = stepTowards(p, srcPos, CFG.workers.speed, dt);
          moving = arrived ? 0 : 1;
          if (arrived) { w.state = 'loading'; w.t = 0; }
          break;
        }
        case 'loading': {
          if (srcPile && srcPile.count > 0 && !w.stack.full && w.t > 0.16) {
            w.t = 0;
            const m = srcPile.take();
            if (m) w.stack.receive(kind, m);
          }
          const waitedEnough = w.t > 1.2 && w.stack.count > 0;
          if (w.stack.full || waitedEnough) {
            if (!isDock) {
              const sOk = this.stand.built && this.stand.stock.space > 0;
              const hOk = this.shack.built && !!this.shack.input && this.shack.input.space > 0;
              const sFill = sOk ? this.stand.stock.count / this.stand.stock.max : 9;
              const hFill = hOk ? this.shack.input!.count / this.shack.input!.max : 9;
              if (!sOk && !hOk) break;
              w.dest = hFill < sFill ? 'shack' : 'stand';
            }
            w.state = 'toDest';
          }
          break;
        }
        case 'toDest': {
          const arrived = stepTowards(p, destPos(), CFG.workers.speed, dt);
          moving = arrived ? 0 : 1;
          if (arrived) { w.state = 'unloading'; w.t = 0; }
          break;
        }
        case 'unloading': {
          if (w.t > 0.14 && w.stack.count > 0) {
            if (isDock) {
              if (this.ferry.canLoad && !this.ferry.cargoFull) {
                const m = w.stack.take('box');
                if (m) { this.loadCargo(m); w.t = 0; }
              }
            } else {
              const pile = w.dest === 'stand' ? this.stand.stock : this.shack.input!;
              if (pile.space > 0) {
                const m = w.stack.take('lobster');
                if (m) { pile.receive(m); w.t = 0; sfx.drop(pile.count); if (w.dest === 'stand') this.stats.lobstersStocked++; }
              } else if (w.t > 1.5) {
                // try the other destination
                w.dest = w.dest === 'stand' ? (this.shack.built ? 'shack' : 'stand') : 'stand';
                w.state = 'toDest';
              }
            }
          }
          if (w.stack.count === 0) w.state = 'toSource';
          break;
        }
      }
      M.animatePerson(p, w.anim, moving, w.stack.count > 0);
      w.stack.update(dt, moving * CFG.workers.speed);
    }
  }

  // -------------------------------------------------------------------
  // Pads & building
  // -------------------------------------------------------------------

  private payAcc = 0;
  private billT = 0;
  private brokeT = 0;

  updatePads(dt: number) {
    for (const d of this.pads) {
      const pad = d.pad!;
      if (d.done) continue;
      if (!pad.visible && d.reveal()) {
        pad.locked = this.level < d.level;
        pad.draw(true);
        pad.show();
        if (d.id === 'cap' || d.id === 'speed') this.ensureOffice();
      }
      if (!pad.visible) continue;
      pad.update(dt, this.money >= pad.remaining);
      if (pad.locked) continue;
      const inside = flatDist(this.player.position, pad.pos) < 1.05;
      if (!inside) { d.needExit = false; continue; }
      if (d.needExit) continue;
      if (this.money <= 0) {
        this.brokeT += dt;
        if (this.brokeT > 0.6) {
          this.brokeT = -2;
          this.ui.float(pad.pos.clone().add(V(0, 0, 1.6)), 'Need more cash!', '#ff8a8a', 18);
          sfx.denied();
        }
        continue;
      }
      // drain money into the pad
      const rate = Math.max(14, pad.price / 1.1);
      this.payAcc += rate * dt;
      const pay = Math.min(Math.floor(this.payAcc), Math.ceil(pad.remaining), Math.floor(this.money));
      if (pay > 0) {
        this.payAcc -= pay;
        this.money -= pay;
        pad.remaining -= pay;
        pad.setProgress(1 - pad.remaining / pad.price);
        sfx.payTick(1 - pad.remaining / pad.price);
      }
      this.billT += dt;
      if (this.billT > 0.06) {
        this.billT = 0;
        const bill = M.makeCash();
        bill.scale.setScalar(0.7);
        this.scene.add(bill);
        bill.position.copy(this.player.localToWorld(V(0, 0.2, 1.0)));
        arcMove(bill, bill.position.clone(), pad.pos.clone().setY(0.1), 0.25, 1.0, () => bill.removeFromParent(), 3);
      }
      if (pad.remaining <= 0) this.completePad(d);
    }
  }

  completePad(d: PadDef) {
    const pad = d.pad!;
    sfx.unlock();
    vibrate(25);
    this.shake.add(0.3);
    this.fx.puff(pad.pos.clone().setY(0.3), 16, 0xffffff, 0.45, 1.4);
    this.fx.confetti(pad.pos.clone().setY(0.5), 45);
    this.addStars(d.stars, pad.pos.clone().setY(1));
    const next = d.repeat ? d.repeat() : null;
    d.build();
    const nextAfter = d.repeat ? d.repeat() : null;
    void next;
    if (d.repeat && nextAfter) {
      d.needExit = true;
      pad.setPrice(nextAfter.price, nextAfter.title);
      squash(pad.group, 0.2, 0.3);
    } else {
      d.done = true;
      pad.hide();
    }
  }

  popBuilding(obj: THREE.Object3D) {
    this.scene.add(obj);
    popIn(obj, 0.6);
    this.fx.puff(obj.position.clone().setY(0.4), 18, 0xffffff, 0.5, 1.8);
  }

  buildBooth() {
    const b = M.makeBooth();
    b.position.copy(LAYOUT.booth);
    this.popBuilding(b);
    this.booth = b;
    addCollider(LAYOUT.booth, 1.7, 1.7);
    this.zonePlates.booth.visible = true;
    popIn(this.zonePlates.booth, 0.4, 0.3);
    this.ui.float(LAYOUT.booth.clone().setY(3), 'Ticket Booth!', '#ffd23f', 24, 1.4);
  }

  buildShed() {
    const s = M.makeShed();
    s.position.copy(LAYOUT.shed);
    this.popBuilding(s);
    this.shed = s;
    addCollider(LAYOUT.shed, 3.5, 2.9);
    this.shedPile = new Pile(this.scene, LAYOUT.shedPile, 'box', CFG.shed.max, 2, 3, 0.6, 0.48, 0.05);
    for (let i = 0; i < 4; i++) this.shedPile.addNew();
    this.zonePlates.shed.visible = true;
    this.zonePlates.cargo.visible = true;
    popIn(this.zonePlates.cargo, 0.4, 0.3);
  }

  buildStand() {
    const g = M.makeStand(0x4dabf7);
    g.position.copy(LAYOUT.stand);
    this.popBuilding(g);
    this.stand.group = g;
    this.stand.built = true;
    addCollider(LAYOUT.stand, 2.5, 1.1);
    this.zonePlates.stand.visible = true;
    popIn(this.zonePlates.stand, 0.4, 0.3);
  }

  buildShack() {
    const g = M.makeShack();
    g.position.copy(LAYOUT.shack);
    this.popBuilding(g);
    this.shack.group = g;
    this.shack.built = true;
    addCollider(LAYOUT.shack, 3.1, 2.5);
    this.zonePlates.shack.visible = true;
    popIn(this.zonePlates.shack, 0.4, 0.3);
  }

  ensureOffice() {
    if (this.office) return;
    const o = M.makeOffice();
    o.position.copy(LAYOUT.office);
    this.popBuilding(o);
    this.office = o;
    addCollider(LAYOUT.office, 3.3, 2.3);
  }

  upgradeCapacity() {
    this.capLevel++;
    this.stack.capacity = CFG.upgrades.capacity[this.capLevel];
    this.ui.float(this.player.position.clone().setY(3), `Carry ${this.stack.capacity}!`, '#ffd23f', 24);
    squash(this.player, 0.3, 0.35);
  }

  upgradeSpeed() {
    this.speedLevel++;
    this.playerSpeed = CFG.upgrades.speed[this.speedLevel];
    this.ui.float(this.player.position.clone().setY(3), 'Faster!', '#ffd23f', 24);
    this.fx.sparkle(this.player.position.clone().setY(0.5), 14, 0x74c0fc);
  }

  upgradeFerry(lvl: number) {
    const f = this.ferry;
    f.pendingLevel = lvl;
    const empty = f.state === 'docked' && f.aboard.length === 0 && f.cargo.length === 0 && f.incoming === 0 && f.cargoArriving === 0;
    if (empty) this.rebuildFerry();
    else this.ui.float(LAYOUT.padFerry.clone().setY(2.5), 'Bigger ferry next trip!', '#ffd23f', 20, 1.6);
  }

  upgradeStand() {
    this.stand.speedMul = 1.6;
    this.stand.maxQueue = 7;
    this.stand.price = CFG.stand.lobsterPrice + 1;
    if (this.stand.group) squash(this.stand.group, 0.2, 0.4);
    this.ui.float(LAYOUT.stand.clone().setY(3), 'More customers!', '#ffd23f', 22, 1.4);
  }

  openRoute2() {
    this.ended = true;
    this.showBanner('NEW ROUTE!', '🍎 Apple Orchard Isle');
    this.fx.confetti(this.player.position.clone().setY(1), 120, 1.3);
    setTimeout(() => this.showEndCard(), 2400);
  }

  showEndCard() {
    const el = document.createElement('div');
    const mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60);
    el.style.cssText = 'position:absolute;inset:0;z-index:25;display:flex;align-items:center;justify-content:center;background:rgba(20,30,45,.55);';
    el.innerHTML = `<div style="background:#fff;border-radius:22px;padding:22px 24px;width:80%;text-align:center;color:#23324a;box-shadow:0 8px 0 rgba(0,0,0,.25)">
      <div style="font-size:34px;font-weight:700">🍎 Coming soon!</div>
      <div style="margin:6px 0 14px;font-size:16px">Apple Orchard Isle is the next route.<br>Thanks for playing the prototype!</div>
      <div style="text-align:left;font-size:15px;line-height:1.7;background:#f2f6fb;border-radius:12px;padding:10px 14px">
        ⏱️ Time: <b>${mins}m ${secs}s</b><br>🎟️ Tickets sold: <b>${this.stats.tickets}</b><br>📦 Parcels shipped: <b>${this.stats.cargo}</b><br>
        🦞 Lobsters sold: <b>${this.stats.lobstersSold}</b><br>🌭 Lobster rolls: <b>${this.stats.rolls}</b><br>⛴️ Full ships: <b>${this.stats.fullShips}</b>
      </div>
      <button style="margin-top:14px;font-family:inherit;font-size:18px;font-weight:700;color:#fff;background:#2fb344;border:0;border-radius:14px;padding:10px 24px;cursor:pointer">Keep playing</button>
    </div>`;
    el.querySelector('button')!.addEventListener('click', () => el.remove());
    this.hud.stage.appendChild(el);
  }

  // -------------------------------------------------------------------
  // Events: seagull thief, VIP RV
  // -------------------------------------------------------------------

  updateEvents(dt: number) {
    if (this.level >= CFG.events.vipMinLevel) {
      this.vipT -= dt;
      if (this.vipT <= 0 && this.queue.length < CFG.vehicles.maxQueue) {
        this.vipT = rand(...CFG.events.vipInterval);
        this.spawnVehicle(true);
        sfx.honk();
      }
    }
    if (this.level >= CFG.events.gullMinLevel && this.stand.built) {
      if (!this.gull) {
        this.gullT -= dt;
        if (this.gullT <= 0 && this.stand.stock.count > 0) this.spawnGull();
      } else this.updateGull(dt);
    }
  }

  spawnGull() {
    const g = M.makeGull();
    const from = V(-14, -14, 7);
    g.position.copy(from);
    this.scene.add(g);
    this.gull = { mesh: g, state: 'in', t: 0, carrying: null, label: null, from };
    sfx.gull();
  }

  updateGull(dt: number) {
    const gl = this.gull!;
    gl.t += dt;
    const wings = gl.mesh.userData.wings as THREE.Object3D[];
    const flap = gl.state === 'sit' ? Math.sin(this.time * 4) * 0.1 : Math.sin(this.time * 18) * 0.7;
    wings[0].rotation.z = flap;
    wings[1].rotation.z = -flap;
    const perch = LAYOUT.stand.clone().setY(1.25).add(V(0.7, 0.1));
    if (gl.state === 'in') {
      const k = clamp(gl.t / 2.2, 0, 1);
      gl.mesh.position.lerpVectors(gl.from, perch, ease.outQuad(k));
      gl.mesh.position.y += Math.sin(k * Math.PI) * 1.5;
      gl.mesh.lookAt(perch.x, gl.mesh.position.y, perch.z);
      if (k >= 1) {
        gl.state = 'sit';
        gl.t = 0;
        gl.label = this.ui.add('bubble warn', '🐦 Thief! Shoo it!', gl.mesh, 1.2);
        sfx.gull();
      }
    } else if (gl.state === 'sit') {
      gl.mesh.position.y = perch.y + Math.abs(Math.sin(this.time * 6)) * 0.08;
      if (flatDist(this.player.position, perch) < 2.3) {
        // scared away!
        this.ui.remove(gl.label);
        gl.label = null;
        sfx.gull();
        this.fx.feathers(gl.mesh.position.clone(), 14);
        this.ui.float(perch.clone().setY(2.5), 'Shoo! +$10', '#ffd23f', 24);
        this.stand.cash.add(10, perch.clone());
        gl.state = 'out';
        gl.t = 0;
        gl.from = gl.mesh.position.clone();
      } else if (gl.t > 6 && this.stand.stock.count > 0) {
        const m = this.stand.stock.take()!;
        gl.mesh.attach(m);
        m.position.set(0, -0.3, 0.2);
        gl.carrying = m;
        this.ui.remove(gl.label);
        gl.label = null;
        this.ui.float(perch.clone().setY(2.5), 'Stolen! 🦞', '#ff8a8a', 22);
        sfx.gull();
        gl.state = 'out';
        gl.t = 0;
        gl.from = gl.mesh.position.clone();
      } else if (gl.t > 6) {
        gl.state = 'out';
        gl.t = 0;
        gl.from = gl.mesh.position.clone();
        this.ui.remove(gl.label);
        gl.label = null;
      }
    } else {
      const k = clamp(gl.t / 2.5, 0, 1);
      const to = V(-18, -20, 9);
      gl.mesh.position.lerpVectors(gl.from, to, ease.inQuad(k));
      gl.mesh.lookAt(to);
      if (k >= 1) {
        gl.mesh.removeFromParent();
        this.gull = null;
        this.gullT = rand(...CFG.events.gullInterval);
      }
    }
  }

  // -------------------------------------------------------------------
  // Objective + guidance arrow
  // -------------------------------------------------------------------

  updateObjective(dt: number) {
    const done = (id: string) => this.pads.find((p) => p.id === id)!.done;
    const padPos = (id: string) => this.pads.find((p) => p.id === id)!.pos;
    let text = '';
    let target: THREE.Vector3 | null = null;
    const hasBox = this.stack.has('box');
    const hasLob = this.stack.has('lobster');
    if (!done('booth')) { text = 'Build the Ticket Booth'; target = padPos('booth'); }
    else if (this.stats.tickets < 3) { text = 'Stand in the booth to sell tickets'; target = LAYOUT.boothZone; }
    else if (this.stats.collected < 10) { text = 'Grab your cash!'; target = LAYOUT.boothCash; }
    else if (!done('shed')) { text = 'Build the Cargo Shed'; target = padPos('shed'); }
    else if (this.stats.cargo < 3) { text = hasBox ? 'Load parcels onto the ferry' : 'Pick up parcels'; target = hasBox ? LAYOUT.cargoPad : LAYOUT.shedPile; }
    else if (this.ferry.returns < 1) { text = 'Ferry is sailing — sell more tickets!'; target = this.ferry.state === 'docked' ? LAYOUT.cargoPad : LAYOUT.boothZone; }
    else if (!done('stand')) { text = 'Build the Seafood Stand'; target = padPos('stand'); }
    else if (this.stats.lobstersStocked < 3) { text = hasLob ? 'Stock the stand with lobsters' : 'Unload the lobsters'; target = hasLob ? LAYOUT.standDrop : LAYOUT.unloadPile; }
    else {
      const open = this.pads.filter((p) => !p.done && p.pad!.visible && !p.pad!.locked).sort((a, b) => a.pad!.remaining - b.pad!.remaining);
      const next = open[0];
      if (next) { text = `Next: ${next.title} ($${Math.ceil(next.pad!.remaining)})`; target = next.pos; }
      else if (!this.ended) { text = 'Earn stars to reach the next level'; target = null; }
      else { text = 'Port complete! 🎉'; target = null; }
    }
    if (text !== this.objectiveKey) {
      this.objectiveKey = text;
      this.hud.objectiveText.textContent = text;
      this.hud.objective.classList.remove('pop');
      void this.hud.objective.offsetWidth;
      this.hud.objective.classList.add('pop');
    }
    this.objTarget = target;
    const p = this.player.position;
    if (target) {
      const d = flatDist(p, target);
      this.arrow.visible = d > 2.6;
      const ang = Math.atan2(target.x - p.x, target.z - p.z);
      this.arrow.position.set(p.x + Math.sin(ang) * 1.3, p.y + 0.1, p.z + Math.cos(ang) * 1.3);
      this.arrow.rotation.y = ang;
      const s = 1 + Math.sin(this.time * 6) * 0.08;
      this.arrow.scale.set(s, 1, s);
      this.marker.visible = true;
      this.marker.position.set(target.x, 2.2 + Math.sin(this.time * 4) * 0.25, target.z);
      this.marker.rotation.y += dt * 2;
    } else {
      this.arrow.visible = false;
      this.marker.visible = false;
    }
  }

  // -------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------

  private lastMoney = -1;
  updateHud(force: boolean, dt = 0) {
    const diff = this.money - this.shownMoney;
    if (Math.abs(diff) < 1 || force) this.shownMoney = this.money;
    else this.shownMoney += diff * Math.min(1, dt * 12);
    const m = Math.round(this.shownMoney);
    if (m !== this.lastMoney) {
      if (m > this.lastMoney && this.lastMoney >= 0) {
        this.hud.moneyBox.classList.remove('bump');
        void this.hud.moneyBox.offsetWidth;
        this.hud.moneyBox.classList.add('bump');
      }
      this.lastMoney = m;
      this.hud.money.textContent = m >= 10000 ? `${(m / 1000).toFixed(1)}K` : `${m}`;
    }
    const L = CFG.levels;
    const lo = L[this.level - 1] ?? 0;
    const hi = L[this.level] ?? lo;
    this.hud.levelNum.textContent = `${this.level}`;
    if (hi > lo) {
      this.hud.levelFill.style.width = `${clamp((this.stars - lo) / (hi - lo), 0, 1) * 100}%`;
      this.hud.levelText.textContent = `${this.stars}/${hi}`;
    } else {
      this.hud.levelFill.style.width = '100%';
      this.hud.levelText.textContent = 'MAX';
    }
  }

  // -------------------------------------------------------------------
  // Debug
  // -------------------------------------------------------------------
  debugMoney(n: number) { this.addMoney(n); }
  debugStars(n: number) { this.addStars(n, this.player.position.clone().setY(1)); }
  debugDepart() {
    if (this.ferry.state === 'docked' && this.ferry.incoming === 0 && this.ferry.cargoArriving === 0) this.depart(false);
  }
}

function popInEl(el: HTMLElement) {
  el.animate([{ transform: 'translate(-50%,-100%) scale(0.3)' }, { transform: 'translate(-50%,-100%) scale(1.15)' }, { transform: 'translate(-50%,-100%) scale(1)' }], { duration: 280, easing: 'ease-out' });
}

export { tweens };
