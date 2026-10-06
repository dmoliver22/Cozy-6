/**
 * The Deckhand's Log: a parchment card over the paused sea at the end of a trip, before the fish
 * buyer. A rank stamp thumps in, then the score, one pip row per skill, the longest knot streak,
 * NEW BEST ribbons, one concrete tip and the bloopers. Readable at 360 px wide; the button is 64 px+.
 */
import { sfx } from '../audio';
import type { LogView } from '../game/progress';

const PIP_CLASS: Record<string, string> = { P: 'gold', G: 'green', S: 'white', M: 'amber' };
const PIP_TITLE: Record<string, string> = { P: 'gold', G: 'good', S: 'safe', M: 'missed' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** A row of coloured pips for a pip string ("PGGSM"). */
export function pipsHtml(pips: string, max = 20): string {
  return Array.from(pips.slice(-max))
    .map((p) => `<i class="pip ${PIP_CLASS[p] ?? 'white'}" title="${PIP_TITLE[p] ?? ''}"></i>`)
    .join('');
}

/** A short rope with one knot per streak knot (drawn up to 18; the count says the rest). */
function ropeSvg(knots: number): string {
  const n = Math.min(18, knots);
  const w = 200;
  let path = 'M4 12';
  for (let x = 4; x < w - 4; x += 12) path += ` q3 -5 6 0 t6 0`;
  let dots = '';
  for (let i = 0; i < n; i++) {
    const x = 10 + (i * (w - 20)) / Math.max(1, n - 1 || 1);
    dots += `<circle cx="${x.toFixed(1)}" cy="12" r="4.6"/>`;
  }
  return `<svg class="rope" viewBox="0 0 ${w} 24" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/>${dots}</svg>`;
}

export function showLog(parent: HTMLElement, v: LogView, onContinue: () => void): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'log-screen interactive';
  const rows = v.rows
    .map(
      (r) => `
      <div class="log-row" data-row="${r.key}">
        <div class="log-row-label"><span>${r.icon}</span>${esc(r.label)}</div>
        <div class="log-pips">${r.pips ? pipsHtml(r.pips) : `<em>${esc(r.empty)}</em>`}</div>
      </div>`,
    )
    .join('');
  const ribbons = v.ribbons.map((r) => `<span class="ribbon">${esc(r)}</span>`).join('');
  el.innerHTML = `
    <div class="log-card" role="dialog" aria-label="Deckhand's Log">
      <div class="log-left">
        <div class="log-head">
          <div class="log-title">Deckhand's Log</div>
          <div class="log-date">Trip ${v.trip} · ${esc(v.dateLine)}</div>
        </div>
        <div class="log-top">
          <div class="stamp-wrap"><div class="stamp rank-${v.rank}">${esc(v.rankName)}</div></div>
          <div class="log-score">
            ${v.showScores ? `<div class="log-num">${fmt(v.score)}</div><div class="log-num-cap">points</div>` : ''}
            ${v.showScores && v.nearMiss ? `<div class="log-near">${esc(v.nearMiss)}</div>` : ''}
          </div>
        </div>
        <div class="log-streak">${ropeSvg(v.bestStreak)}<div class="log-streak-cap">${v.bestStreak ? `<b>${v.bestStreak}</b> knot${v.bestStreak === 1 ? '' : 's'} · longest streak` : 'No knots tied this trip'}</div></div>
        ${ribbons ? `<div class="log-ribbons">${ribbons}</div>` : ''}
      </div>
      <div class="log-right">
        <div class="log-rows">${rows}</div>
        <div class="log-tip"><span>💡</span>${esc(v.tip)}</div>
        <div class="log-bloopers"><span>🎬</span>${esc(v.bloopers)}</div>
        <button class="btn primary big log-go" data-go>To the fish buyer →</button>
      </div>
    </div>`;
  parent.appendChild(el);
  // the rank stamp thumps down after a beat
  const stamp = el.querySelector<HTMLDivElement>('.stamp')!;
  window.setTimeout(() => {
    stamp.classList.add('in');
    sfx.play('thunk', { volume: 0.8, pitch: 1.1 });
  }, 400);
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    sfx.play('uiConfirm');
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 700);
    onContinue();
  };
  el.querySelector('[data-go]')!.addEventListener('click', go);
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') go();
  });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  return el;
}
