import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { describe, expect, it } from 'vitest';
import { freshKey, shotFromKey } from './links';
import { buildAimOverlay } from './overlay';

const all = { ghost: true, contact: true, lines: true, closeUp: false };

/** Ball meshes (not lines, which are meshes too) in the overlay whose material has this colour. */
const meshesOf = (g: THREE.Group, hex: string) =>
  g.children.filter(
    (o): o is THREE.Mesh =>
      o instanceof THREE.Mesh &&
      !(o instanceof Line2) &&
      (o.material as THREE.MeshBasicMaterial).color.getHexString() === hex,
  );

describe('Aim Overlay geometry', () => {
  it('puts ghost balls and contact points exactly where the balls meet', () => {
    for (const format of ['us9', 'uk'] as const) {
      for (let i = 0; i < 50; i++) {
        const shot = shotFromKey(freshKey(format, 'medium'));
        const { objectR, cueR } = shot.table.format;
        const wrong = shot.choices.find((c) => c !== shot.correct)!;
        const g = buildAimOverlay(shot, wrong, all, 2, new THREE.Vector3(shot.cue.x, 0.2, shot.cue.z));
        const ob = new THREE.Vector3(shot.object.x, objectR, shot.object.z);

        for (const [c, hex] of [
          [shot.correct, '4ade80'],
          [wrong, 'f87171'],
        ] as const) {
          const ghostCentre = new THREE.Vector3(c.ghost.x, cueR, c.ghost.z);
          const [fill, outline, dot] = meshesOf(g, hex);
          expect(fill.position.distanceTo(ghostCentre)).toBeLessThan(1e-9);
          expect(outline.position.distanceTo(ghostCentre)).toBeLessThan(1e-9);
          // The contact dot sits on the object ball's surface, on the line to the ghost centre.
          const toDot = dot.position.clone().sub(ob);
          expect(toDot.length()).toBeCloseTo(objectR * 1.01, 9);
          expect(toDot.normalize().dot(ghostCentre.clone().sub(ob).normalize())).toBeCloseTo(1, 9);
        }
      }
    }
  });

  it('draws only the correct aim on the correct Choice', () => {
    const shot = shotFromKey(freshKey('us9', 'medium'));
    const g = buildAimOverlay(shot, shot.correct, all, 2, new THREE.Vector3());
    expect(meshesOf(g, 'f87171')).toHaveLength(0);
    expect(meshesOf(g, '4ade80')).toHaveLength(3); // ghost fill, outline, contact point
  });
});
