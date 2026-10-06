/**
 * HUD: wave-warning ring, radio bubble, world-anchored pops ("Held!"), toasts, off-screen indicators,
 * trip panel (with the Knot Streak rope strip) and crew portraits. Every warning is readable with sound
 * off, and so are the gold targets: the gold arc on the wave ring and the gold core of the spirit level.
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
  /** a grade pop (at most MAX_GRADE_POPS on screen; the oldest makes room) */
  grade?: boolean;
  /** measured size (grade pops keep clear of the wave ring and the spirit level) */
  w?: number;
  h?: number;
}

const MAX_GRADE_POPS = 2;
const WAVE_R = 42;
const GOLD_R = 49;
/** the wave ring's largest scale (the urgent pulse): grade pops keep clear of it at full size */
const WAVE_MAX_SCALE = 1.09;
/** the trip panel's bounce (.hud-trip.bump) */
const BUMP = 1.12;

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
  private waveGold: SVGCircleElement;
  private waveGoldFrac = -1;
  /** the last gold targets given (a caller that doesn't pass them gets these) */
  private perfectSec = 1.2;
  private coreDeg = 0;
  /** Mo's steady hand: widens whatever window the frame passes to setLevel (see setGoldTargets) */
  private winBonusDeg = 0;
  /** what setLevel last wrote (unchanged values aren't written again) */
  private levelShown = { on: false, x: NaN, win: NaN, core: NaN, good: false, gold: false };
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
  private levelCore: HTMLDivElement;
  private tripMain: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private scoreKey = '';
  private scoreBump = 0;
  private toastAt = -1e9;
  /** the trip panel's layout box changed (content, a late font, resize): measure it once, before the next pop writes */
  private tripDirty = true;
  /** x1: right edge · bottom: where the second row may start (both with room for the panel's bounce) */
  private tripBox = { x0: 0, x1: 0, bottom: 0 };
  private objectiveEl: HTMLElement | null = null;
  private objectiveDirty = true;
  /** bumped whenever a box the grade pops avoid may have moved (size observers, resize) */
  private layoutGen = 0;
  private sizeObs: ResizeObserver | null = null;
  private frames = 0;
  /** grade pops keep clear of these (cached; re-measured only when what they depend on changes) */
  private popBoxes: Box[] = [];
  private popBoxKey = '';
  private placed: Box[] = [0, 1, 2, 3].map(() => ({ x0: 0, y0: 0, x1: 0, y1: 0 }));
  private bigEl: HTMLDivElement;
  private bigTimer = 0;
  private _reduceFlashing = false;
  /** Reduce flashing: no flashes, and every HUD/Log pulse and thump holds still (a class on <html> for the CSS). */
  get reduceFlashing(): boolean {
    return this._reduceFlashing;
  }
  set reduceFlashing(on: boolean) {
    this._reduceFlashing = on;
    document.documentElement.classList.toggle('reduce-flashing', on);
  }
  onPortraitTap: ((id: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    const r = (this.root = document.createElement('div'));
    r.className = 'hud';
    r.innerHTML = `
      <div class="hud-wave">
        <svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/><circle class="wave-gold" cx="50" cy="50" r="49"/><circle class="arc" cx="50" cy="50" r="42"/></svg>
        <div class="hud-wave-icon">🌊</div>
        <div class="hud-wave-side"></div>
        <div class="hud-wave-label">HOLD BRACE!</div>
      </div>
      <div class="hud-toast"><span></span></div>
      <div class="hud-big"></div>
      <div class="hud-trip blank"><div class="hud-trip-main"></div><div class="hud-score off"></div></div>
      <div class="hud-portraits"></div>
      <div class="hud-flash"></div>
      <div class="hud-stack">
        <div class="hud-radio"><div class="hud-radio-who">📻 Mo</div><div class="hud-radio-text"></div></div>
        <div class="hud-level"><div class="hud-level-win"></div><div class="hud-level-core core"></div><div class="hud-level-bubble"></div><div class="hud-level-cap">LEVEL</div></div>
        <div class="prompt-hint"></div>
        <div class="prompt"></div>
      </div>`;
    parent.appendChild(r);
    this.waveEl = r.querySelector('.hud-wave')!;
    this.waveArc = r.querySelector('.hud-wave .arc')!;
    this.waveGold = r.querySelector('.hud-wave .wave-gold')!;
    this.waveLabel = r.querySelector('.hud-wave-label')!;
    this.waveSide = r.querySelector('.hud-wave-side')!;
    this.radioEl = r.querySelector('.hud-radio')!;
    this.radioText = r.querySelector('.hud-radio-text')!;
    this.radioWho = r.querySelector('.hud-radio-who')!;
    this.toastEl = r.querySelector('.hud-toast')!;
    this.toastText = this.toastEl.querySelector('span')!;
    this.tripEl = r.querySelector('.hud-trip')!;
    this.tripMain = r.querySelector('.hud-trip-main')!;
    this.scoreEl = r.querySelector('.hud-score')!;
    this.portraitsEl = r.querySelector('.hud-portraits')!;
    this.promptEl = r.querySelector('.prompt')!;
    this.hintEl = r.querySelector('.prompt-hint')!;
    this.flashEl = r.querySelector('.hud-flash')!;
    this.levelEl = r.querySelector('.hud-level')!;
    this.levelBubble = r.querySelector('.hud-level-bubble')!;
    this.levelWin = r.querySelector('.hud-level-win')!;
    this.levelCore = r.querySelector('.hud-level-core')!;
    this.bigEl = r.querySelector('.hud-big')!;
    const circ = 2 * Math.PI * 42;
    this.waveArc.style.strokeDasharray = `${circ}`;
    this.waveArc.style.strokeDashoffset = `${circ}`;
    // sizes change for reasons the HUD can't see (an emoji font arriving late, the objective's text):
    // a ResizeObserver says so after layout, without forcing one
    const changed = () => {
      this.tripDirty = this.objectiveDirty = true;
      this.layoutGen++;
    };
    window.addEventListener('resize', changed);
    if (typeof ResizeObserver !== 'undefined') {
      this.sizeObs = new ResizeObserver(changed);
      this.sizeObs.observe(this.tripEl);
    }
  }

  /**
   * The scoring layer's gold targets, set once a frame: the steady-hand widening of the level window
   * (the HUD green then matches what the landing judge uses), the gold core and the PERFECT brace time.
   * The frame's own setLevel / setWave calls pick these up, so nothing is written twice.
   */
  setGoldTargets(winBonusDeg: number, coreDeg: number, perfectSec: number): void {
    this.winBonusDeg = winBonusDeg;
    this.coreDeg = coreDeg;
    this.perfectSec = perfectSec;
  }

  /** Wave warning ring: fill 0..1 toward impact. perfectSec: the gold arc at the end of the ring (brace in it for PERFECT). */
  setWave(state: { fill: number; side: RogueSide; secs: number; stage: number; lead?: number } | null, playerBraced: boolean, perfectSec = this.perfectSec): void {
    this.perfectSec = perfectSec;
    if (!state) {
      this.waveEl.classList.remove('on');
      return;
    }
    this.waveEl.classList.add('on');
    const circ = 2 * Math.PI * WAVE_R;
    this.waveArc.style.strokeDashoffset = `${circ * (1 - state.fill)}`;
    // the gold target: the last perfectSec / lead of the ring
    const lead = state.lead ?? (state.fill < 0.999 ? state.secs / Math.max(1e-3, 1 - state.fill) : 6.5);
    const frac = Math.max(0, Math.min(1, perfectSec / Math.max(0.5, lead)));
    if (Math.abs(frac - this.waveGoldFrac) > 0.002) {
      this.waveGoldFrac = frac;
      const gc = 2 * Math.PI * GOLD_R;
      this.waveGold.style.strokeDasharray = `${gc * frac} ${gc}`;
      this.waveGold.style.strokeDashoffset = `${-gc * (1 - frac)}`;
    }
    this.waveEl.classList.toggle('gold-now', !playerBraced && state.secs > 0 && state.secs <= perfectSec);
    const sideTxt = state.side === 'port' ? '◀ PORT' : state.side === 'starboard' ? 'STARBOARD ▶' : '▲ BOW';
    if (this.waveSide.textContent !== sideTxt) this.waveSide.textContent = sideTxt;
    const lbl = playerBraced ? 'HELD — hang on!' : state.secs < perfectSec ? 'BRACE NOW!' : 'HOLD BRACE!';
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
    this.toastAt = performance.now();
  }

  /** A toast that joins one shown a moment ago ("…the pot's loose! · Knot slipped!") instead of replacing it. */
  toastMore(text: string, color = '#eaf2f0', secs = 2.6): void {
    const fresh = this.toastTimer > 0 && performance.now() - this.toastAt < 400 && this.toastText.textContent;
    if (fresh) {
      this.toastText.textContent = `${this.toastText.textContent} · ${text}`;
      this.toastTimer = Math.max(this.toastTimer, secs);
    } else this.toast(text, color, secs);
  }

  /** A big banner is showing (lesser banners wait their turn). */
  get bigBusy(): boolean {
    return this.bigTimer > 0;
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

  /** A floating label anchored to a boat-local position. Grade pops are capped: the oldest makes room. */
  pop(text: string, local: THREE.Vector3, cls = '', life = 1.4, grade = false): void {
    if (grade) {
      const mine = this.pops.filter((p) => p.grade);
      for (let i = 0; i <= mine.length - MAX_GRADE_POPS; i++) {
        mine[i].el.remove();
        this.pops.splice(this.pops.indexOf(mine[i]), 1);
      }
    }
    const el = document.createElement('div');
    el.className = `hud-pop ${cls}${grade ? ' grade' : ''}`;
    el.textContent = text;
    this.root.appendChild(el);
    const scale = cls === 'perfect' ? 1.15 : 1;
    this.pops.push({ el, local: local.clone(), t: 0, life, grade, w: grade ? el.offsetWidth * scale : 0, h: grade ? el.offsetHeight * scale : 0 });
  }

  setTrip(html: string): void {
    if (this.tripMain.innerHTML !== html) {
      this.tripMain.innerHTML = html;
      this.tripDirty = true; // re-measured this frame (the size observer would only say so next frame)
    }
    this.tripEl.classList.toggle('blank', !html && this.scoreEl.classList.contains('off'));
  }

  /**
   * The rope strip under the trip panel: "⚓ 4,250 · ×1.75" and six knot glyphs (each fills over 3 knots,
   * so a full rope is the ×2.5 cap at 18). With scores hidden only the rope shows.
   */
  setScore(score: number, mult: number, knots: number, show = true): void {
    const key = `${score}|${mult}|${knots}|${show}`;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    this.tripDirty = true;
    const on = score > 0 || knots > 0;
    this.scoreEl.classList.toggle('off', !on);
    this.tripEl.classList.toggle('blank', !on && !this.tripMain.innerHTML);
    if (!on) return;
    let rope = '';
    for (let i = 0; i < 6; i++) {
      const f = Math.max(0, Math.min(3, knots - i * 3));
      rope += `<i class="knot k${f}"></i>`;
    }
    // the separator travels with the multiplier, so a wrap never leaves a dangling "·"
    const multTxt = mult > 1 ? ` <span class="hud-score-mult"><i class="hud-score-sep">·</i> ×${+mult.toFixed(2)}</span>` : '';
    const nums = show ? `<span class="hud-score-num">⚓ ${Math.round(score).toLocaleString('en-US')}</span>${multTxt}` : '<span class="hud-score-num">⚓</span>';
    this.scoreEl.innerHTML = `<span class="hud-score-line">${nums}</span><span class="hud-score-rope">${rope}</span>`;
  }

  /** The trip panel bounces when points land (the score glows gold for a moment). */
  bumpScore(): void {
    this.bumpTank();
    this.scoreBump = 0.45;
    this.scoreEl.classList.add('bump');
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

  /**
   * Spirit level (shown while landing a pot). angleDeg: current roll; window ±win (plus Mo's steady-hand
   * bonus from setGoldTargets); core ±core (the gold "dead level" band). Only changed values are written.
   */
  setLevel(show: boolean, angleDeg = 0, win = 4, core = this.coreDeg): void {
    this.coreDeg = core;
    const s = this.levelShown;
    if (show !== s.on) this.levelEl.classList.toggle('on', (s.on = show));
    if (!show) return;
    const w = win + this.winBonusDeg;
    const x = Math.round(Math.max(-1, Math.min(1, angleDeg / 15)) * 4500) / 4500;
    if (x !== s.x) this.levelBubble.style.left = `${50 + (s.x = x) * 45}%`;
    if (w !== s.win) this.levelWin.style.width = `${((s.win = w) / 15) * 90}%`;
    if (core !== s.core) this.levelCore.style.width = `${((s.core = core) / 15) * 90}%`;
    const good = Math.abs(angleDeg) < w;
    if (good !== s.good) this.levelEl.classList.toggle('good', (s.good = good));
    const gold = core > 0 && Math.abs(angleDeg) <= core;
    if (gold !== s.gold) this.levelBubble.classList.toggle('gold', (s.gold = gold));
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

  /**
   * The trip panel's layout box (transforms ignored, so a bump doesn't count), measured once per change.
   * It sets --trip-bottom, which keeps the second row (objective, wave ring, toast) below the panel on
   * narrow screens however tall the rope strip makes it; and when the centred objective pill would run
   * into the panel on a wider screen, the pill drops below it too.
   */
  private measureTrip(): void {
    this.tripDirty = false;
    const el = this.tripEl;
    const shown = el.offsetHeight > 0;
    // room for the panel's bounce too (scale 1.12 from its top-left corner, so it grows right and
    // down): nothing beside or below it is ever covered, even mid-bounce
    const b = { x0: shown ? el.offsetLeft : 0, x1: shown ? el.offsetLeft + Math.ceil(el.offsetWidth * BUMP) : 0, bottom: shown ? el.offsetTop + Math.ceil(el.offsetHeight * BUMP) + 3 : 0 };
    if (b.bottom !== this.tripBox.bottom) document.documentElement.style.setProperty('--trip-bottom', `${b.bottom}px`);
    if (b.x0 !== this.tripBox.x0 || b.x1 !== this.tripBox.x1 || b.bottom !== this.tripBox.bottom) {
      this.tripBox = b;
      this.objectiveDirty = true; // re-check the pill against the new panel
      this.layoutGen++;
    }
  }

  /** The objective pill (trip.ts owns it) changed size or the panel moved: drop it below the panel if they'd meet. */
  private placeObjective(): void {
    let ob = this.objectiveEl;
    if (!ob) {
      // trip.ts makes it after the HUD: pick it up once it exists (the first frame, in practice)
      ob = this.objectiveEl = document.querySelector<HTMLElement>('.objective');
      if (!ob) return;
      this.sizeObs?.observe(ob);
      this.objectiveDirty = true;
    }
    if (!this.objectiveDirty) return;
    this.objectiveDirty = false;
    const t = this.tripBox;
    const on = ob.offsetHeight > 0 && t.bottom > 0;
    // horizontal extents only: dropping it below doesn't change them, so this never flip-flops
    const clash = on && ob.offsetLeft < t.x1 + 4 && ob.offsetLeft + ob.offsetWidth > t.x0 - 4;
    if (clash !== ob.classList.contains('below-trip')) {
      ob.classList.toggle('below-trip', clash);
      this.layoutGen++;
    }
  }

  /** The wave ring (with its labels), the spirit level, the trip panel and the objective pill, while they show. */
  private popAvoidBoxes(): Box[] {
    const waveOn = this.waveEl.classList.contains('on');
    const levelOn = this.levelEl.classList.contains('on');
    const ob = this.objectiveEl;
    const obOn = !!ob && ob.style.display !== 'none' && ob.style.display !== '';
    // everything these boxes depend on, read without forcing a layout (and twice a second anyway: the
    // spirit level sits in the bottom stack, which moves with the prompt below it)
    const key = `${waveOn ? this.waveLabel.textContent : '-'}|${levelOn}|${obOn}|${this.layoutGen}|${Math.floor(this.frames / 30)}`;
    if (key === this.popBoxKey) return this.popBoxes;
    this.popBoxKey = key;
    const out: Box[] = [];
    const add = (r: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) => {
      if (r.width > 1 && r.height > 1) out.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 });
    };
    if (waveOn) {
      // one box for the ring and its labels, at the ring's largest size (it scales in and pulses)
      const rs = [this.waveEl, this.waveSide, this.waveLabel].map((e) => e.getBoundingClientRect());
      const r = rs[0];
      const k = WAVE_MAX_SCALE / Math.max(0.5, r.width / Math.max(1, this.waveEl.offsetWidth));
      const cx = r.left + r.width / 2,
        cy = r.top + r.height / 2;
      const x0 = Math.min(...rs.map((q) => q.left)),
        y0 = Math.min(...rs.map((q) => q.top)),
        x1 = Math.max(...rs.map((q) => q.right)),
        y1 = Math.max(...rs.map((q) => q.bottom));
      const u = { left: cx + (x0 - cx) * k, top: cy + (y0 - cy) * k, right: cx + (x1 - cx) * k, bottom: cy + (y1 - cy) * k, width: 0, height: 0 };
      u.width = u.right - u.left;
      u.height = u.bottom - u.top;
      add(u);
    }
    if (levelOn) add(this.levelEl.getBoundingClientRect());
    if (this.tripBox.bottom > 0) add({ left: this.tripBox.x0, top: 0, right: this.tripBox.x1, bottom: this.tripBox.bottom - 3, width: this.tripBox.x1 - this.tripBox.x0, height: 1e3 });
    if (obOn) add(ob!.getBoundingClientRect());
    this.popBoxes = out;
    return out;
  }

  /** Slide a grade pop up or down off the HUD's boxes and the grade pops already placed this frame. */
  private clearPop(x: number, y: number, hw: number, hh: number, avoid: Box[], placed: Box[], n: number, h: number): number {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const b of avoid) {
        if (!overlaps(x, y, hw, hh, b)) continue;
        // boxes in the top half push it down, the spirit level (bottom) pushes it up
        y = (b.y0 + b.y1) / 2 < h / 2 ? b.y1 + hh : b.y0 - hh;
        moved = true;
      }
      for (let i = 0; i < n; i++) {
        const b = placed[i];
        if (!overlaps(x, y, hw, hh, b)) continue;
        // stack away from the HUD on that side (down from the top row, up from the spirit level), so
        // the two rules never push it back and forth
        y = y < h / 2 ? b.y1 + hh + 2 : b.y0 - hh - 2;
        moved = true;
      }
      if (!moved) break;
    }
    return Math.max(hh + 4, Math.min(h - hh - 4, y));
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
    if (this.scoreBump > 0) {
      this.scoreBump -= dt;
      if (this.scoreBump <= 0) this.scoreEl.classList.remove('bump');
    }
    const w = window.innerWidth,
      h = window.innerHeight;
    // layout reads first, before this frame's pop writes (and only when something they depend on changed;
    // without a ResizeObserver, once a second)
    this.frames++;
    if (!this.sizeObs && this.frames % 60 === 0) this.tripDirty = this.objectiveDirty = true;
    if (this.tripDirty) this.measureTrip();
    this.placeObjective();
    const avoid = this.pops.some((p) => p.grade) ? this.popAvoidBoxes() : null;
    let nPlaced = 0;
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
      let x = (_v.x * 0.5 + 0.5) * w;
      let y = (-_v.y * 0.5 + 0.5) * h - 30 - k * 36;
      if (p.grade && avoid) {
        // a grade pop stays on screen and never sits on the wave ring, the spirit level, the trip panel,
        // the objective, or the other grade pop
        const hw = (p.w ?? 0) / 2 + 4,
          hh = (p.h ?? 0) / 2 + 2;
        x = Math.max(hw + 6, Math.min(w - hw - 6, x));
        y = this.clearPop(x, y, hw, hh, avoid, this.placed, nPlaced, h);
        if (nPlaced < this.placed.length) {
          const b = this.placed[nPlaced++];
          b.x0 = x - hw;
          b.x1 = x + hw;
          b.y0 = y - hh;
          b.y1 = y + hh;
        }
      }
      p.el.style.left = `${x}px`;
      p.el.style.top = `${y}px`;
      p.el.style.opacity = `${k < 0.75 ? 1 : 1 - (k - 0.75) * 4}`;
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }
}
