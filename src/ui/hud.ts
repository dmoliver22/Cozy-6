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

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function overlaps(x: number, y: number, hw: number, hh: number, b: Box): boolean {
  return x + hw > b.x0 && x - hw < b.x1 && y + hh > b.y0 && y - hh < b.y1;
}

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
  private toastText: HTMLSpanElement;
  private toastTimer = 0;
  private pops: Pop[] = [];
  private indicators: HTMLDivElement[] = [];
  private tripEl: HTMLDivElement;
  readonly portraitsEl: HTMLDivElement;
  readonly promptEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
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
      <div class="hud-toast"><span></span></div>
      <div class="hud-big"></div>
      <div class="hud-trip"></div>
      <div class="hud-portraits"></div>
      <div class="hud-flash"></div>
      <div class="hud-stack">
        <div class="hud-radio"><div class="hud-radio-who">📻 Mo</div><div class="hud-radio-text"></div></div>
        <div class="hud-level"><div class="hud-level-win"></div><div class="hud-level-bubble"></div><div class="hud-level-cap">LEVEL</div></div>
        <div class="prompt-hint"></div>
        <div class="prompt"></div>
      </div>`;
    parent.appendChild(r);
    this.waveEl = r.querySelector('.hud-wave')!;
    this.waveArc = r.querySelector('.hud-wave .arc')!;
    this.waveLabel = r.querySelector('.hud-wave-label')!;
    this.waveSide = r.querySelector('.hud-wave-side')!;
    this.radioEl = r.querySelector('.hud-radio')!;
    this.radioText = r.querySelector('.hud-radio-text')!;
    this.radioWho = r.querySelector('.hud-radio-who')!;
    this.toastEl = r.querySelector('.hud-toast')!;
    this.toastText = this.toastEl.querySelector('span')!;
    this.tripEl = r.querySelector('.hud-trip')!;
    this.portraitsEl = r.querySelector('.hud-portraits')!;
    this.promptEl = r.querySelector('.prompt')!;
    this.hintEl = r.querySelector('.prompt-hint')!;
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

  /** A small line above the prompt that spells out the carry controls ("Tap Action to put it down"). */
  setHint(text: string): void {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  toast(text: string, color = '#eaf2f0', secs = 2.6): void {
    this.toastText.textContent = text;
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

  private tankBump = 0;
  /** A little bounce on the trip panel when a crab goes into the tank. */
  bumpTank(): void {
    this.tankBump = 0.3;
    this.tripEl.classList.add('bump');
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
      this.indSize.push({ w: 40, h: 24 });
    }
    const w = window.innerWidth,
      h = window.innerHeight;
    const margin = 40;
    // 1. content first (and measure what changed), so layout reads don't interleave with writes
    this.indicators.forEach((el, i) => {
      const it = list[i];
      if (!it) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      const html = `<span>${it.icon}</span>${it.label ? `<b>${it.label}</b>` : ''}`;
      if (el.innerHTML !== html) {
        el.innerHTML = html;
        this.indSize[i] = { w: el.offsetWidth || 40, h: el.offsetHeight || 24 };
      }
      el.style.borderColor = it.color;
    });
    // 2. where each one wants to be
    const pos: { x: number; y: number }[] = [];
    const edge: { i: number; x: number; y: number; ang: number; pri: number }[] = [];
    list.forEach((it, i) => {
      _v.copy(it.world).project(camera);
      const behind = _v.z > 1;
      let x = (_v.x * 0.5 + 0.5) * w;
      let y = (-_v.y * 0.5 + 0.5) * h;
      if (behind) {
        x = w - x;
        y = h - y;
      }
      const el = this.indicators[i];
      const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
      if (onScreen) {
        // on screen: a small floating tag above it
        pos[i] = { x, y: y - 34 };
        el.classList.remove('edge', 'minor');
        el.style.zIndex = '';
      } else {
        const cx = w / 2,
          cy = h / 2;
        const dx = x - cx,
          dy = y - cy;
        const k = Math.min((w / 2 - margin) / Math.max(1, Math.abs(dx)), (h / 2 - margin) / Math.max(1, Math.abs(dy)));
        // the target (and anyone overboard) gets its spot first; the rest make room
        const pri = it.icon === '🎯' ? 0 : it.icon === '🛟' ? 1 : 2;
        edge.push({ i, x: cx + dx * k, y: cy + dy * k, ang: Math.atan2(dy, dx), pri });
        pos[i] = { x: cx + dx * k, y: cy + dy * k };
        el.classList.add('edge');
      }
    });
    // 3. off-screen arrows: slide each along its screen edge to the nearest spot that is clear of
    //    the HUD's own boxes and of the arrows already placed (the target and swimmers go first)
    if (edge.length) {
      const boxes = this.hudBoxes();
      const placed: Box[] = [];
      edge.sort((a, b) => a.pri - b.pri);
      for (const e of edge) {
        const sz = this.indSize[e.i];
        const hw = sz.w / 2 + 3,
          hh = sz.h / 2 + 3;
        // which edge it sits on: the tangent to slide along, the normal pointing on-screen
        const onTop = Math.abs(e.y - margin) < 1,
          onBottom = Math.abs(e.y - (h - margin)) < 1;
        const horiz = onTop || onBottom;
        const nx = horiz ? 0 : e.x < w / 2 ? 1 : -1,
          ny = horiz ? (onTop ? 1 : -1) : 0;
        let found: { x: number; y: number } | null = null;
        for (let k = 0; k < 90 && !found; k++) {
          const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 8;
          let x = e.x + (horiz ? off : 0),
            y = e.y + (horiz ? 0 : off);
          if (x < hw + 4 || x > w - hw - 4 || y < hh + 4 || y > h - hh - 4) continue;
          // step inward past any HUD box in the way (not more than a third of the screen)
          for (let n = 0; n < 6; n++) {
            const b = boxes.find((q) => overlaps(x, y, hw, hh, q));
            if (!b) break;
            if (ny > 0) y = b.y1 + hh;
            else if (ny < 0) y = b.y0 - hh;
            else if (nx > 0) x = b.x1 + hw;
            else x = b.x0 - hw;
          }
          if (horiz ? Math.abs(y - e.y) > h / 3 : Math.abs(x - e.x) > w / 3) continue;
          if (boxes.some((q) => overlaps(x, y, hw, hh, q)) || placed.some((q) => overlaps(x, y, hw, hh, q))) continue;
          found = { x, y };
        }
        const el = this.indicators[e.i];
        if (!found && e.pri === 2) {
          // no room: a spare buoy's arrow gives way rather than piling on top of the others
          el.style.display = 'none';
          continue;
        }
        const at = found ?? { x: e.x, y: e.y };
        placed.push({ x0: at.x - hw, y0: at.y - hh, x1: at.x + hw, y1: at.y + hh });
        pos[e.i] = at;
        el.style.setProperty('--ang', `${e.ang}rad`);
        el.style.zIndex = e.pri === 0 ? '3' : e.pri === 1 ? '2' : '1';
        el.classList.toggle('minor', e.pri === 2);
      }
    }
    list.forEach((_, i) => {
      const el = this.indicators[i];
      el.style.left = `${pos[i].x}px`;
      el.style.top = `${pos[i].y}px`;
    });
  }

  private boxEls: HTMLElement[] = [];
  private boxElsAt = -1e9;
  private indSize: { w: number; h: number }[] = [];
  /** Screen rects of the HUD chrome that off-screen arrows must not cover. */
  private hudBoxes(): Box[] {
    const now = performance.now();
    if (now - this.boxElsAt > 1000) {
      this.boxElsAt = now;
      this.boxEls = Array.from(
        document.querySelectorAll<HTMLElement>('.hud-trip, .hud-portrait, .objective, .hud-wave, .hud-stack > *, .t-menu, .t-action, .t-action .t-label, .t-brace, .t-view, .hud-toast'),
      );
    }
    const out: Box[] = [];
    for (const el of this.boxEls) {
      if ((el.classList.contains('hud-wave') || el.classList.contains('hud-toast')) && !el.classList.contains('on')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 });
    }
    return out;
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
    if (this.tankBump > 0) {
      this.tankBump -= dt;
      if (this.tankBump <= 0) this.tripEl.classList.remove('bump');
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
