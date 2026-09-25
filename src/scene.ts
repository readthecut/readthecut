import * as THREE from 'three';
import { BALL_R, POCKETS, TABLE, type Candidate, type Shot, type V2 } from './geometry';

// Heights are metres above the cloth.
const CUSHION_H = 0.038;
const CUSHION_W = 0.05;
const RAIL_W = 0.13;
const RAIL_H = 0.046;
const POCKET_R_CORNER = 0.075;
const POCKET_R_SIDE = 0.07;
const STANDING_EYE = 1.6 - 0.76; // eye height minus table height
const STANDING_BACK = 0.9;
const CUE_ELEVATION = (4 * Math.PI) / 180;
const CUE_GAP = 0.015; // tip to cue ball
const AIM_EYE_BACK = 0.35; // along the cue, behind the cue ball
const AIM_EYE_ABOVE_CUE = 0.11;

const HALF_L = TABLE.length / 2;
const HALF_W = TABLE.width / 2;

const BALL_COLOURS = [
  '#f2c200', '#1f4fb5', '#d42a1e', '#5b2a86', '#f07a12', '#127a3c', '#7a1f1f', '#111111',
];

export const ballColour = (n: number) => BALL_COLOURS[(n - 1) % 8];

/** Build a Shape from world XZ points, for geometry that is later rotated flat onto the table. */
function flatShape(points: V2[]): THREE.Shape {
  return new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
}

function layFlat(geo: THREE.BufferGeometry, y: number): THREE.BufferGeometry {
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

/** Outline of the rail's inner edge: the cushion-back rectangle unioned with the pocket holes. */
function railInnerOutline(): V2[] {
  const hx = HALF_L + CUSHION_W;
  const hz = HALF_W + CUSHION_W;
  const pts: V2[] = [];
  const steps = 1440;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let r = Math.min(Math.abs(dx) > 1e-9 ? hx / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-9 ? hz / Math.abs(dz) : Infinity);
    for (const p of POCKETS) {
      const pr = p.kind === 'corner' ? POCKET_R_CORNER : POCKET_R_SIDE;
      // Far intersection of the ray with the pocket circle.
      const b = dx * p.hole.x + dz * p.hole.z;
      const c = p.hole.x ** 2 + p.hole.z ** 2 - pr * pr;
      const disc = b * b - c;
      if (disc > 0) r = Math.max(r, b + Math.sqrt(disc));
    }
    pts.push({ x: dx * r, z: dz * r });
  }
  return pts;
}

function ballTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const colour = ballColour(n);
  if (n <= 8) {
    g.fillStyle = colour;
    g.fillRect(0, 0, c.width, c.height);
  } else {
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = colour;
    g.fillRect(0, c.height * 0.27, c.width, c.height * 0.46);
  }
  for (const cx of [c.width * 0.25, c.width * 0.75]) {
    g.fillStyle = '#f4f1e8';
    g.beginPath();
    g.arc(cx, c.height / 2, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 36px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(cx, c.height / 2 + 2);
    g.scale(-1, 1); // SphereGeometry's U runs clockwise seen from outside
    g.fillText(String(n), 0, 0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildCue(): THREE.Group {
  // Built along +Y, tip at the origin.
  const cue = new THREE.Group();
  const parts: [number, number, number, string, number][] = [
    // length, radius at tip end, radius at butt end, colour, roughness
    [0.012, 0.0064, 0.0064, '#3b5e8c', 0.9],
    [0.025, 0.0065, 0.0066, '#f3efe6', 0.4],
    [0.7, 0.0066, 0.0095, '#e2c694', 0.45],
    [0.25, 0.0095, 0.0115, '#2a1a10', 0.35],
    [0.28, 0.0115, 0.0135, '#1a1a1a', 0.8],
    [0.2, 0.0135, 0.015, '#3a2212', 0.35],
  ];
  let y = 0;
  for (const [l, r0, r1, colour, rough] of parts) {
    const geo = new THREE.CylinderGeometry(r1, r0, l, 24);
    geo.translate(0, y + l / 2, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, roughness: rough }));
    mesh.castShadow = true;
    cue.add(mesh);
    y += l;
  }
  return cue;
}

export interface ViewSize {
  width: number;
  height: number;
}

export class TableScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cueBall: THREE.Mesh;
  private objectBall: THREE.Mesh;
  private cue: THREE.Group;
  private pocketMarker: THREE.Mesh;
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 30);
  private shot: Shot | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color('#15171b');

    this.buildTable();
    this.buildLights();

    const ballGeo = new THREE.SphereGeometry(BALL_R, 48, 32);
    this.cueBall = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: '#f7f5ee', roughness: 0.18 }));
    this.objectBall = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ roughness: 0.18 }));
    for (const b of [this.cueBall, this.objectBall]) {
      b.castShadow = true;
      this.scene.add(b);
    }
    this.cue = buildCue();
    this.scene.add(this.cue);

    // Ring on the rail around the called pocket.
    this.pocketMarker = new THREE.Mesh(
      new THREE.RingGeometry(1.02, 1.35, 48),
      new THREE.MeshBasicMaterial({ color: '#ffc94d' }),
    );
    this.pocketMarker.rotation.x = -Math.PI / 2;
    this.scene.add(this.pocketMarker);
  }

  private buildTable() {
    const cloth = new THREE.MeshStandardMaterial({ color: '#1d6b47', roughness: 0.95 });
    const cushionCloth = new THREE.MeshStandardMaterial({ color: '#1a6040', roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3320', roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 1, side: THREE.DoubleSide });

    const clothMesh = new THREE.Mesh(
      layFlat(new THREE.PlaneGeometry(TABLE.length + 2 * CUSHION_W, TABLE.width + 2 * CUSHION_W), 0),
      cloth,
    );
    clothMesh.receiveShadow = true;
    this.scene.add(clothMesh);

    // Pockets: a black floor just above the cloth plus a wall down from the rail.
    for (const p of POCKETS) {
      const r = p.kind === 'corner' ? POCKET_R_CORNER : POCKET_R_SIDE;
      const floor = new THREE.Mesh(layFlat(new THREE.CircleGeometry(r, 40), 0.0008), black);
      floor.position.set(p.hole.x, 0, p.hole.z);
      this.scene.add(floor);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, RAIL_H, 40, 1, true), black);
      wall.position.set(p.hole.x, RAIL_H / 2, p.hole.z);
      this.scene.add(wall);
    }

    // Cushions: one prism per rail segment, running between the jaws.
    const segments: [V2, V2, V2][] = []; // start jaw, end jaw, outward normal
    const corner = POCKETS.filter((p) => p.kind === 'corner');
    const side = POCKETS.filter((p) => p.kind === 'side');
    const jawOnLong = (p: (typeof POCKETS)[number]) => p.jaws.find((j) => Math.abs(Math.abs(j.z) - HALF_W) < 1e-9)!;
    const jawOnShort = (p: (typeof POCKETS)[number]) => p.jaws.find((j) => Math.abs(Math.abs(j.x) - HALF_L) < 1e-9)!;
    for (const sz of [-1, 1]) {
      const sidePocket = side.find((p) => Math.sign(p.mouth.z) === sz)!;
      for (const sx of [-1, 1]) {
        const c = corner.find((p) => Math.sign(p.mouth.x) === sx && Math.sign(p.mouth.z) === sz)!;
        const sj = sidePocket.jaws.find((j) => Math.sign(j.x) === sx)!;
        segments.push([jawOnLong(c), sj, { x: 0, z: sz }]);
      }
    }
    for (const sx of [-1, 1]) {
      const [a, b] = corner.filter((p) => Math.sign(p.mouth.x) === sx);
      segments.push([jawOnShort(a), jawOnShort(b), { x: sx, z: 0 }]);
    }
    for (const [a, b, n] of segments) {
      const along = { x: b.x - a.x, z: b.z - a.z };
      const l = Math.hypot(along.x, along.z);
      const t = { x: along.x / l, z: along.z / l };
      const flare = CUSHION_W * 0.7; // facings angle back into the pocket
      const back = (p: V2, s: number) => ({ x: p.x + n.x * CUSHION_W + t.x * s, z: p.z + n.z * CUSHION_W + t.z * s });
      const shape = flatShape([a, b, back(b, flare), back(a, -flare)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: CUSHION_H, bevelEnabled: false });
      const mesh = new THREE.Mesh(layFlat(geo, 0), cushionCloth);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Rails: outer rectangle with the pocket-bitten inner outline cut out.
    const ox = HALF_L + CUSHION_W + RAIL_W;
    const oz = HALF_W + CUSHION_W + RAIL_W;
    const outer = flatShape([
      { x: -ox, z: -oz }, { x: ox, z: -oz }, { x: ox, z: oz }, { x: -ox, z: oz },
    ]);
    outer.holes.push(new THREE.Path(railInnerOutline().map((p) => new THREE.Vector2(p.x, -p.z))));
    const rail = new THREE.Mesh(layFlat(new THREE.ExtrudeGeometry(outer, { depth: RAIL_H, bevelEnabled: false }), 0), wood);
    this.scene.add(rail);

    // Table body below the rail.
    const body = new THREE.Mesh(new THREE.BoxGeometry(2 * ox, 0.25, 2 * oz), new THREE.MeshStandardMaterial({ color: '#3d2215', roughness: 0.6 }));
    body.position.y = -0.127; // top face just below the cloth
    this.scene.add(body);

    // Diamonds: every eighth of the length, every quarter of the width.
    const pearl = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.3 });
    const diamondGeo = new THREE.CircleGeometry(0.009, 4);
    layFlat(diamondGeo, RAIL_H + 0.0006);
    const railMid = CUSHION_W + RAIL_W / 2;
    const addDiamond = (x: number, z: number) => {
      const d = new THREE.Mesh(diamondGeo, pearl);
      d.position.set(x, 0, z);
      this.scene.add(d);
    };
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      for (const sz of [-1, 1]) addDiamond((k * TABLE.length) / 8, sz * (HALF_W + railMid));
    }
    for (const k of [-1, 0, 1]) {
      for (const sx of [-1, 1]) addDiamond(sx * (HALF_L + railMid), (k * TABLE.width) / 4);
    }

    const floor = new THREE.Mesh(layFlat(new THREE.PlaneGeometry(30, 30), -0.76), new THREE.MeshStandardMaterial({ color: '#23201d', roughness: 1 }));
    this.scene.add(floor);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#20242a', 0.9));
    // Two lamps over the table, like a real table light.
    for (const x of [-0.6, 0.6]) {
      const lamp = new THREE.DirectionalLight('#fff4e2', 1.4);
      lamp.position.set(x, 3, 0.4);
      lamp.target.position.set(x * 0.6, 0, 0);
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(2048, 2048);
      const cam = lamp.shadow.camera;
      cam.left = -1.8;
      cam.right = 1.8;
      cam.top = 1.2;
      cam.bottom = -1.2;
      cam.near = 1;
      cam.far = 5;
      lamp.shadow.bias = -0.0004;
      lamp.shadow.radius = 4;
      this.scene.add(lamp, lamp.target);
    }
  }

  setShot(shot: Shot) {
    this.shot = shot;
    this.cueBall.position.set(shot.cue.x, BALL_R, shot.cue.z);
    this.objectBall.position.set(shot.object.x, BALL_R, shot.object.z);
    const r = shot.pocket.kind === 'corner' ? POCKET_R_CORNER : POCKET_R_SIDE;
    this.pocketMarker.position.set(shot.pocket.hole.x, RAIL_H + 0.001, shot.pocket.hole.z);
    this.pocketMarker.scale.setScalar(r + 0.004);
    this.objectBall.rotation.set(Math.random() * 0.8 - 0.4, Math.random() * Math.PI * 2, Math.random() * 0.8 - 0.4);
    const mat = this.objectBall.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = ballTexture(shot.objectNumber);
    mat.needsUpdate = true;
  }

  private renderTo(target: HTMLCanvasElement) {
    const { width, height } = target;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    target.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
  }

  /** Eye height, a step behind the cue ball, looking along cue ball → object ball. */
  renderStanding(target: HTMLCanvasElement) {
    const s = this.shot!;
    this.cue.visible = false;
    const fx = s.object.x - s.cue.x;
    const fz = s.object.z - s.cue.z;
    const fl = Math.hypot(fx, fz);
    const f = { x: fx / fl, z: fz / fl };
    const eye = new THREE.Vector3(s.cue.x - f.x * STANDING_BACK, STANDING_EYE, s.cue.z - f.z * STANDING_BACK);

    // Pitch and field of view so the cue ball, object ball and pocket all fit.
    const aspect = target.width / target.height;
    let minDep = Infinity;
    let maxDep = -Infinity;
    let maxYaw = 0;
    for (const p of [s.cue, s.object, s.pocket.mouth]) {
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const fwd = dx * f.x + dz * f.z;
      if (fwd < 0.1) continue;
      const lat = -dx * f.z + dz * f.x;
      const dep = Math.atan2(eye.y, Math.hypot(fwd, lat));
      minDep = Math.min(minDep, dep);
      maxDep = Math.max(maxDep, dep);
      maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(lat, fwd)));
    }
    const pad = (8 * Math.PI) / 180;
    const pitch = (minDep + maxDep) / 2;
    const vNeeded = maxDep - minDep + 2 * pad;
    const hNeeded = 2 * (maxYaw + pad);
    const vFromH = 2 * Math.atan(Math.tan(hNeeded / 2) / aspect);
    const vfov = Math.min(85, Math.max(45, (Math.max(vNeeded, vFromH) * 180) / Math.PI));

    this.camera.fov = vfov;
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.x + f.x * Math.cos(pitch), eye.y - Math.sin(pitch), eye.z + f.z * Math.cos(pitch));
    this.renderTo(target);
  }

  /** Down on the shot: eye directly over the cue, looking along the aim line of `choice`. */
  renderAim(target: HTMLCanvasElement, choice: Candidate) {
    const s = this.shot!;
    const a = { x: Math.cos(choice.aimDir), z: Math.sin(choice.aimDir) };
    const cos = Math.cos(CUE_ELEVATION);
    const sin = Math.sin(CUE_ELEVATION);
    const back = new THREE.Vector3(-a.x * cos, sin, -a.z * cos); // from tip toward butt
    const centre = new THREE.Vector3(s.cue.x, BALL_R, s.cue.z);

    this.cue.visible = true;
    this.cue.position.copy(centre).addScaledVector(back, BALL_R + CUE_GAP);
    this.cue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), back);

    const eye = centre.clone().addScaledVector(back, AIM_EYE_BACK);
    eye.y += AIM_EYE_ABOVE_CUE;
    // Same look distance for every Choice, so they differ only in yaw.
    const lookDist = Math.max(0.5, Math.hypot(s.correct.ghost.x - s.cue.x, s.correct.ghost.z - s.cue.z));
    this.camera.fov = this.aimFov(target.width / target.height);
    this.camera.position.copy(eye);
    this.camera.lookAt(centre.x + a.x * lookDist, BALL_R, centre.z + a.z * lookDist);
    this.renderTo(target);
  }

  /**
   * Vertical FOV that keeps the pocket in frame for every Choice. It is shared by
   * all four so the framing can't hint at the answer.
   */
  private aimFov(aspect: number): number {
    const s = this.shot!;
    const pad = (7 * Math.PI) / 180;
    let maxYaw = 0;
    for (const c of s.choices) {
      const a = { x: Math.cos(c.aimDir), z: Math.sin(c.aimDir) };
      const eye = { x: s.cue.x - a.x * AIM_EYE_BACK, z: s.cue.z - a.z * AIM_EYE_BACK };
      const dx = s.pocket.mouth.x - eye.x;
      const dz = s.pocket.mouth.z - eye.z;
      const fwd = dx * a.x + dz * a.z;
      const lat = -dx * a.z + dz * a.x;
      maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(lat, fwd)));
    }
    const vFromH = 2 * Math.atan(Math.tan(maxYaw + pad) / aspect);
    return Math.min(90, Math.max(44, (vFromH * 180) / Math.PI));
  }
}
