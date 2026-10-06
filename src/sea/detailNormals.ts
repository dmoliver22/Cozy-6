/**
 * Baked detail ripples for the sea: one 256 px tiling slope map, built once in code.
 *
 * The sea shader samples it two or three times at different scales, rotations and drift
 * directions instead of evaluating procedural noise octaves per pixel. Texture lookups are
 * cheaper than noise on phones, and the mip chain averages the ripples flat with distance, so
 * the sun glitter stays stable instead of aliasing into speckle.
 *
 * Encoding: R, G = slope dh/du, dh/dv (0.5 = flat, scaled so the steepest texel spans the
 * range), B = height 0..1 (spare), A = 1.
 * The height field is a sum of sines with whole-number wave vectors (so it tiles exactly),
 * spread around the texture's +u axis (the drift / wind axis) with a capillary-like falloff.
 */
import * as THREE from 'three';

const N = 256;
let tex: THREE.DataTexture | null = null;

export function seaDetailTexture(): THREE.DataTexture {
  if (tex) return tex;
  let seed = 90127;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  // wave set: integer cycles per tile (m, n), amplitude, phase
  const waves: { m: number; n: number; a: number; p: number }[] = [];
  const used = new Set<string>();
  while (waves.length < 34) {
    const kLen = 3 + Math.pow(rnd(), 1.4) * 21; // 3 … 24 cycles per tile, more of the long ones
    const ang = (rnd() - 0.5) * 2.4 + (rnd() < 0.25 ? Math.PI / 2 : 0); // mostly along +u, some crossing
    const m = Math.round(Math.cos(ang) * kLen);
    const n = Math.round(Math.sin(ang) * kLen);
    if (m === 0 && n === 0) continue;
    const key = `${m},${n}`;
    if (used.has(key) || used.has(`${-m},${-n}`)) continue;
    used.add(key);
    const k = Math.hypot(m, n);
    waves.push({ m, n, a: Math.pow(k, -1.55) * (0.6 + rnd() * 0.8), p: rnd() * Math.PI * 2 });
  }
  const sx = new Float32Array(N * N);
  const sy = new Float32Array(N * N);
  const h = new Float32Array(N * N);
  // separable evaluation: sin(a + b) with per-row / per-column tables keeps this to a few ms
  const cosU = new Float32Array(N),
    sinU = new Float32Array(N),
    cosV = new Float32Array(N),
    sinV = new Float32Array(N);
  for (const w of waves) {
    for (let i = 0; i < N; i++) {
      const au = (2 * Math.PI * w.m * i) / N + w.p;
      const av = (2 * Math.PI * w.n * i) / N;
      cosU[i] = Math.cos(au);
      sinU[i] = Math.sin(au);
      cosV[i] = Math.cos(av);
      sinV[i] = Math.sin(av);
    }
    const gu = 2 * Math.PI * w.m * w.a,
      gv = 2 * Math.PI * w.n * w.a;
    for (let y = 0; y < N; y++) {
      const cv = cosV[y],
        sv = sinV[y],
        row = y * N;
      for (let x = 0; x < N; x++) {
        // sin(u + v) and cos(u + v)
        const s = sinU[x] * cv + cosU[x] * sv;
        const c = cosU[x] * cv - sinU[x] * sv;
        h[row + x] += w.a * s;
        sx[row + x] += gu * c;
        sy[row + x] += gv * c;
      }
    }
  }
  let smax = 1e-6,
    hmin = Infinity,
    hmax = -Infinity;
  for (let i = 0; i < N * N; i++) {
    smax = Math.max(smax, Math.abs(sx[i]), Math.abs(sy[i]));
    hmin = Math.min(hmin, h[i]);
    hmax = Math.max(hmax, h[i]);
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(127.5 + (sx[i] / smax) * 127.5);
    data[i * 4 + 1] = Math.round(127.5 + (sy[i] / smax) * 127.5);
    data[i * 4 + 2] = Math.round(((h[i] - hmin) / Math.max(1e-6, hmax - hmin)) * 255);
    data[i * 4 + 3] = 255;
  }
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 2;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
