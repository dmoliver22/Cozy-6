/**
 * A tiny occupancy grid + A* over the deck (boat-local XZ), so bots can walk around the
 * table, hatch, stack and into the wheelhouse through its door.
 */
import * as THREE from 'three';
import { HOUSE, L, STERN_Z, BOW_Z, hullHalfWidth, BULWARK_T } from '../boat/layout';

const CELL = 0.25;
const X0 = -3.4,
  X1 = 3.4;
const Z0 = STERN_Z,
  Z1 = BOW_Z;
const W = Math.ceil((X1 - X0) / CELL);
const H = Math.ceil((Z1 - Z0) / CELL);
const R = 0.32; // crew radius + a little

export class NavGrid {
  readonly blocked = new Uint8Array(W * H);
  readonly extra = new Uint8Array(W * H); // dynamic blocks (loose pots etc.)

  constructor() {
    const rects: [number, number, number, number][] = [];
    const box = (cx: number, cz: number, hx: number, hz: number) => rects.push([cx - hx, cz - hz, cx + hx, cz + hz]);
    // working gear
    const t = L.table;
    box(t.center.x, t.center.z, t.half.x, t.half.z);
    const c = L.cradle;
    box(c.center.x, c.center.z, c.half.x, c.half.z);
    box(L.baitBox.center.x, L.baitBox.center.z, L.baitBox.half.x, L.baitBox.half.z);
    box(L.hatch.center.x, L.hatch.center.z, L.hatch.half + 0.12, L.hatch.half + 0.12);
    box(L.crate.center.x, L.crate.center.z, L.crate.half.x, L.crate.half.z);
    box(L.davitBase.x, L.davitBase.z, 0.16, 0.16);
    box(L.davitBase.x + 0.3, L.davitBase.z - 0.25, 0.25, 0.3);
    box(L.launcherLever.x, L.launcherLever.z, 0.15, 0.15);
    // the pot stack (aft)
    rects.push([-3.4, STERN_Z, 3.4, -4.42]);
    // wheelhouse walls with the aft door
    const wt = 0.08;
    rects.push([HOUSE.x0 - wt, HOUSE.z1 - wt, HOUSE.x1 + wt, HOUSE.z1 + wt]); // front
    rects.push([HOUSE.x0 - wt, HOUSE.z0 - wt, HOUSE.x0 + wt, HOUSE.z1 + wt]); // stbd
    rects.push([HOUSE.x1 - wt, HOUSE.z0 - wt, HOUSE.x1 + wt, HOUSE.z1 + wt]); // port
    rects.push([HOUSE.x0 - wt, HOUSE.z0 - wt, -HOUSE.doorHalf, HOUSE.z0 + wt]);
    rects.push([HOUSE.doorHalf, HOUSE.z0 - wt, HOUSE.x1 + wt, HOUSE.z0 + wt]);
    // interior furniture
    box(L.stove.center.x, L.stove.center.z, L.stove.half.x, L.stove.half.z);
    box(L.galleyTable.center.x, L.galleyTable.center.z, L.galleyTable.half.x, L.galleyTable.half.z);
    box(L.galleyTable.center.x - 0.42, L.galleyTable.center.z, 0.2, 0.65);
    box(0, 7.33, 0.95, 0.22);
    for (let j = 0; j < H; j++) {
      const z = Z0 + (j + 0.5) * CELL;
      const hw = hullHalfWidth(Math.min(z, BOW_Z - 0.01)) - BULWARK_T - R;
      for (let i = 0; i < W; i++) {
        const x = X0 + (i + 0.5) * CELL;
        let b = Math.abs(x) > hw || z < STERN_Z + 0.4;
        if (!b) {
          for (const [ax, az, bx, bz] of rects) {
            if (x > ax - R && x < bx + R && z > az - R && z < bz + R) {
              b = true;
              break;
            }
          }
        }
        this.blocked[j * W + i] = b ? 1 : 0;
      }
    }
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x - X0) / CELL);
    const j = Math.floor((z - Z0) / CELL);
    if (i < 0 || j < 0 || i >= W || j >= H) return -1;
    return j * W + i;
  }
  private center(k: number, out: THREE.Vector3): THREE.Vector3 {
    const i = k % W,
      j = Math.floor(k / W);
    return out.set(X0 + (i + 0.5) * CELL, 0, Z0 + (j + 0.5) * CELL);
  }
  isFree(x: number, z: number): boolean {
    const k = this.idx(x, z);
    return k >= 0 && !this.blocked[k] && !this.extra[k];
  }

  /** Nearest free cell to a point (for targets inside furniture, e.g. "stand at the table"). */
  nearestFree(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const k0 = this.idx(p.x, p.z);
    if (k0 >= 0 && !this.blocked[k0] && !this.extra[k0]) return out.copy(p).setY(0);
    let best = -1,
      bd = Infinity;
    const c = new THREE.Vector3();
    for (let k = 0; k < W * H; k++) {
      if (this.blocked[k] || this.extra[k]) continue;
      this.center(k, c);
      const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best >= 0 ? this.center(best, out) : out.copy(p);
  }

  /** Straight-line walkability on the grid. */
  lineFree(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (!this.isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /** A* path from a to b (local XZ), smoothed. Returns waypoints (excluding start). */
  path(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const goal = this.nearestFree(b, new THREE.Vector3());
    const start = this.nearestFree(a, new THREE.Vector3());
    if (this.lineFree(a, goal)) return [goal];
    const s = this.idx(start.x, start.z),
      g = this.idx(goal.x, goal.z);
    if (s < 0 || g < 0) return [goal];
    const N = W * H;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open: number[] = [s];
    const fScore = new Float32Array(N).fill(Infinity);
    gScore[s] = 0;
    const gi = g % W,
      gj = Math.floor(g / W);
    const hfn = (k: number) => {
      const di = Math.abs((k % W) - gi),
        dj = Math.abs(Math.floor(k / W) - gj);
      return Math.max(di, dj) + 0.414 * Math.min(di, dj);
    };
    fScore[s] = hfn(s);
    let iter = 0;
    while (open.length && iter++ < 6000) {
      // pop the lowest f (small open sets: linear scan is fine)
      let bi = 0;
      for (let q = 1; q < open.length; q++) if (fScore[open[q]] < fScore[open[bi]]) bi = q;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === g) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % W,
        cj = Math.floor(cur / W);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di,
            nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nk = nj * W + ni;
          if (this.blocked[nk] || this.extra[nk] || closed[nk]) continue;
          if (di && dj && (this.blocked[cj * W + ni] || this.blocked[nj * W + ci])) continue; // no corner cutting
          const ng = gScore[cur] + (di && dj ? 1.414 : 1);
          if (ng < gScore[nk]) {
            gScore[nk] = ng;
            came[nk] = cur;
            fScore[nk] = ng + hfn(nk);
            open.push(nk);
          }
        }
    }
    if (came[g] < 0 && g !== s) return [goal];
    const cells: THREE.Vector3[] = [];
    for (let k = g; k !== s && k >= 0; k = came[k]) cells.push(this.center(k, new THREE.Vector3()));
    cells.reverse();
    // string-pulling
    const out: THREE.Vector3[] = [];
    let anchor = a.clone();
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineFree(anchor, cells[j])) j--;
      out.push(cells[j]);
      anchor = cells[j];
      i = j + 1;
    }
    out.push(goal);
    return out;
  }

  /** Mark dynamic obstacles (loose pots) — call each think tick. */
  setDynamic(rects: [number, number, number, number][]): void {
    this.extra.fill(0);
    for (const [ax, az, bx, bz] of rects) {
      for (let j = 0; j < H; j++) {
        const z = Z0 + (j + 0.5) * CELL;
        if (z < az - R || z > bz + R) continue;
        for (let i = 0; i < W; i++) {
          const x = X0 + (i + 0.5) * CELL;
          if (x > ax - R && x < bx + R) this.extra[j * W + i] = 1;
        }
      }
    }
  }
}
