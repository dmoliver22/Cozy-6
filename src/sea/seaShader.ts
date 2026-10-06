/**
 * Sea shading (vertex + fragment GLSL for SeaMesh).
 *
 * The displacement is SEA_GLSL from waves.ts, untouched (gameplay floats on the CPU twin).
 * Everything here is look:
 *   - water body: deep → mid by crest height over a wide ramp, plus the low sun on the swell's
 *     own (macro) normal, so the big swells read as lit backs and dark troughs
 *   - Fresnel reflection of an analytic sky (zenith / horizon / sun glow from the look)
 *   - GGX sun highlight on baked detail ripples (2–3 mip-filtered samples of one tiling slope
 *     map), tinted gold and capped, plus twinkling glints kept inside the sun lobe: the
 *     glittering sun path. Detail ripples reach the diffuse and the reflection at 0.8 strength.
 *   - subsurface glow in thin bands just under sharp, back-lit crests
 *   - foam: crisp, broken whitecaps on the sharpest crests, thin wind-stretched streaks behind
 *     them, sparse storm streaks along the wind (kept clear of buoys and the hull), a lit and
 *     broken rogue lip with churned water behind it, a lacy hull collar that is widest at the
 *     bow (a little wider at the stern), and a wake that follows the stern's recent path: broken
 *     prop wash in the first few metres, thin Kelvin arms, a darker churned centreline
 *   - contact darkening around the hull and the hull's shadow; horizon haze into the fog colour
 *
 * Defines (set by SeaMesh per quality tier):
 *   SEA_DETAIL  1 low | 2 medium | 3 high  (detail samples, foam octaves)
 *   WAKE_N      number of stern history points (polyline of WAKE_N - 1 segments)
 *   MARKERS_N   floating things the storm streaks keep clear of
 */
import { SEA_GLSL } from './waves';

export const SEA_VERT = /* glsl */ `
${SEA_GLSL}
uniform vec3 uFocus;
varying vec3 vWorld;
varying vec2 vGrid;
varying vec3 vNormal;
varying vec2 vFoam;   // x pinch of the swell now, y pinch one radian behind the crest (trailing foam)
varying vec2 vRogue;  // x metres from the rogue crest along its travel (+ = ahead), y rogue height there
varying float vHeight;
#include <fog_pars_vertex>

// Trailing foam: the swell's crest "one radian ago", so foam lingers on the back of a crest after
// it passes. Same phases as seaDisplace(); shading only.
float seaFoamTrail(vec2 p, float distFade) {
  float trail = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float fade = (i == 3) ? distFade : 1.0;
    float th = a.z * (a.x * p.x + a.y * p.y) - a.w * uTime + b.z;
    trail += a.z * b.y * fade * sin(th + 0.9);
  }
  return trail;
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - uFocus.xz);
  float distFade = 1.0 - smoothstep(38.0, 75.0, dist);
  vec3 n; float pinch; float rc;
  vGrid = wp.xz;
  vec3 d = seaDisplace(wp.xz, distFade, n, pinch, rc);
  // the rogue's crest rides the centre of its envelope: distance from it, and its height
  float rds = 0.0;
  float rA = 0.0;
  float rp = 0.0;
  if (uRogueB.x > 0.001) {
    rds = uRogueA.x * wp.x + uRogueA.y * wp.z - uRogueA.w;
    float w = uRogueB.z;
    rA = uRogueB.x * exp(-(rds * rds) / (w * w));
    rp = rA * uRogueB.y * uRogueA.z * cos(uRogueA.z * rds);
  }
  float trail = seaFoamTrail(wp.xz, distFade);
  wp.xyz += d;
  vWorld = wp.xyz;
  vNormal = n;
  // whitecaps come from the swell's own pinch (the rogue draws its own lip and churn)
  vFoam = vec2(pinch - rp * 0.85, trail);
  vRogue = vec2(rds, rA);
  vHeight = d.y;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const SEA_FRAG = /* glsl */ `
uniform float uTime2;
uniform mat4 uBoatInv;
uniform float uBoatSpeed;
uniform float uHalfBeam;
uniform float uStern;
uniform float uBow;
uniform vec3 uSunDirection;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform vec3 uHaze;
uniform vec3 uSeaDeep;
uniform vec3 uSeaMid;
uniform vec3 uSeaSub;
uniform vec3 uSeaFoam;
uniform vec3 uSpecTint;     // sun colour pushed toward gold (max channel 1)
uniform vec4 uSeaParams;    // glitter, roughness, reflect, sun disc (rad)
uniform vec4 uSeaState;     // rough 0..1, max pinch (sum k*QA), crest height scale, storm-ness from the look
uniform vec4 uSeaLight;     // sun strength vs golden hour 0..1, swell-form gain, sun luminance, -
uniform vec3 uWind;         // dir x, dir z, strength 0..1
uniform vec4 uWake[WAKE_N]; // stern history: world x, z, arc length from the stern, strength
uniform vec4 uWakeBox;      // world xz bounds of the wake (min x, min z, max x, max z)
uniform vec2 uBoatHeave;    // vertical speed of the hull (m/s), 0
uniform vec4 uMarkers[MARKERS_N]; // floating things: world x, z, clear radius, on
uniform vec4 uRogueA;       // rogue: dirX, dirZ, k, s0 (shared with SEA_GLSL)
uniform sampler2D uDetail;  // baked detail ripples: RG = slope (detailNormals.ts)
varying vec3 vWorld;
varying vec2 vGrid;
varying vec3 vNormal;
varying vec2 vFoam;
varying vec2 vRogue;
varying float vHeight;
#include <fog_pars_fragment>

#define PI 3.14159265

// --- hashes without sin() (stable on mobile GPUs at large coordinates)
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Edge width for thresholded patterns, from the pixel footprint (set once at the top of main:
// fwidth() is undefined inside the per-fragment branches below, so it is not used there).
float gAA = 0.05;
float aastep(float t, float v) {
  return smoothstep(t - gAA, t + gAA, v);
}

// Foam with a crisp outline, a thin see-through film at the edges and denser cores.
// c = coverage 0..1+, p = break-up pattern 0..1.
float foamLayer(float c, float p) {
  float th = 1.0 - c;
  return aastep(th, p) * (0.45 + 0.55 * smoothstep(th, th + 0.25, p));
}

float hullHalf(float z) {
  if (z <= uStern) return 2.85;
  if (z < uStern + 1.5) return mix(2.85, uHalfBeam, sin((z - uStern) / 1.5 * 1.5708));
  if (z <= 4.0) return uHalfBeam;
  if (z >= uBow) return 0.0;
  float t = (z - 4.0) / (uBow - 4.0);
  return uHalfBeam * pow(max(0.0, 1.0 - t * t), 0.6);
}

// Half-width of the hull at boat-local height y (the deck is y = 0; the hull's sections tuck in
// below it toward the keel, as lofted in art/boat.ts). The sea sits ~1.3 m below the deck, where
// the hull is already narrower than its deck outline.
float hullWidthAt(float z, float y) {
  float hw = hullHalf(z);
  if (y >= 0.0) return hw;
  float keel = mix(-2.7, -0.9, pow(smoothstep(3.0, uBow, z), 1.5));
  float k = clamp(y / keel, 0.0, 1.0);
  float f = k < 0.33 ? mix(1.0, 0.985, k / 0.33) : (k < 0.62 ? mix(0.985, 0.9, (k - 0.33) / 0.29) : (k < 0.85 ? mix(0.9, 0.62, (k - 0.62) / 0.23) : mix(0.62, 0.1, (k - 0.85) / 0.15)));
  return hw * f;
}

// distance from the hull's waterline outline in plan (boat-local metres; 0 inside)
float hullDist(vec3 lp, float hwy) {
  if (lp.z < uStern) return length(vec2(max(abs(lp.x) - hullWidthAt(uStern, lp.y), 0.0), uStern - lp.z));
  if (lp.z > uBow) return length(vec2(lp.x, lp.z - uBow));
  return max(abs(lp.x) - hwy, 0.0);
}

// The sky as the water sees it. The warm horizon only on the sun's side (away from it the horizon
// is nearly the zenith's slate teal), and the broad glow broken up by brk (0..1 noise), so swell
// faces tilted toward the sun don't reflect smooth cream smears.
vec3 skyColor(vec3 R, float brk) {
  float h = clamp(R.y, 0.0, 1.0);
  float sunSide = 0.5 + 0.5 * dot(normalize(R.xz + 1e-4), normalize(uSunDirection.xz + 1e-4));
  vec3 hor = mix(mix(uSkyHorizon, uSkyZenith, 0.92), uSkyHorizon, smoothstep(0.35, 1.0, sunSide));
  vec3 c = mix(hor, uSkyZenith, smoothstep(0.0, 0.5, pow(h, 0.8)));
  float sd = max(dot(R, uSunDirection), 0.0);
  c += uSkyGlow * (pow(sd, 5.0) * 0.35 * mix(0.35, 1.0, smoothstep(0.45, 0.75, brk)) + pow(sd, 40.0) * 0.6);
  return c;
}

void main() {
  // ---------------------------------------------------------------- pixel footprint, detail
  // (derivatives and mip-mapped lookups first, before any discard or branch)
  vec2 gp = vGrid;
  float px = max(length(fwidth(gp)), 1e-4); // metres per pixel
  gAA = clamp(px * 1.4, 0.004, 0.3);
  float t = uTime2;
  float rough = uSeaState.x;

  // wind frame: x along the wind, y across it
  vec2 wd = normalize(uWind.xy + vec2(1e-4, 0.0));
  vec2 wn = vec2(-wd.y, wd.x);
  vec2 wp2 = vec2(dot(gp, wd), dot(gp, wn));

  // detail ripples: the baked slope map at 2–3 scales, rotations and drifts (mips fade them out
  // with distance, so they never alias)
  vec2 sl = texture2D(uDetail, wp2 * (1.0 / 9.0) - vec2(t * 0.05, t * 0.004)).rg * 2.0 - 1.0;
  vec2 slope = sl * 0.095;
  {
    mat2 r2 = mat2(0.47, 0.88, -0.88, 0.47);
    vec2 s2 = texture2D(uDetail, (r2 * wp2) * (1.0 / 3.6) + vec2(-t * 0.07, t * 0.045)).rg * 2.0 - 1.0;
    slope += (s2 * r2) * 0.07;
  }
#if SEA_DETAIL >= 3
  {
    mat2 r3 = mat2(0.82, -0.57, 0.57, 0.82);
    vec2 s3 = texture2D(uDetail, (r3 * wp2) * (1.0 / 1.55) + vec2(-t * 0.13, -t * 0.06)).rg * 2.0 - 1.0;
    slope += (s3 * r3) * 0.05;
  }
#endif
  // wind frame → world xz, choppier as the sea builds
  slope = (slope.x * wd + slope.y * wn) * (1.0 + rough * 0.8);

  // Hide the sea inside the hull footprint (the deck-wash sheet handles green water on deck).
  vec3 lp = (uBoatInv * vec4(vWorld, 1.0)).xyz;
  float hwy = hullWidthAt(lp.z, lp.y);
  if (lp.z > uStern + 0.05 && lp.z < uBow - 0.05 && abs(lp.x) < hwy - 0.06 && lp.y < 0.6) discard;
  float hullD = hullDist(lp, hwy);

  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;
  vec3 L = uSunDirection;
  vec3 Nm = normalize(vNormal);
  // shading normals: the swell's slope exaggerated so its form reads from overhead (diffuse,
  // Fresnel), detail ripples at 0.8 there and at full strength only for the sun's highlight
  float gF = uSeaLight.y;
  vec3 Nmac = normalize(vec3(Nm.x * gF, Nm.y, Nm.z * gF));
  vec3 dN = vec3(-slope.x, 0.0, -slope.y);
  vec3 Nd = normalize(Nmac + dN * 0.8);
  // (the sun sees steeper ripples than the diffuse does: real capillary slopes reach 15-20 deg,
  // which spreads the highlight into a glittering path of facets)
  vec3 Ns = normalize(Nm + dN * 1.9);

  // ---------------------------------------------------------------- water body
  float NdV = clamp(dot(Nd, V), 0.0, 1.0);
  float hN = vHeight / uSeaState.z;                      // ~ -1 trough … 1 crest
  float ramp = clamp(smoothstep(-1.15, 1.15, hN) * 0.88 + (1.0 - NdV) * 0.22, 0.0, 1.0);
  vec3 body = mix(uSeaDeep, uSeaMid, ramp);
  // the low sun on the swell (macro normal only): lit backs, dark troughs
  float sunFace = clamp(dot(Nmac, L) / max(L.y, 0.2), 0.0, 2.2);   // 1 on flat water
  float sunK = 0.36 * uSeaLight.x * (sunFace - 1.0);
  body *= 1.0 + sunK * (sunK > 0.0 ? mix(vec3(1.0), uSpecTint, 0.45) : vec3(1.0));

  // subsurface: thin bands of light just under sharp crests, between the viewer and the sun
  float pn = vFoam.x / uSeaState.y;                      // crest pinch, 1 = all waves stacked
  vec2 Vh = normalize(V.xz + vec2(1e-4, 0.0));
  // (hN 0.8 = 0.65 of the summed amplitude; only sharp crests, only their face toward the viewer)
  float crestBand = smoothstep(0.8, 0.95, hN) * (1.0 - smoothstep(1.1, 1.3, hN));
  float thin = crestBand * smoothstep(0.5, 0.9, pn) * smoothstep(0.03, 0.1, dot(Nm.xz, Vh));
  float backlit = pow(clamp(dot(V, -L + Nm * 0.3), 0.0, 1.0), 4.0);
  float sssA = min(0.35, thin * backlit * 1.6) * (0.4 + 0.6 * uSeaLight.x);

  // ---------------------------------------------------------------- sky reflection
  // (the reflection sees the true swell plus most of the ripples: the sky breaks up into facets
  // instead of mirroring in big smooth patches; capped so the far sea never turns to milk)
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, normalize(Nm + dN * 0.8));
  R.y = max(R.y, 0.02);
  // break-up noise in undisplaced coordinates (reused by the foam below)
  float nB = vnoise(mat2(0.8, 0.6, -0.6, 0.8) * gp * 3.3 + vec2(t * 0.1, -t * 0.12));
  vec3 refl = skyColor(normalize(R), nB);
  float reflAmt = clamp(F * 1.3 + 0.03, 0.0, 0.55) * uSeaParams.z;

  // ---------------------------------------------------------------- sun: GGX + glints
  vec3 H = normalize(L + V);
  float NdH = max(dot(Ns, H), 0.0);
  float NdL = max(dot(Ns, L), 0.0);
  float NdVs = max(dot(Ns, V), 0.0);
  float a = max(uSeaParams.y * uSeaParams.y, 0.002);
  // the sun's disc and the ripples lost to the mips widen the lobe
  a = sqrt(a * a + uSeaParams.w * uSeaParams.w * 0.25 + px * px * 0.03);
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float G = 1.0 / max(4.0 * max(NdL, 0.05) * max(NdVs, 0.05), 1e-3);
  float sunUp = smoothstep(-0.02, 0.08, L.y);
  float sunAmt = uSeaParams.x * sunUp * uSeaLight.z;
  float specI = D * FH * G * NdL * sunAmt;
  vec3 spec = uSpecTint * min(specI, 2.6);

  // glints: tiny facets twinkling, only inside the sun's lobe on the swell (not the ripples, or
  // they scatter everywhere), only where the ripples already catch the sun, and only while they
  // are bigger than a pixel: a warm, clustered glitter path, never a starfield
  float lobe = smoothstep(0.85, 0.97, dot(reflect(-V, Nd), L));
  float cell = 0.16;
  float gFade = 1.0 - smoothstep(0.25, 0.6, px / cell);
  float glint = 0.0;
  if (lobe * gFade * specI > 0.03) {
    vec2 cp = gp / cell + wd * t * 0.5;
    vec2 ci = floor(cp);
    vec2 cf = fract(cp) - 0.5;
    float h = hash12(ci);
    float rate = 0.8 + h * 1.7;
    float ph = fract(t * rate + h * 7.0);
    float tw = pow(sin(ph * PI), 3.0);
    float on = step(1.0 - 0.16 * lobe * min(uSeaParams.x, 1.0), hash12(ci + floor(t * rate + h * 7.0) * 17.0));
    float r = length(cf + (hash22(ci) - 0.5) * 0.5);
    glint = on * tw * (1.0 - smoothstep(0.1, 0.32, r)) * lobe * gFade * smoothstep(0.15, 0.9, specI);
  }
  vec3 glitter = uSpecTint * min(glint * sunAmt * 1.4, 3.0);

  // ---------------------------------------------------------------- foam
  float thr = mix(0.76, 0.60, rough);
  // whitecaps spill down the front (downwind) face of the crest: a thin band, not a blob
  float freshC = smoothstep(thr, 1.0, pn) * smoothstep(0.01, 0.09, dot(Nm.xz, wd));
  float trailC = smoothstep(thr - 0.03, 1.0, vFoam.y / uSeaState.y) * (1.0 - freshC);
  bool inWake = all(greaterThan(vWorld.xz, uWakeBox.xy)) && all(lessThan(vWorld.xz, uWakeBox.zw));
  bool nearHull = hullD < 3.0;
  bool rogueOn = vRogue.y > 0.6 && vRogue.x > -7.5 && vRogue.x < 2.0;
  bool streaky = rough > 0.35;
  float foam = 0.0;
  float aer = 0.0;     // aerated water: lighter, a little greener
  float churn = 0.0;   // churned water behind the stern: a little darker
  float nA = 0.5;
  if (freshC > 0.0 || trailC > 0.0 || rogueOn || streaky || inWake || nearHull) {
    // break-up noise in undisplaced (Lagrangian) coordinates, so foam rides the orbital motion
    nA = vnoise(wp2 * vec2(1.9, 0.55) + vec2(-t * 0.25, 0.0));   // stretched along the crests
  }
  float pat = nA * 0.55 + nB * 0.45;

  // keep the sea-state foam clear of floating gear and the hull so they stay readable
  float clearMask = smoothstep(1.6, 3.0, hullD);
  if (streaky || freshC > 0.0 || trailC > 0.0) {
    for (int i = 0; i < MARKERS_N; i++) {
      vec4 mk = uMarkers[i];
      if (mk.w > 0.5) clearMask = min(clearMask, smoothstep(mk.z * 0.55, mk.z, length(vWorld.xz - mk.xy)));
    }
  }

  // whitecaps: crisp, broken patches on the sharpest crests
  if (freshC > 0.0) foam = foamLayer(freshC * 0.95, pat) * (0.4 + 0.6 * clearMask);
  // the crest's wake: thin, broken streaks stretched along the wind (no filaments, no blobs)
  if (trailC > 0.0) {
    float st = vnoise(wp2 * vec2(0.22, 2.4) + vec2(-t * 0.22, 7.0));
    float streak = smoothstep(0.6, 0.72, st * 0.75 + nB * 0.25);
    foam = max(foam, streak * smoothstep(0.0, 0.6, trailC) * 0.38 * clearMask);
  }
  // storm streaks along the wind: long and thin (~20:1), faint, sparse, clustered in patches
  if (streaky) {
    float s1 = vnoise(wp2 * vec2(0.25, 5.0) + vec2(-t * 0.35, 0.0));
#if SEA_DETAIL >= 2
    float s2 = vnoise(wp2 * vec2(0.7, 6.0) + vec2(-t * 0.5, 13.0));
    float sn = s1 * 0.75 + s2 * 0.25;
#else
    float sn = s1 * 0.85 + nB * 0.15;
#endif
    float line = smoothstep(0.71, 0.75, sn);
    // broken along its length, clustered in patches
    float brk = smoothstep(0.35, 0.6, vnoise(wp2 * vec2(0.35, 0.9) + vec2(-t * 0.3, 41.0)));
    float clump = smoothstep(0.55, 0.85, vnoise(wp2 * vec2(0.025, 0.07) + 5.0));
    foam = max(foam, line * brk * clump * smoothstep(0.35, 0.9, rough) * 0.26 * clearMask);
  }

  // ---------------------------------------------------------------- the rogue
  // a lit, broken lip on the crest (about 1.5 m, leading edge feathered over 0.3 m) and
  // churned water streaked along its travel on its back, fading out over ~5 m
  if (rogueOn) {
    float A = vRogue.y;
    float ds = vRogue.x;
    vec2 rdir = uRogueA.xy;
    float across = dot(gp, vec2(-rdir.y, rdir.x));
    float strength = smoothstep(0.7, 1.7, A);
    float r1 = vnoise(vec2(across * 1.1, ds * 1.8) + vec2(t * 0.2, 3.0));
    float r2 = vnoise(vec2(across * 2.6, ds * 3.8) - vec2(t * 0.3, 0.0));
    float rn = r1 * 0.62 + r2 * 0.38;
    float lead = 1.0 - smoothstep(0.6, 0.9, ds);              // leading edge feathered over 0.3 m
    float cov = smoothstep(-1.6, -0.5, ds) * lead;            // dense core, broken back edge
    float lip = aastep(0.5, rn + 0.38 * cov - 0.23) * lead * strength;
    float behind = -ds - 1.0;
    float churnR = 0.0;
    if (behind > 0.0) {
      // thin streaks along the travel direction, low alpha, gone within ~5 m
      float cs = vnoise(vec2(across * 3.4, ds * 0.42) + vec2(0.0, t * 0.15) + 21.0) * 0.6 + nB * 0.4;
      churnR = smoothstep(0.6, 0.7, cs) * (1.0 - smoothstep(0.0, 4.5, behind)) * 0.36 * strength;
    }
    foam = max(foam, max(lip, churnR));
    aer = max(aer, (1.0 - smoothstep(0.0, 4.0, abs(ds + 1.0))) * strength * 0.5);
  }

  // ---------------------------------------------------------------- wake
  float speedF = clamp(uBoatSpeed / 4.2, 0.0, 1.2);
  if (inWake) {
    float bestD = 1e6;
    float bestS = 0.0;
    float bestW = 0.0;
    for (int i = 0; i < WAKE_N - 1; i++) {
      vec4 A = uWake[i];
      vec4 B = uWake[i + 1];
      vec2 ab = B.xy - A.xy;
      float l2 = dot(ab, ab);
      float kr = l2 > 1e-4 ? dot(vWorld.xz - A.xy, ab) / l2 : 0.0;
      float k = clamp(kr, 0.0, 1.0);
      float d = length(vWorld.xz - (A.xy + ab * k));
      // s keeps running past the ends (ahead of the stern < 0, beyond the oldest point > arc)
      if (d < bestD) { bestD = d; bestS = mix(A.z, B.z, kr); bestW = mix(A.w, B.w, k); }
    }
    float arc = uWake[WAKE_N - 1].z;
    // nothing ahead of the transom (beside the hull the collar takes over) or past the oldest point
    float behind = smoothstep(-0.2, 0.7, uStern - lp.z) * smoothstep(-0.3, 0.4, bestS);
    float tail = 1.0 - smoothstep(-2.0, 0.0, bestS - arc);
    float W = clamp(bestW, 0.0, 1.0) * behind * tail;
    if (W > 0.002) {
      // prop wash: churned white water in the first 2–4 m behind the stern, broken by two
      // octaves of noise (threshold 0.5), so no soft solid region
      float halfW = 2.3 + bestS * 0.15;
      float washC = (1.0 - smoothstep(1.5, 4.0, bestS)) * (1.0 - smoothstep(halfW - 0.9, halfW + 0.1, bestD));
      float tb = vnoise(vec2(bestS * 3.0 - t * 1.1, bestD * 3.2 + t * 0.5)) * 0.6 + vnoise(vec2(bestS * 7.0 + t * 0.7, bestD * 7.5) + 17.0) * 0.4;
      float wash = aastep(0.5, tb + (washC - 0.8) * 0.4) * smoothstep(0.05, 0.4, washC);
      // a frothy trail of thin broken streaks along the path, thinning out over ~10 m
      float tr = vnoise(vec2(bestD * 3.0, bestS * 0.35 - t * 0.2) + 5.0);
      float trailF = smoothstep(0.64, 0.74, tr * 0.45 + nB * 0.55) * (1.0 - smoothstep(1.0, 2.0, bestD)) * (1.0 - smoothstep(3.0, 11.0, bestS)) * smoothstep(2.0, 4.0, bestS) * 0.28;
      // Kelvin arms (~19.5 deg): thin lacy lines fading linearly over ~30 m
      float armX = 2.5 + bestS * 0.354;
      float armHalf = 0.16 + bestS * 0.003;
      float wig = vnoise(vec2(bestS * 0.9, 3.0) + t * 0.2) - 0.5;
      float armOff = abs(bestD - armX + wig * 0.5);
      float armLine = 1.0 - smoothstep(armHalf * 0.4, armHalf, armOff);
      float armFade = smoothstep(1.0, 3.0, bestS) * clamp(1.0 - bestS / 30.0, 0.0, 1.0);
      float lace = vnoise(vec2(bestS * 1.7 - t * 0.3, bestD * 2.2) + 9.0) * 0.5 + nB * 0.5;
      float arm = armLine * armFade * aastep(0.4 + armOff / armHalf * 0.2, lace) * 0.85;
      foam = max(foam, max(max(wash, trailF), arm) * W);
      aer = max(aer, (washC * 0.9 + (1.0 - smoothstep(0.0, armHalf * 4.0, abs(bestD - armX))) * armFade * 0.3) * W);
      // churned water along the centreline behind the wash: a faint darker streak
      churn = (1.0 - smoothstep(0.8, 1.9 + bestS * 0.05, bestD)) * smoothstep(2.5, 5.0, bestS) * clamp(1.0 - bestS / 32.0, 0.0, 1.0) * W;
    }
  }

  // ---------------------------------------------------------------- hull contact
  // a lacy collar at the waterline (thin midships, widest at the bow, a little wider at the
  // stern) and a bow wave peeling off with speed
  float contact = 0.0;
  if (nearHull) {
    float bowF = smoothstep(3.0, uBow, lp.z);
    float sternF = 1.0 - smoothstep(uStern, uStern + 3.0, lp.z);
    // (thin at the stern: the wake takes over behind the transom)
    float cw = 0.12 + 0.55 * bowF + 0.25 * sternF + 0.12 * bowF * speedF + 0.2 * min(abs(uBoatHeave.x), 1.0) + 0.12 * rough;
    cw *= 0.3 + 1.3 * vnoise(vec2(lp.z * 0.45 + t * 0.12, sign(lp.x) * 7.0));   // laps unevenly along the hull
    float e = hullD;
    // lace sampled in the boat's plan (not along the distance to the hull, which would draw
    // contour bands parallel to the transom)
    float l1 = vnoise(lp.xz * 2.6 + vec2(0.0, t * (0.45 + speedF * 1.6)));
    float l2 = vnoise(mat2(0.8, 0.6, -0.6, 0.8) * lp.xz * 6.1 + vec2(t * 0.6, -t * 0.7) + 31.0);
    float lace = l1 * 0.6 + l2 * 0.4;
    float cov = 1.0 - smoothstep(cw * 0.35, cw, e);
    float collar = cov * aastep(0.55 - 0.12 * (1.0 - smoothstep(0.0, cw * 0.5, e)), lace);
    // bow wave: a broken band pushed out from the bow, fading toward midships
    float bowOff = (0.35 + 1.0 * speedF) * bowF;
    float bowBand = (1.0 - smoothstep(0.1, 0.3 + 0.25 * speedF, abs(e - bowOff))) * bowF * speedF;
    float bowWave = bowBand * aastep(0.5, lace);
    foam = max(foam, max(collar * (0.85 + 0.15 * speedF), bowWave * 0.8));
    aer = max(aer, max(cov * 0.5, bowBand) * 0.35);
    contact = 1.0 - smoothstep(0.0, 1.2, e);
  }
  foam = clamp(foam, 0.0, 1.0);
  aer = clamp(max(aer, freshC * 0.5), 0.0, 1.0);

  // ---------------------------------------------------------------- the boat's shadow
  // March from the water toward the sun up to rail height; inside the hull outline = shadowed.
  float shadow = 0.0;
  {
    vec3 Ls = mat3(uBoatInv) * L;
    if (Ls.y > 0.12 && abs(lp.x) < 16.0 && lp.z > uStern - 16.0 && lp.z < uBow + 16.0) {
      for (int k = 0; k < 3; k++) {
        float topY = k == 0 ? 0.9 : (k == 1 ? 1.8 : 2.7);  // bulwark rail, then the wheelhouse walls and roof
        vec3 q = lp + Ls * ((topY - lp.y) / Ls.y);
        float inside = hullHalf(q.z) - abs(q.x);
        float zin = smoothstep(uStern - 0.2, uStern + 0.4, q.z) * (1.0 - smoothstep(uBow - 0.6, uBow, q.z));
        if (k > 0) { inside = min(inside, 2.4 - abs(q.x)); zin *= smoothstep(-0.2, 0.3, q.z - 2.9) * (1.0 - smoothstep(-0.3, 0.2, q.z - 8.0)); }
        shadow = max(shadow, smoothstep(-0.6, 0.6, inside) * zin);
      }
    }
    shadow *= 0.4 * (1.0 - uSeaState.w * 0.6);
  }
  spec *= 1.0 - shadow;
  glitter *= 1.0 - shadow;
  sssA *= 1.0 - shadow;
  body *= 1.0 - shadow * 0.3;

  // ---------------------------------------------------------------- combine
  vec3 water = body * (1.0 - reflAmt) + refl * reflAmt;
  water += uSeaSub * sssA * (1.0 - foam);
  water = mix(water, water * 1.3 + uSeaSub * 0.05, aer * 0.45);
  water *= (1.0 - 0.1 * churn) * (1.0 - 0.25 * contact);
  water += (spec + glitter) * (1.0 - foam);
  // foam is plain sea-foam white, capped below pure white and lit by the low sun on the swell
  float foamLit = 0.55 + 0.45 * clamp(sunFace * 0.62, 0.0, 1.0);
  vec3 foamCol = uSeaFoam * foamLit * (0.93 + 0.07 * nB) * (1.0 - shadow * 0.4) * (1.0 - 0.15 * uSeaState.w);
  vec3 col = mix(water, foamCol, foam);

  // horizon haze
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float haze = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float haze = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    // the haze keeps the fog's warmth only toward the sun; away from it the far sea goes slate teal
    float toSun = smoothstep(0.1, 0.95, 0.5 + 0.5 * dot(normalize(-V.xz + 1e-4), normalize(L.xz + 1e-4)));
    col = mix(col, mix(uHaze * vec3(0.42, 0.62, 0.72), uHaze, toSun), haze);
  #endif

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // ±0.5/255 dither: no banding in the dark water and the haze on Low (8 bits straight out)
  gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;
