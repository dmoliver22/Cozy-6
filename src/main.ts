import './ui/style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { applyUrlOverrides } from './config';
import { Game } from './game/game';
import { events } from './core/events';
import { showTitle, showChart } from './ui/title';

async function boot() {
  const params = applyUrlOverrides();
  await RAPIER.init();
  const app = document.getElementById('app')!;
  const game = new Game(app);
  (window as unknown as { __game: Game; __params: unknown }).__game = game;
  (window as unknown as { __params: unknown }).__params = params;
  (window as unknown as { __events: unknown }).__events = events;
  game.start();
  // the sea idles behind the title until we cast off
  game.loop.paused = true;
  game.hud.setVisible(false);
  if (params.weather === 'calm' || params.weather === 'choppy' || params.weather === 'storm') game.weather.force(params.weather);
  const first = game.save.tripsCompleted === 0;
  if (params.autostart === '1') game.beginTrip(params.skipTutorial === '1' || !first);
  else if (first) showTitle(app, true, () => game.beginTrip(params.skipTutorial === '1'));
  else showChart(app, game.save.tripsCompleted, game.save.upgrades, () => game.beginTrip(true));
  document.getElementById('loading')?.classList.add('hidden');
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.innerHTML = `<div class="loading-card"><div class="loading-title">Oops</div><div class="loading-sub">${String(err)}</div></div>`;
});
