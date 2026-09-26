import * as THREE from 'three';
import { type Candidate, type Pocket, type Shot, type Table, type V2 } from './geometry';
import { buildAimOverlay, disposeOverlay, setOverlayResolution, type OverlayLayers } from './overlay';

// Heights are metres above the cloth.
const CUSHION_H = 0.038;
const CUSHION_W = 0.05;
const RAIL_W = 0.13;
const RAIL_H = 0.046;
const STANDING_EYE = 1.6 - 0.76; // eye height minus table height
const STANDING_BACK = 0.9;
const CUE_ELEVATION = (4 * Math.PI) / 180; // a normal stance, cue nearly level
const MAX_CUE_ELEVATION = (30 * Math.PI) / 180;
const CUE_CLEARANCE = 0.011; // shaft radius near the tip (~7 mm), plus a few mm of air
const CUE_GAP = 0.015; // tip to cue ball
const AIM_EYE_BACK = 0.35; // along the cue, behind the cue ball
const AIM_EYE_ABOVE_CUE = 0.11;
const AIM_FOV_ASPECT = 4 / 3;
const LAMP_HEIGHT = 0.95; // shade height above the cloth, typical for a pool table light
const LAMP_INTENSITY = 1.35; // candela per lamp

/**
 * What the balls reflect: a dark room, the three bright lamp shades overhead and
 * the green cloth below. Real balls show exactly this: lamp highlights on top,
 * a green cast underneath.
 */
function tableLightEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), new THREE.MeshBasicMaterial({ color: '#16181b', side: THREE.BackSide }));
  room.position.y = 1.5;
  env.add(room);
  const cloth = new THREE.Mesh(layFlat(new THREE.PlaneGeometry(2.6, 1.3), -0.03), new THREE.MeshBasicMaterial({ color: '#1b5c3d' }));
  env.add(cloth);
  // HDR colour, far brighter than white, so the shades read as light sources in reflections.
  const shade = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.4), side: THREE.DoubleSide });
  for (const k of [-1, 0, 1]) {
    const lamp = new THREE.Mesh(layFlat(new THREE.PlaneGeometry(0.42, 0.34), LAMP_HEIGHT), shade);
    lamp.position.x = k * 0.8;
    env.add(lamp);
  }
  return env;
}

/** Soft dark disc where a ball meets the cloth: the contact shadow a lamp's shadow map is too coarse to show. */
function contactShadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const BALL_COLOURS = [
  '#f2c200', '#1f4fb5', '#d42a1e', '#5b2a86', '#f07a12', '#127a3c', '#7a1f1f', '#111111',
];

export const ballColour = (n: number) => BALL_COLOURS[(n - 1) % 8];

/** UK blackball has unnumbered reds and yellows; the 8 stays black. */
export const ukBallColour = (n: number) => (n === 8 ? '#111111' : n < 8 ? '#c8211b' : '#f3c300');

/** Colour of the object ball as drawn for this table. */
export const objectColour = (shot: Shot) =>
  shot.table.format.balls === 'redsYellows' ? ukBallColour(shot.objectNumber) : ballColour(shot.objectNumber);

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
function railInnerOutline(table: Table): V2[] {
  const hx = table.halfL + CUSHION_W;
  const hz = table.halfW + CUSHION_W;
  const pts: V2[] = [];
  const steps = 1440;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let r = Math.min(Math.abs(dx) > 1e-9 ? hx / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-9 ? hz / Math.abs(dz) : Infinity);
    for (const p of table.pockets) {
      const pr = p.holeR;
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

/**
 * Clipping that keeps pocket meshes out of the table. The pocket circles overlap
 * the cloth and cushions, so unclipped they would stand up out of the table.
 * `inset` moves the boundary outward from the cushion nose: 0 for the pocket
 * floor, CUSHION_W for the wall and ring, which belong to the rail.
 */
function pocketClip(table: Table, p: Pocket, inset: number): { planes: THREE.Plane[]; intersection: boolean } {
  const sx = Math.sign(p.mouth.x);
  const sz = Math.sign(p.mouth.z);
  const beyondSide = new THREE.Plane(new THREE.Vector3(0, 0, sz), -(table.halfW + inset));
  if (p.kind === 'side') return { planes: [beyondSide], intersection: false };
  // A corner clips only the quadrant inside both boundaries.
  return { planes: [new THREE.Plane(new THREE.Vector3(sx, 0, 0), -(table.halfL + inset)), beyondSide], intersection: true };
}

function applyClip(material: THREE.Material, clip: ReturnType<typeof pocketClip>) {
  material.clippingPlanes = clip.planes;
  material.clipIntersection = clip.intersection;
  material.needsUpdate = true;
}

function ballTexture(n: number, style: Table['format']['balls']): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  if (style === 'redsYellows' && n !== 8) {
    g.fillStyle = ukBallColour(n);
    g.fillRect(0, 0, c.width, c.height);
    return finishTexture(c);
  }
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
  return finishTexture(c);
}

function finishTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
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

/** Extra markings for one render, built for the eye position and a line width in pixels. */
export type ExtraMarkings = (eye: THREE.Vector3, lineWidthPx: number) => THREE.Group;

export class TableScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cueBall: THREE.Mesh;
  private objectBall: THREE.Mesh;
  private cue: THREE.Group;
  private pocketMarker: THREE.Mesh;
  private contactShadows: THREE.Mesh[] = [];
  private tableGroup: THREE.Group | null = null;
  private table: Table | null = null;
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 30);
  private shot: Shot | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true; // pocket meshes are clipped to outside the playing surface
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps cloth and ball colours true
    this.renderer.toneMappingExposure = 1.0;
    // Reflections of the table light, mainly for the glossy balls.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(tableLightEnvironment(), 0).texture;
    pmrem.dispose();
    this.scene.background = new THREE.Color('#15171b');

    this.buildLights();

    // Unit sphere, scaled to each ball's radius.
    const ballGeo = new THREE.SphereGeometry(1, 96, 64);
    // Phenolic resin balls: a smooth base under a hard, polished clear coat.
    const ballMaterial = (color?: string) =>
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
    this.cueBall = new THREE.Mesh(ballGeo, ballMaterial('#f7f5ee'));
    this.objectBall = new THREE.Mesh(ballGeo, ballMaterial());
    const shadowTex = contactShadowTexture();
    for (let i = 0; i < 2; i++) {
      const blob = new THREE.Mesh(
        layFlat(new THREE.PlaneGeometry(1, 1), 0),
        new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
      );
      blob.renderOrder = 1;
      this.contactShadows.push(blob);
      this.scene.add(blob);
    }
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

  /** Replace the table meshes when the Table Format changes. */
  private useTable(table: Table) {
    if (this.table === table) return;
    if (this.tableGroup) {
      this.scene.remove(this.tableGroup);
      this.tableGroup.traverse((o) => {
        if (o instanceof THREE.SpotLight) o.shadow.dispose();
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.table = table;
    this.tableGroup = this.buildTable(table);
    this.buildLamps(table, this.tableGroup);
    this.scene.add(this.tableGroup);
  }

  private buildTable(table: Table): THREE.Group {
    const group = new THREE.Group();
    const { halfL, halfW, pockets } = table;
    // Cloth and wood get little of the environment: the lamps light them, the room barely does.
    const cloth = new THREE.MeshStandardMaterial({ color: '#1d6b47', roughness: 0.95, envMapIntensity: 0.02 });
    const cushionCloth = new THREE.MeshStandardMaterial({ color: '#1a6040', roughness: 0.95, envMapIntensity: 0.02 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3320', roughness: 0.5, envMapIntensity: 0.05 });
    const black = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 1, side: THREE.DoubleSide });

    const clothMesh = new THREE.Mesh(
      layFlat(new THREE.PlaneGeometry(table.format.length + 2 * CUSHION_W, table.format.width + 2 * CUSHION_W), 0),
      cloth,
    );
    clothMesh.receiveShadow = true;
    group.add(clothMesh);

    // Pockets: a black floor just above the cloth plus a wall down from the rail.
    for (const p of pockets) {
      const r = p.holeR;
      const floorBlack = black.clone();
      applyClip(floorBlack, pocketClip(table, p, 0));
      const floor = new THREE.Mesh(layFlat(new THREE.CircleGeometry(r, 40), 0.0008), floorBlack);
      floor.position.set(p.hole.x, 0, p.hole.z);
      group.add(floor);
      const wallBlack = black.clone();
      applyClip(wallBlack, pocketClip(table, p, CUSHION_W));
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, RAIL_H, 40, 1, true), wallBlack);
      wall.position.set(p.hole.x, RAIL_H / 2, p.hole.z);
      group.add(wall);
    }

    // Cushions: one prism per rail segment, running between the jaws.
    // Facings angle back into the pocket: sharply at corners (WPA 142°), barely at sides (104°).
    const CORNER_FLARE = CUSHION_W * 0.7;
    const SIDE_FLARE = CUSHION_W * Math.tan((14 * Math.PI) / 180);
    const segments: [V2, V2, V2, number][] = []; // start jaw, end jaw, outward normal, flare at the end jaw
    const corner = pockets.filter((p) => p.kind === 'corner');
    const side = pockets.filter((p) => p.kind === 'side');
    const jawOnLong = (p: Table['pockets'][number]) => p.jaws.find((j) => Math.abs(Math.abs(j.z) - halfW) < 1e-9)!;
    const jawOnShort = (p: Table['pockets'][number]) => p.jaws.find((j) => Math.abs(Math.abs(j.x) - halfL) < 1e-9)!;
    for (const sz of [-1, 1]) {
      const sidePocket = side.find((p) => Math.sign(p.mouth.z) === sz)!;
      for (const sx of [-1, 1]) {
        const c = corner.find((p) => Math.sign(p.mouth.x) === sx && Math.sign(p.mouth.z) === sz)!;
        const sj = sidePocket.jaws.find((j) => Math.sign(j.x) === sx)!;
        segments.push([jawOnLong(c), sj, { x: 0, z: sz }, SIDE_FLARE]);
      }
    }
    for (const sx of [-1, 1]) {
      const [a, b] = corner.filter((p) => Math.sign(p.mouth.x) === sx);
      segments.push([jawOnShort(a), jawOnShort(b), { x: sx, z: 0 }, CORNER_FLARE]);
    }
    for (const [a, b, n, endFlare] of segments) {
      const along = { x: b.x - a.x, z: b.z - a.z };
      const l = Math.hypot(along.x, along.z);
      const t = { x: along.x / l, z: along.z / l };
      const back = (p: V2, s: number) => ({ x: p.x + n.x * CUSHION_W + t.x * s, z: p.z + n.z * CUSHION_W + t.z * s });
      // Every segment starts at a corner jaw.
      const shape = flatShape([a, b, back(b, endFlare), back(a, -CORNER_FLARE)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: CUSHION_H, bevelEnabled: false });
      const mesh = new THREE.Mesh(layFlat(geo, 0), cushionCloth);
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Rails: outer rectangle with the pocket-bitten inner outline cut out.
    const ox = halfL + CUSHION_W + RAIL_W;
    const oz = halfW + CUSHION_W + RAIL_W;
    const outer = flatShape([
      { x: -ox, z: -oz }, { x: ox, z: -oz }, { x: ox, z: oz }, { x: -ox, z: oz },
    ]);
    outer.holes.push(new THREE.Path(railInnerOutline(table).map((p) => new THREE.Vector2(p.x, -p.z))));
    const rail = new THREE.Mesh(layFlat(new THREE.ExtrudeGeometry(outer, { depth: RAIL_H, bevelEnabled: false }), 0), wood);
    group.add(rail);

    // Table body below the rail.
    const body = new THREE.Mesh(new THREE.BoxGeometry(2 * ox, 0.25, 2 * oz), new THREE.MeshStandardMaterial({ color: '#3d2215', roughness: 0.6 }));
    body.position.y = -0.127; // top face just below the cloth
    group.add(body);

    // Diamonds: every eighth of the length, every quarter of the width.
    const pearl = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.3 });
    const diamondGeo = new THREE.CircleGeometry(0.009, 4);
    layFlat(diamondGeo, RAIL_H + 0.0006);
    const railMid = CUSHION_W + RAIL_W / 2;
    const addDiamond = (x: number, z: number) => {
      const d = new THREE.Mesh(diamondGeo, pearl);
      d.position.set(x, 0, z);
      group.add(d);
    };
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      for (const sz of [-1, 1]) addDiamond((k * table.format.length) / 8, sz * (halfW + railMid));
    }
    for (const k of [-1, 0, 1]) {
      for (const sx of [-1, 1]) addDiamond(sx * (halfL + railMid), (k * table.format.width) / 4);
    }

    const floor = new THREE.Mesh(layFlat(new THREE.PlaneGeometry(30, 30), -0.76), new THREE.MeshStandardMaterial({ color: '#23201d', roughness: 1 }));
    group.add(floor);
    return group;
  }

  private buildLights() {
    // Room fill: a little warm light from above, and green bounce from the cloth onto the balls' undersides.
    this.scene.add(new THREE.HemisphereLight('#fff3e0', '#1d5a3c', 0.22));
  }

  /**
   * A three-shade table light hanging over the centre line. Close, overhead
   * lamps are what make shadows fall almost straight down under each ball.
   */
  private buildLamps(table: Table, group: THREE.Group) {
    for (const k of [-1, 0, 1]) {
      const lamp = new THREE.SpotLight('#fff1dc', LAMP_INTENSITY, 0, (62 * Math.PI) / 180, 0.75, 2);
      lamp.position.set(k * table.halfL * 0.62, LAMP_HEIGHT, 0);
      lamp.target.position.set(k * table.halfL * 0.62, 0, 0);
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(2048, 2048);
      lamp.shadow.camera.near = 0.4;
      lamp.shadow.camera.far = 2.5;
      lamp.shadow.bias = -0.0002;
      lamp.shadow.normalBias = 0.002;
      lamp.shadow.radius = 5;
      group.add(lamp, lamp.target);
    }
  }

  setShot(shot: Shot) {
    this.shot = shot;
    this.useTable(shot.table);
    const { objectR, cueR, balls } = shot.table.format;
    this.cueBall.scale.setScalar(cueR);
    this.cueBall.position.set(shot.cue.x, cueR, shot.cue.z);
    this.objectBall.scale.setScalar(objectR);
    this.objectBall.position.set(shot.object.x, objectR, shot.object.z);
    for (const [blob, p, r] of [
      [this.contactShadows[0], shot.cue, cueR],
      [this.contactShadows[1], shot.object, objectR],
    ] as const) {
      blob.position.set(p.x, 0.0007, p.z);
      blob.scale.set(r * 2.1, 1, r * 2.1);
    }
    this.pocketMarker.position.set(shot.pocket.hole.x, RAIL_H + 0.001, shot.pocket.hole.z);
    this.pocketMarker.scale.setScalar(shot.pocket.holeR + 0.004);
    applyClip(this.pocketMarker.material as THREE.Material, pocketClip(shot.table, shot.pocket, CUSHION_W));
    this.objectBall.rotation.set(...shot.objectSpin);
    const mat = this.objectBall.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = ballTexture(shot.objectNumber, balls);
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
  renderStanding(target: HTMLCanvasElement, extra?: ExtraMarkings) {
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
    this.renderWith(target, extra);
  }

  /**
   * Down on the shot: eye directly over the cue, looking along the aim line of `choice`.
   * With `layers`, draws the Aim Overlay for that Choice (only ever after answering).
   */
  renderAim(target: HTMLCanvasElement, choice: Candidate, layers?: OverlayLayers, extra?: ExtraMarkings) {
    const s = this.shot!;
    const a = { x: Math.cos(choice.aimDir), z: Math.sin(choice.aimDir) };
    const elevation = this.cueElevation();
    const cos = Math.cos(elevation);
    const sin = Math.sin(elevation);
    const back = new THREE.Vector3(-a.x * cos, sin, -a.z * cos); // from tip toward butt
    const cueR = s.table.format.cueR;
    const centre = new THREE.Vector3(s.cue.x, cueR, s.cue.z);

    this.cue.visible = true;
    this.cue.position.copy(centre).addScaledVector(back, cueR + CUE_GAP);
    this.cue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), back);

    const eye = centre.clone().addScaledVector(back, AIM_EYE_BACK);
    eye.y += AIM_EYE_ABOVE_CUE;
    // Same look distance for every Choice, so they differ only in yaw.
    const lookDist = Math.max(0.5, Math.hypot(s.correct.ghost.x - s.cue.x, s.correct.ghost.z - s.cue.z));
    this.camera.position.copy(eye);
    if (layers?.closeUp) {
      // Close-up: same eye, narrower field of view aimed at the contact area. A pure
      // magnification, so what you see is still exactly what the eye sees from there.
      const { objectR } = s.table.format;
      const pts = [s.object, s.correct.ghost, choice.ghost];
      const focus = new THREE.Vector3(
        pts.reduce((t, p) => t + p.x, 0) / pts.length,
        objectR,
        pts.reduce((t, p) => t + p.z, 0) / pts.length,
      );
      const span = 10 * objectR; // vertical extent of the frame at the focus distance
      this.camera.fov = (2 * Math.atan(span / 2 / eye.distanceTo(focus)) * 180) / Math.PI;
      this.camera.lookAt(focus);
    } else {
      // FOV is fixed for the thumbnail's 4:3 shape, so a taller canvas is a magnified crop, not a wider view.
      this.camera.fov = this.aimFov(AIM_FOV_ASPECT);
      // Pitch: down to the aim point, or further if a raised cue lifts the eye enough to lose the
      // cue ball off the bottom of the frame. Depends only on the Shot, so every Choice shares it.
      const halfFov = (this.camera.fov * Math.PI) / 360;
      const flat = (x: number, z: number) => Math.hypot(x - eye.x, z - eye.z);
      const toAim = Math.atan2(eye.y - cueR, flat(centre.x + a.x * lookDist, centre.z + a.z * lookDist));
      const toBallFoot = Math.atan2(eye.y, Math.max(0.01, flat(s.cue.x, s.cue.z) - cueR));
      const pitch = Math.max(toAim, toBallFoot - halfFov + (4 * Math.PI) / 180);
      this.camera.lookAt(eye.x + a.x * Math.cos(pitch), eye.y - Math.sin(pitch), eye.z + a.z * Math.cos(pitch));
    }

    const lineWidth = Math.max(1.5, target.height / (layers?.closeUp ? 220 : 300));
    this.renderWith(target, (e) => {
      const g = new THREE.Group();
      if (layers && (layers.ghost || layers.contact || layers.lines)) g.add(buildAimOverlay(s, choice, layers, lineWidth, e));
      if (extra) g.add(extra(e, lineWidth));
      return g;
    });
  }

  /** Render with temporary markings added to the scene, then remove and free them. */
  private renderWith(target: HTMLCanvasElement, extra?: ExtraMarkings) {
    const group = extra?.(this.camera.position.clone(), Math.max(1.5, target.height / 300));
    if (group) {
      setOverlayResolution(group, target.width, target.height);
      this.scene.add(group);
    }
    this.renderTo(target);
    if (group) {
      this.scene.remove(group);
      disposeOverlay(group);
    }
  }

  /**
   * Where a table-space point appears on the canvas last rendered, in canvas
   * pixels. Only valid straight after a render, since the camera is shared.
   */
  project(p: THREE.Vector3, target: HTMLCanvasElement): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * target.width, y: ((1 - v.y) / 2) * target.height };
  }

  /**
   * Cue elevation for this Shot. Normally a nearly level 4°, but raised to clear
   * the cushion and rail behind the cue ball, as a player bridging on the rail
   * would. Taken from the correct aim and shared by every Aim View of the Shot,
   * so the camera's tilt never differs between Choices or hints at the answer.
   */
  private cueElevation(): number {
    const s = this.shot!;
    const { cueR } = s.table.format;
    const back = { x: -Math.cos(s.correct.aimDir), z: -Math.sin(s.correct.aimDir) };
    // Distance from the cue ball's centre, backwards along the cue, to a rectangle's edge.
    const exit = (hx: number, hz: number) => {
      const tx = back.x > 0 ? (hx - s.cue.x) / back.x : back.x < 0 ? (-hx - s.cue.x) / back.x : Infinity;
      const tz = back.z > 0 ? (hz - s.cue.z) / back.z : back.z < 0 ? (-hz - s.cue.z) / back.z : Infinity;
      return Math.min(tx, tz);
    };
    const { halfL, halfW } = s.table;
    let e = CUE_ELEVATION;
    for (const [t, height] of [
      [exit(halfL, halfW), CUSHION_H],
      // Each obstacle's nearest edge is where the cue is lowest over it.
      [exit(halfL + CUSHION_W, halfW + CUSHION_W), RAIL_H],
    ] as const) {
      if (t > 0.01) e = Math.max(e, Math.atan((height + CUE_CLEARANCE - cueR) / t));
    }
    return Math.min(e, MAX_CUE_ELEVATION);
  }

  /** Show or hide the ring on the called pocket (drills that aren't about a pocket hide it). */
  showPocketMarker(visible: boolean) {
    this.pocketMarker.visible = visible;
  }

  /**
   * Vertical FOV that keeps the pocket in frame for every Choice, up to a cap. It is shared by
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
    // Capped so the object ball stays readable; on steep cuts the pocket falls outside the frame, as in real peripheral vision.
    return Math.min(62, Math.max(44, (vFromH * 180) / Math.PI));
  }
}
