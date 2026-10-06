/**
 * Small props: bucket, bait jar, mallet, life ring, grapple, buoys, line coil, specials, ice shards.
 * Each factory returns a Group centred on its physics body's centre. Glossy toy plastic, brass,
 * steel, rope and glass; every prop's static meshes are merged per material.
 */
import * as THREE from 'three';
import { config } from '../config';
import { plastic, metal, wood, rope, rubber, glow, basic, canvasTexture, mergeStatic } from './materials';

const P = config.palette;

// ---------------------------------------------------------------------------------------------
// helpers

type V3 = [number, number, number];
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: V3 = [0, 0, 0], s?: V3, r?: V3, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  if (s) m.scale.set(s[0], s[1], s[2]);
  if (r) m.rotation.set(r[0], r[1], r[2]);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
const matCache = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) matCache.set(key, (m = make()));
  return m;
}
const lathe = (pts: [number, number][], seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** A tube along points, optionally tapering toward the end. */
function tube(pts: V3[], r: number, taper = 1, seg = 16, radial = 6, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(...p)),
    closed,
  );
  const g = new THREE.TubeGeometry(curve, seg, r, radial, closed);
  if (taper !== 1) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const c = new THREE.Vector3(),
      v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const t = uv.getX(i);
      curve.getPointAt(t, c);
      v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 + (taper - 1) * t).add(c);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
  }
  return g;
}
/** Clear glass (no transmission pass: just a glossy see-through shell). */
function glassMat(tint: number, opacity = 0.32): THREE.MeshStandardMaterial {
  return mat(`glass${tint}_${opacity}`, () => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.04, metalness: 0.1, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
}
const done = (g: THREE.Group) => {
  mergeStatic(g);
  return g;
};

// ---------------------------------------------------------------------------------------------

export function makeBucket(): THREE.Group {
  const g = new THREE.Group();
  const blue = plastic(0x2f86c4, { rough: 0.28 });
  // moulded pail: outer wall with two ribs and a rolled rim, inner wall and floor (one lathe)
  const shell = geo('bucket', () =>
    lathe(
      [
        [0.0, -0.17],
        [0.152, -0.17],
        [0.158, -0.162],
        [0.166, -0.08],
        [0.173, -0.07],
        [0.17, -0.06],
        [0.183, 0.04],
        [0.19, 0.05],
        [0.187, 0.06],
        [0.198, 0.145],
        [0.212, 0.152],
        [0.214, 0.168],
        [0.2, 0.172],
        [0.188, 0.16],
        [0.148, -0.148],
        [0.0, -0.148],
      ],
      18,
    ),
  );
  put(g, shell, blue);
  // wire bail handle with a grip, on two moulded ears
  const steel = metal(0x9aa3a8, { rough: 0.35 });
  put(g, geo('bail', () => new THREE.TorusGeometry(0.205, 0.0075, 4, 18, Math.PI)), steel, [0, 0.155, 0], undefined, [0, 0, 0], false);
  put(g, geo('bailGrip', () => new THREE.CylinderGeometry(0.017, 0.017, 0.11, 8)), plastic(0x23262b, { rough: 0.5 }), [0, 0.36, 0], undefined, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) put(g, geo('bucketEar', () => new THREE.BoxGeometry(0.03, 0.05, 0.05)), blue, [s * 0.205, 0.145, 0]);
  return done(g);
}

function baitLabel(): THREE.Texture {
  return canvasTexture(256, 64, (c) => {
    c.fillStyle = '#f3e7c9';
    c.fillRect(0, 0, 256, 64);
    c.fillStyle = '#c8432f';
    c.fillRect(0, 0, 256, 7);
    c.fillRect(0, 57, 256, 7);
    // a little fish and the word, twice round the jar
    for (const x of [64, 192]) {
      c.fillStyle = '#2b4a6a';
      c.beginPath();
      c.ellipse(x - 40, 33, 12, 7, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(x - 30, 33);
      c.lineTo(x - 21, 26);
      c.lineTo(x - 21, 40);
      c.fill();
      c.font = 'bold 26px Georgia, serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('BAIT', x + 12, 34);
    }
  });
}

export function makeBaitJar(): THREE.Group {
  const g = new THREE.Group();
  // chunky bait in murky brine, seen through the glass
  const silver = plastic(0xb9c3c6, { rough: 0.25 });
  const pink = plastic(0xc9726a, { rough: 0.45 });
  const chunks: [V3, number, THREE.Material][] = [
    [[-0.03, -0.07, 0.02], 0.4, silver],
    [[0.035, -0.075, -0.01], 1.3, pink],
    [[0.0, -0.035, 0.035], 2.2, silver],
    [[-0.035, -0.02, -0.03], 0.9, pink],
    [[0.03, 0.0, 0.02], 2.9, silver],
    [[-0.01, 0.025, -0.01], 1.7, pink],
  ];
  for (const [p, rz, m] of chunks) put(g, geo('chunk', () => new THREE.DodecahedronGeometry(0.03, 0)), m, p, [1.3, 0.7, 0.9], [0.4, rz, rz]);
  put(g, geo('brine', () => new THREE.CylinderGeometry(0.079, 0.079, 0.17, 14)), mat('brine', () => new THREE.MeshStandardMaterial({ color: 0x9b9a5a, roughness: 0.2, transparent: true, opacity: 0.45, depthWrite: false })), [0, -0.025, 0], undefined, undefined, false);
  // the jar: rounded shoulders and a screw neck
  const jar = geo('jar', () =>
    lathe(
      [
        [0.0, -0.12],
        [0.08, -0.12],
        [0.09, -0.11],
        [0.092, 0.05],
        [0.084, 0.075],
        [0.072, 0.085],
        [0.072, 0.1],
      ],
      18,
    ),
  );
  put(g, jar, glassMat(0xe2f2ea, 0.3), [0, 0, 0], undefined, undefined, false);
  // label band round the front
  put(
    g,
    geo('jarLabel', () => new THREE.CylinderGeometry(0.0935, 0.0935, 0.085, 18, 1, true)),
    mat('jarLabelMat', () => new THREE.MeshStandardMaterial({ map: baitLabel(), roughness: 0.75, metalness: 0 })),
    [0, -0.03, 0],
  );
  // red screw lid with a ridged edge
  const red = metal(0xd23b2b, { rough: 0.35, metalness: 0.4 });
  put(g, geo('lid', () => new THREE.CylinderGeometry(0.08, 0.08, 0.04, 18)), red, [0, 0.112, 0]);
  put(g, geo('lidRim', () => new THREE.TorusGeometry(0.079, 0.008, 4, 18)), red, [0, 0.096, 0], undefined, [Math.PI / 2, 0, 0], false);
  return done(g);
}

export function makeMallet(): THREE.Group {
  const g = new THREE.Group();
  // ash handle, rubber grip, a banded wooden head
  put(g, geo('malletHandle', () => new THREE.CylinderGeometry(0.022, 0.027, 0.66, 8)), wood(0xd8ad78, { plankWidth: 0.04, along: 'z', weathered: false }), [0, -0.04, 0]);
  put(g, geo('malletGrip', () => new THREE.CylinderGeometry(0.031, 0.031, 0.17, 8)), rubber(0x2b2f36), [0, -0.29, 0]);
  put(g, geo('malletKnob', () => new THREE.SphereGeometry(0.034, 8, 6)), rubber(0x2b2f36), [0, -0.38, 0]);
  put(g, geo('malletHead', () => new THREE.CylinderGeometry(0.068, 0.068, 0.26, 14)), wood(0x9a6a44, { plankWidth: 0.05, along: 'x', weathered: true }), [0, 0.33, 0], undefined, [0, 0, Math.PI / 2]);
  const steel = metal(0x8d969b, { rough: 0.3 });
  for (const s of [-1, 1]) put(g, geo('malletBand', () => new THREE.CylinderGeometry(0.071, 0.071, 0.024, 14)), steel, [s * 0.1, 0.33, 0], undefined, [0, 0, Math.PI / 2]);
  return done(g);
}

export function makeLifeRing(): THREE.Group {
  const g = new THREE.Group();
  const holder = new THREE.Group();
  const red = plastic(0xd8372a, { rough: 0.3 });
  const white = plastic(0xf5f0e6, { rough: 0.3 });
  const R = 0.32,
    T = 0.085;
  for (let i = 0; i < 4; i++) {
    const arc = put(holder, geo('ringArc', () => new THREE.TorusGeometry(R, T, 8, 10, Math.PI / 2)), i % 2 ? white : red);
    arc.rotation.z = (i * Math.PI) / 2;
  }
  // grab line: four festoons round the outside, lashed on at the colour joins
  const line = rope(0xf0dfb4);
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2,
      a1 = a0 + Math.PI / 2;
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) {
      const a = a0 + ((a1 - a0) * k) / 4;
      const sag = Math.sin((k / 4) * Math.PI);
      const r = R + T + 0.006 + sag * 0.035;
      pts.push([Math.cos(a) * r, Math.sin(a) * r, 0.012 * sag]);
    }
    put(holder, geo(`festoon${i}`, () => tube(pts, 0.011, 1, 9, 4)), line, [0, 0, 0], undefined, undefined, false);
    // lashing round the tube at the join
    const lash = put(holder, geo('lash', () => new THREE.TorusGeometry(T + 0.008, 0.012, 3, 8)), line, [Math.cos(a0) * R, Math.sin(a0) * R, 0], undefined, undefined, false);
    lash.rotation.set(0, Math.PI / 2, 0);
    lash.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), a0 + Math.PI / 2);
  }
  holder.rotation.x = Math.PI / 2; // lies flat in its body frame (body is a flat cylinder)
  g.add(holder);
  return done(g);
}

export function makeGrapple(): THREE.Group {
  const g = new THREE.Group();
  const steel = metal(0x59636a, { rough: 0.48, metalness: 0.8 });
  put(g, geo('grShaft', () => new THREE.CylinderGeometry(0.024, 0.03, 0.46, 8)), steel, [0, 0.0, 0]);
  put(g, geo('grCrown', () => new THREE.SphereGeometry(0.042, 10, 8)), steel, [0, -0.22, 0]);
  // four curved tines with barbed points
  const tine = geo('grTine', () =>
    tube(
      [
        [0, -0.215, 0],
        [0.07, -0.235, 0],
        [0.13, -0.2, 0],
        [0.155, -0.12, 0],
        [0.135, -0.05, 0],
      ],
      0.019,
      0.45,
      9,
      5,
    ),
  );
  const tip = geo('grTip', () => {
    const c = new THREE.ConeGeometry(0.016, 0.05, 6);
    c.rotateZ(0.5);
    c.translate(0.122, -0.03, 0);
    return c;
  });
  for (let i = 0; i < 4; i++) {
    put(g, tine, steel, [0, 0, 0], undefined, [0, (i * Math.PI) / 2, 0]);
    put(g, tip, steel, [0, 0, 0], undefined, [0, (i * Math.PI) / 2, 0]);
  }
  // shackle eye with a short tail of line
  put(g, geo('grEye', () => new THREE.TorusGeometry(0.045, 0.013, 6, 12)), steel, [0, 0.27, 0]);
  put(g, geo('grTail', () => tube([[0, 0.31, 0], [0.04, 0.33, 0.02], [0.08, 0.3, 0.03], [0.1, 0.24, 0.02]], 0.012, 1, 10, 5)), rope(0xf0dfb4), [0, 0, 0], undefined, undefined, false);
  return done(g);
}

// --- buoys ---------------------------------------------------------------------------------

/** Glossy orange buoy skin: a white band round the middle with the pot number painted on it. */
function buoyMat(n: number | undefined): THREE.MeshStandardMaterial {
  return mat(`buoy${n ?? '-'}`, () => {
    const map = canvasTexture(256, 128, (c) => {
      c.fillStyle = '#ef7a2a';
      c.fillRect(0, 0, 256, 128);
      // moulding seams and a darker cap
      const grd = c.createLinearGradient(0, 0, 0, 30);
      grd.addColorStop(0, '#d8641e');
      grd.addColorStop(1, '#ef7a2a');
      c.fillStyle = grd;
      c.fillRect(0, 0, 256, 30);
      c.fillStyle = '#fbf6ec';
      c.fillRect(0, 50, 256, 28);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(0, 49, 256, 1.5);
      c.fillRect(0, 77.5, 256, 1.5);
      if (n !== undefined) {
        c.fillStyle = '#23262b';
        c.font = 'bold 26px Georgia, serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (const x of [0, 64, 128, 192, 256]) c.fillText(String(n), x, 65);
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 0.24, metalness: 0 });
  });
}

function numberTexture(n: number): THREE.CanvasTexture {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#23262b';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 35);
  });
}

/** A buoy: glossy orange ball with a white band (and a flag pole when big). Origin = ball centre. */
export function makeBuoy(n?: number, big = false): THREE.Group {
  const g = new THREE.Group();
  const r = big ? 0.42 : 0.28;
  put(g, geo(`buoyBall${r}`, () => new THREE.SphereGeometry(r, big ? 22 : 16, big ? 14 : 11)), buoyMat(n));
  // rope eye on top
  const line = rope(0xf0dfb4);
  put(g, geo(`buoyEye${r}`, () => new THREE.TorusGeometry(r * 0.16, r * 0.035, 4, 10)), line, [0, r * 1.02, 0], undefined, [0, 0.4, 0], false);
  if (big) {
    // marker pole with a pennant
    const black = plastic(0x2b2b2b, { rough: 0.4 });
    put(g, geo('buoyPole', () => new THREE.CylinderGeometry(0.022, 0.028, 1.3, 6)), black, [0, r + 0.6, 0]);
    put(g, geo('buoyKnob', () => new THREE.SphereGeometry(0.04, 8, 6)), black, [0, r + 1.27, 0]);
    const flag = geo('pennant', () => {
      const f = new THREE.PlaneGeometry(0.36, 0.22, 6, 2);
      const p = f.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + 0.18;
        // taper to a swallow-tail and add a little wave
        p.setY(i, p.getY(i) * (1 - x * 0.9));
        p.setZ(i, Math.sin(x * 14) * 0.025 * x * 3);
      }
      f.translate(0.18, 0, 0);
      f.rotateY(-Math.PI / 2);
      f.computeVertexNormals();
      return f;
    });
    put(g, flag, plastic(P.buoy, { rough: 0.5, side: THREE.DoubleSide }), [0, r + 1.1, 0]);
  }
  mergeStatic(g);
  if (n !== undefined) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(n), depthTest: false, transparent: true }));
    sp.scale.set(0.7, 0.7, 0.7);
    sp.position.y = big ? r + 1.75 : r + 0.4;
    sp.renderOrder = 10;
    g.add(sp);
  }
  return g;
}

/** A coiled line (rope loops) as carried from the grapple. */
export function makeLineCoil(): THREE.Group {
  const g = new THREE.Group();
  const line = rope(0xe8d39a);
  for (let i = 0; i < 4; i++) {
    const loop = put(g, geo(`coil${i}`, () => new THREE.TorusGeometry(0.135 - i * 0.006, 0.024, 6, 20)), line, [0.004 * i, -0.04 + i * 0.024, 0.003 * (i % 2)], undefined, [Math.PI / 2 + (i % 2 ? 0.06 : -0.05), 0, 0]);
    loop.rotation.z = i * 0.7;
  }
  put(g, geo('coilTail', () => tube([[0.13, 0.04, 0], [0.17, 0.0, 0.03], [0.19, -0.06, 0.05], [0.2, -0.12, 0.04]], 0.02, 1, 10, 6)), line);
  return done(g);
}

export function makeIceShardGeometry(): THREE.BufferGeometry {
  return new THREE.TetrahedronGeometry(0.06, 0);
}

// ---- specials ----------------------------------------------------------------

/** Message in a bottle, standing up along Y (the physics capsule's axis). */
export function makeBottle(): THREE.Group {
  const g = new THREE.Group();
  put(
    g,
    geo('bottle', () =>
      lathe(
        [
          [0.0, -0.165],
          [0.06, -0.165],
          [0.068, -0.155],
          [0.068, 0.03],
          [0.058, 0.07],
          [0.03, 0.1],
          [0.024, 0.14],
          [0.028, 0.15],
          [0.026, 0.158],
        ],
        16,
      ),
    ),
    glassMat(0x4f9a66, 0.42),
    [0, 0, 0],
    undefined,
    undefined,
    false,
  );
  put(g, geo('cork', () => new THREE.CylinderGeometry(0.022, 0.019, 0.045, 8)), plastic(0xb08456, { rough: 0.8 }), [0, 0.165, 0]);
  // the rolled note inside, tied with a red ribbon
  put(g, geo('note', () => new THREE.CylinderGeometry(0.028, 0.028, 0.17, 10)), plastic(0xf3e6c4, { rough: 0.85 }), [0.008, -0.06, 0.006], undefined, [0.08, 0, 0.05]);
  put(g, geo('ribbon', () => new THREE.TorusGeometry(0.03, 0.006, 4, 12)), plastic(0xc8432f, { rough: 0.5 }), [0.01, -0.06, 0.006], undefined, [Math.PI / 2, 0, 0]);
  return done(g);
}

export function makeOctopus(): THREE.Group {
  const g = new THREE.Group();
  const coral = plastic(0xe2607a, { rough: 0.3 });
  const pale = plastic(0xf6b0bd, { rough: 0.4 });
  // mantle, with paler spots
  put(g, geo('octoHead', () => new THREE.SphereGeometry(0.15, 18, 14)), coral, [0, 0.05, -0.02], [1, 1.12, 1.05], [-0.25, 0, 0]);
  for (const [x, y, z, r] of [
    [0.07, 0.17, -0.05, 0.022],
    [-0.08, 0.14, -0.08, 0.018],
    [0.02, 0.2, -0.1, 0.016],
    [-0.04, 0.09, -0.14, 0.02],
    [0.1, 0.06, -0.1, 0.016],
  ] as [number, number, number, number][])
    put(g, geo('octoSpot', () => new THREE.SphereGeometry(1, 8, 6)), pale, [x, y, z], [r, r * 0.5, r], undefined, false);
  // eight curling arms
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const curl = i % 2 ? 1 : -1;
    const pts: V3[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const rr = 0.07 + t * 0.2 - (t > 0.75 ? (t - 0.75) * 0.25 : 0);
      const aa = a + curl * t * t * 0.9;
      pts.push([Math.cos(aa) * rr, -0.06 - 0.12 * Math.min(1, t * 2.2) + (t > 0.8 ? (t - 0.8) * 0.4 : 0), Math.sin(aa) * rr]);
    }
    put(g, geo(`octoArm${i}`, () => tube(pts, 0.032, 0.2, 14, 6)), coral);
  }
  // big googly eyes
  for (const s of [-1, 1]) {
    put(g, geo('octoEye', () => new THREE.SphereGeometry(0.042, 12, 10)), plastic(0xfdfbf6, { rough: 0.2 }), [s * 0.07, 0.07, 0.115], [1, 1.1, 0.8], undefined, false);
    put(g, geo('octoPupil', () => new THREE.SphereGeometry(0.024, 10, 8)), plastic(0x15161a, { rough: 0.1 }), [s * 0.072, 0.065, 0.145], [1, 1.1, 0.6], undefined, false);
  }
  return done(g);
}

export function makeBoot(): THREE.Group {
  const g = new THREE.Group();
  const green = plastic(0x6f9a3a, { rough: 0.35 });
  const dark = rubber(0x2b2b2b);
  // shaft, rounded toe, sole and a turned top
  put(g, geo('bootShaft', () => new THREE.CylinderGeometry(0.078, 0.072, 0.3, 14)), green, [0, 0.03, -0.045], [1, 1, 1.15]);
  put(g, geo('bootFoot', () => new THREE.CapsuleGeometry(0.076, 0.16, 4, 12)), green, [0, -0.115, 0.035], [1, 1, 0.78], [Math.PI / 2, 0, 0]);
  put(g, geo('bootSole', () => new THREE.CapsuleGeometry(0.075, 0.17, 2, 12)), dark, [0, -0.168, 0.035], [1.04, 1, 0.22], [Math.PI / 2, 0, 0]);
  put(g, geo('bootTop', () => new THREE.TorusGeometry(0.076, 0.014, 6, 16)), plastic(0xd9c25a, { rough: 0.4 }), [0, 0.18, -0.045], [1, 1.15, 1], [Math.PI / 2, 0, 0]);
  // a strand of kelp draped over the top
  put(g, geo('kelp', () => tube([[-0.09, 0.05, -0.02], [-0.06, 0.17, -0.04], [0.0, 0.2, -0.05], [0.06, 0.15, -0.03], [0.1, 0.06, 0.0], [0.11, -0.02, 0.03]], 0.014, 0.6, 16, 5)), plastic(0x5a6a2a, { rough: 0.5 }), [0, 0, 0]);
  return done(g);
}

export function makeShipBell(): THREE.Group {
  const g = new THREE.Group();
  const brass = metal(0xd2a447, { rough: 0.22, metalness: 0.95 });
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push([0.055 + 0.11 * Math.pow(t, 1.7) + (t > 0.88 ? (t - 0.88) * 0.25 : 0), 0.13 - t * 0.27]);
  }
  pts.push([0.19, -0.145], [0.18, -0.15]);
  // the bell (open: the inside shows from below) with a lip bead, crown loop and clapper
  put(g, geo('bell', () => lathe(pts, 22)), metal(0xd2a447, { rough: 0.22, metalness: 0.95, side: THREE.DoubleSide }));
  put(g, geo('bellCap', () => new THREE.SphereGeometry(0.058, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)), brass, [0, 0.128, 0], [1, 0.5, 1]);
  put(g, geo('bellLip', () => new THREE.TorusGeometry(0.188, 0.01, 6, 22)), brass, [0, -0.142, 0], undefined, [Math.PI / 2, 0, 0]);
  put(g, geo('bellBead', () => new THREE.TorusGeometry(0.1, 0.007, 5, 18)), brass, [0, 0.06, 0], undefined, [Math.PI / 2, 0, 0], false);
  put(g, geo('bellCrown', () => new THREE.TorusGeometry(0.035, 0.013, 6, 12)), brass, [0, 0.175, 0]);
  put(g, geo('clapper', () => new THREE.SphereGeometry(0.032, 10, 8)), metal(0x6b6e70, { rough: 0.4 }), [0.02, -0.12, 0]);
  // bell rope with a knot
  const line = rope(0xf3e3b0);
  put(g, geo('bellRope', () => tube([[0.02, -0.14, 0], [0.03, -0.2, 0.01], [0.02, -0.26, 0.0]], 0.012, 1, 6, 5)), line);
  put(g, geo('bellKnot', () => new THREE.SphereGeometry(0.022, 8, 6)), line, [0.02, -0.27, 0]);
  return done(g);
}

/** A sea otter floating on its back (long axis along Z, belly up), clutching a clam. */
export function makeOtter(): THREE.Group {
  const g = new THREE.Group();
  const fur = plastic(0x7a5236, { rough: 0.6 });
  const belly = plastic(0xd9b892, { rough: 0.6 });
  const dark = plastic(0x1d1612, { rough: 0.2 });
  put(g, geo('otBody', () => new THREE.CapsuleGeometry(0.16, 0.4, 6, 14)), fur, [0, 0, -0.02], undefined, [Math.PI / 2, 0, 0]);
  put(g, geo('otTummy', () => new THREE.SphereGeometry(0.14, 14, 10)), belly, [0, 0.115, 0.0], [0.75, 0.42, 1.5]);
  // head: fluffy pale face, round ears, button nose, happy closed eyes
  put(g, geo('otHead', () => new THREE.SphereGeometry(0.135, 16, 12)), fur, [0, 0.06, 0.33]);
  put(g, geo('otFace', () => new THREE.SphereGeometry(0.11, 14, 10)), belly, [0, 0.07, 0.4], [1.05, 0.85, 0.7]);
  for (const s of [-1, 1]) {
    put(g, geo('otMuzzle', () => new THREE.SphereGeometry(0.04, 10, 8)), belly, [s * 0.03, 0.04, 0.47]);
    put(g, geo('otEar', () => new THREE.SphereGeometry(0.03, 8, 6)), fur, [s * 0.1, 0.13, 0.31], [1, 1, 0.6]);
    put(g, geo('otEye', () => new THREE.TorusGeometry(0.018, 0.0055, 4, 8, Math.PI)), dark, [s * 0.052, 0.135, 0.43], undefined, [-0.9, 0, 0], false);
    // front paws on the clam, hind feet up
    put(g, geo('otPaw', () => new THREE.SphereGeometry(0.042, 10, 8)), fur, [s * 0.065, 0.16, 0.17], [1, 0.8, 1.1]);
    put(g, geo('otFoot', () => new THREE.SphereGeometry(0.055, 10, 8)), fur, [s * 0.08, 0.1, -0.3], [0.9, 0.6, 1.3], [0.6, 0, 0]);
    for (let i = 0; i < 2; i++)
      put(g, geo('otWhisker', () => new THREE.CylinderGeometry(0.002, 0.002, 0.08, 3)), plastic(0xf5efe5, { rough: 0.4 }), [s * 0.085, 0.045 + i * 0.016, 0.47], undefined, [0, 0, s * (Math.PI / 2 + (i - 0.5) * 0.3)], false);
  }
  put(g, geo('otNose', () => new THREE.SphereGeometry(0.022, 8, 6)), dark, [0, 0.07, 0.5], [1.3, 0.8, 0.9]);
  // the clam
  put(g, geo('clam', () => new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), plastic(0xf2c9b8, { rough: 0.35 }), [0, 0.17, 0.2], [1.2, 0.45, 1]);
  // tail
  put(g, geo('otTail', () => new THREE.ConeGeometry(0.08, 0.32, 10)), fur, [0, 0.0, -0.42], [1, 0.55, 1], [-Math.PI / 2, 0, 0]);
  return done(g);
}

let glowTex: THREE.Texture | null = null;
function halo(): THREE.Texture {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(64, 64, (c) => {
    const grd = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, 64, 64);
  });
  return glowTex;
}

/** A glowing moon jelly. children[0] is the bell group that specials.ts pulses. */
export function makeJelly(): THREE.Group {
  const g = new THREE.Group();
  const bell = new THREE.Group();
  g.add(bell);
  const domeMat = mat('jellyDome', () => new THREE.MeshStandardMaterial({ color: 0xcdb8ff, emissive: 0x8a6cff, emissiveIntensity: 0.9, roughness: 0.15, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }));
  const dome = geo('jellyDome', () =>
    lathe(
      [
        [0.0, 0.11],
        [0.07, 0.1],
        [0.13, 0.065],
        [0.17, 0.01],
        [0.185, -0.02],
        [0.175, -0.03],
      ],
      20,
    ),
  );
  put(bell, dome, domeMat, [0, 0, 0], undefined, undefined, false);
  // glowing core: four petals inside the bell
  const core = glow(0xff9de6, 1.6);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    put(bell, geo('jellyPetal', () => new THREE.TorusGeometry(0.03, 0.009, 4, 10)), core, [Math.cos(a) * 0.045, 0.045, Math.sin(a) * 0.045], undefined, [Math.PI / 2, 0, a], false);
  }
  // frilly oral arms and fine tentacles (glow, no lighting)
  const armMat = mat('jellyArm', () => new THREE.MeshBasicMaterial({ color: 0xe6d8ff, transparent: true, opacity: 0.75, depthWrite: false }));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const pts: V3[] = [];
    for (let k = 0; k <= 5; k++) pts.push([Math.cos(a) * (0.02 + Math.sin(k * 1.3) * 0.02), -0.02 - k * 0.05, Math.sin(a) * (0.02 + Math.cos(k * 1.3) * 0.02)]);
    put(bell, geo(`jellyArm${i}`, () => tube(pts, 0.016, 0.3, 12, 5)), armMat, [0, 0, 0], undefined, undefined, false);
  }
  const tMat = basic(0xd6c8ff, { transparent: true, opacity: 0.6, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const pts: V3[] = [];
    for (let k = 0; k <= 4; k++) pts.push([Math.cos(a) * (0.165 - k * 0.012) + Math.sin(k * 2 + i) * 0.01, -0.03 - k * 0.07, Math.sin(a) * (0.165 - k * 0.012)]);
    put(bell, geo(`jellyT${i}`, () => tube(pts, 0.004, 0.5, 8, 3)), tMat, [0, 0, 0], undefined, undefined, false);
  }
  mergeStatic(bell);
  // a soft additive halo stands in for a light (no extra light in the scene, no shader recompiles)
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: 0xa98cff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  glowSprite.scale.set(0.9, 0.9, 0.9);
  g.add(glowSprite);
  return g;
}

export type SpecialKind = 'bottle' | 'octopus' | 'boot' | 'bell' | 'otter' | 'jelly';
export function makeSpecial(kind: SpecialKind): THREE.Group {
  switch (kind) {
    case 'bottle':
      return makeBottle();
    case 'octopus':
      return makeOctopus();
    case 'boot':
      return makeBoot();
    case 'bell':
      return makeShipBell();
    case 'otter': {
      // the loose otter's physics body is an upright capsule: stand the model along its axis
      const g = new THREE.Group();
      const o = makeOtter();
      o.rotation.x = -Math.PI / 2;
      o.position.set(0, 0.02, 0);
      g.add(o);
      return g;
    }
    case 'jelly':
      return makeJelly();
  }
}

export function makeArrow(color: number): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 10), basic(color, { transparent: true, opacity: 0.9, depthWrite: false }));
  cone.rotation.x = Math.PI;
  g.add(cone);
  return g;
}
