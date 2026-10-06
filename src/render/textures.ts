/**
 * Small canvas-generated textures for scenery (no image files).
 */
import * as THREE from 'three';

let ripple: THREE.Texture | null = null;

/**
 * A tiling normal map of soft wind ripples (sum of integer-frequency waves, so it wraps), for
 * still water in the harbor. Linear (no colour space).
 */
export function rippleNormalTex(size = 256): THREE.Texture {
  if (ripple) return ripple;
  const n = size;
  const hgt = new Float32Array(n * n);
  const waves: [number, number, number, number][] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const fx = Math.round((rnd() - 0.5) * 18) || 1;
    const fy = Math.round((rnd() - 0.5) * 10);
    waves.push([fx, fy, rnd() * Math.PI * 2, 1 / Math.hypot(fx, fy)]);
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let h = 0;
      for (const [fx, fy, ph, a] of waves) h += Math.sin(((fx * x + fy * y) / n) * Math.PI * 2 + ph) * a;
      hgt[y * n + x] = h;
    }
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(n, n);
  const k = 2.2;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = hgt[y * n + ((x + 1) % n)] - hgt[y * n + ((x + n - 1) % n)];
      const dy = hgt[((y + 1) % n) * n + x] - hgt[((y + n - 1) % n) * n + x];
      const v = new THREE.Vector3(-dx * k, -dy * k, 1).normalize();
      const o = (y * n + x) * 4;
      img.data[o] = (v.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (v.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (v.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  ripple = t;
  return t;
}

/** A vertical gradient (top → bottom colour stops) for painted backdrops like a window at dusk. */
export function gradientTex(stops: [number, string][], w = 8, h = 128): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) grd.addColorStop(o, c);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let snowN: THREE.Texture | null = null;

/**
 * A tiling normal map of soft wind-packed snow: lumpy drifts plus fine sastrugi streaks, so
 * bright snow reads as a surface under low sun instead of flat white. Linear (no colour space).
 */
export function snowNormalTex(size = 128): THREE.Texture {
  if (snowN) return snowN;
  const n = size;
  // value noise on a wrapped lattice, a few octaves
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // cx × cy lattice cells across the tile (integers, so it wraps)
  const octave = (cx: number, cy: number) => {
    const g = Array.from({ length: cx * cy }, rnd);
    return (x: number, y: number) => {
      const fx = (x / n) * cx,
        fy = (y / n) * cy;
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy);
      const tx = fx - x0,
        ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx),
        sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[(((j % cy) + cy) % cy) * cx + (((i % cx) + cx) % cx)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const o1 = octave(4, 4),
    o2 = octave(8, 8),
    o3 = octave(16, 16),
    streaks = octave(8, 32); // fine sastrugi, stretched along x
  const hgt = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) hgt[y * n + x] = o1(x, y) * 1.0 + o2(x, y) * 0.5 + o3(x, y) * 0.25 + streaks(x, y) * 0.15;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(n, n);
  const k = 5.0;
  const v = new THREE.Vector3();
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = hgt[y * n + ((x + 1) % n)] - hgt[y * n + ((x + n - 1) % n)];
      const dy = hgt[((y + 1) % n) * n + x] - hgt[((y + n - 1) % n) * n + x];
      v.set(-dx * k, -dy * k, 1).normalize();
      const o = (y * n + x) * 4;
      img.data[o] = (v.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (v.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (v.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  snowN = t;
  return t;
}
