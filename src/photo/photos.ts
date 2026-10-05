/**
 * Auto-captured "moments" (max 6): someone overboard, a wave wipeout, the golden crab,
 * a special catch, everyone braced through a rogue set, the cat sliding. Rendered from a
 * dedicated photo camera into a small target, kept as JPEG data URLs for the galley wall.
 */
import * as THREE from 'three';
import { config } from '../config';
import { events } from '../core/events';
import { later } from '../core/schedule';
import { sfx } from '../audio';
import type { PhotoRecord } from '../core/save';
import type { Ctx } from '../game/ctx';
import type { CrewManager } from '../crew/crewManager';

const NAMES: Record<string, string> = { player: 'You', mo: 'Mo', dot: 'Dot', ike: 'Ike' };
const SPECIAL_NAMES: Record<string, string> = { bottle: 'a message in a bottle', octopus: 'an octopus', boot: "somebody's boot", bell: "an old ship's bell", otter: 'a sea otter', jelly: 'a glowing jellyfish' };

export class PhotoDirector {
  readonly photos: PhotoRecord[] = [];
  private kinds = new Set<string>();
  private cam: THREE.PerspectiveCamera;
  private rt: THREE.WebGLRenderTarget;
  private canvas: HTMLCanvasElement;
  private pending = 0;
  enabled = true;

  constructor(
    private ctx: Ctx,
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private flash: () => void,
    private beforeCapture: () => void = () => {},
  ) {
    ctx.sys.photos = this;
    const w = config.photo.width,
      h = config.photo.height;
    this.cam = new THREE.PerspectiveCamera(42, w / h, 0.2, 400);
    this.rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const crew = () => ctx.sys.crew as CrewManager;

    events.on('overboard', ({ kind, who, worldPos }) => {
      if (kind !== 'crew' || !who) return;
      this.request('overboard', who === 'player' ? 'You, going for a swim' : `${NAMES[who]} goes for a swim`, () => {
        const c = crew().get(who as never);
        return c.inSea ? c.wp.clone() : worldPos.clone();
      }, 0.9);
    });
    events.on('knockdown', ({ crew: who, reason }) => {
      if (reason !== 'wave') return;
      const gag = ctx.sys.tutorialGag;
      const cap = gag && who === 'ike' ? 'Ike, airborne' : who === 'player' ? 'You vs. the wave' : `${NAMES[who]} vs. the wave`;
      this.request(gag ? 'gag' : 'wipeout', cap, () => this.local(crew().get(who as never).pos(new THREE.Vector3())), config.photo.delaySec);
    });
    events.on('golden', ({ localPos }) => this.request('golden', 'Golden!', () => this.local(localPos), 0.5));
    events.on('special', ({ kind, localPos }) => this.request('special', `Look what came up: ${SPECIAL_NAMES[kind] ?? kind}!`, () => this.local(localPos), 0.9));
    events.on('rogueResolved', ({ allHeld }) => {
      if (allHeld) this.request('allHeld', 'Everyone held!', () => this.local(new THREE.Vector3(0, 0.8, -1)), 0.05);
    });
    events.on('catSlide', ({ localPos }) => this.request('cat', "Barnacle's belly slide", () => this.local(localPos), 0.25));
  }

  private local(p: THREE.Vector3): THREE.Vector3 {
    return this.ctx.boat.localToWorld(p, new THREE.Vector3());
  }

  /** Ask for a photo of a subject (world-space getter), shot after a short delay for peak action. */
  request(kind: string, caption: string, subject: () => THREE.Vector3, delay: number): void {
    if (!this.enabled) return;
    if (this.photos.length + this.pending >= config.photo.max) return;
    if (this.kinds.has(kind)) return;
    this.kinds.add(kind);
    this.pending++;
    later(delay, () => {
      this.pending--;
      try {
        this.capture(caption, kind, subject());
      } catch (e) {
        console.warn('photo failed', e);
      }
    });
  }

  private capture(caption: string, kind: string, s: THREE.Vector3): void {
    const b = this.ctx.boat;
    // frame from the starboard quarter, above, looking at the subject with the boat behind it
    const side = new THREE.Vector3(-Math.cos(b.yaw), 0, Math.sin(b.yaw)); // starboard
    const back = new THREE.Vector3(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
    this.cam.position.copy(s).addScaledVector(side, 6.5).addScaledVector(back, 3).add(new THREE.Vector3(0, 4.2, 0));
    this.cam.lookAt(s.x, s.y + 0.6, s.z);
    this.cam.updateMatrixWorld();
    this.beforeCapture();
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.cam);
    const w = this.rt.width,
      h = this.rt.height;
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(this.rt, 0, 0, w, h, buf);
    r.setRenderTarget(prev);
    const g = this.canvas.getContext('2d')!;
    const img = g.createImageData(w, h);
    // flip vertically (GL origin is bottom-left)
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    g.putImageData(img, 0, 0);
    // a warm little vignette
    const grd = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(40,20,0,0.35)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    const url = this.canvas.toDataURL('image/jpeg', 0.82);
    this.photos.push({ img: url, caption, kind });
    sfx.play('camera', { volume: 0.6 });
    this.flash();
    events.emit('photo', { caption });
  }
}

/** Render a 1080 × 1350 postcard of the best photo with the trip stats. */
export async function renderPostcard(photo: PhotoRecord, stats: { earnings: number; kg: number; crabs: number; golden: number; overboards: number; allHeld: number }, hatColor: number): Promise<string> {
  const W = 1080,
    H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // paper
  g.fillStyle = '#f6efe0';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(160,120,70,0.06)';
  for (let i = 0; i < 400; i++) g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  // header
  g.fillStyle = '#c8432f';
  g.fillRect(0, 0, W, 150);
  g.fillStyle = '#f2c230';
  g.font = '900 86px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('Pot Luck', W / 2, 105);
  // the photo as a polaroid, slightly tilted
  const img = await loadImage(photo.img);
  g.save();
  g.translate(W / 2, 560);
  g.rotate(-0.035);
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 30;
  g.fillRect(-440, -360, 880, 760);
  g.shadowBlur = 0;
  g.drawImage(img, -400, -320, 800, 600);
  g.fillStyle = '#23262b';
  g.font = 'italic 46px Georgia, serif';
  g.fillText(photo.caption, 0, 350);
  g.restore();
  // pin
  g.fillStyle = '#' + hatColor.toString(16).padStart(6, '0');
  g.beginPath();
  g.arc(W / 2, 215, 22, 0, Math.PI * 2);
  g.fill();
  // stats
  g.fillStyle = '#1f5c66';
  g.font = '800 40px Trebuchet MS, sans-serif';
  g.textAlign = 'left';
  const lines = [
    `🦀 ${stats.crabs} crab · ${stats.kg.toFixed(1)} kg in the tank`,
    `💰 $${Math.round(stats.earnings).toLocaleString('en-US')} at the fish buyer`,
    `✨ ${stats.golden} golden · 🤲 ${stats.allHeld} rogue sets held · 🛟 ${stats.overboards} swims`,
  ];
  lines.forEach((l, i) => g.fillText(l, 90, 1070 + i * 62));
  g.fillStyle = '#7d7ba6';
  g.font = 'italic 34px Georgia, serif';
  g.fillText('Greetings from Kittiwake Harbor — aboard the Puffin', 90, 1290);
  return c.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}
