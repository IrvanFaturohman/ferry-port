// Static environment: land, road, pier, water, decor. Also layout positions.
import * as THREE from 'three';
import { COLORS, mat, makeLighthouse, makeHouse, makeTree, makeBuoy, makeBollard, makeCrate } from './models';

const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);

export const LAYOUT = {
  laneIn: -1.1,
  laneOut: 1.1,
  roadStartZ: 30,
  ferryStern: V(0, -6.3),
  ferryAway: V(0, -80),
  gateZ: 2.4,
  booth: V(-3.5, 3.0),
  boothZone: V(-3.5, 4.75),
  boothCash: V(-5.4, 3.2),
  barrier: V(-2.25, 2.2),
  shed: V(6.4, 4.6),
  shedPile: V(4.2, 3.6),
  cargoPad: V(4.0, -3.7),
  cargoCash: V(5.9, -3.7),
  unloadPile: V(-4.0, -3.7),
  stand: V(-6.6, 1.3),
  standDrop: V(-4.65, 1.3),
  standCash: V(-8.7, 2.3),
  standQueue: V(-6.6, 2.85),
  shack: V(-6.6, 9.0),
  shackDrop: V(-4.6, 8.6),
  shackCash: V(-8.9, 10.2),
  shackQueue: V(-6.6, 11.0),
  office: V(6.4, 11.4),
  padCapacity: V(5.0, 14.0),
  padSpeed: V(7.8, 14.0),
  padClerk: V(-5.2, 6.0),
  padDockhand: V(6.6, 7.6),
  padUnloader: V(-6.0, -2.0),
  padFerry: V(6.2, -1.9),
  padStandUp: V(-9.6, 5.0),
  padRoute2: V(10.2, 1.0),
  customerSpawnW: V(-16, 6.0),
  customerSpawnW2: V(-16, 14.0),
  playerStart: V(-2.8, 7.5),
};

export type AABB = { minX: number; maxX: number; minZ: number; maxZ: number };

export const WALKABLE: AABB[] = [
  { minX: -14.5, maxX: 14.5, minZ: -0.9, maxZ: 22 },
  { minX: -7.2, maxX: 7.2, minZ: -6.0, maxZ: -0.5 },
];

export const COLLIDERS: AABB[] = [];
export function addCollider(center: THREE.Vector3, w: number, d: number) {
  const c = { minX: center.x - w / 2, maxX: center.x + w / 2, minZ: center.z - d / 2, maxZ: center.z + d / 2 };
  COLLIDERS.push(c);
  return c;
}

export class World {
  water!: THREE.Mesh;
  private waterBase!: Float32Array;
  lighthouse!: THREE.Group;
  buoys: THREE.Object3D[] = [];
  island!: THREE.Group;

  constructor(private scene: THREE.Scene) {
    this.build();
  }

  private build() {
    const s = this.scene;

    // Water (animated low-poly)
    const wg = new THREE.PlaneGeometry(140, 108, 56, 44);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: COLORS.water, flatShading: true }));
    this.water.position.set(0, -0.22, -55.2);
    this.water.receiveShadow = true;
    s.add(this.water);
    this.waterBase = Float32Array.from(wg.attributes.position.array as Float32Array);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), mat(COLORS.water));
    far.position.set(0, -0.35, -40);
    s.add(far);

    // Land
    const land = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 40), mat(COLORS.grass));
    land.position.set(0, -0.5, 19);
    land.receiveShadow = true;
    s.add(land);
    const sand = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 2.6), mat(COLORS.sand));
    sand.position.set(0, -0.48, 0.2);
    sand.receiveShadow = true;
    s.add(sand);
    // shoreline foam strip
    const foam = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 0.5), mat(0xe8fbff));
    foam.position.set(0, -0.08, -1.15);
    s.add(foam);

    // Road
    const road = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.06, 32), mat(COLORS.road));
    road.position.set(0, 0.02, 15);
    road.receiveShadow = true;
    s.add(road);
    for (let z = 1; z < 31; z += 2) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 1), mat(COLORS.roadLine));
      dash.position.set(0, 0.06, z);
      s.add(dash);
    }
    for (const sx of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 32), mat(COLORS.concrete));
      curb.position.set(2.35 * sx, 0.05, 15);
      curb.receiveShadow = true;
      s.add(curb);
    }

    // Paved plaza on the land side
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(20, 0.04, 14), mat(0xf6efe0));
    plaza.position.set(0, 0.0, 6.2);
    plaza.receiveShadow = true;
    s.add(plaza);
    // sidewalk west (customers)
    const walk = new THREE.Mesh(new THREE.BoxGeometry(14, 0.05, 1.6), mat(0xdcd4c0));
    walk.position.set(-10, 0.01, 6);
    s.add(walk);

    // Pier (wood planks)
    const pier = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(14.6, 0.3, 5.6), mat(COLORS.wood));
    deck.position.set(0, -0.05, -3.4);
    deck.receiveShadow = true;
    pier.add(deck);
    for (let i = 0; i < 19; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 5.6), mat(COLORS.woodDark));
      line.position.set(-7 + i * 0.78, 0.11, -3.4);
      pier.add(line);
    }
    for (let i = 0; i < 8; i++) for (const z of [-6.1, -0.8]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 8), mat(COLORS.woodDark));
      post.position.set(-7 + i * 2, -0.6, z);
      pier.add(post);
    }
    // pier road markings for vehicles
    const pierRoad = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.02, 5.6), mat(0x8c7b6a));
    pierRoad.position.set(0, 0.11, -3.4);
    pier.add(pierRoad);
    for (let i = 0; i < 9; i++) {
      const b = makeBollard();
      b.position.set(-7 + i * 1.75, 0.1, -6.0);
      if (Math.abs(b.position.x) > 2.6) pier.add(b);
    }
    s.add(pier);

    // Lighthouse on a small rock
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(3, 0), mat(0x9aa3b5, { flat: true }));
    rock.scale.set(1.2, 0.5, 1);
    rock.position.set(12, -0.4, -8);
    s.add(rock);
    this.lighthouse = makeLighthouse();
    this.lighthouse.position.set(12, 0.6, -8);
    s.add(this.lighthouse);

    // Houses (New England clapboard pastels)
    const houses: [number, number, number, number, number][] = [
      [-12, 17, 0xa8d8ff, 0x2f4a73, 0.4],
      [-8, 18.5, 0xffc2d1, 0x8a3b4a, -0.2],
      [8, 18, 0xfff2a8, 0x5b6b8c, 0.1],
      [12.5, 16, 0xc9f2d0, 0x2f4a73, -0.4],
      [-13, 12.5, 0xffe0b8, 0x8a3b4a, 1.2],
      [13, 8, 0xd9c8ff, 0x2f4a73, -1.3],
    ];
    for (const [x, z, c, r, rot] of houses) {
      const h = makeHouse(c, r);
      h.position.set(x, 0, z);
      h.rotation.y = rot + Math.PI;
      s.add(h);
      addCollider(h.position, 3, 3);
    }

    // Trees
    const trees: [number, number, number][] = [
      [-14, 9, 1.1], [-11, 21, 1.2], [-4, 20, 1], [4, 21, 1.15], [14, 12, 1], [10.5, 20.5, 0.9],
      [-13.5, 2, 0.9], [13.5, 3, 1.1], [-9.5, 14.5, 0.8], [10, 15, 0.85], [-15, 16, 1.2], [15, 19, 1.1],
    ];
    for (const [x, z, sc] of trees) {
      const t = makeTree(sc);
      t.position.set(x, 0, z);
      t.rotation.y = x * z;
      s.add(t);
      addCollider(t.position, 0.9, 0.9);
    }

    // Crates and flowers for life
    for (const [x, z] of [[-6.6, -5.4], [-5.8, -5.5], [6.4, -5.4], [9.2, 6.2], [-11.8, 4.4]] as [number, number][]) {
      const c = makeCrate();
      c.position.set(x, 0.1, z);
      c.rotation.y = x;
      s.add(c);
    }

    // Buoys
    for (const [x, z, c] of [[-9, -9, COLORS.red], [9, -12, COLORS.yellow], [-5, -16, COLORS.red], [5, -20, COLORS.yellow], [-12, -22, COLORS.red]] as [number, number, number][]) {
      const b = makeBuoy(c);
      b.position.set(x, 0, z);
      s.add(b);
      this.buoys.push(b);
    }

    // Distant island (destination)
    this.island = new THREE.Group();
    const isl = new THREE.Mesh(new THREE.DodecahedronGeometry(9, 0), mat(0x7fd84f, { flat: true }));
    isl.scale.set(1.6, 0.35, 1);
    this.island.add(isl);
    for (let i = 0; i < 7; i++) {
      const t = makeTree(1.8);
      t.position.set(-8 + i * 2.6, 2.4, Math.sin(i) * 3);
      this.island.add(t);
    }
    this.island.position.set(-6, -0.5, -92);
    s.add(this.island);
  }

  update(t: number) {
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.waterBase[i], z = this.waterBase[i + 2];
      arr[i + 1] = Math.sin(x * 0.35 + t * 1.3) * 0.09 + Math.cos(z * 0.42 + t * 1.1) * 0.09;
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    for (let i = 0; i < this.buoys.length; i++) {
      const b = this.buoys[i];
      b.position.y = Math.sin(t * 1.6 + i) * 0.12;
      b.rotation.z = Math.sin(t * 1.2 + i * 2) * 0.15;
    }
    const light = this.lighthouse.userData.light as THREE.Mesh;
    light.scale.setScalar(1 + Math.sin(t * 3) * 0.15);
  }
}
