/**
 * Sea shading (vertex + fragment GLSL for SeaMesh).
 *
 * The displacement is SEA_GLSL from waves.ts, untouched (gameplay floats on the CPU twin).
 * Everything here is look:
 *   - water body: deep → mid by crest height over a wide ramp, plus the low sun on the relief
 *     normal: the swell's own normal, exaggerated, plus shading-only swell rows (short-crested
 *     trains of 1.75-4.9 m fanned around the wind, sharp crests and flat troughs) and a faint chop
 *     from the baked slope map at 23 m and 14 m tiles; so the sea reads in rows from overhead: lit
 *     backs, dark troughs and a thin bright lip along each crest
 *   - Fresnel reflection of an analytic sky (zenith / horizon / sun glow from the look, the warm
 *     horizon paled toward silver-cream so the sun side never turns sepia)
 *   - the sun: a capped GGX sheen on the relief normal (pale gold highlights on the faces that
 *     mirror it, blue water between) and discrete sparkles: one random facet per world cell,
 *     re-rolled a few times a second, flashing only when it mirrors the sun into the eye and only
 *     near a crest top, so they string out along the crest lips inside the sun path; cells grow
 *     with distance (no aliasing)
 *   - subsurface glow in thin bands just under sharp, back-lit crests (faint, never a halo)
 *   - foam, all of it feathered (no stencil edges): sparse whitecaps on some crests even in calm
 *     water, soft wind-stretched streaks behind them, sparse storm streaks along the wind (kept
 *     clear of buoys and the hull), a lit and broken rogue lip with churned water behind it, a
 *     frothy hull collar (a dense line at the waterline breaking up into holes and clumps, its
 *     width lapping along the hull, two to three times wider at the bow shoulders and stern
 *     quarters), a bow wave peeling off the stem with speed, and a wake that follows the stern's
 *     recent path: a bright, dense prop-wash core behind the transom breaking into streaky
 *     turbulence along the path and scattered patches, Kelvin arms, a darker centreline
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
uniform vec4 uSeaLight;     // sun strength vs golden hour 0..1, swell-form gain, sun luminance, chop relief
uniform vec3 uWind;         // dir x, dir z, strength 0..1
uniform vec4 uWake[WAKE_N]; // stern history: world x, z, arc length from the stern, strength
uniform vec4 uWakeBox;      // world xz bounds of the wake (min x, min z, max x, max z)
uniform vec2 uBoatHeave;    // vertical speed of the hull (m/s), 0
uniform vec4 uMarkers[MARKERS_N]; // floating things: world x, z, clear radius, on
uniform vec4 uRogueA;       // rogue: dirX, dirZ, k, s0 (shared with SEA_GLSL)
uniform vec4 uRows;         // swell rows: slope gain, crest-line strength, speed scale, 0
uniform float uWakeOdo;     // metres the stern has travelled (wrapped): world-fixed wake streaks
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

// Foam with a soft, feathered rim and denser cores (no stencil edge): the rim fades in over
// "feather" of the pattern's range (never less than the pixel footprint), the core over a little
// more. c = coverage 0..1+, p = break-up pattern 0..1.
float foamLayer(float c, float p, float feather) {
  float th = 1.0 - c;
  float f = max(feather, gAA);
  // (no coverage, no foam: a wide feather must not reach the pattern's peaks on its own)
  return smoothstep(th - f, th + f, p) * (0.5 + 0.5 * smoothstep(th, th + f * 2.5, p)) * smoothstep(0.0, 0.25, c);
}

// (Low draws no bloom or tilt-shift to soften them: a little dimmer)
#if SEA_DETAIL >= 2
  #define SPARK_TOL 0.06
  #define SPARK_GAIN 6.0
#else
  #define SPARK_TOL 0.04
  #define SPARK_GAIN 3.6
#endif
// One facet per cell (cell size in metres), re-rolled 0.5-1.5 times a second: 0..1 where it mirrors
// the sun (its random tilt matches need, the slope it must add to the relief normal), a round
// dot at a random spot in the cell, at least about two pixels across, fading in and out.
float sparkle(vec2 p, vec2 need, float cell, float px, float t) {
  vec2 cp = p / cell;
  vec2 ci = floor(cp);
  float h = hash12(ci);
  float k = t * (0.5 + h) + h * 9.0;
  float ep = floor(k);
  // (triangular in each axis: most facets sit near the relief normal, so the sparkles crowd the
  // swell faces that already mirror the sun and thin out across the path)
  vec2 tilt = (hash22(ci + ep * 17.31) + hash22(ci * 1.31 + ep * 7.77 + 5.0) - 1.0) * 0.32;
  float match = 1.0 - smoothstep(SPARK_TOL * 0.5, SPARK_TOL, length(tilt - need));
  if (match <= 0.0) return 0.0;
  vec2 pos = (hash22(ci * 1.7 + ep * 5.3 + 3.1) - 0.5) * 0.5;
  float r = length(fract(cp) - 0.5 - pos) * cell;
  float rad = max(cell * 0.15, px * 2.0);
  float life = sin(fract(k) * PI);
  return match * (1.0 - smoothstep(rad * 0.3, rad, r)) * life * life;
}

// Froth: value noise in two octaves (three on High) with fine bubbles, 0..1. p in metres.
float froth(vec2 p) {
  float n = vnoise(p) * 0.55 + vnoise(mat2(0.8, 0.6, -0.6, 0.8) * p * 2.3 + 17.0) * 0.3;
#if SEA_DETAIL >= 3
  n += vnoise(mat2(0.6, -0.8, 0.8, 0.6) * p * 5.1 + 41.0) * 0.15;
#else
  n += 0.075;
#endif
  return n;
}

// Swell rows (shading only). The geometry's Gerstner swell is long and gentle: from the overhead
// camera it read as soft, directionless mottling. These are ROWS_N short-crested trains a few
// metres long, fanned around the wind, each a raised sine (sharp crests, broad flat troughs)
// whose crests bend and break into lengths of a few wavelengths, so the sea reads in rows: lit
// backs, dark troughs and a thin bright edge along each crest.
//   xy: slope (world xz), z: height (~-0.6 trough .. 1 crest), w: crest line 0..1, just past the
//   top on the face the wave runs toward; top: 0..1 near a crest top (the sparkles gather there)
#if SEA_DETAIL >= 3
  #define ROWS_N 4
#elif SEA_DETAIL >= 2
  #define ROWS_N 3
#else
  #define ROWS_N 2
#endif
vec4 swellRows(vec2 p, vec2 w, float t, float px, out float top) {
  vec2 sl = vec2(0.0);
  float h = 0.0;
  float line = 0.0;
  top = 0.0;
  for (int i = 0; i < ROWS_N; i++) {
    float fi = float(i);
    float ang = i == 0 ? 0.12 : (i == 1 ? -0.5 : (i == 2 ? 0.66 : -0.22));
    float lam = i == 0 ? 3.4 : (i == 1 ? 2.5 : (i == 2 ? 4.9 : 1.75));
    float amp = i == 0 ? 1.0 : (i == 1 ? 0.8 : (i == 2 ? 0.7 : 0.5));
    vec2 dir = vec2(cos(ang) * w.x - sin(ang) * w.y, sin(ang) * w.x + cos(ang) * w.y);
    float al = dot(p, dir);
    float ac = dot(p, vec2(-dir.y, dir.x));
    float k = 6.2832 / lam;
    // crests bend and break into lengths of a few wavelengths; fade before they alias
    float bend = (vnoise(vec2(ac / (lam * 1.3), al / (lam * 3.0)) + fi * 7.31) - 0.5) * 2.0;
    float env = smoothstep(0.3, 0.75, vnoise(vec2(ac / (lam * 1.15), al / (lam * 1.3)) + fi * 19.13 + vec2(0.0, t * 0.03)));
    float a = amp * env * (1.0 - smoothstep(lam * 0.06, lam * 0.16, px));
    float ph = k * al - sqrt(9.81 * k) * uRows.z * t + fi * 2.13 + bend;
    float u = 0.5 + 0.5 * sin(ph);
    sl += dir * (a * 1.5 * u * u * cos(ph));
    h += a * (u * u * u - 0.31);
    // the crest's lit lip: rising over the back toward the top and ending crisply just past it
    // (about a sixth of the wavelength; the crisp edge never under ~2 px)
    float dp = mod(ph - 1.75 + PI, 2.0 * PI) - PI;
    float ew = max(0.22, px * k * 2.0);
    // (broken into dashes along the crest: not one long silky fold)
    float dash = smoothstep(0.32, 0.62, vnoise(vec2(ac / (lam * 0.55), al / lam) + fi * 3.7 + 50.0));
    line = max(line, a * dash * smoothstep(-1.0, -0.05, dp) * (1.0 - smoothstep(0.0, ew, dp)));
    top = max(top, a * smoothstep(0.65, 0.93, u));
  }
  return vec4(sl, h, line);
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
// faces tilted toward the sun don't reflect smooth cream smears. Both are paled toward a silvery
// cream: the sky's own orange, laid over blue water, went muddy sepia.
vec3 pale(vec3 c, float k) {
  return mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))) * vec3(1.06, 1.0, 0.92), k);
}
vec3 skyColor(vec3 R, float brk) {
  float h = clamp(R.y, 0.0, 1.0);
  float sunSide = 0.5 + 0.5 * dot(normalize(R.xz + 1e-4), normalize(uSunDirection.xz + 1e-4));
  vec3 warm = pale(uSkyHorizon, 0.5);
  vec3 hor = mix(mix(warm, uSkyZenith, 0.92), warm, smoothstep(0.35, 1.0, sunSide));
  vec3 c = mix(hor, uSkyZenith, smoothstep(0.0, 0.5, pow(h, 0.8)));
  float sd = max(dot(R, uSunDirection), 0.0);
  c += pale(uSkyGlow, 0.4) * (pow(sd, 5.0) * 0.2 * mix(0.3, 1.0, smoothstep(0.45, 0.75, brk)) + pow(sd, 40.0) * 0.4);
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

  // Swell relief, for the shading only: the same slope map twice more at 23 m and 14 m tiles,
  // steep enough that a choppy sea's lit backs and dark troughs read from the overhead camera
  // (the geometry and the gameplay surface are untouched). B holds the height: troughs darker.
  vec2 chop;
  float chopH;
  {
    // (squeezed across the wind, so the chop runs in long crests rather than round blotches)
    vec2 q = wp2 * vec2(1.0, 0.6);
    mat2 r4 = mat2(0.94, 0.34, -0.34, 0.94);
    vec3 c4 = texture2D(uDetail, (r4 * q) * (1.0 / 23.0) + vec2(-t * 0.021, t * 0.007)).rgb;
    mat2 r5 = mat2(0.91, -0.42, 0.42, 0.91);
    vec3 c5 = texture2D(uDetail, (r5 * q) * (1.0 / 14.0) + vec2(-t * 0.03, -t * 0.012) + 0.37).rgb;
    chop = (((c4.rg * 2.0 - 1.0) * r4) * 0.62 + ((c5.rg * 2.0 - 1.0) * r5) * 0.38) * vec2(1.0, 0.6);
    chopH = c4.b * 0.62 + c5.b * 0.38;
  }
  chop = (chop.x * wd + chop.y * wn) * uSeaLight.w;
  // swell rows (see swellRows): the directional relief the overhead camera reads
  float rowTop;
  vec4 rows = swellRows(gp, wd, t, px, rowTop);
  vec2 rowSl = rows.xy * uRows.x;

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
  vec3 dC = vec3(-chop.x - rowSl.x, 0.0, -chop.y - rowSl.y);
  // the relief normal: swell, rows and chop (body light, the sun's sheen, the sparkles' facets)
  vec3 Nrel = normalize(Nmac + dC);
  vec3 Nd = normalize(Nmac + dC + dN * 0.8);

  // ---------------------------------------------------------------- water body
  float NdV = clamp(dot(Nd, V), 0.0, 1.0);
  float hN = vHeight / uSeaState.z;                      // ~ -1 trough … 1 crest
  float ramp = clamp(smoothstep(-1.15, 1.15, hN) * 0.8 + (chopH - 0.5) * 0.6 * uSeaLight.w / 0.2 + rows.z * 0.18 * uRows.y + (1.0 - NdV) * 0.22, 0.0, 1.0);
  vec3 body = mix(uSeaDeep, uSeaMid, ramp);
  // dark troughs between the rows
  body *= 1.0 - 0.3 * uRows.y * (1.0 - smoothstep(-0.55, 0.15, rows.z));
  // the low sun on the swell and chop: lit backs (warmed by the sun), dark troughs
  float sunFace = clamp(dot(Nrel, L) / max(L.y, 0.2), 0.0, 2.6);   // 1 on flat water
  float sunK = 0.8 * uSeaLight.x * (sunFace - 1.0);
  sunK = sunK > 0.0 ? sunK / (1.0 + 0.5 * sunK) : max(sunK, -0.55);
  body *= 1.0 + sunK * (sunK > 0.0 ? mix(vec3(1.0), uSpecTint, 0.5) : vec3(1.0));

  // subsurface: thin bands of light just under sharp crests, between the viewer and the sun
  float pn = vFoam.x / uSeaState.y;                      // crest pinch, 1 = all waves stacked
  vec2 Vh = normalize(V.xz + vec2(1e-4, 0.0));
  // (hN 0.8 = 0.65 of the summed amplitude; only sharp crests, only their face toward the viewer)
  float crestBand = smoothstep(0.8, 0.95, hN) * (1.0 - smoothstep(1.1, 1.3, hN));
  float thin = crestBand * smoothstep(0.5, 0.9, pn) * smoothstep(0.03, 0.1, dot(Nm.xz, Vh));
  float backlit = pow(clamp(dot(V, -L + Nm * 0.3), 0.0, 1.0), 4.0);
  float sssA = min(0.16, thin * backlit * 1.2) * (0.4 + 0.6 * uSeaLight.x);

  // ---------------------------------------------------------------- sky reflection
  // (the reflection sees the true swell plus most of the ripples: the sky breaks up into facets
  // instead of mirroring in big smooth patches; capped so the far sea never turns to milk)
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, normalize(Nm + dC + dN * 0.8));
  R.y = max(R.y, 0.02);
  // break-up noise in undisplaced coordinates (reused by the foam below)
  float nB = vnoise(mat2(0.8, 0.6, -0.6, 0.8) * gp * 3.3 + vec2(t * 0.1, -t * 0.12));
  vec3 refl = skyColor(normalize(R), nB);
  float reflAmt = clamp(F * 1.3 + 0.03, 0.0, 0.45) * uSeaParams.z;

  // ---------------------------------------------------------------- sun: sheen + sparkles
  // A soft warm sheen along the sun path that follows the swell relief (a wide lobe, capped low,
  // so the path never washes out to cream), and discrete sparkles: tiny facets that mirror the
  // sun into the eye for a moment.
  vec3 H = normalize(L + V);
  float sunUp = smoothstep(-0.02, 0.08, L.y);
  float sunAmt = uSeaParams.x * sunUp * uSeaLight.z;
  vec3 Nsh = normalize(Nrel + dN * 0.9);
  float NdH = max(dot(Nsh, H), 0.0);
  float NdL = max(dot(Nsh, L), 0.0);
  float NdVs = max(dot(Nsh, V), 0.0);
  float a = max(uSeaParams.y * uSeaParams.y, 0.002);
  // the sun's disc, the ripples left out of the sheen and the ones lost to the mips widen the lobe
  a = sqrt(a * a + uSeaParams.w * uSeaParams.w * 0.25 + px * px * 0.03 + 0.007);
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  float G = 1.0 / max(4.0 * max(NdL, 0.05) * max(NdVs, 0.05), 1e-3);
  float specI = D * FH * G * NdL * sunAmt;
  // (gold highlights on the faces that mirror the sun, blue water between them: a narrower lobe
  // with brighter peaks than before, when a broad, dim one tinted the whole path khaki)
  vec3 spec = uSpecTint * (0.62 * specI / (1.0 + 0.6 * specI));

  // Sparkles: each cell of a world grid holds one facet, re-rolled a few times a second, tilted at
  // random (up to ~17 deg) around the relief normal. It flashes only if it mirrors the sun into
  // the eye, and only near a crest top of the swell rows, so the sparkles string out along the
  // crest lips inside the sun path and thin out toward its edges: few, bright, discrete points
  // (not dust over the whole lit half). Cells grow with distance (two octaves blended) so a
  // sparkle never shrinks under a pixel or aliases.
  float glint = 0.0;
  vec2 need = H.xz / max(H.y, 0.05) - Nrel.xz / max(Nrel.y, 0.05);
  // (far out, where the rows have faded under the pixel footprint, a sparse scatter stays)
  float onCrest = max(smoothstep(0.15, 0.55, rowTop), 0.3 * smoothstep(0.35, 0.9, px));
  if (sunAmt > 0.05 && onCrest > 0.0 && dot(need, need) < 0.16) {
    float lod = log2(max(px * 6.0 / 0.26, 1.0));
    float l0 = floor(lod);
    float c0 = 0.26 * exp2(l0);
    glint = sparkle(gp, need, c0, px, t);
#if SEA_DETAIL >= 2
    glint = mix(glint, sparkle(gp + 31.7, need, c0 * 2.0, px, t), lod - l0);
#endif
  }
  // (brightest in the core of the path, fading toward its edges)
  glint *= onCrest * (1.0 - smoothstep(0.08, 0.38, length(need)));
  vec3 glitter = uSpecTint * glint * sunAmt * SPARK_GAIN;

  // ---------------------------------------------------------------- foam
  float thr = mix(0.6, 0.56, rough);
  // whitecaps spill down the front (downwind) face of the crest: a thin band, not a blob. Only
  // some crests break: a slow, sparse mask scatters them in calm water and lifts as the sea builds
  float capMask = smoothstep(0.56 - 0.45 * rough, 0.72 - 0.45 * rough, vnoise(gp * 0.08 + vec2(t * 0.035, -t * 0.02) + 11.0));
  // (on a rogue's slopes its own lip and churn take over)
  float offRogue = 1.0 - 0.75 * smoothstep(0.3, 1.1, vRogue.y);
  // (the crest itself and its downwind face, the slope measured against the sea state's own:
  // in a calm sea the slopes are tiny and an absolute threshold left no whitecaps at all)
  float front = smoothstep(-0.15, 0.25, dot(Nm.xz, wd) / uSeaState.y);
  float freshC = smoothstep(thr, thr + 0.3, pn) * front * capMask * offRogue;
  float trailC = smoothstep(thr - 0.03, 1.0, vFoam.y / uSeaState.y) * (1.0 - freshC);
  bool inWake = all(greaterThan(vWorld.xz, uWakeBox.xy)) && all(lessThan(vWorld.xz, uWakeBox.zw));
  float speedF = clamp(uBoatSpeed / 4.2, 0.0, 1.2);
  bool nearHull = hullD < 3.0 + 2.5 * speedF;
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
  // (a bright core with a feathered rim, softer with distance: crisp, never a paper cut-out)
  if (freshC > 0.0) {
    // frothy breakup (several octaves, stretched along the crest), not single-noise contours
    float capP = froth(wp2 * vec2(2.4, 0.9) + vec2(-t * 0.3, 0.0)) * 0.75 + nB * 0.25;
    // (a wide feather, wider far away, and holes through the body: never a hard white lozenge)
    float capF = foamLayer(freshC * 0.75, capP, 0.13 + min(px * 0.5, 0.15));
    capF *= 1.0 - 0.6 * smoothstep(0.5, 0.75, vnoise(wp2 * vec2(4.5, 2.2) + vec2(-t * 0.4, 23.0)));
    foam = capF * 0.88 * (0.4 + 0.6 * clearMask);
  }
  // the crest's wake: thin, broken streaks stretched along the wind (no filaments, no blobs)
  // (A single octave of value noise, anisotropic and lattice-aligned to the wind, used to draw
  // these: wherever the surface is seen face-on, like the steep back of a rogue, its straight
  // parallel streaks lined up into a comb of vertical stripes. They are now frothy, from rotated
  // octaves that never line up, and left to the rogue's own churn on its slopes.)
  float trailOK = 1.0 - smoothstep(0.3, 1.1, vRogue.y);
  if (trailC > 0.0 && trailOK > 0.0) {
    // (only ~2:1 along the wind and broken by a second pattern: at 4:1 they read as smeared
    // scratches once tilt-shift softened them)
    float st = froth(wp2 * vec2(0.7, 1.4) + vec2(-t * 0.12, 7.0));
    float streak = smoothstep(0.62, 0.84, st * 0.85 + nB * 0.15) * smoothstep(0.35, 0.65, vnoise(wp2 * 0.6 + 19.0));
    foam = max(foam, streak * smoothstep(0.0, 0.6, trailC) * 0.2 * clearMask * trailOK);
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
    float lip = smoothstep(0.44, 0.56, rn + 0.38 * cov - 0.23) * lead * strength;
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
      // Streaky turbulence along the path, never cells or lace: noise stretched ~5:1 along the
      // wake and bent by a warp, sampled at a world-fixed distance along the path (the odometer
      // less the arc length), so the streaks stay put in the water as the boat moves on.
      float sw = uWakeOdo - bestS;
      float halfW = 2.3 + bestS * 0.15;
      float acr = bestD / halfW;
      float warp = vnoise(vec2(sw * 0.3, bestD * 0.6) + 3.0) - 0.5;
      float stA = vnoise(vec2(bestD * 1.7 + warp * 2.8, sw * 0.34) + 5.0);
      float stB = vnoise(vec2(bestD * 3.8 + warp * 3.6, sw * 0.8 - t * 0.2) + 17.0);
      float streak = stA * 0.62 + stB * 0.38;
      // (and torn open into dark gaps as it spreads: churned, not combed)
      float gaps = smoothstep(0.5, 0.74, vnoise(vec2(bestD * 1.1 + warp, sw * 0.55) + 29.0)) * smoothstep(2.5, 8.0, bestS);
      // the prop wash right behind the transom: a bright, dense core of churned white water,
      // boiling in the boat's own frame
      float coreC = (1.0 - smoothstep(0.5, 3.0 + 1.5 * speedF, bestS)) * (1.0 - smoothstep(0.45, 0.95, acr));
      float boil = froth(vec2(bestD * 1.8 + warp * 2.0, bestS * 1.0 - t * 2.0) + 3.0);
      float core = foamLayer(coreC, boil * 0.55 + streak * 0.45, 0.14);
      // (boiling open as it leaves the transom)
      core *= 1.0 - 0.55 * smoothstep(0.52, 0.78, vnoise(vec2(bestD * 2.4, bestS * 1.2 - t * 1.5) + 61.0)) * smoothstep(0.8, 3.0, bestS);
      // further back: streaks along the path, thinning out over ~16 m
      float midC = (1.0 - smoothstep(4.0, 15.0, bestS)) * (1.0 - smoothstep(0.35, 0.85, acr)) * 0.56;
      float mid = foamLayer(midC, streak, 0.12) * 0.88;
      // and scattered patches drifting apart, gone by ~28 m
      float patC = (1.0 - smoothstep(9.0, 28.0, bestS)) * (1.0 - smoothstep(0.55, 1.4, acr)) * 0.32;
      float patN = vnoise(vec2(bestD * 0.8 + warp * 1.5, sw * 0.3) + 41.0) * 0.6 + stB * 0.4;
      float patches = foamLayer(patC, patN, 0.1) * (0.35 + 0.35 * smoothstep(0.4, 0.7, streak));
      float wash = max(core, max(mid, patches)) * (1.0 - 0.7 * gaps);
      // Kelvin arms (~19.5 deg): soft broken lines fading linearly over ~30 m
      float armX = 2.5 + bestS * 0.354;
      float armHalf = 0.2 + bestS * 0.004;
      float wig = vnoise(vec2(sw * 0.9, 3.0)) - 0.5;
      float armOff = abs(bestD - armX + wig * 0.5);
      float armLine = 1.0 - smoothstep(0.0, armHalf, armOff);
      float armFade = smoothstep(1.0, 3.0, bestS) * clamp(1.0 - bestS / 30.0, 0.0, 1.0);
      float lace = vnoise(vec2(sw * 0.6, bestD * 0.9) + 9.0) * 0.5 + nB * 0.5;
      float arm = armLine * armFade * smoothstep(0.38, 0.72, lace) * 0.5;
      foam = max(foam, max(wash, arm) * W);
      aer = max(aer, (coreC * 0.9 + midC * 0.4 + (1.0 - smoothstep(0.0, armHalf * 4.0, abs(bestD - armX))) * armFade * 0.3) * W);
      // churned water along the centreline behind the wash: a faint darker streak
      churn = (1.0 - smoothstep(0.8, 1.9 + bestS * 0.05, bestD)) * smoothstep(2.5, 5.0, bestS) * clamp(1.0 - bestS / 32.0, 0.0, 1.0) * W;
    }
  }

  // ---------------------------------------------------------------- hull contact
  // a lacy collar at the waterline (thin midships, widest at the bow, a little wider at the
  // stern) and a bow wave peeling off with speed
  float contact = 0.0;
  if (nearHull) {
    float e = hullD;
    float bowF = smoothstep(3.0, uBow, lp.z);
    float sternF = 1.0 - smoothstep(uStern, uStern + 2.5, lp.z);
    float heave = min(abs(uBoatHeave.x), 1.0);
    // Frothy churn hugging the waterline: a dense bright line right at the hull, breaking up into
    // holes and loose clumps away from it. Its width laps along the hull at two scales (never an
    // even outline) and is two to three times wider, and brighter, where the hull shoves the
    // water hardest: the bow shoulders and the stern quarters. Wider with speed, heave and a rough
    // sea. Froth is sampled in the boat's plan (no contour bands along the transom) and streams
    // aft with speed.
    float shoulder = smoothstep(uBow - 8.5, uBow - 5.0, lp.z) * (1.0 - 0.35 * smoothstep(uBow - 1.5, uBow, lp.z));
    float quarter = 1.0 - smoothstep(uStern + 1.8, uStern + 4.5, lp.z);
    float wide = max(shoulder, quarter);
    float side = lp.x > 0.0 ? 7.0 : 0.0;
    float lap = vnoise(vec2(lp.z * 0.42 + t * 0.12, side)) * 0.62 + vnoise(vec2(lp.z * 1.35 - t * 0.22, side + 3.0)) * 0.38;
    float cw = (0.22 + 0.55 * wide) * (1.0 + 0.7 * speedF + 0.35 * heave + 0.25 * rough) * (0.35 + 1.3 * lap);
    vec2 fp = lp.xz * vec2(2.2, 1.5) + vec2(0.0, t * (0.35 + speedF * 2.4));
    float fr = froth(fp + vec2(t * 0.07, 0.0));
    // (the edge is ragged at a coarser scale too)
    float rag = vnoise(lp.xz * vec2(0.9, 0.55) + vec2(0.0, t * (0.2 + speedF)) + 23.0);
    float k = e / (cw * (0.6 + 0.8 * rag));                   // 0 at the hull, 1 at the collar's edge
    float cov = pow(1.0 - smoothstep(0.0, 1.0, k), 1.3) * (0.7 + 0.3 * wide);
    float collar = foamLayer(cov * 0.95, fr, 0.13 + 0.1 * min(k, 1.0));
    // bubbles and holes open up quickly away from the waterline: churn, not a solid cushion
    float holes = smoothstep(0.45, 0.72, vnoise(fp * 2.7 + vec2(-t * 0.25, 50.0)));
    collar *= 1.0 - 0.85 * holes * smoothstep(0.05, 0.4, k);
    // (thinner, see-through froth in its body: a lacy texture rather than flat white)
    collar *= 0.78 + 0.22 * smoothstep(0.3, 0.7, vnoise(fp * 4.2 + 13.0)) + 0.22 * (1.0 - smoothstep(0.0, 0.25, k));
    // loose, lacy clumps shed off the shoulders and quarters, beyond the collar's edge
    float clumpC = wide * smoothstep(0.6, 1.1, k) * (1.0 - smoothstep(1.1, 2.1, k)) * 0.45;
    float clump = foamLayer(clumpC, froth(fp * 1.3 + 31.0), 0.16);
    clump *= 1.0 - 0.75 * smoothstep(0.45, 0.7, vnoise(fp * 3.4 + 7.0));
    collar = max(collar, clump * 0.75);
    // the waterline itself: a thin, dense, lapping line
    float line = (1.0 - smoothstep(0.03, 0.12 + 0.12 * wide, e)) * (0.65 + 0.35 * fr);
    collar = max(collar, line);
    // bow wave: as the boat makes way, a white crest peels off the stem, angled aft and out
    // (about 20 degrees), with churned froth between it and the hull; it fans out and fades
    // toward midships
    float bowWave = 0.0;
    if (speedF > 0.02) {
      float aft = uBow - lp.z;                                // metres aft of the stem
      float bowZone = smoothstep(-0.4, 0.3, aft) * (1.0 - smoothstep(4.0, 9.0 + 3.0 * speedF, aft));
      float off = 0.15 + aft * (0.22 + 0.12 * speedF) * speedF;
      float halfW = 0.18 + 0.05 * aft + 0.25 * speedF;
      // (its edge wanders and frays: a breaking crest, not a brush stroke)
      float wob = vnoise(vec2(aft * 1.4 - t * (1.0 + 2.5 * speedF), side * 3.0 + 1.0)) - 0.5;
      float band = 1.0 - smoothstep(halfW * 0.3, halfW * (1.0 + 0.5 * wob), abs(e - off - wob * halfW * 0.9));
      float inside = (1.0 - smoothstep(off * 0.7, off + halfW * 0.3, e)) * 0.45;
      // froth streaming aft along the hull
      vec2 bp = lp.xz * vec2(3.0, 1.3) + vec2(0.0, t * (0.6 + speedF * 3.0));
      float bfr = froth(bp + 9.0);
      float cB = max(band, inside) * bowZone * min(1.0, speedF * 1.5);
      bowWave = foamLayer(cB * (1.0 - aft * 0.05), bfr, 0.14);
      bowWave *= 1.0 - 0.8 * smoothstep(0.46, 0.74, vnoise(bp * 2.3 + 77.0)) * (1.0 - 0.5 * band);
      aer = max(aer, cB * 0.35);
    }
    foam = max(foam, max(collar, bowWave));
    aer = max(aer, cov * (0.25 + 0.15 * wide));
    contact = 1.0 - smoothstep(0.0, 1.2, e);
  }
  foam = clamp(foam, 0.0, 1.0);
  // aerated water only right under the foam (no glow around whitecaps)
  aer = clamp(max(aer, foam * 0.35), 0.0, 1.0);

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
  // aerated water: lighter and a little milky, not a teal glow
  water = mix(water, water * 1.2 + vec3(0.012, 0.016, 0.018), aer * 0.45);
  water *= (1.0 - 0.1 * churn) * (1.0 - 0.25 * contact);
  // the crest lines: a thin bright edge along each row (the sky caught on the steep lip), silvery
  // cyan away from the sun, warm cream toward it
  float toSunV = smoothstep(-0.3, 0.9, dot(normalize(-V.xz + 1e-4), normalize(L.xz + 1e-4)));
  vec3 crestCol = mix(pale(uSkyZenith, 0.4) * 1.7, pale(uSkyHorizon, 0.55) * 0.42, toSunV);
#if SEA_DETAIL >= 2
  float crestK = uRows.w;
#else
  float crestK = uRows.w * 0.6;   // (no tilt-shift to soften them on Low, and small screens)
#endif
  water = mix(water, max(water, crestCol), rows.w * crestK * (1.0 - shadow * 0.6) * (1.0 - contact));
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
