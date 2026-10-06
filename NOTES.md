# POT LUCK — build notes

A cozy-chaotic crab-fishing demo for desktop and phone browsers.
Vite + TypeScript + Three.js + Rapier (`@dimforge/rapier3d-compat`). No other engines, no
external assets: every mesh is built in code (`src/art/*`) and every sound is procedural
WebAudio (`src/audio/*`, behind `sfx.play(name, { pitch, volume })`).

All tuning numbers live in `src/config.ts`. Values quoted below are the current ones.

---

## How the simulation is put together

**Frames.** World space holds the sea and the boat's pose. Everything on deck lives in a
separate Rapier world in **boat-local space**: deck surface at `y = 0`, `+Z` toward the bow,
`+X` toward port. The boat itself is never a rigid body.

**Fixed step.** `core/loop.ts` runs the sim at 60 Hz with an accumulator (max 4 steps per
frame) and hands an `alpha` to the renderer, which interpolates every body
(`BodyState` keeps the previous and current transforms). Slow motion scales the accumulator
(`loop.timeScale`). Nothing in the sim uses `setTimeout`: delayed sim events go through
`core/schedule.ts` (`later(seconds, fn)`), stepped with sim time, so slow motion and the
headless probes stay in sync.

**Determinism.** `core/rng.ts` is mulberry32 with named streams derived from `config.seed`
(`?seed=` overrides). Sim randomness (catches, weather, rogue schedule, bots, spills, throws)
uses streams. `Math.random` is only used for cosmetic sound and particle jitter.

**Sea (`sea/waves.ts`).** Four Gerstner waves. The same function exists in TypeScript
(`Sea.displace` and `Sea.height`, which inverts the horizontal displacement with a few
fixed-point iterations) and in GLSL (`SEA_GLSL`), so floating things sit exactly on the
rendered surface. A rogue wave is a separate travelling packet: a carrier of wavelength 40 m
under a gaussian envelope (half-width 20 m) moving at 9.5 m/s, faded in over 6 s. The sea
mesh is a non-uniform grid around the camera. It discards fragments inside the hull
footprint (so the deck never shows water) and adds foam from crest pinch, the rogue crest
line and the wake.

**Boat (`boat/boat.ts`).** The boat samples the sea under six hull points (bow, stern,
four quarters). Heave, pitch and roll each follow their target through a critically damped
spring (`responsiveness` heave 2.4, pitch 2.0, roll 1.7 rad/s; `rollGain` 1.8). The springs
are stiffened while a rogue is underneath so the boat rides up the face. Ice adds roll
(`iceRollGain`). A scripted roll kick is spread over 0.15 s. The navigator
(`boat/navigator.ts`) drives yaw and speed (cruise, goto, alongside). Alongside maneuvers
follow a cubic Bézier `pathPose` with an arc-length table, a speed profile and end-heading
convergence. The boat's acceleration comes from finite differences, smoothed and clamped
(horizontal ±3.5, vertical ±9 m/s²).

**Deck physics (`deck/deckWorld.ts`).** Every step:
- `g_local = R⁻¹(g − a_boat)` becomes the deck world's gravity.
- The fictitious terms `−α×r − ω×(ω×r)` are applied per body as impulses.
- Velocities are clamped (14 m/s linear, 22 rad/s angular).

Static colliders (`deck/structure.ts`) include six friction zones (dry 0.7, wet 0.42,
ice 0.06), the bulwarks (thickened outward against tunnelling), the wheelhouse, the table,
the hatch coaming and the crate. The cradle is a kinematic body. Items use the Min friction
combine rule so a wet deck feels slippery. Collision groups are in `deck/groups.ts`.

**Overboard.** An item or crew member that leaves the hull plan (`ItemManager.outsideHull`)
switches to a world-space **sea state**: it falls, then floats or sinks on the Gerstner
surface and drifts with the wind. `toDeck` brings it back aboard. Pots, the cat and anchored
buoys are flagged `noOverboard` or handled by their own systems.

---

## Milestones

### M1 — Sea, boat, camera, debug
- Built the shared CPU/GPU Gerstner sea, the Puffin riding it on six hull samples, the
  overhead "dollhouse" camera (level horizon, slow follow, cutaway roof), and a debug
  overlay (F3 or a three-finger tap) showing FPS, bodies, wave state, `g_local`, roll and
  pitch.
- **Pass test:** beam-on to the swell the roll RMS is 6.1°; bow-on it is 1.4°.

### M2 — Deck-local physics and the deckhand
- Built the deck world with local gravity and fictitious forces, and the capsule crew
  controller: velocity-limited, scaled by surface grip (dry 1.0, wet 0.55, ice 0.09), with
  20% control while sliding. Added an upright torque spring, grab/carry/throw through a
  carry spring (`carrySpring` 260, `carryDamping` 26), ballistic throws with
  `solveBallistic` and `throwFlightTime`, and crabs.
- **Pass test:** in a moderate swell an untouched bucket slides 1.3 m across the deck. The
  player stays on their feet, and grab, carry and throw all work.

### M3 — Rogue sets, brace, knockdown, overboard
- **Rogue sets** are telegraphed in stages: bell (`leadSec` 6.5 s), radio, then the crest on
  the horizon. A side-coded HUD ring shows the countdown; it is readable with the sound off.
- **Brace** grabs the nearest rail or segment (`braceSegments`) with a spring (k 5200,
  c 520) that breaks above 5200 N.
- **Knockdowns:** an unbraced crew member goes down from:
  - a slope steeper than 27°;
  - an unexplained contact impulse above 210 N·s;
  - the deck wash: a travelling water front that pushes bodies and gives a small lift at
    the far rail.

  Knockdowns use a pool of three ragdolls (six parts, spherical joints) and fall back to a
  "tumble" capsule when the pool is empty. Hats fly off as physics items.
- **Overboard rescue:** the crew member swims; the life ring can be thrown (lofted arc) and
  pulled in on its rope. Bots throw it after 3 s, and the crane auto-rescues at 25 s. Nobody
  dies.
- **Pass test:**
  - A braced player holds through a 2.6 m set.
  - Unbraced crew tumble and sometimes go over.
  - Ring rescue works, and the crane rescue lands at about 29 s (25 s plus the lift).

### M4 — The fishing loop
- **Setting:** stack → crane → cradle → bait jar → launcher lever. The pot falls, splashes
  and sinks, and its buoy pops up 0.9 s later.
- **Soak:** catch fills at about 3.4 crabs/min, modified by spot quality.
- **Hauling:** grapple throw (2.4 m hook radius, 3.5 m aim assist on throws at the sea) →
  carry the line to the block → hauler → the pot rises and hangs at 1.65 m. Pendulum swing
  with a soft guide spring when grabbed. It must be released over the cradle while the deck
  is level within ±4.5°.
- **Landing:** a good landing is a THUNK with a 3 cm deck dip and a flash. A bad one leaves
  a loose 300 kg pot on deck to be re-hooked.
- **Tip and sort:** tip the cradle and the crabs spill onto the sorting table. Big males go
  in the tank hatch; females and small ones go back over the rail. Specials include a
  bottle, an octopus that steals things, a boot, a bell, an otter and a jellyfish.
- **Pass test:** a full string of five pots was hooked, hauled, landed level, tipped and
  sorted. A bad landing followed by a rehook also works.

### M5 — First person, touch, gamepad, haptics
- **First-person view:** mittens and a reticle, horizon roll at 0.3 of the boat's (comfort
  slider 0–0.6), optional head-bob, aim by raycast.
- **Touch:** a thumb stick, a context **Action** button (tap = use, hold = carry, drag =
  slingshot throw), **BRACE**, the view toggle, and portrait tap → spot to ping a bot.
  Buttons are at least 64 px.
- **Gamepad, haptics, pause menu:** settings for quality, comfort, volume, music,
  invert-look and reduce-flashing are saved to localStorage.
- **Quality and frame budget:** phones start on Low, desktops on High. Auto quality drops
  a tier after 3 s above 20 ms per frame and climbs back below 11 ms (phones climb no higher
  than Medium). The pixel ratio is capped at 1.5 on phones.
- **Pass test:** the FP view works, and the touch Action button drives the same verbs as
  the mouse (Playwright touch test).

### M6 — Bots, the cat, the trip
- **Bots:** Mo (captain, at the helm), Dot and Ike (forgets to brace 30% of the time) run a
  priority list:
  - brace;
  - rescue;
  - helm;
  - pings;
  - pot work (fetch line, tip, land, haul, rehook, grapple, bait, launch);
  - urgent ice;
  - sort;
  - hat;
  - ice;
  - cat;
  - coil;
  - idle.

  Claims on a `TaskBoard` stop two bots doing the same job. Movement uses A* on a 0.25 m
  nav grid (`deck/navgrid.ts`) with string pulling, and loose pots are dynamic obstacles.
- **Barnacle the cat** never goes overboard (the rail repels them). They belly-slide on a
  steep deck, can be petted or carried, and nap in the hammock (an upgrade).
- **Trip director:** tutorial → set string 1 → transit → set string 2 → transit → haul 1 →
  "storm's coming: haul one more or run for home?" → haul 2 → home.
- **The tutorial gag:** Ike wanders to the starboard rail during the first swell, forgets
  to brace, and slides into the buoy pile with his hat flying. The photo is "Ike,
  airborne".
- **Pass test:** a fully autonomous trip (player parked) completes, 10/10 pots landed.

### M7 — Weather and ice
- **Weather director:** calm → choppy → storm, tied to the trip phase and blended over 25 s.
  Each phase sets swell, wind, snow, ice rate and a storm look (fog, sky, music intensity).
- **Rogue schedule:** choppy rogues every 70–100 s; three storm sets 32–48 s apart, at
  amplitudes 1.9 (choppy) and 2.8 (storm).
- **Ice:** builds per zone (choppy 0.0012/s, storm 0.0055/s; heater lines ×0.35), lowers
  friction, and makes the boat top-heavy. Chip it with the mallet (0.18 per tap); bots chip
  the worst zone.
- **Pass test:** in a full trip the storm is visibly harder, Ike forgets to brace, the
  "ALL HELD!" slow-mo fires, specials get handled, and the cat never goes over.

### M8 — Harbor, galley, photos, save
- **Kittiwake Harbor:**
  - **Fish buyer:** tally by species × price/kg × freshness, with a penalty for wrongly
    kept crabs.
  - **Chandlery:** six upgrades — faster hauler, rail nets, deck heater lines, better radar
    (+2 s warning), bigger tank, cat hammock.
  - **Knit shop:** hat colours.
- **Galley potluck:** drag (or tap) ingredients into the pot. The dish gives a small buff
  next trip.
- **Photos:** up to six auto-photos (overboard, wipeout, golden, special, all-held, cat
  slide) for a photo board, plus a 1080×1350 postcard download.
- **Save:** progress in localStorage (`potluck.save.v1`). Return trips start at the chart
  screen.
- **Pass test:** trip → harbor → galley → postcard download → save. Reload shows the chart
  screen with the upgrades applied.

### M9 — Polish, stability, tutorial check
**New feel:**
- Golden crab camera push-in (eased in, held 1.8 s, eased out, with focus pulled toward the
  table), a "GOLDEN!" banner and a haptic pattern.
- Crabs squash on landing (scale from the impact speed, recovers in 0.2 s).
- Ripple rings on the sea where thrown-back crabs land.
- Tank counter in the HUD trip panel (count/capacity, kg, goldens) with a bounce on each
  keeper.
- Touch devices show touch prompts from the first frame (no "[LMB]").

**Bugs found and fixed while testing:**
- The tutorial radio line ("Nice set…") fired 6 times. A falling pot re-entered its splash
  branch while hovering at the surface; pots now splash once (`splashed` flag), and the
  swell step is guarded against re-entry.
- **Fall-through safety net.** A standing crew member wedged within 0.2 m of the hull edge
  under the deck plate could fall forever (no overboard check while standing). Now every
  on-deck state (stand, helm, down, get-up, ragdoll) checks: below the deck at the edge →
  overboard; below the deck inside the hull → lifted back up. Items get the same rule.
- A loose pot shoved past the rail fell forever and stalled the haul. Loose pots are now
  dragged back aboard by their line.
- **Rehook:** bots now drag a stray pot home (pull from the cradle side, or push from
  behind). They pick whichever side the nav grid can reach and steer straight while
  holding. If neither side is reachable for 5 s (or 30 s pass), the block is swung over and
  hooks it where it lies. The re-hook zone now covers the working deck aft of the cradle.
- **Push carry:** a crew member pushing or dragging something heavy faces it, and the hold
  point sits just outside the load instead of inside it.
- **Bots sat idle:** a pot job whose claim another bot held was still returned, then
  silently failed to claim. Pot jobs now check their claim first. Sorting considers every
  crab on deck, not only those within 9 m.
- **Lost gear:** the grapple and mallet return to their hooks after 20 s and 25 s lying
  loose (faster if lost overboard). A hat nobody reaches in 45 s respawns on the galley hook.
- **Body budget:** at most 40 crabs on deck (`maxCrabsOnDeck`); the rest of a tipped pot
  goes "straight down the chute". Worst case is about 75 dynamic bodies.
- `?weather=calm|choppy|storm` pins the weather (storm sets never run out) for testing.

**Pass tests:**
- **Tutorial** (`scripts/probe-tut.js`): bait → launch → "Over she goes!" → one swell
  call → Ike knocked into the buoy pile → photo "Ike, airborne" → "Ha! Ike, you've gotta
  BRACE, son" → phase set1.
- **10-minute locked storm** (`scripts/probe-storm.js`, 15 rogue sets back to back, player
  idle), last 4 runs:

  | Run | NaN | Fall-throughs | Max dynamic bodies | Physics + sim per step | Longest loose pot |
  |-----|-----|---------------|--------------------|------------------------|-------------------|
  | 1 | 0 | 0 | 38 | 0.72 ms | 0 s |
  | 2 | 0 | 0 | 44 | 0.84 ms | 36 s |
  | 3 | 0 | 0 | 37 | 0.90 ms | 7 s |
  | 4 | 0 | 0 | 42 | 0.68 ms | 1 s |

- **Full autonomous trips** (`scripts/probe-m7.js`, player parked): both runs end. One took
  756 s and the other 931 s. Each landed 10/10 pots good and banked 34–36 crabs, with
  5–6 rogue sets all held and 0–1 overboards.

---

## Performance notes
- Sim + physics cost per 60 Hz step measured in headless Chromium: 0.5–0.9 ms in a full
  storm (all bots active, ~40 bodies). That leaves the frame budget to rendering.
- **Rendering cost per tier:** sea grid 96/128/240 segments; snow 500/1200/2400; spray
  pools 120/240/400; shadows on Medium (1024, small casters and pot doors left out) and
  High (2048); one draw call each for the instanced crabs. Every material, hidden storm
  effects included, is compiled after the first frame (`Stage.precompile`).
- **Draw calls** (`renderer.info.render.calls` after two frames, calm, default view):
  Low 253, Medium 398, High 432 (Medium was 419: the crew, pots, wheelhouse and gantry still
  cast; Low with a 512 shadow map measured 398, so Low stays shadowless).
- **Quality tiers:** phones start on Low at DPR ≤ 1.5 and may climb to Medium. Auto quality
  steps down after 3 s above 20 ms per frame.
- The headless tests render with SwiftShader (software). Their frame rates say nothing
  about real GPUs, so frame-rate numbers were not taken from them. Check on real hardware
  with the F3 overlay.

## Known limitations
- In a permanently locked storm the bots spend most of their time bracing, chipping ice and
  rescuing, so sorting falls behind. The crab cap keeps the body budget, but the player is
  expected to help sort. In a normal trip the storm only covers the last haul and the run
  home.
- The sim is seeded, but a live session also depends on real-time input and frame timing,
  so two sessions are not bit-identical.

## Testing hooks
- `window.__game` (the `Game`): `step(dt)` advances the sim synchronously. `trip`, `pots`,
  `crew`, `bots`, `weather`, `rogue` and the other systems hang off it.
- `window.__events` is the typed event bus.
- **URL flags:**
  - `?autostart=1` skips the title screen.
  - `?skipTutorial=1` skips the tutorial.
  - `?weather=storm` pins the weather.
  - `?seed=N` sets the RNG seed.
  - `?touch=1` forces the touch UI.
- **Scripts:** `scripts/shot.mjs <query> <out.png> [waitMs] [js] [--mobile]` loads the dev
  server in headless Chromium, runs a probe and screenshots. The `scripts/probe-*.js` files
  are the milestone probes.
