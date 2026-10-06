/**
 * Small props: bucket, bait jar, mallet, life ring, grapple, buoys, line coil, specials, ice shards.
 * Each factory returns a Group centred on its physics body's centre. Glossy toy plastic, brass,
 * steel, rope and glass; every prop's static meshes are merged per material. Handled-toy wear (a
 * grubby bucket lip and dark inside, a worn life ring) is baked into vertex colours on meshes
 * kept out of the merge; painted details (bait-jar lid, buoy numbers and scuffs) are canvas decals
 * sharing their prop's material. Everything is shaped to read from the overhead camera.
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
/** A capsule from a to b. */
function capsuleAB(a: V3, b: V3, r: number): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const c = new THREE.CapsuleGeometry(r, Math.max(0.001, A.distanceTo(B)), 3, 8);
  c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  c.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return c;
}
/** Clear glass (no transmission pass: just a glossy see-through shell). */
function glassMat(tint: number, opacity = 0.32): THREE.MeshStandardMaterial {
  return mat(`glass${tint}_${opacity}`, () => new THREE.MeshStandardMaterial({ color: tint, roughness: 0.04, metalness: 0.1, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
}
const done = (g: THREE.Group) => {
  mergeStatic(g);
  return g;
};
/**
 * Bake a per-vertex shade (toy wear, grime, contact darkening) into a copy of a geometry. Meshes
 * using it need a vertex-colour material and `userData.keep` (mergeStatic drops colours).
 */
function shadeGeo(
  g: THREE.BufferGeometry,
  f: (p: THREE.Vector3, n: THREE.Vector3, centroid: THREE.Vector3) => number | [number, number, number],
): THREE.BufferGeometry {
  const q = g.index ? g.toNonIndexed() : g.clone();
  const pos = q.attributes.position as THREE.BufferAttribute;
  const nor = q.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(),
    n = new THREE.Vector3(),
    m = new THREE.Vector3(),
    t = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    // the centre of this vertex's triangle (for hard colour edges along triangle boundaries)
    const f0 = i - (i % 3);
    m.fromBufferAttribute(pos, f0).add(t.fromBufferAttribute(pos, f0 + 1)).add(t.fromBufferAttribute(pos, f0 + 2)).multiplyScalar(1 / 3);
    const c = f(p, n, m);
    if (typeof c === 'number') col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
    else col.set(c, i * 3);
  }
  q.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return q;
}
/** A glossy toy-plastic material that multiplies in the vertex colours. */
function vcPlastic(color: number, rough = 0.32): THREE.MeshStandardMaterial {
  return mat(`vcp${color}_${rough}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, vertexColors: true }));
}
/** Cheap hash noise for wear patterns. */
const hash3 = (x: number, y: number, z: number) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
const keep = (m: THREE.Mesh) => {
  m.userData.keep = true;
  return m;
};

// ---------------------------------------------------------------------------------------------

export function makeBucket(): THREE.Group {
  const g = new THREE.Group();
  const blue = plastic(0x2f86c4, { rough: 0.28 });
  // moulded pail: outer wall with two ribs, a thick rolled lip, inner wall and floor (one lathe).
  // The inside is shaded darker (so it reads as a vessel from above) and the lip is a bit grimy.
  const shell = geo('bucketV', () => {
    const outer: [number, number][] = [
      [0.0, -0.17],
      [0.152, -0.17],
      [0.158, -0.162],
      [0.17, -0.06],
      [0.183, 0.04],
      [0.19, 0.05],
      [0.198, 0.13],
    ];
    // rolled lip: a fat half-round bead round the top
    const lip: [number, number][] = [];
    for (let i = 0; i <= 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 1.15;
      lip.push([0.2 + Math.cos(a) * 0.022, 0.15 + Math.sin(a) * 0.022]);
    }
    const inner: [number, number][] = [
      [0.184, 0.148],
      [0.148, -0.146],
      [0.0, -0.15],
    ];
    const prof = [...outer, ...lip, ...inner];
    const l = lathe(prof, 14);
    // shade by profile point (lathe vertices run segment by segment through the profile)
    const pos = l.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const nIn = outer.length + lip.length;
    for (let i = 0; i < pos.count; i++) {
      const j = i % prof.length;
      const y = prof[j][1];
      const grime = 0.86 + 0.14 * hash3(Math.round(pos.getX(i) * 60), Math.round(y * 40), Math.round(pos.getZ(i) * 60));
      let k = 1;
      if (j >= nIn + 1) k = 0.2 + 0.32 * Math.max(0, (y + 0.15) / 0.3); // inside: dark at the bottom
      else if (j >= outer.length - 1) k = 0.9 * grime; // the handled, grubby lip
      else if (j <= 1) k = 0.62; // scuffed foot
      col.set([k, k, k], i * 3);
    }
    l.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return l;
  });
  put(g, shell, vcPlastic(0x2f86c4, 0.28)).userData.keep = true;
  // wire bail handle with a grip, on two moulded ears
  const steel = metal(0x9aa3a8, { rough: 0.35 });
  put(g, geo('bail', () => new THREE.TorusGeometry(0.21, 0.0075, 3, 10, Math.PI)), steel, [0, 0.14, 0], undefined, [0, 0, 0], false);
  put(g, geo('bailGrip', () => new THREE.CylinderGeometry(0.017, 0.017, 0.11, 6)), plastic(0x23262b, { rough: 0.5 }), [0, 0.35, 0], undefined, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) put(g, geo('bucketEar', () => new THREE.BoxGeometry(0.03, 0.05, 0.05)), blue, [s * 0.212, 0.13, 0]);
  return done(g);
}

/**
 * The bait jar's paper: the label band (top half of the canvas) and the painted lid top (a red
 * disc with a white fish, bottom-left square), so the label and lid share one material.
 */
function baitLabel(): THREE.Texture {
  return canvasTexture(256, 128, (c) => {
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
    // lid top: glossy red with a fat white fish (reads straight down from the overhead camera)
    c.fillStyle = '#d23b2b';
    c.fillRect(0, 64, 64, 64);
    c.fillStyle = '#b42e22';
    c.beginPath();
    c.arc(32, 96, 31, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = '#a3291f';
    c.stroke();
    c.fillStyle = '#fffaf0';
    c.beginPath();
    c.ellipse(28, 96, 15, 9.5, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(39, 96);
    c.lineTo(52, 86);
    c.lineTo(50, 96);
    c.lineTo(52, 106);
    c.closePath();
    c.fill();
    c.fillStyle = '#d23b2b';
    c.beginPath();
    c.arc(20, 93.5, 2.4, 0, Math.PI * 2);
    c.fill();
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
  // label band round the front (top half of the label canvas) and the painted lid top
  const paper = mat('jarLabelMat2', () => new THREE.MeshStandardMaterial({ map: baitLabel(), roughness: 0.55, metalness: 0 }));
  put(
    g,
    geo('jarLabel2', () => {
      const c = new THREE.CylinderGeometry(0.0935, 0.0935, 0.085, 18, 1, true);
      const uv = c.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
      return c;
    }),
    paper,
    [0, -0.03, 0],
  );
  // a red screw lid, 15% bigger than the neck needs, with a ridged edge
  const red = metal(0xd23b2b, { rough: 0.35, metalness: 0.4 });
  put(g, geo('lid2', () => new THREE.CylinderGeometry(0.092, 0.092, 0.046, 20, 1, true)), red, [0, 0.115, 0]);
  put(g, geo('lidRim2', () => new THREE.TorusGeometry(0.091, 0.009, 4, 20)), red, [0, 0.094, 0], undefined, [Math.PI / 2, 0, 0], false);
  put(g, geo('lidLip', () => new THREE.TorusGeometry(0.086, 0.007, 4, 20)), red, [0, 0.137, 0], undefined, [Math.PI / 2, 0, 0], false);
  put(
    g,
    geo('lidTop', () => {
      const c = new THREE.CircleGeometry(0.09, 20);
      c.rotateX(-Math.PI / 2);
      const uv = c.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 0.5);
      return c;
    }),
    paper,
    [0, 0.1385, 0],
    undefined,
    undefined,
    false,
  );
  return done(g);
}

export function makeMallet(): THREE.Group {
  const g = new THREE.Group();
  // ash handle, rubber grip, a banded wooden head
  put(g, geo('malletHandle', () => new THREE.CylinderGeometry(0.022, 0.027, 0.66, 7, 1, true)), wood(0xd8ad78, { plankWidth: 0.04, along: 'z', weathered: false }), [0, -0.04, 0]);
  put(g, geo('malletGrip', () => new THREE.CylinderGeometry(0.031, 0.031, 0.17, 7)), rubber(0x2b2f36), [0, -0.29, 0]);
  put(g, geo('malletKnob', () => new THREE.SphereGeometry(0.034, 7, 4)), rubber(0x2b2f36), [0, -0.38, 0]);
  put(g, geo('malletHead', () => new THREE.CylinderGeometry(0.068, 0.068, 0.2, 10, 1, true)), wood(0x9a6a44, { plankWidth: 0.05, along: 'x', weathered: true }), [0, 0.33, 0], undefined, [0, 0, Math.PI / 2]);
  const steel = metal(0x8d969b, { rough: 0.3 });
  for (const s of [-1, 1]) put(g, geo('malletBand', () => new THREE.CylinderGeometry(0.071, 0.071, 0.024, 10, 1, true)), steel, [s * 0.1, 0.33, 0], undefined, [0, 0, Math.PI / 2]);
  // bright yellow painted striking faces: the mallet reads from the overhead camera
  const yellow = plastic(0xf5c518, { rough: 0.3 });
  for (const s of [-1, 1]) {
    put(g, geo('malletFace', () => new THREE.CylinderGeometry(0.066, 0.07, 0.03, 10)), yellow, [s * 0.115, 0.33, 0], undefined, [0, 0, -s * (Math.PI / 2)]);
  }
  // and a yellow tag on a loop at the end of the grip
  put(g, geo('malletTag', () => new THREE.BoxGeometry(0.07, 0.045, 0.008)), yellow, [0.035, -0.43, 0], undefined, [0, 0, -0.5]);
  return done(g);
}

export function makeLifeRing(): THREE.Group {
  const g = new THREE.Group();
  const holder = new THREE.Group();
  const R = 0.32,
    T = 0.085;
  // one torus, red and white quarters in the vertex colours: the white is handled and a little
  // grubby toward the inside, the red sun-faded on top
  const ring = geo('ringV', () =>
    shadeGeo(new THREE.TorusGeometry(R, T, 8, 28), (p, n, c) => {
      const red = new THREE.Color(0xd8372a),
        white = new THREE.Color(0xf2ede2);
      const a = Math.atan2(c.y, c.x);
      const q = Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
      const rr = Math.hypot(p.x, p.y);
      const inner = Math.max(0, (R - rr) / T); // 0 outside .. 1 at the hole
      const speck = hash3(Math.round(p.x * 50), Math.round(p.y * 50), Math.round(p.z * 50));
      if (q % 2) {
        const k = 1 - inner * 0.22 - (speck > 0.8 ? 0.1 : 0);
        return [white.r * k, white.g * k, white.b * k * 0.96];
      }
      const fade = 1 + Math.max(0, n.z) * 0.1;
      return [red.r * fade, red.g * fade * 1.3, red.b * fade * 1.3];
    }),
  );
  keep(put(holder, ring, vcPlastic(0xffffff, 0.3)));
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
    put(holder, geo(`festoon${i}`, () => tube(pts, 0.011, 1, 8, 3)), line, [0, 0, 0], undefined, undefined, false);
    // lashing round the tube at the join
    const lash = put(holder, geo('lash', () => new THREE.CylinderGeometry(T + 0.012, T + 0.012, 0.022, 7, 1, true)), line, [Math.cos(a0) * R, Math.sin(a0) * R, 0], undefined, undefined, false);
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
  put(g, geo('grCrown', () => new THREE.SphereGeometry(0.042, 8, 6)), steel, [0, -0.22, 0]);
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
      8,
      4,
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
  put(g, geo('grEye', () => new THREE.TorusGeometry(0.045, 0.013, 4, 10)), steel, [0, 0.27, 0]);
  put(g, geo('grTail', () => tube([[0, 0.31, 0], [0.04, 0.33, 0.02], [0.08, 0.3, 0.03], [0.1, 0.24, 0.02]], 0.012, 1, 8, 4)), rope(0xf0dfb4), [0, 0, 0], undefined, undefined, false);
  return done(g);
}

// --- buoys ---------------------------------------------------------------------------------

/**
 * Glossy orange buoy skin, one canvas: the top half wraps the ball (darker moulded cap, a white
 * band with the pot number painted on the front and back, scuffed grubby bottom); the
 * bottom-left square is the top-cap decal with the number again, so it reads straight down.
 */
function buoyMat(n: number | undefined): THREE.MeshStandardMaterial {
  return mat(`buoy2${n ?? '-'}`, () => {
    const map = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#ef7a2a';
      c.fillRect(0, 0, 256, 256);
      // moulding seams and a darker cap
      const grd = c.createLinearGradient(0, 0, 0, 30);
      grd.addColorStop(0, '#d8641e');
      grd.addColorStop(1, '#ef7a2a');
      c.fillStyle = grd;
      c.fillRect(0, 0, 256, 30);
      c.fillStyle = '#fbf6ec';
      c.fillRect(0, 48, 256, 32);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(0, 47, 256, 1.5);
      c.fillRect(0, 79.5, 256, 1.5);
      // a scuffed, grubby bottom where it drags on the deck and the pot
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const low = c.createLinearGradient(0, 100, 0, 128);
      low.addColorStop(0, 'rgba(70,40,20,0)');
      low.addColorStop(1, 'rgba(70,40,20,0.4)');
      c.fillStyle = low;
      c.fillRect(0, 96, 256, 32);
      // fine scratches only right at the bottom, where it sits and drags
      for (let i = 0; i < 40; i++) {
        const x = rnd() * 256,
          y = 108 + rnd() * 20;
        c.strokeStyle = rnd() < 0.6 ? `rgba(70,40,22,${0.1 + rnd() * 0.15})` : `rgba(255,235,210,${0.1 + rnd() * 0.15})`;
        c.lineWidth = 0.5 + rnd() * 0.8;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 2);
        c.stroke();
      }
      if (n !== undefined) {
        c.fillStyle = '#23262b';
        c.font = 'bold 30px Georgia, serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        // front and back only (0 and 180 degrees): never split across the wrap seam
        for (const x of [64, 192]) c.fillText(String(n), x, 65);
      }
      // the top-cap decal (bottom-left square): a white roundel with the number
      c.fillStyle = '#d8641e';
      c.fillRect(0, 128, 128, 128);
      if (n !== undefined) {
        c.fillStyle = '#fbf6ec';
        c.beginPath();
        c.arc(64, 192, 50, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.2)';
        c.lineWidth = 3;
        c.stroke();
        c.fillStyle = '#23262b';
        c.font = 'bold 70px Georgia, serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(n), 64, 197);
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
  // the ball uses the top half of the buoy canvas
  put(
    g,
    geo(`buoyBall2${r}`, () => {
      const b = new THREE.SphereGeometry(r, big ? 20 : 12, big ? 13 : 8);
      const uv = b.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
      return b;
    }),
    buoyMat(n),
  );
  if (n !== undefined) {
    // the number again on a cap decal over the top (planar UVs into the canvas's square)
    const capA = 0.5;
    put(
      g,
      geo(`buoyCap${r}`, () => {
        const cap = new THREE.SphereGeometry(r * 1.004, 18, 3, 0, Math.PI * 2, 0, capA);
        const pos = cap.attributes.position as THREE.BufferAttribute;
        const uv = cap.attributes.uv as THREE.BufferAttribute;
        const cr = r * 1.004 * Math.sin(capA);
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (0.5 + pos.getX(i) / (2 * cr)) * 0.5, (0.5 - pos.getZ(i) / (2 * cr)) * 0.5);
        return cap;
      }),
      buoyMat(n),
      [0, 0, 0],
      undefined,
      undefined,
      false,
    );
  }
  // rope eye on top
  const line = rope(0xf0dfb4);
  put(g, geo(`buoyEye${r}`, () => new THREE.TorusGeometry(r * 0.16, r * 0.035, 3, 6)), line, [0, r * 1.02, 0], undefined, [0, 0.4, 0], false);
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

const OTTER = { fur: 0x6f4a2f, belly: 0xa9805a, pale: 0xead9bd, dark: 0x1d1612, pad: 0x4a3122 };

/**
 * An otter head, face toward +Z in its own frame: a pale face mask with a big two-puff muzzle,
 * a button nose, closed happy eye arcs, rosy cheeks, round ears and whiskers.
 */
function otterHead(parent: THREE.Object3D, p: V3, rot: V3, scale = 1): void {
  const h = new THREE.Group();
  h.position.set(...p);
  h.rotation.set(...rot);
  h.scale.setScalar(scale);
  parent.add(h);
  const fur = plastic(OTTER.fur, { rough: 0.6 });
  const pale = plastic(OTTER.pale, { rough: 0.62 });
  const dark = plastic(OTTER.dark, { rough: 0.2 });
  put(h, geo('otHead2', () => new THREE.SphereGeometry(0.125, 18, 14)), fur);
  put(h, geo('otMask', () => new THREE.SphereGeometry(0.112, 16, 12)), pale, [0, -0.01, 0.042], [1.06, 0.95, 0.84]);
  for (const s of [-1, 1]) {
    put(h, geo('otMuzzle2', () => new THREE.SphereGeometry(0.05, 12, 9)), pale, [s * 0.037, -0.047, 0.106], [1, 0.9, 1]);
    put(h, geo('otEar2', () => new THREE.SphereGeometry(0.032, 8, 6)), fur, [s * 0.1, 0.078, -0.012], [1, 0.85, 0.6]);
    // closed, smiling eyes: little arcs (an upside-down U)
    put(h, geo('otEyeArc', () => new THREE.TorusGeometry(0.02, 0.0068, 5, 10, Math.PI)), dark, [s * 0.052, 0.032, 0.124], undefined, [-0.25, s * 0.38, 0], false);
    put(h, geo('otCheek', () => new THREE.SphereGeometry(0.024, 8, 6)), plastic(0xf09a8f, { rough: 0.6 }), [s * 0.08, -0.018, 0.103], [1, 0.7, 0.45], [0, s * 0.7, 0], false);
    for (let i = 0; i < 3; i++)
      put(
        h,
        geo('otWhisker2', () => new THREE.CylinderGeometry(0.0022, 0.0015, 0.1, 3)),
        plastic(0xf8f2e8, { rough: 0.4 }),
        [s * 0.1, -0.044 + (i - 1) * 0.013, 0.118],
        undefined,
        [0, s * -0.35, s * (Math.PI / 2 + (i - 1) * 0.2)],
        false,
      );
  }
  put(h, geo('otChin', () => new THREE.SphereGeometry(0.036, 10, 8)), pale, [0, -0.085, 0.085]);
  put(h, geo('otNose2', () => new THREE.SphereGeometry(0.026, 10, 8)), dark, [0, -0.014, 0.146], [1.4, 0.85, 0.9]);
  put(h, geo('otMouth', () => new THREE.TorusGeometry(0.014, 0.004, 4, 8, Math.PI)), dark, [0, -0.06, 0.142], undefined, [0.3, 0, Math.PI], false);
}

/** A clam held up in two paws (a fluted scallop, hinge down). */
function otterClam(parent: THREE.Object3D, p: V3, rot: V3): void {
  const c = new THREE.Group();
  c.position.set(...p);
  c.rotation.set(...rot);
  parent.add(c);
  const shell = plastic(0xf4cdb8, { rough: 0.32 });
  put(
    c,
    geo('clamFluted', () => {
      const g = new THREE.SphereGeometry(0.055, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          z = pos.getZ(i);
        const a = Math.atan2(z, x);
        const k = 1 + 0.06 * Math.cos(a * 8);
        pos.setXYZ(i, x * k, pos.getY(i), z * k);
      }
      g.computeVertexNormals();
      return g;
    }),
    shell,
    [0, 0, 0],
    [1.15, 0.42, 1],
  );
  put(c, geo('clamLip', () => new THREE.TorusGeometry(0.056, 0.006, 4, 16)), plastic(0xe0a990, { rough: 0.4 }), [0, 0, 0], [1.15, 1, 1], [Math.PI / 2, 0, 0], false);
}

/** A sea otter floating on its back (long axis along Z, belly up), clutching a clam. Rides on pots. */
export function makeOtter(): THREE.Group {
  const g = new THREE.Group();
  const fur = plastic(OTTER.fur, { rough: 0.6 });
  const belly = plastic(OTTER.belly, { rough: 0.6 });
  put(g, geo('otBody', () => new THREE.CapsuleGeometry(0.16, 0.4, 6, 14)), fur, [0, 0, -0.02], undefined, [Math.PI / 2, 0, 0]);
  put(g, geo('otTummy', () => new THREE.SphereGeometry(0.14, 14, 10)), belly, [0, 0.115, 0.0], [0.75, 0.42, 1.5]);
  // head lying back: crown toward +Z, face up and a little forward
  otterHead(g, [0, 0.075, 0.34], [Math.PI / 2 + 0.45, Math.PI, 0]);
  for (const s of [-1, 1]) {
    // front paws on the clam, hind feet up
    put(g, geo('otPaw', () => new THREE.SphereGeometry(0.042, 10, 8)), fur, [s * 0.062, 0.17, 0.17], [1, 0.8, 1.1]);
    put(g, geo('otFoot', () => new THREE.SphereGeometry(0.055, 10, 8)), plastic(OTTER.pad, { rough: 0.55 }), [s * 0.08, 0.1, -0.3], [0.9, 0.6, 1.3], [0.6, 0, 0]);
  }
  otterClam(g, [0, 0.175, 0.2], [0, 0, 0]);
  // tail
  put(g, geo('otTail', () => new THREE.ConeGeometry(0.08, 0.32, 10)), fur, [0, 0.0, -0.42], [1, 0.55, 1], [-Math.PI / 2, 0, 0]);
  return done(g);
}

/** A flattened tube (a paddle tail) along a curve: width in the horizontal, thickness vertical. */
function paddle(pts: V3[], w0: number, w1: number, thick: number, seg = 14, radial = 8): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const pos: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const T = new THREE.Vector3(),
    S = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    curve.getTangentAt(t, T);
    S.crossVectors(T, up).normalize();
    // round the tip off
    const w = (w0 + (w1 - w0) * t) * (t > 0.85 ? Math.sqrt(Math.max(0.05, 1 - ((t - 0.85) / 0.15) ** 2)) : 1);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(c.x + S.x * Math.cos(a) * w, c.y + Math.sin(a) * thick, c.z + S.z * Math.cos(a) * w);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j,
        b = i * radial + ((j + 1) % radial),
        d = (i + 1) * radial + j,
        e = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The loose otter special: sitting up on its tail inside the upright 0.82 m capsule (origin = its
 * centre), belly and pale face toward +Z with the face tipped up toward the overhead camera,
 * both front paws holding a clam at the chest, big hind feet splayed forward and a flat paddle
 * tail curled round the base.
 */
export function makeSittingOtter(): THREE.Group {
  const g = new THREE.Group();
  const fur = plastic(OTTER.fur, { rough: 0.6 });
  const belly = plastic(OTTER.belly, { rough: 0.6 });
  const pad = plastic(OTTER.pad, { rough: 0.55 });
  // a pear-shaped body: broad seat, narrowing to the shoulders
  put(
    g,
    geo('otSitBody', () =>
      lathe(
        [
          [0.0, -0.4],
          [0.1, -0.395],
          [0.145, -0.37],
          [0.162, -0.31],
          [0.16, -0.22],
          [0.148, -0.1],
          [0.13, 0.0],
          [0.112, 0.08],
          [0.1, 0.14],
          [0.0, 0.2],
        ],
        24,
      ),
    ),
    fur,
    [0, 0, 0],
    [1, 1, 0.92],
  );
  // a paler tummy on the front
  put(g, geo('otSitTummy', () => new THREE.SphereGeometry(0.13, 20, 16)), belly, [0, -0.17, 0.07], [0.9, 1.42, 0.66]);
  otterHead(g, [0, 0.262, 0.03], [-0.32, 0, 0], 1.12);
  // arms from the shoulders to the paws, holding a clam at the chest
  for (const s of [-1, 1]) {
    put(g, geo(`otArm${s}`, () => capsuleAB([s * 0.1, 0.08, 0.03], [s * 0.05, 0.018, 0.15], 0.038)), fur);
    put(g, geo('otSitPaw', () => new THREE.SphereGeometry(0.04, 10, 8)), fur, [s * 0.052, 0.01, 0.158], [1.05, 0.9, 1]);
  }
  otterClam(g, [0, 0.022, 0.178], [Math.PI / 2 - 0.25, 0, 0]);
  // big webbed hind feet splayed forward at the base
  for (const s of [-1, 1]) {
    put(g, geo('otSitFoot', () => new THREE.SphereGeometry(0.06, 12, 8)), pad, [s * 0.105, -0.385, 0.135], [0.95, 0.32, 1.5], [0, s * 0.45, 0]);
    for (let k = -1; k <= 1; k++)
      put(g, geo('otToe', () => new THREE.SphereGeometry(0.02, 6, 4)), pad, [s * 0.105 + Math.sin(s * 0.45) * 0.085 + k * 0.024, -0.38, 0.135 + Math.cos(0.45) * 0.085], [1, 0.75, 1.2], undefined, false);
  }
  // a flat paddle tail curling round the base from behind to the right foot
  put(
    g,
    geo('otSitTail', () =>
      paddle(
        [
          [0.0, -0.33, -0.12],
          [-0.09, -0.375, -0.15],
          [-0.17, -0.39, -0.06],
          [-0.18, -0.392, 0.05],
          [-0.13, -0.392, 0.13],
        ],
        0.058,
        0.04,
        0.022,
      ),
    ),
    fur,
  );
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
    case 'otter':
      // the loose otter's physics body is an upright capsule: it sits up on its tail
      return makeSittingOtter();
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
