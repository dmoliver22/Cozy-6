/**
 * Anti-aliasing for flat UI rings (selection rings under the crew, the aim reticle, the landing
 * and highlight rings). Phones render without MSAA and the overlay helpers are drawn after post
 * straight onto the canvas, so their polygon edges stair-step. Instead of relying on MSAA, the
 * ring's alpha is feathered over about 1.5 px on both edges with a screen-space derivative of the
 * radius (fwidth), and the circle is drawn just inside the polygon so its chords never show.
 *
 * Applied at runtime by the stage's overlay scan to any MeshBasicMaterial on a RingGeometry; the
 * owners of those meshes don't need to change anything.
 */
import * as THREE from 'three';

const FEATHERED = 'ringFeather';

/** Feather a ring mesh's edges once. Returns false if it doesn't apply (or already done). */
export function featherRing(mesh: THREE.Mesh): boolean {
  const geo = mesh.geometry as THREE.RingGeometry;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (geo.type !== 'RingGeometry' || Array.isArray(mat) || !mat.isMeshBasicMaterial) return false;
  if (mat.userData[FEATHERED]) return false;
  const p = geo.parameters;
  // the polygon's chords sit inside the true circle by r·(1 − cos(π/n)): keep the drawn circle
  // inside them so the feathered edge stays round
  const k = Math.cos(Math.PI / Math.max(3, p.thetaSegments));
  const ring = new THREE.Vector2(p.innerRadius, p.outerRadius * k);
  mat.userData[FEATHERED] = true;
  mat.transparent = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRingR = { value: ring };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRingR;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRingR = length(position.xy);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRingR;\nuniform vec2 uRingR;')
      .replace(
        '#include <alphatest_fragment>',
        `float rfw = max(fwidth(vRingR), 1e-5) * 1.5;
        diffuseColor.a *= smoothstep(uRingR.x, uRingR.x + rfw, vRingR) * (1.0 - smoothstep(uRingR.y - rfw, uRingR.y, vRingR));
        #include <alphatest_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => FEATHERED;
  mat.needsUpdate = true;
  return true;
}
