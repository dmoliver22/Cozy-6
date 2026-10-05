/**
 * POT LUCK — every tuning number lives here.
 * Units: metres, seconds, kilograms, radians unless a name says otherwise (…Deg, …Ms).
 * Boat-local frame: +Y up (deck surface is y = 0), +Z toward the bow, +X toward PORT, −X toward STARBOARD.
 */

const deg = Math.PI / 180;

export const config = {
  seed: 20251005,

  sim: {
    hz: 60,
    maxStepsPerFrame: 4,
    /** Slow motion when everyone holds through a rogue set. */
    allHeldSlowmo: { scale: 0.35, durationSec: 0.3 },
    gravity: 9.81,
  },

  render: {
    maxPixelRatioPhone: 1.5,
    maxPixelRatioDesktop: 2,
    autoDowngradeMs: 20, // frame time that, if sustained, drops quality
    autoDowngradeWindowSec: 3,
    autoUpgradeMs: 11,
  },

  quality: {
    low: { seaSegments: 96, shadows: false, snow: 500, spray: 120, pixelRatio: 1.0, outline: true },
    medium: { seaSegments: 160, shadows: false, snow: 1200, spray: 240, pixelRatio: 1.25, outline: true },
    high: { seaSegments: 240, shadows: true, snow: 2400, spray: 400, pixelRatio: 2.0, outline: true },
  },

  sea: {
    meshSize: 200,
    /** 4 Gerstner waves. dirDeg is the travel direction in world XZ (0 = +X, 90 = +Z). */
    waves: [
      { amp: 0.9, length: 40, dirDeg: 20, steep: 0.55, phase: 0.0 },
      { amp: 0.55, length: 24, dirDeg: -15, steep: 0.6, phase: 1.3 },
      { amp: 0.32, length: 14, dirDeg: 65, steep: 0.65, phase: 2.1 },
      { amp: 0.2, length: 8, dirDeg: 35, steep: 0.7, phase: 4.0 },
    ],
    rogue: {
      maxAmp: 3.0,
      length: 34, // wavelength of the carrier inside the group
      groupWidth: 18, // gaussian envelope half-width along travel direction
      speed: 13, // m/s — a game speed, not a dispersion speed, so the crest reads on the horizon
      steep: 0.55,
      fadeInSec: 6, // amplitude ramps up as it approaches
    },
    foamSlope: 0.55,
    colorDeep: 0x123f47,
    colorShallow: 0x1f5c66,
    colorFoam: 0xeaf2f0,
    swimmerDrift: 0.25, // m/s drift of floating things
  },

  boat: {
    name: 'the Puffin',
    length: 20,
    beam: 6.4,
    freeboard: 1.3, // deck height above the waterline
    /** Critically damped spring frequencies (rad/s) — higher = snappier. */
    responsiveness: { heave: 2.4, pitch: 2.0, roll: 1.7 },
    rollGain: 1.8,
    pitchGain: 0.75,
    maxRollDeg: 34,
    maxPitchDeg: 16,
    /** Hull sample points in boat-local XZ (bow, stern, port fore/aft, starboard fore/aft). */
    samples: [
      [0, 9],
      [0, -9],
      [3, 5],
      [3, -5],
      [-3, 5],
      [-3, -5],
    ] as [number, number][],
    speed: { cruise: 4.2, set: 1.6, haul: 0.0, max: 5.2, accel: 0.6, reverse: -1.2 },
    yawRateMax: 0.22,
    yawAccel: 0.25,
    iceRollGain: 0.45, // extra roll multiplier at full ice (top-heavy)
    rogueRollKickDeg: 14, // extra scripted roll impulse when a rogue hits (in addition to the sea itself)
    landingDip: 0.03, // the deck dips 3 cm on a good pot landing
  },

  deck: {
    /** Scale of the boat's acceleration that leaks into local gravity (1 = physical). */
    accelScale: 1.0,
    tangentialScale: 1.0,
    friction: { dry: 0.7, wet: 0.42, ice: 0.06 },
    itemFriction: 0.5,
    railHeight: 1.0,
    overboardMargin: 0.3,
    maxLinVel: 14,
    maxAngVel: 22,
    drainSec: 3.5, // time constant for deck water to drain through scuppers
    ankleDeepSlow: 0.55, // speed multiplier in ankle-deep water
    washSpeed: 7.5,
    washForce: 260, // N per (m/s) relative water speed per unit drag area
    washDepth: 0.55,
    washLiftAtRail: 2.2, // upward m/s² nudge when a wash crosses the far rail (comedy overboards)
    vaultSpeed: 2.6, // a tumbling body hitting the low rail faster than this may go over
    vaultChance: 0.4,
    unstickSec: 2.0,
  },

  crew: {
    height: 1.7,
    radius: 0.3,
    mass: 80,
    walkSpeed: 3.1,
    runSpeed: 3.1,
    accel: 22,
    /** Grip multipliers on the controller acceleration by surface. */
    grip: { dry: 1.0, wet: 0.55, ice: 0.09 },
    slideControl: 0.2, // fraction of control while sliding
    slideThreshold: 1.2, // m/s of unwanted velocity that counts as sliding
    uprightStiffness: 900,
    uprightDamping: 120,
    yawStiffness: 400,
    yawDamping: 60,
    knockdownImpulse: 210, // N·s of unexplained impulse that knocks an unbraced crew member down
    knockdownSlopeDeg: 27, // unbraced and standing on a slope steeper than this → knocked down
    ragdollTime: 1.2,
    getUpTime: 0.55,
    ragdollPool: 3,
    reach: 1.55,
    carrySpring: 260,
    carryDamping: 26,
    carryMaxForce: 1800,
    throwMaxSpeed: 13,
    eyeHeight: 1.6,
    hatRespawnSec: 9,
    pinchStaggerSec: 0.7,
    pinchChance: 0.08, // per second when a crab is at your ankles
  },

  brace: {
    reach: 1.2,
    stiffness: 5200,
    damping: 520,
    breakForce: 5200,
    breakForceBuff: 1.1, // "Warm bellies"
    leanDeg: 14,
  },

  overboard: {
    ringGrabRadius: 1.5,
    autoRescueSec: 25,
    botThrowDelaySec: 3,
    swimSpeed: 0.7,
    pullSpeed: 1.6,
    ringMaxRope: 22,
    railNetsChanceScale: 0.25,
  },

  telegraph: {
    leadSec: 6.5, // bell rings this long before impact (5–8 s)
    radioSec: 4,
    crestSec: 3,
    radarBonusSec: 2,
  },

  weather: {
    phases: {
      calm: { swell: 0.32, wind: 0.15, snow: 0.0, iceRate: 0.0, storm: 0.0 },
      choppy: { swell: 0.62, wind: 0.45, snow: 0.25, iceRate: 0.004, storm: 0.4 },
      storm: { swell: 0.95, wind: 0.9, snow: 0.85, iceRate: 0.018, storm: 1.0 },
    },
    blendSec: 25,
    rogueAmp: { tutorial: 1.0, choppy: 1.9, storm: 2.8 },
    stormRogueSets: 3,
    stormRogueGapSec: [32, 48] as [number, number],
    choppyRogueGapSec: [70, 100] as [number, number],
    heaterIceScale: 0.35,
  },

  ice: {
    zones: 6,
    maxThickness: 0.06,
    chipPerTap: 0.18,
    chipCooldown: 0.22,
    frictionAt: 0.55, // ice level at which deck friction reaches the ice value
  },

  fishing: {
    stringCount: 2,
    potsPerString: 5,
    potMass: 300,
    potSize: [2, 0.9, 2] as [number, number, number],
    potSpacing: 26,
    soakFillPerMin: 6.5, // crab per minute in an average spot
    maxCatchBodies: 16,
    haulSpeed: 1.25, // m/s line speed
    fasterHaulerScale: 1.6,
    potDepth: 9,
    hangLength: 1.6,
    swingDamping: 0.12,
    levelWindowDeg: 4.5,
    grappleRange: 14,
    grappleHookRadius: 1.8,
    buoyAlongsideDist: 11,
    tankCapacity: 70,
    biggerTankScale: 1.5,
    specialChance: 0.22,
    goldenChance: 0.05,
  },

  catch: {
    red: { name: 'Red king crab', color: 0xc8432f, pricePerKg: 11, weight: [2.2, 4.5], weightRoll: 0.42, femaleRate: 0.3, smallRate: 0.18 },
    blue: { name: 'Blue king crab', color: 0x3f6fa8, pricePerKg: 13, weight: [2.0, 4.0], weightRoll: 0.15, femaleRate: 0.3, smallRate: 0.2 },
    snow: { name: 'Snow crab', color: 0xd8875a, pricePerKg: 6, weight: [0.5, 1.2], weightRoll: 0.4, femaleRate: 0.35, smallRate: 0.22 },
    golden: { name: 'Golden king crab', color: 0xf2c230, pricePerKg: 40, weight: [2.5, 4.5], weightRoll: 0.03, femaleRate: 0.0, smallRate: 0.0 },
    wrongKeepPenalty: 0.04, // fraction of sale lost per wrongly kept crab
    freshnessLossPerMin: 0.01,
  },

  bots: {
    ikeForgetBraceRate: 0.3,
    thinkInterval: 0.35,
    arriveRadius: 0.55,
    throwAimError: 0.9,
    sortPause: 0.35,
    pingHoldSec: 6,
  },

  cat: {
    mass: 4,
    walkSpeed: 0.9,
    slideTiltDeg: 11,
    slideFriction: 0.05,
    railRepel: 30,
  },

  camera: {
    overhead: {
      fov: 30,
      pitchDeg: 55,
      distanceFar: 62, // whole boat
      distanceNear: 22, // close on my deckhand
      followLag: 2.2, // smoothing rate (1/s)
      yawLag: 1.6,
      landscapeYawDeg: 90, // broadside: bow points screen-right
      portraitYawDeg: 0, // stern view: bow points screen-up
      shake: 0.15,
    },
    fp: {
      fov: 70,
      rollFactor: 0.3,
      pitchFactor: 0.35,
      headBob: 0.025,
      lookSensitivity: 0.0024,
      touchLookSensitivity: 0.006,
      padLookSpeed: 2.6,
    },
    switchSec: 0.4,
  },

  touch: {
    buttonMin: 64,
    bigButton: 92,
    joystickRadius: 60,
    holdSec: 0.32,
  },

  haptics: {
    impact: 40,
    landing: [20, 30, 25] as number[],
    pinch: 18,
  },

  photo: {
    max: 6,
    width: 480,
    height: 360,
    delaySec: 0.35,
  },

  trip: {
    tutorialPots: 1,
    soakMinSec: 70,
    homeRunSec: 26,
  },

  harbor: {
    startingCoins: 0,
  },

  /** Shared palette (see brief §10). */
  palette: {
    slicker: 0xf2c230,
    hull: 0xc8432f,
    sea: 0x1f5c66,
    foam: 0xeaf2f0,
    storm: 0x7d7ba6,
    amber: 0xf0a65a,
    buoy: 0xe8742b,
    wood: 0xb98b5e,
    deck: 0x9c7a58,
    steel: 0x6d7a80,
    cream: 0xefe6d2,
    roof: 0x3f4a52,
    ink: 0x23262b,
    morningSky: 0xbfd3d6,
    morningHorizon: 0xf3d9c0,
  },

  debug: {
    startOverlay: false,
  },
};

export type Config = typeof config;
export const DEG = deg;

/** URL overrides for quick tuning/testing, e.g. ?seed=7&phase=storm&skipTutorial=1 */
export function applyUrlOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const p = new URLSearchParams(location.search);
    p.forEach((v, k) => (out[k] = v));
    if (out.seed) config.seed = Number(out.seed) || config.seed;
  } catch {
    /* no location in tests */
  }
  return out;
}
