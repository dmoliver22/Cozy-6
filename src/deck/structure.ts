/**
 * Static deck structure colliders built from boat/layout.ts.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import { HOUSE, L, STERN_Z, BOW_Z, hullHalfWidth, railHeight, BULWARK_T, ICE_ZONE_ROWS } from '../boat/layout';
import { CG } from './groups';
import type { DeckWorld } from './deckWorld';

export interface DeckStructure {
  zoneColliders: RAPIER.Collider[]; // 6 deck friction zones
  railColliders: RAPIER.Collider[];
  cradleBody: RAPIER.RigidBody; // kinematic, tilts for launch / tip
  cradleCollider: RAPIER.Collider;
  interiorFloor: RAPIER.Collider;
}

export function buildDeckStructure(dw: DeckWorld): DeckStructure {
  const world = dw.world;
  const ground = dw.ground;
  const fr = config.deck.friction.wet;
  const mk = (desc: RAPIER.ColliderDesc, kind: string, friction = 0.6) => {
    desc.setCollisionGroups(CG.static).setFriction(friction).setRestitution(0.05);
    const c = world.createCollider(desc, ground);
    dw.setOwner(c, { kind });
    return c;
  };
  const boxAt = (hx: number, hy: number, hz: number, x: number, y: number, z: number, kind: string, rot?: THREE.Quaternion, friction = 0.6) => {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
    if (rot) d.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    return mk(d, kind, friction);
  };

  // --- deck plate in 6 friction zones (convex pieces of the hull plan)
  const zoneColliders: RAPIER.Collider[] = [];
  ICE_ZONE_ROWS.forEach(([z0, z1], row) => {
    for (const side of [1, -1]) {
      const pts: number[] = [];
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const z = z0 + ((z1 - z0) * i) / n;
        const hw = Math.max(0.05, hullHalfWidth(Math.min(z, BOW_Z - 0.01)));
        for (const y of [0, -0.5]) {
          pts.push(0, y, z);
          pts.push(side * hw, y, z);
        }
      }
      const d = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (!d) continue;
      const c = mk(d, 'deck', fr);
      zoneColliders[row * 2 + (side > 0 ? 0 : 1)] = c;
    }
  });

  // --- bulwarks along both sides (segments following the plan), transom
  const railColliders: RAPIER.Collider[] = [];
  const segs = 24;
  const q = new THREE.Quaternion();
  for (const side of [1, -1]) {
    for (let i = 0; i < segs; i++) {
      const za = STERN_Z + ((BOW_Z - STERN_Z) * i) / segs;
      const zb = STERN_Z + ((BOW_Z - STERN_Z) * (i + 1)) / segs;
      const xa = side * (hullHalfWidth(za) - BULWARK_T / 2);
      const xb = side * (hullHalfWidth(zb) - BULWARK_T / 2);
      const h = Math.max(railHeight(za), railHeight(zb)) + 0.06;
      const len = Math.hypot(xb - xa, zb - za);
      if (len < 0.02) continue;
      const ang = Math.atan2(xb - xa, zb - za);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      // thicker collider outward so fast bodies don't tunnel
      const out = 0.12;
      const cx = (xa + xb) / 2 + side * out * Math.cos(ang) * 0.5;
      const c = boxAt(BULWARK_T / 2 + out / 2, (h + 0.5) / 2, len / 2 + 0.05, cx, (h - 0.5) / 2, (za + zb) / 2, 'rail', q, 0.5);
      railColliders.push(c);
    }
  }
  const sternHw = hullHalfWidth(STERN_Z);
  railColliders.push(boxAt(sternHw, 0.78, 0.15, 0, 0.28, STERN_Z + 0.02, 'rail'));

  // --- wheelhouse walls with an aft door, roof
  const H = HOUSE;
  const hw = H.wallT / 2;
  const wh = H.wallH / 2;
  boxAt((H.x1 - H.x0) / 2, wh, hw, (H.x0 + H.x1) / 2, wh, H.z1 - hw, 'house');
  boxAt(hw, wh, (H.z1 - H.z0) / 2, H.x0 + hw, wh, (H.z0 + H.z1) / 2, 'house');
  boxAt(hw, wh, (H.z1 - H.z0) / 2, H.x1 - hw, wh, (H.z0 + H.z1) / 2, 'house');
  const sideW = (-H.doorHalf - H.x0) / 2;
  boxAt(sideW, wh, hw, H.x0 + sideW, wh, H.z0 + hw, 'house');
  boxAt(sideW, wh, hw, H.x1 - sideW, wh, H.z0 + hw, 'house');
  boxAt(H.doorHalf, (H.wallH - H.doorH) / 2, hw, 0, H.doorH + (H.wallH - H.doorH) / 2, H.z0 + hw, 'house');
  boxAt((H.x1 - H.x0) / 2 + 0.2, 0.07, (H.z1 - H.z0) / 2 + 0.25, 0, H.roofY, (H.z0 + H.z1) / 2 + 0.1, 'roof');
  const interiorFloor = boxAt((H.x1 - H.x0) / 2, 0.05, (H.z1 - H.z0) / 2, 0, -0.05, (H.z0 + H.z1) / 2, 'interior', undefined, 0.8);

  // interior furniture
  const st = L.stove;
  boxAt(st.half.x, st.half.y, st.half.z, st.center.x, st.half.y, st.center.z, 'stove');
  const gt = L.galleyTable;
  boxAt(gt.half.x, gt.half.y, gt.half.z, gt.center.x, gt.half.y, gt.center.z, 'galleyTable');
  boxAt(0.2, 0.21, 0.65, gt.center.x - 0.42, 0.21, gt.center.z, 'bench');
  boxAt(0.95, 0.5, 0.22, 0, 0.5, 7.33, 'helm');

  // --- working gear
  const t = L.table;
  boxAt(t.half.x, t.center.y / 2, t.half.z, t.center.x, t.center.y / 2, t.center.z, 'table', undefined, 0.45);
  boxAt(0.03, 0.06, t.half.z, t.center.x + t.half.x, t.center.y + 0.06, t.center.z, 'tableLip');
  boxAt(t.half.x, 0.06, 0.03, t.center.x, t.center.y + 0.06, t.center.z - t.half.z, 'tableLip');
  boxAt(t.half.x, 0.06, 0.03, t.center.x, t.center.y + 0.06, t.center.z + t.half.z, 'tableLip');
  // solid launcher base under the cradle
  const c = L.cradle;
  boxAt(c.half.x - 0.05, (c.center.y - 0.1) / 2, c.half.z - 0.05, c.center.x, (c.center.y - 0.1) / 2, c.center.z, 'launcherBase');
  // hatch coaming
  const h = L.hatch;
  boxAt(h.half + 0.1, h.coaming / 2, 0.05, h.center.x, h.coaming / 2, h.center.z - h.half - 0.05, 'coaming');
  boxAt(h.half + 0.1, h.coaming / 2, 0.05, h.center.x, h.coaming / 2, h.center.z + h.half + 0.05, 'coaming');
  boxAt(0.05, h.coaming / 2, h.half, h.center.x - h.half - 0.05, h.coaming / 2, h.center.z, 'coaming');
  boxAt(0.05, h.coaming / 2, h.half, h.center.x + h.half + 0.05, h.coaming / 2, h.center.z, 'coaming');
  // curiosity crate walls
  const cr = L.crate;
  boxAt(cr.half.x, cr.half.y, 0.03, cr.center.x, cr.half.y, cr.center.z - cr.half.z, 'crate');
  boxAt(cr.half.x, cr.half.y, 0.03, cr.center.x, cr.half.y, cr.center.z + cr.half.z, 'crate');
  boxAt(0.03, cr.half.y, cr.half.z, cr.center.x - cr.half.x, cr.half.y, cr.center.z, 'crate');
  boxAt(0.03, cr.half.y, cr.half.z, cr.center.x + cr.half.x, cr.half.y, cr.center.z, 'crate');
  const bb = L.baitBox;
  boxAt(bb.half.x, bb.half.y, bb.half.z, bb.center.x, bb.half.y, bb.center.z, 'baitBox');
  const eh = L.engineHatch;
  boxAt(eh.half, 0.06, eh.half, eh.center.x, 0.06, eh.center.z, 'engineHatch', undefined, 0.6);
  // davit post, mast, lever bases
  mk(RAPIER.ColliderDesc.cylinder(L.davitTop.y / 2, 0.15).setTranslation(L.davitBase.x, L.davitTop.y / 2, L.davitBase.z), 'davit');
  boxAt(0.15, 0.18, 0.15, L.launcherLever.x, 0.18, L.launcherLever.z, 'leverBase');
  boxAt(0.25, 0.35, 0.3, L.davitBase.x + 0.3, 0.35, L.davitBase.z - 0.25, 'hauler');

  // --- cradle: kinematic so it can tilt for launching / tipping
  const cradleBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.center.x, c.center.y, c.center.z));
  const cd = RAPIER.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z).setCollisionGroups(CG.static).setFriction(0.5);
  const cradleCollider = world.createCollider(cd, cradleBody);
  dw.setOwner(cradleCollider, { kind: 'cradle' });
  // outboard stop on the cradle
  const stop = RAPIER.ColliderDesc.cuboid(0.06, 0.12, c.half.z).setTranslation(-c.half.x - 0.02, 0.1, 0).setCollisionGroups(CG.static);
  dw.setOwner(world.createCollider(stop, cradleBody), { kind: 'cradle' });

  return { zoneColliders, railColliders, cradleBody, cradleCollider, interiorFloor };
}
