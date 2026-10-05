/**
 * Title card (first launch: "tap to cast off" — also unlocks audio on iOS) and the harbor chart
 * for later trips: one fishing ground with an escalating forecast.
 */
import { sfx } from '../audio';

export function showTitle(parent: HTMLElement, firstTime: boolean, onGo: () => void): void {
  const el = document.createElement('div');
  el.className = 'title-screen interactive';
  el.innerHTML = `
    <div class="title-card">
      <div class="title-logo">Pot Luck</div>
      <div class="title-sub">a cozy-chaotic crab-fishing trip aboard <b>the Puffin</b></div>
      <button class="btn primary big" data-go>${firstTime ? '⚓ Cast off' : '⚓ Back to sea'}</button>
      <div class="title-hint">Headphones on · works with mouse & keys, a gamepad, or touch</div>
    </div>`;
  parent.appendChild(el);
  const go = () => {
    sfx.unlock();
    sfx.play('foghorn', { volume: 0.5 });
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
    onGo();
  };
  el.querySelector('[data-go]')!.addEventListener('click', go);
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') go();
  });
}

export function showChart(parent: HTMLElement, trips: number, upgrades: string[], onGo: () => void): void {
  const el = document.createElement('div');
  el.className = 'chart-screen interactive';
  el.innerHTML = `
    <div class="chart-card">
      <div class="chart-title">Chart table — trip ${trips + 1}</div>
      <canvas width="560" height="320"></canvas>
      <div class="chart-ground"><b>Kingfisher Bank</b> · forecast: ☀️ calm → 🌬 choppy → ⛈ storm</div>
      ${upgrades.length ? `<div class="chart-upg">Aboard: ${upgrades.join(' · ')}</div>` : ''}
      <button class="btn primary big" data-go>⚓ Cast off for Kingfisher Bank</button>
    </div>`;
  parent.appendChild(el);
  const cv = el.querySelector('canvas')!;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#e9dcbc';
  g.fillRect(0, 0, 560, 320);
  g.strokeStyle = 'rgba(31,92,102,.25)';
  for (let x = 0; x < 560; x += 40) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 320);
    g.stroke();
  }
  for (let y = 0; y < 320; y += 40) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(560, y);
    g.stroke();
  }
  // coastline
  g.fillStyle = '#c7b78c';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(200, 0);
  g.bezierCurveTo(170, 60, 230, 90, 160, 140);
  g.bezierCurveTo(110, 180, 140, 240, 60, 320);
  g.lineTo(0, 320);
  g.closePath();
  g.fill();
  g.fillStyle = '#c8432f';
  g.beginPath();
  g.arc(150, 150, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#23262b';
  g.font = 'bold 15px Georgia, serif';
  g.fillText('Kittiwake Hbr', 70, 178);
  // the ground
  g.strokeStyle = '#e8742b';
  g.setLineDash([6, 5]);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(158, 150);
  g.quadraticCurveTo(300, 110, 410, 160);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(232,116,43,.25)';
  g.beginPath();
  g.ellipse(420, 165, 70, 45, 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#23262b';
  g.fillText('Kingfisher Bank', 360, 225);
  g.font = '26px serif';
  g.fillText('🦀', 405, 175);
  el.querySelector('[data-go]')!.addEventListener('click', () => {
    sfx.unlock();
    sfx.play('foghorn', { volume: 0.5 });
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
    onGo();
  });
}
