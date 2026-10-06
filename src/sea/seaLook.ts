/**
 * The light the water effects are lit by, shared by the sea, spray, ripples and snow.
 *
 * SeaMesh.applyLook() (called by Stage every frame with the art-direction look) refreshes it, so
 * particles and ripples pick up the same sun, sky and foam colours as the sea without each owner
 * having to pass the look around. Until the first applyLook it holds the golden-hour look.
 */
import * as THREE from 'three';
import { computeLook, goldenLook, type Look } from '../render/look';

export interface SeaLight {
  /** unit vector toward the sun */
  sunDir: THREE.Vector3;
  /** sun colour × intensity (irradiance) */
  sun: THREE.Color;
  /** the sun's colour alone (look.sunColor) */
  sunTint: THREE.Color;
  /** sky fill (hemisphere sky colour × intensity) */
  ambient: THREE.Color;
  foam: THREE.Color;
  fog: THREE.Color;
  skyHorizon: THREE.Color;
  /** 0 golden … 1 storm, estimated from the look (glitter fades out in the storm) */
  storm: number;
}

export const seaLight: SeaLight = {
  sunDir: new THREE.Vector3(0, 1, 0),
  sun: new THREE.Color(),
  sunTint: new THREE.Color(),
  ambient: new THREE.Color(),
  foam: new THREE.Color(),
  fog: new THREE.Color(),
  skyHorizon: new THREE.Color(),
  storm: 0,
};

/** Plain sea-foam white for every water effect (linear, capped below pure white). */
export const SEA_FOAM = new THREE.Color(0xeef2f0).multiplyScalar(0.99);

const GOLDEN_GLITTER = goldenLook().sea.glitter;
const STORM_GLITTER = computeLook(1, 0, goldenLook()).sea.glitter;

export function setSeaLight(look: Look): void {
  const s = seaLight;
  s.sunDir.copy(look.sunDir);
  s.sun.copy(look.sunColor).multiplyScalar(look.sunIntensity);
  s.sunTint.copy(look.sunColor);
  s.ambient.copy(look.hemiSky).multiplyScalar(look.hemiIntensity);
  // foam stays a neutral sea-foam white whatever the look's tint (no peach, no lilac)
  s.foam.copy(SEA_FOAM);
  s.fog.copy(look.fogColor);
  s.skyHorizon.copy(look.skyHorizon);
  s.storm = THREE.MathUtils.clamp((GOLDEN_GLITTER - look.sea.glitter) / Math.max(1e-3, GOLDEN_GLITTER - STORM_GLITTER), 0, 1);
}

setSeaLight(goldenLook());

/**
 * What the sea's shading needs from the game world, gathered once per frame by SprayFx (the sea
 * module that holds the game context) and read by SeaMesh.update():
 *   - floating gear (buoys, pot markers, anything overboard) that the storm foam keeps clear of
 *   - the weather's wind, for the direction of the foam streaks and ripple drift
 * Hosts that never feed it get no markers and the swell-derived default wind.
 */
export const SEA_MARKERS = 4;

export interface SeaWorld {
  /** world x, z, clear radius (m), 1 = on */
  markers: THREE.Vector4[];
  /** world XZ wind direction (x, z) */
  windDir: THREE.Vector2;
  /** 0..1 */
  wind: number;
  /** set once something has written the wind */
  hasWind: boolean;
}

export const seaWorld: SeaWorld = {
  markers: Array.from({ length: SEA_MARKERS }, () => new THREE.Vector4()),
  windDir: new THREE.Vector2(1, 0),
  wind: 0,
  hasWind: false,
};
