/**
 * Ice builds up in snow on the rails and deck (visible thickness), lowers friction,
 * and makes the boat top-heavy (more roll). Chip it off with the mallet: rhythmic taps,
 * crisp cracks, shards that tumble downhill, visible thinning — and a bigger shatter on the last tap.
 *
 * Visuals: the deck frost is one merged overlay mesh whose six zones read their ice level from a
 * uniform array: blotches of feathery crystals that glaze over when thick, see-through enough for
 * the planks to show, with a sharp sun highlight on the crystals, a cool sky sheen at grazing
 * angles and sparse glints on random facets. The rail ice is one merged mesh of chunky,
 * translucent strips plus icicles on the outboard side. Two draw calls in all, whatever the level.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config } from '../config';
import { clamp } from '../core/math';
import { ICE_ZONE_ROWS, HALF_BEAM, BULWARK_T, hullHalfWidth, railHeight, L, BOW_Z } from '../boat/layout';
import { ITEM_DEFS, type Item } from '../deck/items';
import { interactableId, type Verb } from '../deck/interact';
import { makeMallet } from '../art/items';
import type { Ctx } from '../game/ctx';
import { events } from '../core/events';
import { sfx } from '../audio';
import { seaLight } from '../sea/seaLook';

const _v = new THREE.Vector3();

export class IceSystem {
  readonly mallet: Item;
  private frost: THREE.Mesh;
  private railIce: THREE.Mesh;
  /** per-zone ice level shared by the frost and rail-ice shaders */
  private iceLevels = { value: [0, 0, 0, 0, 0, 0] };
  private lastTap = -10;
  private rng;
  /** per-zone stand spot for chipping */
  readonly spots: THREE.Vector3[] = [];

  constructor(private ctx: Ctx) {
    ctx.sys.ice = this;
    this.rng = ctx.rng.stream('ice');
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1);
    this.mallet = ctx.items.add(ITEM_DEFS.mallet, makeMallet(), L.malletHook.clone(), { fixed: true, quat: q });
    this.mallet.data.label = 'ice mallet';
    this.mallet.home = { p: L.malletHook.clone(), q, afterSec: 25 };
    const frostGeos: THREE.BufferGeometry[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    let vis = 7; // cosmetic jitter only (does not touch the sim's rng streams)
    const jit = () => ((vis = (vis * 16807) % 2147483647) / 2147483647);
    ICE_ZONE_ROWS.forEach(([z0, z1], row) => {
      for (const side of [1, -1]) {
        const zi = row * 2 + (side > 0 ? 0 : 1);
        // deck frost: a flat patch on this side of the zone
        const zz1 = Math.min(z1, BOW_Z - 1.5);
        const w = HALF_BEAM - BULWARK_T - 0.1;
        frostGeos.push(frostPatch((side * w) / 2, (z0 + zz1) / 2, w, zz1 - z0, zi));
        // chunky ice along the rail top, icicles hanging off the outboard side
        const n = Math.max(1, Math.round((zz1 - z0) / 1.2));
        for (let k = 0; k < n; k++) {
          const za = z0 + ((zz1 - z0) * k) / n,
            zb = z0 + ((zz1 - z0) * (k + 1)) / n;
          const zc = (za + zb) / 2;
          railGeos.push(railStrip(side * (hullHalfWidth(zc) - BULWARK_T / 2), railHeight(zc) + 0.06, zc, zb - za, zi));
          for (let j = 0; j < 3; j++) {
            const zj = za + (zb - za) * (0.2 + 0.3 * j + (jit() - 0.5) * 0.15);
            railGeos.push(icicle(side * (hullHalfWidth(zj) + 0.02), railHeight(zj) + 0.04, zj, 0.03 + jit() * 0.03, 0.6 + jit() * 0.5, zi));
          }
        }
        // standing spot to chip this zone
        const zs = clamp((z0 + zz1) / 2, -4.0, 6.5);
        const spot = new THREE.Vector3(side * (hullHalfWidth(zs) - 0.85), 0, zs);
        if (row === 1) spot.z = side > 0 ? -1.4 : -1.1;
        this.spots[zi] = spot;
        // interactable: chip the ice here (with the mallet in hand)
        const chip: Verb = { id: 'chip', icon: '🔨', label: 'Chip the ice (tap!)', button: 'use', start: () => this.chip(zi) };
        ctx.interact.add({
          id: interactableId(),
          name: 'ice:' + zi,
          radius: 1.6,
          pos: (out) => out.copy(spot).setY(0.4),
          verbs: (_id, held) => (held === 'mallet' && this.level(zi) > 0.04 ? [chip] : null),
        });
      }
    });
    this.frost = new THREE.Mesh(mergeGeometries(frostGeos, false)!, frostMaterial(this.iceLevels));
    this.frost.renderOrder = 3;
    this.frost.receiveShadow = true;
    this.frost.visible = false;
    ctx.boatGroup.add(this.frost);
    this.railIce = new THREE.Mesh(mergeGeometries(railGeos, false)!, railIceMaterial(this.iceLevels));
    this.railIce.receiveShadow = true;
    this.railIce.visible = false;
    ctx.boatGroup.add(this.railIce);
  }

  level(zone: number): number {
    return this.ctx.surface.ice[zone];
  }

  worstZone(): { zone: number; level: number; spot: THREE.Vector3 } {
    let best = 0;
    const ice = this.ctx.surface.ice;
    for (let i = 1; i < ice.length; i++) if (ice[i] > ice[best]) best = i;
    return { zone: best, level: ice[best], spot: this.spots[best] };
  }

  chip(zone: number): void {
    const t = this.ctx.time;
    if (t - this.lastTap < config.ice.chipCooldown) return;
    this.lastTap = t;
    const ice = this.ctx.surface.ice;
    const before = ice[zone];
    ice[zone] = Math.max(0, before - config.ice.chipPerTap);
    const last = before > 0 && ice[zone] <= 0.001;
    const p = _v.copy(this.spots[zone]);
    p.x += Math.sign(p.x) * 0.55;
    p.y = 0.5;
    const spray = this.ctx.sys.spray;
    spray?.shardBurst(p, last ? 26 : 9, last);
    sfx.play('chip', { volume: 0.8, pitch: 0.9 + this.rng.range(0, 0.25) });
    sfx.play(last ? 'shatter' : 'crack', { volume: last ? 0.9 : 0.6, pitch: 0.9 + this.rng.range(0, 0.3), delay: 0.02 });
    events.emit('iceChipped', { zone, last });
    if (last) this.ctx.sys.hud?.pop('Clear!', p.clone().setY(1.2), 'good', 1.0);
  }

  step(dt: number): void {
    const w = this.ctx.sys.weather;
    if (!w) return;
    const heater = this.ctx.upgrades.has('heaterLines') ? config.weather.heaterIceScale : 1;
    const ice = this.ctx.surface.ice;
    const rate = w.cur.iceRate * heater * (0.4 + w.snow);
    for (let i = 0; i < ice.length; i++) {
      // the fore walkways (row 2) ice a little less: the house shelters them
      const shelter = i >= 4 ? 0.6 : 1;
      ice[i] = Math.min(1, ice[i] + rate * shelter * dt * (0.8 + 0.4 * ((i * 37) % 5) / 5));
    }
    // top-heavy: more roll
    this.ctx.boat.rollScale = 1 + config.boat.iceRollGain * this.ctx.surface.totalIce();
    this.ctx.surface.railIce[0] = (ice[0] + ice[2] + ice[4]) / 3;
    this.ctx.surface.railIce[1] = (ice[1] + ice[3] + ice[5]) / 3;
  }

  render(): void {
    const ice = this.ctx.surface.ice;
    const lv = this.iceLevels.value;
    let any = 0;
    for (let i = 0; i < lv.length; i++) {
      lv[i] = ice[i] ?? 0;
      any = Math.max(any, lv[i]);
    }
    this.frost.visible = any > 0.01;
    this.railIce.visible = any > 0.03;
  }
}

// ---------------------------------------------------------------------------------------------
// visuals

/** Frost texture: RGB = feathery crystals, A = blotchy coverage noise. Tileable, generated once. */
let frostTex: THREE.DataTexture | null = null;
function frostTexture(): THREE.DataTexture {
  if (frostTex) return frostTex;
  const N = 256;
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  // crystals: feathers (a spine with short side barbs), drawn at every wrap offset so it tiles
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  g.lineCap = 'round';
  for (let f = 0; f < 60; f++) {
    const x0 = rnd() * N,
      y0 = rnd() * N,
      ang = rnd() * Math.PI * 2,
      len = 14 + rnd() * 30,
      alpha = 0.45 + rnd() * 0.5,
      lw = 1.8 + rnd() * 1.2;
    for (const dx of [0, -N, N])
      for (const dy of [0, -N, N]) {
        g.strokeStyle = `rgba(255,255,255,${alpha})`;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(x0 + dx, y0 + dy);
        g.lineTo(x0 + dx + Math.cos(ang) * len, y0 + dy + Math.sin(ang) * len);
        g.stroke();
        g.lineWidth = 1.1;
        for (let b = 0.15; b < 0.95; b += 0.14) {
          const bx = x0 + dx + Math.cos(ang) * len * b,
            by = y0 + dy + Math.sin(ang) * len * b;
          const bl = len * 0.22 * (1 - b * 0.6);
          for (const sgn of [1, -1]) {
            const a2 = ang + sgn * 1.0;
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(bx + Math.cos(a2) * bl, by + Math.sin(a2) * bl);
            g.stroke();
          }
        }
      }
  }
  // sparkle specks
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.6})`;
    g.fillRect(rnd() * N, rnd() * N, 2, 2);
  }
  const img = g.getImageData(0, 0, N, N).data;
  // coverage: tileable value noise, 3 octaves
  const lattice = (period: number) => {
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    const at = (i: number, j: number) => v[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    return (x: number, y: number) => {
      const xi = Math.floor(x),
        yi = Math.floor(y);
      const fx = x - xi,
        fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx),
        uy = fy * fy * (3 - 2 * fy);
      return (at(xi, yi) * (1 - ux) + at(xi + 1, yi) * ux) * (1 - uy) + (at(xi, yi + 1) * (1 - ux) + at(xi + 1, yi + 1) * ux) * uy;
    };
  };
  const o1 = lattice(4),
    o2 = lattice(8),
    o3 = lattice(16);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const u = x / N,
        v = y / N;
      const cov = o1(u * 4, v * 4) * 0.55 + o2(u * 8, v * 8) * 0.3 + o3(u * 16, v * 16) * 0.15;
      data[i] = data[i + 1] = data[i + 2] = img[i];
      data[i + 3] = Math.round(THREE.MathUtils.clamp(cov, 0, 1) * 255);
    }
  frostTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  frostTex.wrapS = frostTex.wrapT = THREE.RepeatWrapping;
  frostTex.magFilter = THREE.LinearFilter;
  frostTex.minFilter = THREE.LinearMipmapLinearFilter;
  frostTex.generateMipmaps = true;
  frostTex.colorSpace = THREE.NoColorSpace;
  frostTex.needsUpdate = true;
  return frostTex;
}

/** aIce per vertex: zone, base y, centre x, kind (0 strip / frost, 1 icicle). */
function tagIce(geo: THREE.BufferGeometry, zone: number, baseY: number, cx: number, kind: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set([zone, baseY, cx, kind], i * 4);
  g.setAttribute('aIce', new THREE.BufferAttribute(a, 4));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/** Metres of deck one tile of the frost texture covers (crystals a few cm wide, feathers ~15–45 cm). */
const FROST_TILE = 3.0;

/** A flat frost patch (boat-local) with UVs in metres / FROST_TILE. */
function frostPatch(cx: number, cz: number, w: number, d: number, zone: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, d, 1, 1).rotateX(-Math.PI / 2).translate(cx, 0.015, cz);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / FROST_TILE, pos.getZ(i) / FROST_TILE);
  return tagIce(geo, zone, 0, cx, 0);
}

/** Rail ice strip of unit height around `y` (scaled by the zone's level in the shader). */
function railStrip(x: number, y: number, z: number, len: number, zone: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.26, 1, len * 0.96, 1, 1, 2);
  // a lumpy top: lift the middle row a little
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0 && Math.abs(pos.getZ(i)) < 0.01) pos.setY(i, 0.62);
  geo.computeVertexNormals();
  geo.translate(x, y, z);
  return tagIce(geo, zone, y, x, 0);
}

/** An icicle hanging from (x, y, z), `len` × the unit length (grown by the zone's level). */
function icicle(x: number, y: number, z: number, r: number, len: number, zone: number): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(r, len, 5, 1).rotateX(Math.PI).translate(x, y - len / 2, z);
  return tagIce(geo, zone, y, x, 1);
}

const ICE_VERT_PARS = /* glsl */ `#include <common>
attribute vec4 aIce;
uniform float uIce[6];
varying float vIceLv;`;

/** Shared light for the ice shaders (live references into seaLight, refreshed by the sea's applyLook). */
const iceLight = () => ({ uSunDir: { value: seaLight.sunDir }, uSun: { value: seaLight.sun }, uAmb: { value: seaLight.ambient } });

const ICE_FRAG_PARS = /* glsl */ `#include <common>
varying float vIceLv;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uAmb;
float iceHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// GGX normal distribution
float iceD(float a, float ndh) {
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}`;

function frostMaterial(levels: { value: number[] }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xeaf6ff,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  m.map = frostTexture();
  // the crystals are raised: their edges tilt the normal, so they catch the light
  m.bumpMap = m.map;
  m.bumpScale = 3.0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIce = levels;
    Object.assign(sh.uniforms, iceLight());
    sh.vertexShader = sh.vertexShader.replace('#include <common>', ICE_VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIceLv = uIce[int(aIce.x + 0.5)];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', ICE_FRAG_PARS)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `vec4 frostT = texture2D(map, vMapUv);
        float lv = vIceLv;
        // frost creeps in as blotches (crystals first), then glazes over when thick
        float th = 1.0 - lv * 1.2;
        float cov = smoothstep(th, th + 0.1, frostT.a * 0.85 + frostT.r * 0.2);
        float glaze = smoothstep(0.45, 0.95, lv);
        float cryst = frostT.r;
        diffuseColor.rgb *= mix(vec3(0.72, 0.85, 0.95), vec3(1.0), clamp(cryst * 1.4 + glaze * 0.15, 0.0, 1.0));
        // see-through: the planks show under thin frost (<= 0.58); crystals read whiter
        diffuseColor.a = cov * clamp(0.18 + 0.45 * cryst + 0.06 * glaze, 0.0, 0.58);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(0.32, 0.12, glaze) + cryst * 0.1;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
          // glossy frost: a sharp sun highlight on the (bumped) crystals, a cool sky sheen toward
          // grazing angles, and sparse glints where a random facet mirrors the sun
          vec3 Nv = normal;
          vec3 Vv = normalize(vViewPosition);
          vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          vec3 Hv = normalize(Lv + Vv);
          float ndv = clamp(dot(Nv, Vv), 0.0, 1.0);
          float ndl = clamp(dot(Nv, Lv), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(Vv, Hv), 0.0, 1.0), 5.0);
          float spec = iceD(mix(0.18, 0.12, glaze), clamp(dot(Nv, Hv), 0.0, 1.0)) * fres * ndl / max(4.0 * ndl * ndv, 0.05);
          spec = min(spec, 3.0) * cov;
          float lum = dot(uSun, vec3(0.3333));
          vec3 sunTint = uSun / max(lum, 1e-3);
          outgoingLight += mix(sunTint, vec3(1.0), 0.6) * spec * lum * 0.35;
          // a broad glossy sheen across the patch toward the sun (the smooth surface under the
          // crystals), strongest once it glazes over
          float sheen = iceD(0.4, clamp(dot(nonPerturbedNormal, Hv), 0.0, 1.0)) * (0.3 + 0.5 * glaze) * cov;
          outgoingLight += mix(sunTint, vec3(1.0), 0.7) * sheen * lum * 0.4;
          // cool sky sheen
          float rim = smoothstep(0.0, 0.55, 1.0 - ndv) * cov * (0.6 + 0.4 * glaze);
          float lightLv = dot(uAmb, vec3(0.3333)) * 0.7 + lum * 0.12;
          outgoingLight = mix(outgoingLight, vec3(0.874, 0.953, 1.0) * lightLv, 0.4 * rim);
          // glints: ~3 % of 5 cm cells get a random facet; it flashes when that facet mirrors the sun
          vec2 cell = floor(vMapUv * 60.0);
          float h = iceHash(cell);
          float glint = 0.0;
          if (h > 0.97) {
            vec3 jit = vec3(iceHash(cell + 3.1), iceHash(cell + 7.7), iceHash(cell + 1.3)) - 0.5;
            vec3 Nf = normalize(Nv + jit * 1.2);
            float fs = iceD(0.12, clamp(dot(Nf, Hv), 0.0, 1.0)) * 0.08;
            vec2 f = fract(vMapUv * 60.0) - 0.5;
            glint = step(0.5, fs) * (1.0 - smoothstep(0.15, 0.45, length(f))) * cov;
          }
          outgoingLight += mix(sunTint, vec3(1.0), 0.5) * glint * (1.0 + lum) * 1.5;
          diffuseColor.a = clamp(max(diffuseColor.a, max(spec * 0.5, glint)) + 0.18 * rim + sheen * 0.15, 0.0, 1.0);
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'ice-frost-2';
  return m;
}

function railIceMaterial(levels: { value: number[] }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xcfe6f4, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.82, emissive: 0x9fc8e0, emissiveIntensity: 0.06 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIce = levels;
    sh.uniforms.uMaxT = { value: config.ice.maxThickness * 2.5 };
    Object.assign(sh.uniforms, iceLight());
    sh.vertexShader = sh.vertexShader.replace('#include <common>', ICE_VERT_PARS + '\nuniform float uMaxT;').replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      float lv = uIce[int(aIce.x + 0.5)];
      vIceLv = lv;
      float on = step(0.03, lv);
      if (aIce.w < 0.5) {
        // strip: grows thicker and a little wider with the level
        transformed.y = aIce.y + (transformed.y - aIce.y) * max(0.001, lv * uMaxT);
        transformed.x = aIce.z + (transformed.x - aIce.z) * (1.0 + lv * 0.3);
      } else {
        // icicle: appears once the rail is well iced, lengthens with it
        transformed.y = aIce.y + (transformed.y - aIce.y) * smoothstep(0.3, 1.0, lv) * 0.45;
      }
      transformed = mix(vec3(aIce.z, aIce.y, transformed.z), transformed, on);`,
    );
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', ICE_FRAG_PARS).replace(
      '#include <opaque_fragment>',
      /* glsl */ `{
        // translucent ice: clear where you look straight in, milky and bright at the silhouette,
        // with a sharp sun highlight
        vec3 Vv = normalize(vViewPosition);
        vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        vec3 Hv = normalize(Lv + Vv);
        float ndv = clamp(dot(normal, Vv), 0.0, 1.0);
        float ndl = clamp(dot(normal, Lv), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 2.0);
        float lum = dot(uSun, vec3(0.3333));
        float spec = min(iceD(0.14, clamp(dot(normal, Hv), 0.0, 1.0)) * 0.06 * ndl, 2.5);
        outgoingLight = mix(outgoingLight, vec3(0.874, 0.953, 1.0) * (dot(uAmb, vec3(0.3333)) * 0.8 + lum * 0.15), 0.45 * rim);
        outgoingLight += uSun / max(lum, 1e-3) * spec * lum * 0.3;
        diffuseColor.a = clamp(0.5 + 0.45 * rim + spec * 0.3, 0.0, 0.95);
      }
      #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => 'ice-rail-2';
  return m;
}
