import './ui/style.css';
import { applyUrlOverrides, config } from './config';
import { initPhysics } from './core/physicsInit';
import { Game } from './game/game';
import { ObjectiveBeacon } from './game/beacon';
import { events } from './core/events';
import { showTitle, showChart } from './ui/title';
import * as progress from './game/progress';

async function boot() {
  const params = applyUrlOverrides();
  const physics = await initPhysics();
  if (physics === 'js') console.info('Pot Luck: WebAssembly is blocked here, running the JavaScript build of the physics engine (slower).');
  (window as unknown as { __physics: string }).__physics = physics;
  const app = document.getElementById('app')!;
  // Today's Tide: everyone fishing today fishes the same water (the probes keep the fixed seed).
  // The date is fixed here for the whole trip (a trip past midnight still counts for today).
  const day = progress.tripDateKey();
  if (params.seed === undefined && params.autostart !== '1') config.seed = progress.dailySeed(day);
  const game = new Game(app);
  // the arrow over the next thing to do (reads game state, draws through the stage)
  new ObjectiveBeacon(game);
  // phones frame the working deck closer (overrides the Game's own phone default)
  if (game.stage.isPhone) game.rig.zoom = config.camera.overhead.phoneZoom;
  // compile the hidden storm effects' shaders now rather than when the storm arrives
  void game.stage.precompile();
  (window as unknown as { __game: Game; __params: unknown }).__game = game;
  (window as unknown as { __params: unknown }).__params = params;
  (window as unknown as { __events: unknown }).__events = events;
  (window as unknown as { __progress: unknown }).__progress = progress;
  game.start();
  // the sea idles behind the title until we cast off
  game.loop.paused = true;
  game.hud.setVisible(false);
  if (params.weather === 'calm' || params.weather === 'choppy' || params.weather === 'storm') game.weather.force(params.weather);
  const first = game.save.tripsCompleted === 0;
  if (params.autostart === '1') game.beginTrip(params.skipTutorial === '1' || !first);
  else if (first) showTitle(app, true, () => game.beginTrip(params.skipTutorial === '1'));
  else showChart(app, progress.chartView(game.save, game.settings.showScores), () => game.beginTrip(true));
  document.getElementById('loading')?.classList.add('hidden');
}

boot().catch((err) => {
  console.error(err);
  const msg = String(err);
  const why = /webgl/i.test(msg)
    ? "This browser couldn't start WebGL, which Pot Luck needs for its 3D sea. Try another browser, or turn on hardware acceleration."
    : /webassembly|wasm|unsafe-eval|rapier-js/i.test(msg)
      ? "This page blocked the physics engine from starting. Try opening Pot Luck in another browser."
      : "Something went wrong while loading. Reload the page to try again.";
  const card = document.querySelector('#loading .loading-card');
  if (!card) return;
  const sub = card.querySelector('.loading-sub') ?? card.appendChild(document.createElement('div'));
  sub.className = 'loading-sub loading-error';
  sub.textContent = why;
});
