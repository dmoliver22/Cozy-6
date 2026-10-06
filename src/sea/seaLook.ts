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
  ambient: new THREE.Color(),
  foam: new THREE.Color(),
  fog: new THREE.Color(),
  skyHorizon: new THREE.Color(),
  storm: 0,
};

const GOLDEN_GLITTER = goldenLook().sea.glitter;
const STORM_GLITTER = computeLook(1, 0, goldenLook()).sea.glitter;

export function setSeaLight(look: Look): void {
  const s = seaLight;
  s.sunDir.copy(look.sunDir);
  s.sun.copy(look.sunColor).multiplyScalar(look.sunIntensity);
  s.ambient.copy(look.hemiSky).multiplyScalar(look.hemiIntensity);
  s.foam.copy(look.sea.foam);
  s.fog.copy(look.fogColor);
  s.skyHorizon.copy(look.skyHorizon);
  s.storm = THREE.MathUtils.clamp((GOLDEN_GLITTER - look.sea.glitter) / Math.max(1e-3, GOLDEN_GLITTER - STORM_GLITTER), 0, 1);
}

setSeaLight(goldenLook());
