/**
 * HUD: wave-warning ring, radio bubble, world-anchored pops ("Held!"), toasts, off-screen indicators,
 * trip panel and crew portraits. Every warning is readable with sound off.
 */
import * as THREE from 'three';
import type { RogueSide } from '../core/events';

export interface Indicator {
  world: THREE.Vector3;
  icon: string;
  color: string;
  label?: string;
}

interface Pop {
  el: HTMLDivElement;
  local: THREE.Vector3;
  t: number;
  life: number;
}

const _v = new THREE.Vector3();

export class Hud {
  readonly root: HTMLDivElement;
  private waveEl: HTMLDivElement;
  private waveArc: SVGCircleElement;
  private waveLabel: HTMLDivElement;
  private waveSide: HTMLDivElement;
  private radioEl: HTMLDivElement;
  private radioText: HTMLDivElement;
  private radioWho: HTMLDivElement;
  private radioTimer = 0;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private pops: Pop[] = [];
  private indicators: HTMLDivElement[] = [];
  private tripEl: HTMLDivElement;
  readonly portraitsEl: HTMLDivElement;
  readonly promptEl: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private levelEl: HTMLDivElement;
  private levelBubble: HTMLDivElement;
  private levelWin: HTMLDivElement;
  private bigEl: HTMLDivElement;
  private bigTimer = 0;
  reduceFlashing = false;
  onPortraitTap: ((id: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    const r = (this.root = document.createElement('div'));
    r.className = 'hud';
    r.innerHTML = `
      <div class="hud-wave">
        <svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/><circle class="arc" cx="50" cy="50" r="42"/></svg>
        <div class="hud-wave-icon">🌊</div>
        <div class="hud-wave-side"></div>
        <div class="hud-wave-label">HOLD BRACE!</div>
      </div>
      <div class="hud-radio"><div class="hud-radio-who">📻 Mo</div><div class="hud-radio-text"></div></div>
      <div class="hud-toast"></div>
      <div class="hud-big"></div>
      <div class="hud-trip"></div>
      <div class="hud-portraits"></div>
      <div class="hud-level"><div class="hud-level-win"></div><div class="hud-level-bubble"></div><div class="hud-level-cap">LEVEL</div></div>
      <div class="hud-flash"></div>
      <div class="prompt"></div>`;
    parent.appendChild(r);
    this.waveEl = r.querySelector('.hud-wave')!;
    this.waveArc = r.querySelector('.hud-wave .arc')!;
    this.waveLabel = r.querySelector('.hud-wave-label')!;
    this.waveSide = r.querySelector('.hud-wave-side')!;
    this.radioEl = r.querySelector('.hud-radio')!;
    this.radioText = r.querySelector('.hud-radio-text')!;
    this.radioWho = r.querySelector('.hud-radio-who')!;
    this.toastEl = r.querySelector('.hud-toast')!;
    this.tripEl = r.querySelector('.hud-trip')!;
    this.portraitsEl = r.querySelector('.hud-portraits')!;
    this.promptEl = r.querySelector('.prompt')!;
    this.flashEl = r.querySelector('.hud-flash')!;
    this.levelEl = r.querySelector('.hud-level')!;
    this.levelBubble = r.querySelector('.hud-level-bubble')!;
    this.levelWin = r.querySelector('.hud-level-win')!;
    this.bigEl = r.querySelector('.hud-big')!;
    const circ = 2 * Math.PI * 42;
    this.waveArc.style.strokeDasharray = `${circ}`;
    this.waveArc.style.strokeDashoffset = `${circ}`;
  }

  /** Wave warning ring: fill 0..1 toward impact. */
  setWave(state: { fill: number; side: RogueSide; secs: number; stage: number } | null, playerBraced: boolean): void {
    if (!state) {
      this.waveEl.classList.remove('on');
      return;
    }
    this.waveEl.classList.add('on');
    const circ = 2 * Math.PI * 42;
    this.waveArc.style.strokeDashoffset = `${circ * (1 - state.fill)}`;
    const sideTxt = state.side === 'port' ? '◀ PORT' : state.side === 'starboard' ? 'STARBOARD ▶' : '▲ BOW';
    if (this.waveSide.textContent !== sideTxt) this.waveSide.textContent = sideTxt;
    const lbl = playerBraced ? 'HELD — hang on!' : state.secs < 1.2 ? 'BRACE NOW!' : 'HOLD BRACE!';
    if (this.waveLabel.textContent !== lbl) this.waveLabel.textContent = lbl;
    this.waveEl.classList.toggle('braced', playerBraced);
    this.waveEl.classList.toggle('urgent', state.secs < 1.5 && !this.reduceFlashing);
  }

  radio(who: string, text: string, urgent = false, secs = 4): void {
    this.radioWho.textContent = `📻 ${who}`;
    this.radioText.textContent = text;
    this.radioEl.classList.add('on');
    this.radioEl.classList.toggle('urgent', urgent);
    this.radioTimer = secs;
  }

  toast(text: string, color = '#eaf2f0', secs = 2.6): void {
    this.toastEl.textContent = text;
    this.toastEl.style.color = color;
    this.toastEl.classList.add('on');
    this.toastTimer = secs;
  }

  big(text: string, secs = 1.6): void {
    this.bigEl.textContent = text;
    this.bigEl.classList.remove('on');
    void this.bigEl.offsetWidth;
    this.bigEl.classList.add('on');
    this.bigTimer = secs;
  }

  flash(color: string): void {
    if (this.reduceFlashing) return;
    this.flashEl.style.background = color;
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  /** A floating label anchored to a boat-local position. */
  pop(text: string, local: THREE.Vector3, cls = '', life = 1.4): void {
    const el = document.createElement('div');
    el.className = `hud-pop ${cls}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.pops.push({ el, local: local.clone(), t: 0, life });
  }

  setTrip(html: string): void {
    if (this.tripEl.innerHTML !== html) this.tripEl.innerHTML = html;
  }

  setPortraits(list: { id: string; name: string; color: string; status: string }[]): void {
    if (this.portraitsEl.children.length !== list.length) {
      this.portraitsEl.innerHTML = '';
      for (const p of list) {
        const d = document.createElement('div');
        d.className = 'hud-portrait interactive';
        d.dataset.id = p.id;
        d.innerHTML = `<div class="face" style="background:${p.color}">${p.name[0]}</div><div class="status"></div><div class="name">${p.name}</div>`;
        const tap = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          this.onPortraitTap?.(p.id);
        };
        d.addEventListener('touchstart', tap, { passive: false });
        d.addEventListener('mousedown', tap);
        this.portraitsEl.appendChild(d);
      }
    }
    list.forEach((p, i) => {
      const s = this.portraitsEl.children[i].querySelector('.status') as HTMLDivElement;
      if (s.textContent !== p.status) s.textContent = p.status;
    });
  }

  selectPortrait(id: string | null): void {
    for (const c of Array.from(this.portraitsEl.children)) (c as HTMLDivElement).classList.toggle('sel', (c as HTMLDivElement).dataset.id === id);
  }

  /** Spirit level (shown while landing a pot). angleDeg: current roll; window ±win. */
  setLevel(show: boolean, angleDeg = 0, win = 4): void {
    this.levelEl.classList.toggle('on', show);
    if (!show) return;
    const x = Math.max(-1, Math.min(1, angleDeg / 15));
    this.levelBubble.style.left = `${50 + x * 45}%`;
    this.levelWin.style.width = `${(win / 15) * 90}%`;
    this.levelEl.classList.toggle('good', Math.abs(angleDeg) < win);
  }

  setIndicators(list: Indicator[], camera: THREE.Camera): void {
    while (this.indicators.length < list.length) {
      const d = document.createElement('div');
      d.className = 'hud-ind';
      this.root.appendChild(d);
      this.indicators.push(d);
    }
    const w = window.innerWidth,
      h = window.innerHeight;
    const margin = 46;
    this.indicators.forEach((el, i) => {
      const it = list[i];
      if (!it) {
        el.style.display = 'none';
        return;
      }
      _v.copy(it.world).project(camera);
      const behind = _v.z > 1;
      let x = (_v.x * 0.5 + 0.5) * w;
      let y = (-_v.y * 0.5 + 0.5) * h;
      if (behind) {
        x = w - x;
        y = h - y;
      }
      const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
      if (onScreen) {
        // on screen: a small floating tag above it
        el.style.display = 'flex';
        el.classList.remove('edge');
        el.style.left = `${x}px`;
        el.style.top = `${y - 34}px`;
      } else {
        el.style.display = 'flex';
        el.classList.add('edge');
        const cx = w / 2,
          cy = h / 2;
        const dx = x - cx,
          dy = y - cy;
        const k = Math.min((w / 2 - margin) / Math.max(1, Math.abs(dx)), (h / 2 - margin) / Math.max(1, Math.abs(dy)));
        el.style.left = `${cx + dx * k}px`;
        el.style.top = `${cy + dy * k}px`;
        el.style.setProperty('--ang', `${Math.atan2(dy, dx)}rad`);
      }
      const html = `<span>${it.icon}</span>${it.label ? `<b>${it.label}</b>` : ''}`;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.style.borderColor = it.color;
    });
  }

  update(dt: number, camera: THREE.Camera, boatMatrix: THREE.Matrix4): void {
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioEl.classList.remove('on');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) this.bigEl.classList.remove('on');
    }
    const w = window.innerWidth,
      h = window.innerHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      if (p.t > p.life) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      _v.copy(p.local).applyMatrix4(boatMatrix).project(camera);
      if (_v.z > 1) {
        p.el.style.display = 'none';
        continue;
      }
      p.el.style.display = 'block';
      const k = p.t / p.life;
      p.el.style.left = `${(_v.x * 0.5 + 0.5) * w}px`;
      p.el.style.top = `${(-_v.y * 0.5 + 0.5) * h - 30 - k * 36}px`;
      p.el.style.opacity = `${k < 0.75 ? 1 : 1 - (k - 0.75) * 4}`;
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }
}
