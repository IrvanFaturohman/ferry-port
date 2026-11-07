import './style.css';
import * as THREE from 'three';
import { World } from './world';
import { Game } from './game';
import { Particles, WorldUI, Shake } from './fx';
import { sfx } from './audio';
import { tweens, clamp, damp } from './util';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const canvas = $<HTMLCanvasElement>('game');

// ---------------- Renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3ec7e8);
scene.fog = new THREE.Fog(0x8fe0f2, 42, 88);

const camera = new THREE.PerspectiveCamera(42, 9 / 16, 0.5, 220);
const CAM_OFFSET = new THREE.Vector3(0, 30, 20);

const hemi = new THREE.HemisphereLight(0xffffff, 0x9fd6a8, 1.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-8, 20, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 60;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

const world = new World(scene);
const particles = new Particles(scene);
const ui = new WorldUI($('world-ui'), camera);
const shake = new Shake();

let game = createGame();
(window as any).__game = game;
function createGame() {
  return new Game(scene, camera, particles, ui, shake, {
    money: $('money'),
    moneyBox: $('money-box'),
    levelNum: $('level-num'),
    levelFill: $('level-fill'),
    levelText: $('level-text'),
    levelStar: $('level-star'),
    objective: $('objective'),
    objectiveText: $('objective-text'),
    banner: $('banner'),
    stage,
  });
}

// ---------------- Resize ----------------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep a similar horizontal view on wider screens
  camera.fov = w / h > 0.7 ? 32 : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------- Input (floating joystick + keyboard) ----------------
const joy = $('joystick');
const knob = $('joy-knob');
const JOY_R = 50;
let joyActive = false;
let joyId = -1;
const joyOrigin = { x: 0, y: 0 };
const joyVec = new THREE.Vector2();
const keys = new Set<string>();

stage.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button, select, #debug-panel')) return;
  sfx.init();
  joyActive = true;
  joyId = e.pointerId;
  const r = stage.getBoundingClientRect();
  joyOrigin.x = e.clientX - r.left;
  joyOrigin.y = e.clientY - r.top;
  joy.style.left = `${joyOrigin.x}px`;
  joy.style.top = `${joyOrigin.y}px`;
  joy.style.display = 'block';
  knob.style.transform = 'translate(-50%, -50%)';
  joyVec.set(0, 0);
});
window.addEventListener('pointermove', (e) => {
  if (!joyActive || e.pointerId !== joyId) return;
  const r = stage.getBoundingClientRect();
  let dx = e.clientX - r.left - joyOrigin.x;
  let dy = e.clientY - r.top - joyOrigin.y;
  const d = Math.hypot(dx, dy);
  if (d > JOY_R) { dx = (dx / d) * JOY_R; dy = (dy / d) * JOY_R; }
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  joyVec.set(dx / JOY_R, dy / JOY_R);
  if (joyVec.length() < 0.12) joyVec.set(0, 0);
});
const endJoy = (e: PointerEvent) => {
  if (e.pointerId !== joyId) return;
  joyActive = false;
  joy.style.display = 'none';
  joyVec.set(0, 0);
};
window.addEventListener('pointerup', endJoy);
window.addEventListener('pointercancel', endJoy);
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === '`') toggleDebug();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function readInput() {
  const v = new THREE.Vector2(joyVec.x, joyVec.y);
  const kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const ky = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (kx || ky) v.set(kx, ky).normalize();
  return v;
}

// ---------------- Buttons ----------------
let started = false;
$('btn-start').addEventListener('click', () => {
  sfx.init();
  started = true;
  $('start-screen').classList.add('gone');
});
const btnSound = $('btn-sound');
btnSound.addEventListener('click', () => {
  sfx.init();
  sfx.setEnabled(!sfx.enabled);
  btnSound.textContent = sfx.enabled ? '🔊' : '🔇';
});
const panel = $('debug-panel');
function toggleDebug() { panel.classList.toggle('hidden'); }
$('btn-debug').addEventListener('click', toggleDebug);
$('dbg-close').addEventListener('click', toggleDebug);
let speedMul = 1;
$<HTMLSelectElement>('dbg-speed').addEventListener('change', (e) => { speedMul = Number((e.target as HTMLSelectElement).value); });
$('dbg-money').addEventListener('click', () => game.debugMoney(500));
$('dbg-stars').addEventListener('click', () => game.debugStars(5));
$('dbg-ferry').addEventListener('click', () => game.debugDepart());
$('dbg-reset').addEventListener('click', () => location.reload());

// ---------------- Loop (fixed timestep) ----------------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
let elapsed = 0;
const camTarget = new THREE.Vector3();
camTarget.copy(game.player.position);

function frame(now: number) {
  requestAnimationFrame(frame);
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += real * speedMul;
  let steps = 0;
  while (acc >= STEP && steps < 8) {
    acc -= STEP;
    steps++;
    elapsed += STEP;
    if (started) {
      game.input.copy(readInput());
      game.update(STEP);
    }
    tweens.update(STEP);
    particles.update(STEP);
    shake.update(STEP);
  }
  world.update(elapsed);

  // camera follow (clamped to the play area)
  const p = game.player.position;
  const tx = clamp(p.x, -5.5, 5.5);
  const tz = clamp(p.z, -6.5, 15);
  camTarget.x = damp(camTarget.x, tx, 5, real);
  camTarget.z = damp(camTarget.z, tz, 5, real);
  camera.position.copy(camTarget).add(CAM_OFFSET).add(shake.offset);
  camera.lookAt(camTarget.x + shake.offset.x, 0, camTarget.z - 1.5 + shake.offset.z);
  sun.position.set(camTarget.x - 8, 20, camTarget.z + 10);
  sun.target.position.set(camTarget.x, 0, camTarget.z);

  ui.update(real);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// redraw canvas-text once the web font is ready
document.fonts?.ready.then(() => {
  for (const d of game.pads) d.pad?.draw(true);
});

void createGame;
