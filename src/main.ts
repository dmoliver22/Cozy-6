import './ui/style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { applyUrlOverrides } from './config';
import { Game } from './game/game';

async function boot() {
  const params = applyUrlOverrides();
  await RAPIER.init();
  const app = document.getElementById('app')!;
  const game = new Game(app);
  (window as unknown as { __game: Game; __params: unknown }).__game = game;
  (window as unknown as { __params: unknown }).__params = params;
  game.start();
  document.getElementById('loading')?.classList.add('hidden');
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.innerHTML = `<div class="loading-card"><div class="loading-title">Oops</div><div class="loading-sub">${String(err)}</div></div>`;
});
