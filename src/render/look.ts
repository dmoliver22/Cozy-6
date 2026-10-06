/**
 * Art direction in one place: the "golden hour toy diorama" look and its storm counterpart.
 *
 * Calm water is a late-afternoon golden hour: a low warm sun about 26 degrees right of the view,
 * ahead of the camera and behind the boat, so the boat is rim-lit, its shadows run toward the
 * lower left and the sun path glitters across the upper right; a weak neutral-cool fill from
 * behind the camera; a slate-teal sky that keeps the sea's reflection teal rather than royal
 * blue; deep, desaturated teal water; a warm haze over the far sea; a contrasty grade with warm
 * highlights and teal shadows, a warm-brown vignette, and a tilt-shift blur that makes the boat
 * read as a miniature. The storm pulls everything toward cold slate: high diffuse light, a strong
 * cool rim on the boat, a close grey spray haze over grey-green water with dark troughs and
 * lighter crests, white foam, a cooler, less saturated grade.
 *
 * Stage, sea, post-processing and the end-of-trip scenes all read from `computeLook()`; nothing
 * else should hard-code scene colours.
 */
import * as THREE from 'three';

export interface Look {
  /** unit vector toward the sun (world space) */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** angular size of the sun disc in the sky (radians) */
  sunDisc: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  /** glow around the sun, added to the sky */
  skyGlow: THREE.Color;
  fogColor: THREE.Color;
  /** fog start/end for the overhead camera; first person uses fpFog* */
  fogNear: number;
  fogFar: number;
  fpFogNear: number;
  fpFogFar: number;
  exposure: number;
  sea: {
    deep: THREE.Color;
    mid: THREE.Color;
    /** light scattered through thin wave crests */
    subsurface: THREE.Color;
    foam: THREE.Color;
    /** sun glitter strength 0..1+ */
    glitter: number;
    /** surface roughness for the sun highlight (lower = tighter path) */
    roughness: number;
    /** sky reflection strength at grazing angles */
    reflect: number;
  };
  grade: {
    /** colour pushed into the shadows */
    shadowTint: THREE.Color;
    /** colour pushed into the highlights */
    highlightTint: THREE.Color;
    saturation: number;
    contrast: number;
    vignette: number;
    /** colour the vignette pulls the corners toward (warm brown, never black; post applies it in display space) */
    vignetteTint: THREE.Color;
    grain: number;
    bloomStrength: number;
    bloomThreshold: number;
    bloomRadius: number;
    /** tilt-shift: blur amount at the top/bottom of the screen (0 = off) */
    tiltShift: number;
    /** how much of the tilt-shift applies below the focus band (the near water), 0..1 */
    tiltBelow: number;
  };
}

const c = (hex: number) => new THREE.Color(hex);

/** The two poles the weather blends between. Values are in linear working space via THREE.Color. */
const GOLDEN = {
  // low for long warm shadows and a rim, high enough that the wheelhouse shadow doesn't swallow
  // the working deck
  sunElevDeg: 20,
  /** sun azimuth relative to the overhead view yaw: about 26 degrees right of the view, ahead of
   * the camera and behind the boat, so the glitter path crosses the upper right of the frame (as
   * in the reference), the boat is rim-lit and its shadows run toward the lower left */
  sunAzOffset: -0.45,
  sunColor: c(0xffb36b),
  sunIntensity: 4.3,
  sunDisc: 0.04,
  // a weak, nearly neutral cool fill from behind the camera: the warm key does the modelling
  rimColor: c(0xaec2d6),
  rimIntensity: 0.5,
  hemiSky: c(0xb7c5d0),
  hemiGround: c(0x5a3a26),
  hemiIntensity: 0.75,
  // slate-teal zenith (not royal blue): reflected through the env map it keeps the sea teal
  skyZenith: c(0x4a6e82),
  skyHorizon: c(0xf3b886),
  skyGlow: c(0xffcf8f),
  // the far sea hazes warm toward the sun (the sea and sky tint it slate teal away from it)
  fogColor: c(0xb38f78),
  fogNear: 40,
  fogFar: 115,
  // first person: fully fogged before the 100 m edge of the sea grid, clear water nearer
  fpFogNear: 45,
  fpFogFar: 92,
  exposure: 1.02,
  sea: { deep: c(0x061d24), mid: c(0x173f45), subsurface: c(0x33a39a), foam: c(0xfff3e2), glitter: 1.6, roughness: 0.2, reflect: 0.7 },
  grade: {
    shadowTint: c(0x0d4152),
    highlightTint: c(0xffd2a0),
    saturation: 0.95,
    contrast: 1.25,
    vignette: 0.5,
    vignetteTint: c(0x2a1c14),
    grain: 0.035,
    bloomStrength: 0.4,
    bloomThreshold: 0.85,
    bloomRadius: 0.5,
    tiltShift: 1.0,
    tiltBelow: 0.65,
  },
};

const STORM = {
  sunElevDeg: 38,
  // the same bearing as golden hour, so the sun doesn't swing across the sky as the weather blends
  sunAzOffset: -0.45,
  sunColor: c(0xc3cbd8),
  sunIntensity: 1.5,
  sunDisc: 0.0,
  rimColor: c(0x8ea4c4),
  // a strong cool rim so the hull's outline holds against the grey sea
  rimIntensity: 0.9,
  hemiSky: c(0x9aa6b8),
  hemiGround: c(0x1f262e),
  hemiIntensity: 1.7,
  skyZenith: c(0x2a303c),
  skyHorizon: c(0x6a7480),
  skyGlow: c(0x8a929c),
  // close, slate-grey spray haze: the far sea goes grey (a surface), never black
  fogColor: c(0x4d5863),
  fogNear: 18,
  fogFar: 75,
  fpFogNear: 12,
  fpFogFar: 62,
  exposure: 1.05,
  // darker troughs, lighter crests: the swell's form reads through the spray haze
  sea: { deep: c(0x0e1c24), mid: c(0x2e4c58), subsurface: c(0x4d7c7a), foam: c(0xeef3f4), glitter: 0.12, roughness: 0.4, reflect: 0.6 },
  grade: {
    shadowTint: c(0x18212c),
    highlightTint: c(0xdfe8f2),
    saturation: 0.9,
    contrast: 1.12,
    vignette: 0.4,
    vignetteTint: c(0x1a1f24),
    grain: 0.05,
    bloomStrength: 0.25,
    bloomThreshold: 1.0,
    bloomRadius: 0.4,
    tiltShift: 0.7,
    tiltBelow: 0.5,
  },
};

function makeLook(): Look {
  return {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    sunDisc: 0,
    rimColor: new THREE.Color(),
    rimIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    skyGlow: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogNear: 0,
    fogFar: 0,
    fpFogNear: 0,
    fpFogFar: 0,
    exposure: 1,
    sea: { deep: new THREE.Color(), mid: new THREE.Color(), subsurface: new THREE.Color(), foam: new THREE.Color(), glitter: 0, roughness: 0, reflect: 0 },
    grade: {
      shadowTint: new THREE.Color(),
      highlightTint: new THREE.Color(),
      saturation: 1,
      contrast: 1,
      vignette: 0,
      vignetteTint: new THREE.Color(),
      grain: 0,
      bloomStrength: 0,
      bloomThreshold: 1,
      bloomRadius: 0,
      tiltShift: 0,
      tiltBelow: 1,
    },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const shared = makeLook();

/**
 * The look for a storm amount 0..1 and a view yaw (radians, the camera's horizontal heading;
 * the sun sits ahead and to the right of the view so the glitter path faces the player).
 * Returns a shared object: copy what you need to keep.
 */
export function computeLook(storm: number, viewYaw: number, out: Look = shared): Look {
  const s = Math.min(1, Math.max(0, storm));
  // storm eases in late so the golden look holds through the choppy phase
  const t = s * s * (3 - 2 * s);
  const elev = (lerp(GOLDEN.sunElevDeg, STORM.sunElevDeg, t) * Math.PI) / 180;
  // ahead-right of the camera's view (camera right = view × up), raking across the boat
  const az = viewYaw + lerp(GOLDEN.sunAzOffset, STORM.sunAzOffset, t);
  out.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
  out.sunColor.copy(GOLDEN.sunColor).lerp(STORM.sunColor, t);
  out.sunIntensity = lerp(GOLDEN.sunIntensity, STORM.sunIntensity, t);
  out.sunDisc = lerp(GOLDEN.sunDisc, STORM.sunDisc, t);
  out.rimColor.copy(GOLDEN.rimColor).lerp(STORM.rimColor, t);
  out.rimIntensity = lerp(GOLDEN.rimIntensity, STORM.rimIntensity, t);
  out.hemiSky.copy(GOLDEN.hemiSky).lerp(STORM.hemiSky, t);
  out.hemiGround.copy(GOLDEN.hemiGround).lerp(STORM.hemiGround, t);
  out.hemiIntensity = lerp(GOLDEN.hemiIntensity, STORM.hemiIntensity, t);
  out.skyZenith.copy(GOLDEN.skyZenith).lerp(STORM.skyZenith, t);
  out.skyHorizon.copy(GOLDEN.skyHorizon).lerp(STORM.skyHorizon, t);
  out.skyGlow.copy(GOLDEN.skyGlow).lerp(STORM.skyGlow, t);
  out.fogColor.copy(GOLDEN.fogColor).lerp(STORM.fogColor, t);
  out.fogNear = lerp(GOLDEN.fogNear, STORM.fogNear, t);
  out.fogFar = lerp(GOLDEN.fogFar, STORM.fogFar, t);
  out.fpFogNear = lerp(GOLDEN.fpFogNear, STORM.fpFogNear, t);
  out.fpFogFar = lerp(GOLDEN.fpFogFar, STORM.fpFogFar, t);
  out.exposure = lerp(GOLDEN.exposure, STORM.exposure, t);
  const a = GOLDEN.sea,
    b = STORM.sea,
    o = out.sea;
  o.deep.copy(a.deep).lerp(b.deep, t);
  o.mid.copy(a.mid).lerp(b.mid, t);
  o.subsurface.copy(a.subsurface).lerp(b.subsurface, t);
  o.foam.copy(a.foam).lerp(b.foam, t);
  o.glitter = lerp(a.glitter, b.glitter, t);
  o.roughness = lerp(a.roughness, b.roughness, t);
  o.reflect = lerp(a.reflect, b.reflect, t);
  const ga = GOLDEN.grade,
    gb = STORM.grade,
    g = out.grade;
  g.shadowTint.copy(ga.shadowTint).lerp(gb.shadowTint, t);
  g.highlightTint.copy(ga.highlightTint).lerp(gb.highlightTint, t);
  g.saturation = lerp(ga.saturation, gb.saturation, t);
  g.contrast = lerp(ga.contrast, gb.contrast, t);
  g.vignette = lerp(ga.vignette, gb.vignette, t);
  g.vignetteTint.copy(ga.vignetteTint).lerp(gb.vignetteTint, t);
  g.grain = lerp(ga.grain, gb.grain, t);
  g.bloomStrength = lerp(ga.bloomStrength, gb.bloomStrength, t);
  g.bloomThreshold = lerp(ga.bloomThreshold, gb.bloomThreshold, t);
  g.bloomRadius = lerp(ga.bloomRadius, gb.bloomRadius, t);
  g.tiltShift = lerp(ga.tiltShift, gb.tiltShift, t);
  g.tiltBelow = lerp(ga.tiltBelow, gb.tiltBelow, t);
  return out;
}

/** The golden-hour look on its own (harbor, galley, photos, title backdrop). */
export function goldenLook(viewYaw = 0): Look {
  return computeLook(0, viewYaw, makeLook());
}

/**
 * Kittiwake Harbor at sunset: the sun almost on the water, peach-to-violet sky, long shadows,
 * a softer tilt-shift so the street reads as a model village. `viewYaw` is the harbor camera's
 * heading; the sun sits low behind it and to its right, raking across the shop fronts.
 */
export function harborLook(viewYaw = 0): Look {
  const l = goldenLook(viewYaw);
  const elev = (13 * Math.PI) / 180;
  const az = viewYaw + Math.PI + 0.85;
  l.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
  l.sunColor.setHex(0xffa060);
  l.sunIntensity = 3.6;
  l.sunDisc = 0.06;
  l.rimColor.setHex(0x9fb0d8);
  l.rimIntensity = 0.45;
  // a dusky violet sky fill, kept low: the snow is bright and would go flat lavender-white
  l.hemiSky.setHex(0x9a92b0);
  l.hemiGround.setHex(0x6a4a3a);
  l.hemiIntensity = 0.6;
  l.skyZenith.setHex(0x40507e);
  l.skyHorizon.setHex(0xf5a070);
  l.skyGlow.setHex(0xffb072);
  // the far water and sky read as a sunset gradient, not a brown band
  l.fogColor.setHex(0xe7a985);
  l.fogNear = 40;
  l.fogFar = 220;
  l.exposure = 0.85;
  l.sea.deep.setHex(0x0c2a3a);
  l.sea.mid.setHex(0x1b4f66);
  const g = l.grade;
  g.shadowTint.setHex(0x1d3b5a);
  g.highlightTint.setHex(0xffc896);
  g.saturation = 1.1;
  g.contrast = 1.06;
  g.vignette = 0.32;
  g.vignetteTint.setHex(0x2c1c18);
  g.bloomStrength = 0.45;
  g.bloomThreshold = 0.95;
  g.tiltShift = 0.45;
  g.tiltBelow = 0.6;
  return l;
}

/**
 * The galley: lamplight and stove glow. The "sky" here only feeds the environment map, so its
 * colours are the room: dark timber above, amber lamplight around, the stove as the "sun".
 */
export function galleyLook(): Look {
  const l = goldenLook(0);
  l.sunDir.set(-0.5, 0.35, 0.3).normalize();
  l.sunColor.setHex(0xffb070);
  l.sunIntensity = 0.0;
  l.sunDisc = 0.12;
  l.rimColor.setHex(0x8fa8d8);
  l.rimIntensity = 0.25;
  l.hemiSky.setHex(0xffd2a0);
  l.hemiGround.setHex(0x3a2418);
  l.hemiIntensity = 0.55;
  l.skyZenith.setHex(0x2a1a12);
  l.skyHorizon.setHex(0xa86a3c);
  l.skyGlow.setHex(0xffa860);
  l.fogColor.setHex(0x6a4a34);
  l.fogNear = 30;
  l.fogFar = 80;
  l.exposure = 1.05;
  l.sea.deep.setHex(0x2a1a12);
  const g = l.grade;
  g.shadowTint.setHex(0x2a2a3a);
  g.highlightTint.setHex(0xffcf98);
  // neutral saturation: the warm lamplight and the cool window fill supply the colour
  g.saturation = 1.0;
  g.contrast = 1.06;
  g.vignette = 0.4;
  g.vignetteTint.setHex(0x1e1410);
  g.grain = 0.04;
  g.bloomStrength = 0.55;
  g.bloomThreshold = 0.85;
  g.bloomRadius = 0.6;
  g.tiltShift = 0.35;
  g.tiltBelow = 0.8;
  return l;
}

/** A deep copy of a Look (computeLook returns a shared object). */
export function cloneLook(l: Look): Look {
  return {
    ...l,
    sunDir: l.sunDir.clone(),
    sunColor: l.sunColor.clone(),
    rimColor: l.rimColor.clone(),
    hemiSky: l.hemiSky.clone(),
    hemiGround: l.hemiGround.clone(),
    skyZenith: l.skyZenith.clone(),
    skyHorizon: l.skyHorizon.clone(),
    skyGlow: l.skyGlow.clone(),
    fogColor: l.fogColor.clone(),
    sea: { ...l.sea, deep: l.sea.deep.clone(), mid: l.sea.mid.clone(), subsurface: l.sea.subsurface.clone(), foam: l.sea.foam.clone() },
    grade: { ...l.grade, shadowTint: l.grade.shadowTint.clone(), highlightTint: l.grade.highlightTint.clone(), vignetteTint: l.grade.vignetteTint.clone() },
  };
}
