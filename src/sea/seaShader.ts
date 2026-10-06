/**
 * Sea shading (vertex + fragment GLSL for SeaMesh).
 *
 * The displacement is SEA_GLSL from waves.ts, untouched (gameplay floats on the CPU twin).
 * Everything here is look:
 *   - water body: deep → mid by crest height and view angle, lit by the low sun
 *   - Fresnel reflection of an analytic sky (zenith / horizon / sun glow from the look)
 *   - GGX sun highlight on 1–3 octaves of scrolling detail normals (faded by pixel footprint so
 *     they never alias) plus twinkling glints: the glittering sun path
 *   - subsurface glow through thin, sun-facing crests
 *   - foam: crisp, broken whitecaps on pinched crests with lacy trailing foam behind them,
 *     rogue crest foam, wind streaks in the storm, hull-contact foam and a frothy wake that
 *     follows the stern's recent path (V arms + turbulent prop wash)
 *   - horizon haze into the look's fog colour
 *
 * Defines (set by SeaMesh per quality tier):
 *   SEA_DETAIL  1 low | 2 medium | 3 high  (detail octaves, lacy foam, glints)
 *   WAKE_N      number of stern history points (polyline of WAKE_N - 1 segments)
 */
import { SEA_GLSL } from './waves';

export const SEA_VERT = /* glsl */ `
${SEA_GLSL}
uniform vec3 uFocus;
varying vec3 vWorld;
varying vec2 vGrid;
varying vec3 vNormal;
varying vec4 vFoam;   // x pinch now, y pinch one radian behind the crest (trailing foam), z rogue crest line, w rogue trailing foam
varying float vHeight;
#include <fog_pars_vertex>

// Trailing foam: the crest "one radian ago" for every wave, so foam lingers on the back of a crest
// after it passes. Same phases as seaDisplace(); shading only.
// Returns (trailing pinch of the swell, rogue back-of-crest band, the rogue's own pinch).
vec3 seaFoamTrail(vec2 p, float distFade) {
  float trail = 0.0;
  float rtrail = 0.0;
  float rpinch = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float fade = (i == 3) ? distFade : 1.0;
    float th = a.z * (a.x * p.x + a.y * p.y) - a.w * uTime + b.z;
    trail += a.z * b.y * fade * sin(th + 0.9);
  }
  if (uRogueB.x > 0.001) {
    float ds = uRogueA.x * p.x + uRogueA.y * p.y - uRogueA.w;
    float w = uRogueB.z;
    float A = uRogueB.x * exp(-(ds * ds) / (w * w));
    float u = uRogueA.z * ds;
    float kq = A * uRogueB.y * uRogueA.z;
    rpinch = kq * cos(u);
    // a broad band of churned water on the back of the rogue crest
    rtrail = smoothstep(0.55, 1.0, cos(u + 0.7)) * smoothstep(0.9, 2.2, A);
  }
  return vec3(trail, rtrail, rpinch);
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - uFocus.xz);
  float distFade = 1.0 - smoothstep(38.0, 75.0, dist);
  vec3 n; float pinch; float rc;
  vGrid = wp.xz;
  vec3 d = seaDisplace(wp.xz, distFade, n, pinch, rc);
  vec3 tr = seaFoamTrail(wp.xz, distFade);
  wp.xyz += d;
  vWorld = wp.xyz;
  vNormal = n;
  // whitecaps come from the swell's own pinch (the rogue draws its own crest line and churn;
  // a little of its steepness still brings out whitecaps on its face)
  vFoam = vec4(pinch - tr.z * 0.8, tr.x, rc, tr.y);
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
uniform vec3 uSunColor;     // colour × intensity
uniform vec3 uAmbient;      // sky fill
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform vec3 uHaze;
uniform vec3 uSeaDeep;
uniform vec3 uSeaMid;
uniform vec3 uSeaSub;
uniform vec3 uSeaFoam;
uniform vec4 uSeaParams;    // glitter, roughness, reflect, sun disc (rad)
uniform vec4 uSeaState;     // rough 0..1, max pinch (sum k*QA), crest height scale, storm-ness from the look
uniform vec3 uWind;         // dir x, dir z, strength 0..1
uniform vec4 uWake[WAKE_N]; // stern history: world x, z, arc length from the stern, strength
uniform vec4 uWakeBox;      // world xz bounds of the wake (min x, min z, max x, max z)
uniform vec2 uBoatHeave;    // vertical speed of the hull (m/s), 0
varying vec3 vWorld;
varying vec2 vGrid;
varying vec3 vNormal;
varying vec4 vFoam;
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
// value noise with analytic derivatives: (value, d/dx, d/dy)
vec3 noised(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * (vec2(k1, k2) + k4 * u.yx));
}
// marbled foam filaments: thin ridges along the 0.5 contour of two noise octaves
float marble(vec2 p) {
  float n = vnoise(p) * 0.65 + vnoise(p * 2.3 + 17.0) * 0.35;
  return 1.0 - abs(n * 2.0 - 1.0);
}

// Edge width for thresholded patterns, from the pixel footprint (set once at the top of main:
// fwidth() is undefined inside the per-fragment branches below, so it is not used there).
float gAA = 0.05;
float aastep(float t, float v) {
  return smoothstep(t - gAA, t + gAA, v);
}

// Foam with a crisp outline but a thin, see-through film at the edges and dense cores.
// c = coverage 0..1+, p = break-up pattern 0..1.
float foamLayer(float c, float p) {
  float th = 1.0 - c;
  return aastep(th, p) * (0.38 + 0.62 * smoothstep(th, th + 0.3, p));
}

float hullHalf(float z) {
  if (z <= uStern) return 2.85;
  if (z < uStern + 1.5) return mix(2.85, uHalfBeam, sin((z - uStern) / 1.5 * 1.5708));
  if (z <= 4.0) return uHalfBeam;
  if (z >= uBow) return 0.0;
  float t = (z - 4.0) / (uBow - 4.0);
  return uHalfBeam * pow(max(0.0, 1.0 - t * t), 0.6);
}

vec3 skyColor(vec3 R) {
  float h = clamp(R.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.5, pow(h, 0.8)));
  float sd = max(dot(R, uSunDirection), 0.0);
  c += uSkyGlow * (pow(sd, 5.0) * 0.45 + pow(sd, 40.0) * 0.8);
  return c;
}

void main() {
  // pixel footprint first (derivatives before any discard or branch)
  vec2 gp = vGrid;
  float px = max(length(fwidth(gp)), 1e-4); // metres per pixel
  gAA = clamp(px * 1.4, 0.004, 0.3);

  // Hide the sea inside the hull footprint (the deck-wash sheet handles green water on deck).
  vec3 lp = (uBoatInv * vec4(vWorld, 1.0)).xyz;
  float hw = hullHalf(lp.z);
  float edge = abs(lp.x) - hw;
  if (lp.z > uStern + 0.05 && lp.z < uBow - 0.05 && edge < -0.06 && lp.y < 0.6) discard;

  float t = uTime2;
  float rough = uSeaState.x;
  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;
  vec3 L = uSunDirection;
  vec3 Nm = normalize(vNormal);

  // wind frame: x along the wind, y across it
  vec2 wd = normalize(uWind.xy + vec2(1e-4, 0.0));
  vec2 wp2 = vec2(dot(gp, wd), dot(gp, vec2(-wd.y, wd.x)));

  // ---------------------------------------------------------------- detail normals
  vec2 slope = vec2(0.0);
  float chop = 1.0 + rough * 0.7;
  if (px * 0.42 < 0.45) {
    float f = 0.42;
    vec3 n = noised(gp * f + wd * (t * 0.18));
    slope += n.yz * f * 0.30 * (1.0 - smoothstep(0.12, 0.45, px * f));
  }
#if SEA_DETAIL >= 2
  if (px * 1.15 < 0.45) {
    float f = 1.15;
    vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * gp;
    vec3 n = noised(q * f - vec2(t * 0.31, t * 0.12));
    slope += (n.yz * mat2(0.8, -0.6, 0.6, 0.8)) * f * 0.085 * (1.0 - smoothstep(0.12, 0.45, px * f));
  }
#endif
#if SEA_DETAIL >= 3
  if (px * 3.1 < 0.45) {
    float f = 3.1;
    vec2 q = mat2(0.28, 0.96, -0.96, 0.28) * gp;
    vec3 n = noised(q * f + vec2(t * 0.55, -t * 0.2));
    slope += (n.yz * mat2(0.28, 0.96, -0.96, 0.28)) * f * 0.026 * (1.0 - smoothstep(0.12, 0.45, px * f));
  }
#endif
  slope *= chop;
  vec3 N = normalize(Nm + vec3(-slope.x, 0.0, -slope.y));

  // ---------------------------------------------------------------- water body
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float hN = vHeight / uSeaState.z;                      // ~ -1 trough … 1 crest
  float crest = smoothstep(-0.6, 1.0, hN);
  float NdLm = dot(Nm, L);
  float lambert = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 body = mix(uSeaDeep, uSeaMid, clamp(0.12 + crest * 0.7 + (1.0 - NdV) * 0.4, 0.0, 1.0));
  body *= 0.68 + 0.75 * lambert;
  body += uAmbient * uSeaMid * 0.1;

  // subsurface: light through thin, pinched crests between the viewer and the low sun
  float pn = vFoam.x / uSeaState.y;                      // crest pinch, 1 = all waves stacked
  vec2 Lh = normalize(L.xz + vec2(1e-4, 0.0));
  vec2 Vh = normalize(V.xz + vec2(1e-4, 0.0));
  float backlit = clamp(dot(-Lh, Vh) * 0.5 + 0.5, 0.0, 1.0);
  float facing = clamp(dot(Nm.xz, Vh) * 4.0 + 0.4, 0.0, 1.0);
  float thin = smoothstep(0.3, 1.0, hN) * smoothstep(0.25, 0.9, pn);
  vec3 sss = uSeaSub * thin * (0.08 + 0.4 * backlit * backlit) * facing;
  sss *= 0.6 + 0.4 * clamp(dot(uSunColor, vec3(0.3333)) / 1.6, 0.0, 1.5);

  // ---------------------------------------------------------------- sky reflection
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.02);
  vec3 refl = skyColor(normalize(R));
  float reflAmt = clamp(F * 2.2 + 0.05, 0.0, 1.0) * uSeaParams.z;

  // ---------------------------------------------------------------- sun: GGX + glints
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0);
  float NdL = max(dot(N, L), 0.0);
  float a = max(uSeaParams.y * uSeaParams.y, 0.002);
  a = sqrt(a * a + uSeaParams.w * uSeaParams.w * 0.25);  // sun disc widens the lobe
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float G = 1.0 / max(4.0 * max(NdL, 0.05) * max(NdV, 0.05), 1e-3);
  float sunUp = smoothstep(-0.02, 0.08, L.y);
  vec3 spec = uSunColor * (D * FH * G * NdL) * uSeaParams.x * sunUp;

  // glints: tiny facets twinkling inside a broad lobe around the mirror direction
  float broad = pow(max(dot(reflect(-L, N), V), 0.0), 22.0);
  float glint = 0.0;
  if (broad * uSeaParams.x > 0.003 && px < 0.1) {
    float cell = 0.14;
    vec2 cp = gp / cell + wd * t * 0.5;
    vec2 ci = floor(cp);
    vec2 cf = fract(cp) - 0.5;
    float h = hash12(ci);
    float rate = 0.8 + h * 1.7;
    float ph = fract(t * rate + h * 7.0);
    float tw = pow(sin(ph * PI), 4.0);
    float on = step(1.0 - (0.06 + 0.3 * broad) * uSeaParams.x, hash12(ci + floor(t * rate + h * 7.0) * 17.0));
    float r = length(cf + (hash22(ci) - 0.5) * 0.6);
    float dotS = 1.0 - smoothstep(0.05, 0.2, r);
    glint = on * tw * dotS * (1.0 - smoothstep(0.3, 0.7, px / cell));
  }
  vec3 glitter = uSunColor * broad * glint * 7.0 * uSeaParams.x * sunUp;

  // ---------------------------------------------------------------- foam
  float thr = mix(0.84, 0.58, rough);
  float freshC = smoothstep(thr, 1.0, pn);
  float trailC = smoothstep(thr + 0.02, 1.0, vFoam.y / uSeaState.y) * (1.0 - freshC * 0.5);
  // Where can foam show at all? (most calm water has none: skip the pattern noise there)
  bool inWake = all(greaterThan(vWorld.xz, uWakeBox.xy)) && all(lessThan(vWorld.xz, uWakeBox.zw));
  bool nearHull = edge < 4.0 && lp.z > uStern - 1.0 && lp.z < uBow + 1.0;
  bool needFoam = freshC > 0.0 || trailC > 0.0 || vFoam.z > 0.001 || vFoam.w > 0.001 || rough > 0.15 || inWake || nearHull;
  // patterns live in the undisplaced (Lagrangian) coordinates, so foam rides the orbital motion
  float nc = 0.5, nf = 0.5, nff = 0.5, pat = 0.5;
  if (needFoam) {
    nc = vnoise(wp2 * vec2(0.8, 0.3) + vec2(-t * 0.2, 0.0));   // stretched along the crests
    nf = vnoise(mat2(0.6, 0.8, -0.8, 0.6) * gp * 2.2 + vec2(t * 0.1, -t * 0.15));   // break-up (rotated lattice)
#if SEA_DETAIL >= 2
    nff = vnoise(mat2(0.94, -0.34, 0.34, 0.94) * gp * 5.3 - vec2(t * 0.25, 0.0));
    pat = nc * 0.45 + nf * 0.35 + nff * 0.2;
#else
    nff = nf;
    pat = nc * 0.55 + nf * 0.45;
#endif
  }
  // lace: thin filaments stretched along the wind
  float lace = 0.0;
  if (trailC > 0.001 || vFoam.w > 0.001) lace = smoothstep(0.88, 0.97, marble(wp2 * vec2(0.42, 1.25) + vec2(-t * 0.22, 0.0)));
  // fresh whitecap: a dense core with broken, crisp edges
  float foam = foamLayer(freshC * 0.85, pat * 0.75 + nff * 0.25);
  // the crest's wake: filaments only, thinning out
  foam = max(foam, lace * foamLayer(trailC * 1.1, nc * 0.6 + nf * 0.4) * 0.8);
#if SEA_DETAIL >= 2
  // old, dissolved foam marbling the whole sea (faint; more of it as the sea builds)
  if (px < 0.25 && rough > 0.12) {
    float old = smoothstep(0.93, 0.985, marble(wp2 * vec2(0.12, 0.42) + vec2(-t * 0.12, 3.0)));
    foam = max(foam, old * (0.035 + 0.22 * rough) * smoothstep(0.35, 0.65, nf));
  }
#endif
  // rogue: a thin white lip on the crest plus churned water on its back
  foam = max(foam, aastep(0.35, vFoam.z * (0.55 + 0.7 * pat)));
  foam = max(foam, vFoam.w * max(lace, aastep(0.62, pat)) * 0.9);
  // storm streaks along the wind
  // (thin lines, clustered in patches, never a regular grid)
  if (rough > 0.4) {
    float streakN = vnoise(wp2 * vec2(0.08, 2.4) + vec2(-t * 0.6, 0.0));
    float streakPatch = smoothstep(0.45, 0.8, vnoise(wp2 * vec2(0.03, 0.09) + 5.0));
    foam = max(foam, aastep(0.87, streakN) * streakPatch * smoothstep(0.4, 0.95, rough) * smoothstep(0.3, 0.6, nf) * 0.45);
  }

  // ---------------------------------------------------------------- wake
  float speedF = clamp(uBoatSpeed / 4.2, 0.0, 1.2);
  float aer = 0.0; // aerated (bubbly, lighter) water
  if (inWake) {
    float bestD = 1e6;
    float bestS = 0.0;
    float bestW = 0.0;
    for (int i = 0; i < WAKE_N - 1; i++) {
      vec4 A = uWake[i];
      vec4 B = uWake[i + 1];
      vec2 ab = B.xy - A.xy;
      float l2 = dot(ab, ab);
      float k = l2 > 1e-4 ? clamp(dot(vWorld.xz - A.xy, ab) / l2, 0.0, 1.0) : 0.0;
      vec2 q = A.xy + ab * k;
      float d = length(vWorld.xz - q);
      if (d < bestD) { bestD = d; bestS = mix(A.z, B.z, k); bestW = mix(A.w, B.w, k); }
    }
    // only behind the stern near the boat (beside the hull the hull foam takes over)
    float behind = max(smoothstep(-0.3, 1.2, uStern - lp.z), smoothstep(5.0, 9.0, bestS));
    bestW *= behind;
    if (bestW > 0.002) {
      float W = clamp(bestW, 0.0, 1.0);
      // path-aligned turbulence (stretched along the trail) mixed with world noise to break symmetry
      vec2 pc = vec2(bestS * 0.55 - t * 0.15, bestD * 1.4);
      float tb = vnoise(pc + vec2(0.0, t * 0.6)) * 0.55 + vnoise(pc * 2.3 - vec2(t * 0.4, 0.0)) * 0.3 + nff * 0.15;
      // prop wash: churned white water behind the transom, opening into a frothy trail
      float washW = 1.9 + bestS * 0.09;
      float wash = (1.0 - smoothstep(washW * 0.2, washW, bestD)) * exp(-bestS / 17.0);
      float boil = 1.0 - smoothstep(0.0, 4.0, bestS);    // right at the transom it is all white
      float washFoam = foamLayer(wash * (0.72 + 0.4 * boil), tb * 0.85 + nf * 0.15);
      // Kelvin arms (~19.5 deg) spreading behind: broken dashes of foam on a lighter band
      float armX = 2.6 + bestS * 0.34;
      float armW = 0.3 + bestS * 0.03;
      float armBand = 1.0 - smoothstep(0.0, armW * 2.2, abs(bestD - armX));
      float arm = (1.0 - smoothstep(0.0, armW, abs(bestD - armX))) * exp(-bestS / 18.0) * smoothstep(0.5, 3.0, bestS);
      float dash = vnoise(vec2(bestS * 0.7, bestD * 0.3) + 11.0);
      float armFoam = foamLayer(arm * (0.55 + 0.6 * dash), nf * 0.5 + nff * 0.5);
      foam = max(foam, (washFoam * 0.92 + armFoam * 0.75 * (1.0 - washFoam)) * W);
      aer = max(aer, (wash * 1.1 + armBand * exp(-bestS / 22.0) * smoothstep(0.5, 3.0, bestS) * 0.45) * W);
    }
  }
  // hull contact: a broken white collar at the waterline, a bow wave peeling off with speed
  if (nearHull) {
    float inHull = step(uStern - 0.3, lp.z) * step(lp.z, uBow + 0.6);
    float bow = smoothstep(2.0, uBow, lp.z);
    // the collar laps: its width breathes along the hull and with the hull's heave
    float lapN = vnoise(vec2(lp.z * 0.9 - t * 0.7, t * 0.35));
    float collarW = (0.18 + 0.3 * bow * speedF + 0.3 * abs(uBoatHeave.x) + rough * 0.2) * (0.55 + 0.9 * lapN);
    float e = max(edge, 0.0);
    float collar = (1.0 - smoothstep(0.0, collarW, e)) * inHull;
    // bow wave: a band pushed outward from the bow, fading toward midships
    float bowBand = (1.0 - smoothstep(0.0, 0.35 + 0.4 * speedF, abs(e - (0.3 + 1.2 * speedF) * bow))) * bow * speedF * inHull;
    float c = max(collar * (0.5 + 0.3 * speedF + rough * 0.25), bowBand * 0.85);
    // froth streaked along the hull, sliding aft with the boat's way
    float hs = vnoise(vec2(lp.z * 2.2 + t * (0.3 + speedF * 2.0), e * 4.5 - t * 0.6));
    foam = max(foam, foamLayer(c, hs * 0.55 + nff * 0.45));
    aer = max(aer, max(collar, bowBand) * 0.7 * inHull * (1.0 - smoothstep(0.0, 1.6, e - collarW)));
  }
  foam = clamp(foam, 0.0, 1.0);

  // foam halo: aerated water around whitecaps reads lighter and greener
  aer = clamp(max(aer, max(freshC, trailC * 0.5) * 0.6), 0.0, 1.0);

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
        shadow = max(shadow, smoothstep(-0.25, 0.35, inside) * zin);
      }
    }
    shadow *= 0.85 * (1.0 - uSeaState.w * 0.6);
  }
  spec *= 1.0 - shadow;
  glitter *= 1.0 - shadow;
  sss *= 1.0 - shadow;
  body *= 1.0 - shadow * 0.28;

  // ---------------------------------------------------------------- combine
  vec3 water = body * (1.0 - reflAmt) + refl * reflAmt + sss;
  water = mix(water, water * 0.45 + uSeaSub * 0.45 + uSeaMid * 0.4 + uSeaFoam * 0.03, aer * 0.55);
  water += (spec + glitter) * (1.0 - foam);
  float foamLit = 0.62 + 0.3 * clamp(NdLm * 0.5 + 0.5, 0.0, 1.0);
  vec3 foamCol = uSeaFoam * foamLit * (vec3(0.82) + uSunColor * 0.06 + uAmbient * 0.08);
  foamCol *= 0.9 + 0.1 * nff; // a little tone in the foam
  vec3 col = mix(water, foamCol, clamp(foam, 0.0, 1.0) * 0.97);

  // horizon haze
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float haze = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float haze = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, uHaze, haze);
  #endif

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
