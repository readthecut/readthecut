import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { dir, dist, type Candidate, type Shot } from './geometry';

/** Which Aim Overlay layers to draw, and whether to magnify the contact area. */
export interface OverlayLayers {
  ghost: boolean;
  contact: boolean;
  lines: boolean;
  closeUp: boolean;
}

const GOOD = '#4ade80';
const BAD = '#f87171';
const AIM = '#f7f5ee';
const GEOMETRIC = '#7dd3fc';

/** Drawing helpers for markings in table space, collected into one group. */
function markingKit(shot: Shot, lineWidthPx: number, eye: THREE.Vector3) {
  const group = new THREE.Group();
  const { objectR, cueR } = shot.table.format;
  const at = (p: { x: number; z: number }, y: number) => new THREE.Vector3(p.x, y, p.z);
  const obCentre = at(shot.object, objectR);
  const cueCentre = at(shot.cue, cueR);

  const line = (from: THREE.Vector3, to: THREE.Vector3, colour: string, dashed: boolean) => {
    const geo = new LineGeometry();
    geo.setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);
    const mat = new LineMaterial({
      color: colour,
      linewidth: lineWidthPx,
      dashed,
      dashSize: 0.025,
      gapSize: 0.015,
      transparent: true,
      opacity: 0.95,
    });
    const l = new Line2(geo, mat);
    l.computeLineDistances();
    group.add(l);
  };

  // A translucent cue ball at the moment of contact, outlined so two overlapping ghosts stay readable.
  const ghost = (c: Candidate, colour: string, fillOpacity = 0.22) => {
    const centre = at(c.ghost, cueR);
    const fill = new THREE.Mesh(
      new THREE.SphereGeometry(cueR, 48, 32),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: fillOpacity, depthWrite: false }),
    );
    fill.position.copy(centre);
    // Outline ring through the centre, turned to face the eye: that's the sphere's silhouette.
    const outline = new THREE.Mesh(
      new THREE.RingGeometry(cueR * 0.93, cueR, 64),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    outline.position.copy(centre);
    outline.lookAt(eye);
    fill.renderOrder = 2;
    outline.renderOrder = 3;
    group.add(fill, outline);
  };

  // The point on the object ball that the cue ball touches: on the line between the two centres.
  const contact = (c: Candidate, colour: string, size = 0.2) => {
    const towardGhost = at(c.ghost, cueR).sub(obCentre).normalize();
    // Transparent (though fully opaque) so it is drawn after the translucent ghost, not under it.
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(objectR * size, 24, 16),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true }),
    );
    dot.position.copy(obCentre).addScaledVector(towardGhost, objectR * 1.01);
    dot.renderOrder = 4;
    group.add(dot);
  };

  // The object ball's path: to the pocket, or a little past it when this aim misses.
  const obPath = (c: Candidate, colour: string) => {
    const u = dir(c.obDir);
    const d = dist(shot.object, shot.pocket.mouth) + (c.miss > 0 ? 0.15 : 0);
    line(obCentre, at({ x: shot.object.x + u.x * d, z: shot.object.z + u.z * d }, objectR), colour, false);
  };

  return { group, at, obCentre, cueCentre, cueR, line, ghost, contact, obPath };
}

/**
 * The Aim Overlay for one Aim View, built in table space from the same
 * geometry that decides the answer, so it sits exactly where the balls meet.
 * On a wrong Choice it shows both where this aim sends the cue ball (red) and
 * where it needed to go (green).
 */
export function buildAimOverlay(
  shot: Shot,
  view: Candidate,
  layers: OverlayLayers,
  lineWidthPx: number,
  eye: THREE.Vector3,
): THREE.Group {
  const { group, at, cueCentre, cueR, line, ghost, contact, obPath } = markingKit(shot, lineWidthPx, eye);
  const correct = shot.correct;
  const isCorrect = view === correct;

  const viewColour = isCorrect ? GOOD : BAD;
  if (layers.lines) {
    line(cueCentre, at(view.ghost, cueR), AIM, true); // this view's aim line, straight up the middle
    obPath(view, viewColour);
    if (!isCorrect) {
      line(cueCentre, at(correct.ghost, cueR), GOOD, true); // where the aim needed to go
      obPath(correct, GOOD);
    }
  }
  if (layers.ghost) {
    ghost(view, viewColour);
    if (!isCorrect) ghost(correct, GOOD);
    // With throw: where a pure ghost-ball aim would put the cue ball. The gap to green is the throw allowance.
    if (shot.geometric) ghost(shot.geometric, GEOMETRIC);
  }
  if (layers.contact) {
    contact(view, viewColour);
    if (!isCorrect) contact(correct, GOOD);
  }
  return group;
}

export function disposeOverlay(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof Line2) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}

/** Line materials measure width in pixels, so they need the target's size before each render. */
export function setOverlayResolution(group: THREE.Group, width: number, height: number) {
  group.traverse((o) => {
    if (o instanceof Line2) (o.material as LineMaterial).resolution.set(width, height);
  });
}

// The placed ghost ball is a see-through cue ball: white, so it never matches an object ball's colour.
export const PLACED = '#f7f5ee';

/**
 * Markings for the Ghost Ball Trainer: the viewer's placed ghost ball (yellow),
 * an optional aid, and after locking in, the correct ghost ball and both paths.
 */
export function buildPlacementMarkings(
  shot: Shot,
  placed: Candidate,
  opts: { contactAid: boolean; reveal: boolean; aimLine: boolean },
  lineWidthPx: number,
  eye: THREE.Vector3,
): THREE.Group {
  const { group, at, cueCentre, cueR, line, ghost, contact, obPath } = markingKit(shot, lineWidthPx, eye);
  if (opts.aimLine) line(cueCentre, at(placed.ghost, cueR), AIM, true);
  ghost(placed, PLACED, 0.3);
  // Larger than the reveal dots: this aid has to read from standing height.
  if (opts.contactAid && !opts.reveal) contact(shot.correct, GOOD, 0.4);
  if (opts.reveal) {
    obPath(placed, placed.miss > 0 ? BAD : GOOD);
    if (placed !== shot.correct) {
      ghost(shot.correct, GOOD);
      obPath(shot.correct, GOOD);
      contact(shot.correct, GOOD);
    }
    contact(placed, PLACED);
  }
  return group;
}
