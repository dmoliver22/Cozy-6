/**
 * Pause menu with settings: quality, comfort roll, head-bob, haptics, volume, music,
 * invert look, reduce flashing, hold to carry, show scores. Big touch-friendly controls; the buttons stay
 * reachable (sticky) when the card has to scroll on a short screen.
 */
import type { Settings } from '../core/settings';

export interface MenuHooks {
  onChange(s: Settings): void;
  onResume(): void;
  onRestart?(): void;
  onHarbor?(): void;
}

export class PauseMenu {
  readonly root: HTMLDivElement;
  open = false;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private hooks: MenuHooks,
  ) {
    const r = (this.root = document.createElement('div'));
    r.className = 'menu interactive';
    r.innerHTML = `
      <div class="menu-card">
        <div class="menu-title">Paused</div>
        <div class="menu-sub">the kettle's on</div>
        <label class="row"><span>Quality</span>
          <select data-k="quality"><option value="auto">Auto</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label class="row"><span>First-person roll (comfort)</span><input type="range" min="0" max="0.6" step="0.05" data-k="comfortRoll"><b class="val" data-v="comfortRoll"></b></label>
        <label class="row"><span>Head-bob</span><input type="checkbox" data-k="headBob"></label>
        <label class="row"><span>Haptics</span><input type="checkbox" data-k="haptics"></label>
        <label class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-k="volume"></label>
        <label class="row"><span>Music</span><input type="range" min="0" max="1" step="0.05" data-k="music"></label>
        <label class="row"><span>Hold to carry<small class="row-note">Off: tap to pick up, tap again to put down</small></span><input type="checkbox" data-k="holdToCarry"></label>
        <label class="row"><span>Invert look</span><input type="checkbox" data-k="invertLook"></label>
        <label class="row"><span>Reduce flashing</span><input type="checkbox" data-k="reduceFlashing"></label>
        <label class="row"><span>Show scores<small class="row-note">Off: grades keep their words, the numbers hide</small></span><input type="checkbox" data-k="showScores"></label>
        <div class="menu-help">
          <b>Desktop</b> WASD move · mouse aims · LMB grab/use, click again to put down · RMB aim & throw · Shift/Space brace · E interact · Q ping a bot · V view · F3 debug<br>
          <b>Gamepad</b> L-stick move · R-stick aim/look · A grab, A again to put down · X interact · LB brace · RT throw · RB ping · Y view<br>
          <b>Phone</b> left thumb moves · Action button does what it shows: tap to pick up, tap again to put down, drag it to throw · BRACE · 👁 view · tap a portrait then a spot to send a bot
        </div>
        <div class="menu-buttons">
          <button class="btn primary" data-a="resume">Back to work</button>
          <button class="btn" data-a="harbor">Run for home</button>
        </div>
      </div>`;
    parent.appendChild(r);
    this.sync();
    r.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => {
      const k = el.dataset.k as keyof Settings;
      const on = () => {
        const s = this.settings as unknown as Record<string, unknown>;
        if (el instanceof HTMLInputElement && el.type === 'checkbox') s[k] = el.checked;
        else if (el instanceof HTMLInputElement && el.type === 'range') s[k] = Number(el.value);
        else s[k] = el.value;
        this.sync();
        this.hooks.onChange(this.settings);
      };
      el.addEventListener('input', on);
      el.addEventListener('change', on);
    });
    r.querySelector('[data-a="resume"]')!.addEventListener('click', () => this.hide());
    r.querySelector('[data-a="harbor"]')!.addEventListener('click', () => {
      this.hide();
      this.hooks.onHarbor?.();
    });
    r.addEventListener('pointerdown', (e) => e.stopPropagation());
    r.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }

  private sync(): void {
    const s = this.settings as unknown as Record<string, unknown>;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => {
      const k = el.dataset.k!;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!s[k];
      else el.value = String(s[k]);
    });
    this.root.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => (el.textContent = Number(s[el.dataset.v!]).toFixed(2)));
  }

  show(): void {
    this.open = true;
    this.sync();
    this.root.classList.add('on');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  hide(): void {
    this.open = false;
    this.root.classList.remove('on');
    this.hooks.onResume();
  }
  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }
}
