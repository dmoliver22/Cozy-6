# Pot Luck

A cozy, chaotic crab-fishing game for desktop and phone browsers. You crew the *Puffin* with
Captain Mo, Dot, Ike and Barnacle the cat. You set pots, haul them through a swell that keeps
getting bigger, and land 300 kg of steel on a rolling deck. Then you sell the catch at the
harbor and cook a potluck in the galley.

Everything runs on physics:
- The sea is a Gerstner wave field.
- The boat rides it on six hull samples.
- Everything on deck lives in a Rapier world that feels the boat's motion as tilted, shifting
  gravity.

Buckets slide, crabs scuttle, rogue waves wash the deck, and anyone who isn't braced goes for
a tumble (or a swim).

Built with Vite, TypeScript, Three.js and Rapier. All art is generated in code and all sound
is procedural WebAudio. There are no asset files.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (also served on your LAN for phones)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the build
```

To play on a phone, open the LAN address that `npm run dev` prints, on the same Wi-Fi.
Landscape is recommended; portrait works with a stern-on camera.

## Controls

| Action | Desktop | Gamepad | Phone |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Left thumb stick |
| Grab / use (hold to carry) | Left mouse | A | **Action** button (does what it shows) |
| Aim & throw | Hold right mouse, release | Hold RT, release | Drag the Action button (slingshot) |
| Interact (levers, re-hook, chip, pet) | E | X | Action button (it switches to that verb) |
| **Brace** (hold) | Shift or Space | LB | **BRACE** button |
| Ping a bot to a spot | Q / Tab | RB | Tap a portrait, then a spot |
| Overhead ⇄ first person | V | Y | 👁 button |
| Zoom (overhead) | Mouse wheel | D-pad up/down | Pinch |
| Pause / settings | Esc / P | Start | ☰ button |
| Debug overlay | F3 | — | Three-finger tap |

With the debug overlay open, you can also use: **R** to trigger a rogue set, **O** to
throw Ike overboard, **K** to knock Ike down, **[ / ]** to change the swell, and **T** to
skip to the second haul.

## How to play

1. **Set a string.** Grab a bait jar from the bait box and bait the pot on the cradle. Then
   hold the launcher lever. Watch for the buoy.
2. **Brace.** When the bell rings and the wave ring fills, get to a rail and hold BRACE.
   Rogue sets come from the side the ring shows. Everyone held = slow-mo and a cheer.
3. **Haul.**
   - Throw the grapple at a buoy alongside, then carry the line to the block.
   - Run the hauler.
   - Guide the swinging pot over the cradle and let go **when the spirit level is in the
     green**.

   A level landing goes *THUNK*. A bad one leaves a loose pot to drag back and re-hook.
4. **Tip and sort.** Tip the cradle. Big males go in the tank hatch; females and small crabs
   go back over the rail. Watch out for pinches, golden crabs, and whatever else came up in
   the pot.
5. **Weather.** Calm turns choppy turns storm. Ice builds up on the deck, so chip it with
   the mallet before everyone's skating. When the barometer drops, Mo asks: one more
   string, or run for home?
6. **Harbor and galley.**
   - Sell the catch and buy upgrades or a new hat.
   - Cook a potluck for a small buff next trip.
   - Pin the trip's photos on the board and download a postcard.

Nobody drowns: overboard crew get a life ring (throw it, then pull them in), and the crane
fishes them out after 25 s.

## Settings

The pause menu has:
- Quality (Auto/Low/Medium/High). Auto drops a tier if frames run slow.
- First-person roll comfort.
- Head-bob.
- Haptics.
- Volume and music.
- Invert look.
- Reduce flashing.

## URL flags (testing)

| Flag | Effect |
|---|---|
| `?autostart=1` | Skip the title / chart screen |
| `?skipTutorial=1` | Skip the tutorial string |
| `?weather=calm\|choppy\|storm` | Pin the weather for the whole trip (storm sets never stop) |
| `?seed=N` | Change the RNG seed |
| `?touch=1` | Force the touch UI on desktop |

## Project layout

```
src/
  config.ts        every tuning number
  core/            fixed-step loop, seeded RNG, event bus, sim-time scheduler, save, settings
  sea/             Gerstner waves (CPU + GLSL), sea mesh, spray
  boat/            boat motion from hull samples, deck layout, navigator
  deck/            deck-local Rapier world, static colliders, surface (wet/ice), items, wash, nav grid
  crew/            crew controller, ragdolls, rescue, helm, bots, the cat
  fishing/         pots, grapple, crabs, catch rolls, specials
  weather/         weather director, rogue sets, snow, ice
  camera/ input/ ui/  camera rig, devices → player input, HUD, touch, menus
  art/             code-built meshes (boat, crew, crabs, pots, items, cat)
  audio/           procedural SFX, babble voices, ambient loops, music
  harbor/ galley/ photo/  end-of-trip scenes, photo capture and postcard
  game/            the Game orchestrator, trip director, feedback (game feel)
scripts/           headless Playwright probes used to test each milestone
```

See [NOTES.md](NOTES.md) for how the simulation works, the milestone-by-milestone build
log, the test results and the tuning values.
