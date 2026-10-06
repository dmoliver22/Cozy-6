/**
 * The galley potluck: the crew around a small table, snow on the window, the stove glowing,
 * Barnacle napping. Drag 2–3 ingredients into the pot to cook a dish (a small buff for next trip),
 * and the trip's photos are pinned to the wall as Polaroids — save the best as a postcard.
 */
import * as THREE from 'three';
import { config } from '../config';
import { makeCrew, CREW_LOOKS, type CrewView } from '../art/crew';
import { makeCat } from '../art/cat';
import { makeShipBell, makeBoot } from '../art/items';
import { toon, toonUnique, box, cyl, canvasTexture, wood } from '../art/materials';
import { Snow } from '../weather/snow';
import { galleyLook, type Look } from '../render/look';
import { SkyEnv, makeSkyUniforms, skyFromLook } from '../render/sky';
import { gradientTex } from '../render/textures';
import { renderPostcard } from '../photo/photos';
import { dataUrlToBlob, platformDownloads } from '../core/platform';
import type { PhotoRecord, SaveData } from '../core/save';
import type { Appraisal } from '../harbor/market';
import { LORE } from '../fishing/specials';
import { sfx, music } from '../audio';

const P = config.palette;

const PANTRY = [
  { id: 'potato', icon: '🥔', name: 'Potatoes' },
  { id: 'onion', icon: '🧅', name: 'Onion' },
  { id: 'butter', icon: '🧈', name: 'Butter' },
  { id: 'dill', icon: '🌿', name: 'Dill' },
  { id: 'lemon', icon: '🍋', name: 'Lemon' },
  { id: 'bread', icon: '🍞', name: 'Bread' },
  { id: 'corn', icon: '🌽', name: 'Corn' },
];
const CATCH_ING: Record<string, { icon: string; name: string }> = {
  red: { icon: '🦀', name: 'Red king crab' },
  blue: { icon: '🦀', name: 'Blue king crab' },
  snow: { icon: '🦀', name: 'Snow crab' },
  golden: { icon: '✨', name: 'Golden king crab' },
};

export function dishFor(ings: string[]): { name: string; icon: string; line: string } {
  const has = (x: string) => ings.includes(x);
  const crab = ings.some((i) => i in CATCH_ING);
  if (has('golden')) return { name: 'Golden Potluck Pie', icon: '🥧', line: 'A pie fit for a lighthouse keeper. Everyone goes quiet for a moment.' };
  if (crab && has('butter') && has('lemon')) return { name: 'Buttery Crab Legs', icon: '🦀', line: "Mo hums. Dot steals the last leg. Ike wears butter on his chin." };
  if (crab && (has('potato') || has('corn') || has('onion'))) return { name: 'Bering Chowder', icon: '🍲', line: 'Thick enough to stand a spoon in. Warm right down to the boots.' };
  if (crab && has('bread')) return { name: 'Crab Melt Sandwiches', icon: '🥪', line: 'Crispy, cheesy, gone in a minute.' };
  if (has('snow') && has('dill')) return { name: 'Dilly Snow Crab', icon: '🌿', line: 'Light and bright. Barnacle approves (she got a claw).' };
  if (crab) return { name: 'Crab Boil', icon: '🦀', line: 'A big steaming pile on newspaper. Messy and perfect.' };
  return { name: 'Pantry Stew', icon: '🍲', line: "No crab, but plenty of love. Mo says it's his gran's recipe." };
}

function seat(v: CrewView, x: number, z: number, yaw: number, scene: THREE.Scene): void {
  v.root.position.set(x, 0.62, z);
  v.root.rotation.y = yaw;
  v.parts.legs.obj.rotation.x = -1.35;
  v.parts.legs.obj.position.z += 0.18;
  v.parts.armL.obj.rotation.set(-1.0, 0, -0.15);
  v.parts.armR.obj.rotation.set(-1.0, 0, 0.15);
  scene.add(v.root);
}

export class Galley {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** lamplight interior (src/render/look.ts); the stage grades the frame with it */
  readonly look: Look = galleyLook();
  private env: SkyEnv | null = null;
  private envSky = makeSkyUniforms();
  readonly ui: HTMLDivElement;
  private t = 0;
  private stoveLight: THREE.PointLight;
  private lantern: THREE.PointLight;
  private snow: Snow;
  private crew: CrewView[] = [];
  private steam: THREE.Mesh[] = [];
  private pot: string[] = [];
  private cooked = false;
  private stoveLoop: ReturnType<typeof sfx.loop>;
  private purrLoop: ReturnType<typeof sfx.loop>;
  onNext: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private save: SaveData,
    private photos: PhotoRecord[],
    private appraisal: Appraisal,
    private stats: { overboards: number; allHeld: number },
    private newFinds: { bottle: boolean; boot: boolean; bell: boolean },
  ) {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 60);
    const sc = this.scene;
    const look = this.look;
    sc.background = new THREE.Color(0x2a1d16);
    // warm lamplight interior: a low warm fill, the lantern and stove do the rest
    sc.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity));
    // the "sky" here is the room itself, only for reflections: dark timber, amber lamplight
    skyFromLook(this.envSky, look, 0, { clouds: 0, ground: new THREE.Color(0x2a1a12) });
    // room: tongue-and-groove planking (box-projected, so the planks keep their size)
    // (a greyer, weathered timber: the lamplight supplies the orange, so the yellow oilskins still pop)
    const wallMat = wood(0xa48a72, { plankWidth: 0.16, along: 'x', weathered: true, rough: 0.7 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), wood(0x7e5c44, { plankWidth: 0.2, along: 'x', weathered: true, rough: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    sc.add(floor);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), wallMat);
    back.position.set(0, 1.6, -2.5);
    back.receiveShadow = true;
    sc.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), wallMat);
    left.position.set(-3, 1.6, 0);
    left.rotation.y = Math.PI / 2;
    sc.add(left);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), wallMat);
    right.position.set(3, 1.6, 0);
    right.rotation.y = -Math.PI / 2;
    sc.add(right);
    // window with snow outside: the last of the dusk over the harbour
    const dusk = gradientTex([
      [0, '#24325e'],
      [0.55, '#4a4f86'],
      [0.82, '#c98a7a'],
      [1, '#e8a878'],
    ]);
    const winMat = new THREE.MeshBasicMaterial({ map: dusk });
    winMat.color.setScalar(1.25); // a touch above white so it glows in the bloom
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), winMat);
    win.position.set(0.6, 1.7, -2.49);
    sc.add(win);
    const frame = toon(0x5a3a26);
    sc.add(box(1.55, 0.08, 0.06, frame, 0.6, 2.22, -2.46), box(1.55, 0.08, 0.06, frame, 0.6, 1.18, -2.46), box(0.08, 1.1, 0.06, frame, -0.12, 1.7, -2.46), box(0.08, 1.1, 0.06, frame, 1.32, 1.7, -2.46), box(0.04, 1.0, 0.04, frame, 0.6, 1.7, -2.45));
    sc.add(box(1.5, 0.06, 0.25, toon(P.foam), 0.6, 1.2, -2.38)); // snow on the sill
    // stove
    sc.add(box(0.8, 1.0, 0.7, toon(0x2e3338), -2.3, 0.5, -1.9));
    const fire = box(0.42, 0.26, 0.02, toonUnique(0xff8a3d, { emissive: 0xff6a1a }), -2.3, 0.42, -1.54);
    sc.add(fire);
    const pipe = cyl(0.08, 0.08, 2.2, toon(0x2e3338));
    pipe.position.set(-2.3, 2.1, -2.1);
    sc.add(pipe);
    this.stoveLight = new THREE.PointLight(P.amber, 6, 7, 1.4);
    this.stoveLight.position.set(-2.2, 0.8, -1.3);
    sc.add(this.stoveLight);
    // lantern over the table: a point light for the room and a soft spot that pools light on the
    // table and casts the crew's shadows (when the tier has shadows)
    // (hung high, so the lantern itself sits just above the frame instead of behind the title)
    this.lantern = new THREE.PointLight(0xffd09a, 4.5, 8, 1.5);
    this.lantern.position.set(0, 2.62, 0);
    sc.add(this.lantern);
    const pool = new THREE.SpotLight(0xffc98a, 6, 7, 1.0, 0.9, 1.4);
    pool.position.set(0, 2.6, 0);
    pool.target.position.set(0, 0, 0);
    pool.castShadow = true;
    pool.shadow.mapSize.set(1024, 1024);
    pool.shadow.bias = -0.0006;
    pool.shadow.normalBias = 0.02;
    pool.shadow.radius = 4;
    pool.shadow.intensity = 0.7;
    sc.add(pool, pool.target);
    // cool moonlight falling in through the window and across the room: it cools the floor, the
    // table, the left wall and the crew's shoulders, so they separate from the lamplit timber by
    // warm/cool contrast rather than only by the vignette
    const winLight = new THREE.DirectionalLight(0x7f9bd6, 0.42);
    winLight.position.set(2.4, 4.2, -5.2);
    winLight.target.position.set(-0.8, 0.6, 1.2);
    sc.add(winLight, winLight.target);
    // the lantern body: a warm glow, not a blown white box behind the title
    sc.add(box(0.2, 0.28, 0.2, toonUnique(0xc9a37a, { emissive: 0xffb860, emissiveIntensity: 0.4 }), 0, 2.8, 0));
    // table & bench
    sc.add(box(1.8, 0.08, 1.1, toon(P.wood), 0, 0.78, 0));
    sc.add(box(0.15, 0.78, 0.15, toon(0x6b4b35), 0, 0.39, 0));
    for (const [x, z] of [
      [-0.55, -0.25],
      [0.55, 0.25],
      [0.1, -0.3],
      [-0.3, 0.3],
    ]) {
      const mug = cyl(0.06, 0.06, 0.12, toon(P.slicker));
      mug.position.set(x, 0.88, z);
      sc.add(mug);
    }
    // the potluck pot on the table + steam
    const cauldron = cyl(0.26, 0.2, 0.26, toon(0x3a3f46), 14);
    cauldron.position.set(0, 0.95, 0);
    sc.add(cauldron);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      s.position.set(0, 1.1, 0);
      sc.add(s);
      this.steam.push(s);
    }
    // the crew around the table, hats on the hook
    const looks = [
      { ...CREW_LOOKS.mo },
      { ...CREW_LOOKS.dot },
      { ...CREW_LOOKS.ike },
      { ...CREW_LOOKS.player, isPlayer: false, hatColor: save.hatColor, boots: save.finds.boot ? 0x7d9a3a : undefined },
    ];
    const places: [number, number, number][] = [
      [-1.25, 0, Math.PI / 2],
      [1.25, 0, -Math.PI / 2],
      [0, -0.95, 0],
      [0, 0.95, Math.PI],
    ];
    looks.forEach((l, i) => {
      const v = makeCrew(l);
      seat(v, places[i][0], places[i][1], places[i][2], sc);
      this.crew.push(v);
    });
    // Barnacle by the stove (or in her hammock)
    const cat = makeCat();
    if (save.upgrades.includes('catHammock')) {
      const ham = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(P.hull));
      ham.scale.set(1.2, 0.35, 0.7);
      ham.position.set(-1.6, 1.3, -2.0);
      sc.add(ham);
      cat.root.position.set(-1.6, 1.36, -2.0);
    } else {
      sc.add(box(0.6, 0.08, 0.5, toon(0x8a3a3a), -1.6, 0.04, -1.5));
      cat.root.position.set(-1.6, 0.18, -1.5);
    }
    cat.setPose('loaf', 0);
    cat.root.rotation.y = 0.8;
    sc.add(cat.root);
    // finds: the old ship's bell by the door, the boot
    if (save.finds.bell) {
      const bell = makeShipBell();
      bell.scale.setScalar(1.6);
      bell.position.set(2.6, 2.0, -1.8);
      sc.add(bell);
    }
    if (save.finds.boot) {
      const boot = makeBoot();
      boot.position.set(2.4, 0.2, 1.2);
      sc.add(boot);
    }
    // photo board on the right wall
    const board = box(0.06, 1.3, 2.2, toon(0xb48a5a), 2.95, 1.65, 0.2);
    sc.add(board);
    this.pinPhotos(sc);
    this.snow = new Snow(sc, 500);
    this.snow.points.position.set(0, 0, 0);
    this.camera.position.set(0.4, 2.0, 3.4);
    this.camera.lookAt(0, 0.9, -0.4);

    this.stoveLoop = sfx.loop('stove', { volume: 0.6 });
    this.purrLoop = sfx.loop('purr', { volume: 0.35 });
    music.setMood('galley');

    this.ui = document.createElement('div');
    this.ui.className = 'galley-ui interactive';
    parent.appendChild(this.ui);
    this.buildUi();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private pinPhotos(sc: THREE.Scene): void {
    const loader = new THREE.TextureLoader();
    this.photos.slice(0, 6).forEach((ph, i) => {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.55), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6 }));
      g.add(frame);
      const tex = loader.load(ph.img);
      tex.colorSpace = THREE.SRGBColorSpace;
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
      pic.position.set(0, 0.05, 0.002);
      g.add(pic);
      const cap = canvasTexture(256, 48, (c) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 256, 48);
        c.fillStyle = '#23262b';
        c.font = 'italic 22px Georgia, serif';
        c.textAlign = 'center';
        c.fillText(ph.caption.length > 26 ? ph.caption.slice(0, 25) + '…' : ph.caption, 128, 30);
      });
      const capM = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.085), new THREE.MeshStandardMaterial({ map: cap, roughness: 0.6 }));
      capM.position.set(0, -0.19, 0.002);
      g.add(capM);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), toon(this.save.hatColor));
      pin.position.set(0, 0.24, 0.02);
      g.add(pin);
      const col = i % 3,
        row = Math.floor(i / 3);
      g.position.set(2.91, 1.95 - row * 0.62, -0.45 + col * 0.65);
      g.rotation.y = -Math.PI / 2;
      g.rotation.z = (((i * 37) % 7) - 3) * 0.03;
      sc.add(g);
    });
  }

  private buildUi(): void {
    const tankSpecies = this.appraisal.lines.filter((l) => l.count > 0).map((l) => l.species);
    if (!tankSpecies.length) tankSpecies.push('snow');
    const chips = [
      ...tankSpecies.map((s) => ({ id: s, icon: CATCH_ING[s].icon, name: CATCH_ING[s].name })),
      ...PANTRY,
    ];
    const lore = this.newFinds.bottle ? LORE[(this.save.tripsCompleted + 1) % LORE.length] : '';
    this.ui.innerHTML = `
      <div class="g-top">
        <div class="g-title">Potluck in the galley</div>
        <div class="g-sub">$${Math.round(this.appraisal.total).toLocaleString('en-US')} earned · ${this.appraisal.crabs} crab · ${this.stats.allHeld} rogue sets held · ${this.stats.overboards} swims${(this.stats as { score?: string }).score ?? ''}</div>
      </div>
      ${lore ? `<div class="g-lore">📜 From the bottle: <i>${lore}</i></div>` : ''}
      <div class="g-pot" data-pot><div class="g-pot-icon">🍲</div><div class="g-pot-items"></div><div class="g-pot-hint">Drag 2–3 ingredients into the pot</div></div>
      <div class="g-tray">${chips.map((c) => `<div class="g-chip" data-i="${c.id}"><span>${c.icon}</span><b>${c.name}</b></div>`).join('')}</div>
      <div class="g-actions">
        <button class="btn primary" data-a="cook" disabled>Cook!</button>
        <button class="btn" data-a="photos">📸 Photo board</button>
        <button class="btn" data-a="next">Next trip →</button>
      </div>
      <div class="g-result"></div>
      <div class="g-photos"><div class="g-photos-inner"></div></div>`;
    const potEl = this.ui.querySelector<HTMLElement>('[data-pot]')!;
    const cook = this.ui.querySelector<HTMLButtonElement>('[data-a="cook"]')!;
    // pointer-based drag (mouse & touch alike)
    this.ui.querySelectorAll<HTMLElement>('.g-chip').forEach((chip) => {
      chip.addEventListener('pointerdown', (e) => {
        if (this.cooked) return;
        e.preventDefault();
        const ghost = chip.cloneNode(true) as HTMLElement;
        ghost.classList.add('ghost');
        document.body.appendChild(ghost);
        const move = (ev: PointerEvent) => {
          ghost.style.left = ev.clientX + 'px';
          ghost.style.top = ev.clientY + 'px';
          const r = potEl.getBoundingClientRect();
          potEl.classList.toggle('hot', ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom);
        };
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', end);
          ghost.remove();
          potEl.classList.remove('hot');
        };
        const up = (ev: PointerEvent) => {
          end();
          const r = potEl.getBoundingClientRect();
          const inside = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
          // a quick tap also adds it (no precise dragging needed)
          const tap = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 8;
          if ((inside || tap) && this.pot.length < 3 && !this.pot.includes(chip.dataset.i!)) {
            this.pot.push(chip.dataset.i!);
            chip.classList.add('used');
            sfx.play('plop', { pitch: 0.8 + this.pot.length * 0.15 });
            this.renderPot();
            cook.disabled = this.pot.length < 2;
          }
        };
        move(e);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', end);
      });
    });
    cook.addEventListener('click', () => this.cook());
    this.ui.querySelector('[data-a="photos"]')!.addEventListener('click', () => this.togglePhotos());
    this.ui.querySelector('[data-a="next"]')!.addEventListener('click', () => {
      sfx.play('uiConfirm');
      this.stoveLoop.stop(0.5);
      this.purrLoop.stop(0.5);
      this.onNext?.();
    });
  }

  private renderPot(): void {
    const el = this.ui.querySelector('.g-pot-items')!;
    el.innerHTML = this.pot.map((i) => `<span>${(CATCH_ING[i] ?? PANTRY.find((p) => p.id === i))!.icon}</span>`).join('');
  }

  private cook(): void {
    if (this.cooked || this.pot.length < 2) return;
    this.cooked = true;
    const dish = dishFor(this.pot);
    this.save.buff = 'warmBellies';
    sfx.play('cook', { volume: 0.9 });
    later(() => sfx.play('cheer', { volume: 0.7 }), 1300);
    const res = this.ui.querySelector<HTMLElement>('.g-result')!;
    res.innerHTML = `<div class="g-dish"><div class="g-dish-icon">${dish.icon}</div><div><div class="g-dish-name">${dish.name}</div><div class="g-dish-line">${dish.line}</div><div class="g-buff">Warm bellies: brace +10% next trip</div></div></div>`;
    res.classList.add('on');
    this.ui.querySelector<HTMLButtonElement>('[data-a="cook"]')!.disabled = true;
    this.steam.forEach((s, i) => (s.userData.t = -i * 0.4));
  }

  private togglePhotos(): void {
    const box = this.ui.querySelector<HTMLElement>('.g-photos')!;
    const on = !box.classList.contains('on');
    box.classList.toggle('on', on);
    if (!on) return;
    const inner = box.querySelector<HTMLElement>('.g-photos-inner')!;
    if (!this.photos.length) {
      inner.innerHTML = '<div class="g-empty">No photos this trip — the ocean was shy. Next time!</div><button class="btn" data-x>Close</button>';
    } else {
      inner.innerHTML =
        this.photos.map((p, i) => `<figure class="polaroid" style="--r:${(((i * 37) % 7) - 3) * 1.2}deg"><img src="${p.img}" alt=""><figcaption>${p.caption}</figcaption></figure>`).join('') +
        `<div class="g-photo-actions"><button class="btn primary" data-pc>💌 Save postcard</button><button class="btn" data-x>Close</button></div>`;
      inner.querySelector('[data-pc]')!.addEventListener('click', () => this.postcard());
    }
    inner.querySelector('[data-x]')!.addEventListener('click', () => box.classList.remove('on'));
  }

  bestPhoto(): PhotoRecord | null {
    const order = ['golden', 'gag', 'overboard', 'allHeld', 'special', 'wipeout', 'cat'];
    const sorted = [...this.photos].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return sorted[0] ?? null;
  }

  private postcardBusy = false;

  private async postcard(): Promise<void> {
    const best = this.bestPhoto();
    // building the card takes a few seconds: one at a time, and say so on the button
    if (!best || this.postcardBusy) return;
    this.postcardBusy = true;
    sfx.play('pageTurn');
    const btn = this.ui.querySelector<HTMLButtonElement>('[data-pc]');
    let label = '💌 Save postcard';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Developing…';
    }
    try {
      // let the busy label paint before the heavy drawing starts
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const url = await renderPostcard(best, { earnings: this.appraisal.total, kg: this.appraisal.kg, crabs: this.appraisal.crabs, golden: this.appraisal.golden, overboards: this.stats.overboards, allHeld: this.stats.allHeld }, this.save.hatColor);
      const blob = dataUrlToBlob(url);
      // inside the claude.ai viewer: the viewer's own save prompt
      const dl = await platformDownloads();
      if (dl) {
        try {
          await dl.save({ filename: 'potluck-postcard.png', data: blob });
          label = '💌 Postcard saved';
          return;
        } catch (e) {
          if ((e as { code?: string })?.code === 'declined') return;
          // anything else: show it so it can be saved by hand
        }
      }
      if (!__ARTIFACT__) {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'potluck-postcard.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      this.showPostcard(URL.createObjectURL(blob));
    } finally {
      this.postcardBusy = false;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }

  /** Where the page can't save files: show the postcard full size to save by hand. */
  private showPostcard(src: string): void {
    const inner = this.ui.querySelector<HTMLElement>('.g-photos-inner')!;
    // the hint first and the card sized to the screen, so the hint and Close are never below the fold
    inner.innerHTML = `<figure class="postcard-preview"><figcaption>Right-click or long-press the postcard to save it.</figcaption><img src="${src}" alt="Pot Luck postcard"></figure><div class="g-photo-actions"><button class="btn" data-x>Close</button></div>`;
    inner.querySelector('[data-x]')!.addEventListener('click', () => {
      this.ui.querySelector('.g-photos')!.classList.remove('on');
      URL.revokeObjectURL(src);
    });
  }

  update(dt: number, renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera, look: Look) => void): void {
    this.t += dt;
    const t = this.t;
    if (!this.env) {
      this.env = new SkyEnv(renderer, 256);
      this.scene.environment = this.env.update(this.envSky);
      this.scene.environmentIntensity = 0.6;
    }
    this.stoveLight.intensity = 5.5 + Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.6;
    this.lantern.intensity = 4.5 + Math.sin(t * 3.1) * 0.15;
    this.camera.position.x = 0.4 + Math.sin(t * 0.15) * 0.3;
    this.camera.lookAt(0, 0.95, -0.4);
    // little idle life: heads bob, someone laughs
    this.crew.forEach((c, i) => {
      c.parts.head.obj.rotation.z = Math.sin(t * 1.3 + i) * 0.08;
      c.parts.head.obj.rotation.x = Math.sin(t * 0.9 + i * 2) * 0.05;
      c.body.position.y = Math.abs(Math.sin(t * 2 + i)) * (this.cooked ? 0.03 : 0.01);
    });
    for (const s of this.steam) {
      const k = (s.userData.t = (s.userData.t ?? 0) + dt);
      if (!this.cooked || k < 0) continue;
      const ph = k % 2.4;
      s.position.set(Math.sin(k * 2) * 0.08, 1.1 + ph * 0.5, Math.cos(k * 1.7) * 0.06);
      s.scale.setScalar(0.6 + ph * 0.8);
      (s.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - ph / 2.4);
    }
    // a thin curtain of snow right at the window pane
    this.snow.update(t * 0.4, new THREE.Vector3(0.6, 1.7, -2.3), new THREE.Vector2(0.15, 0), 0.05, 0.9, window.innerHeight * renderer.getPixelRatio() * 0.12, 0, 1.1);
    if (draw) draw(this.scene, this.camera, this.look);
    else renderer.render(this.scene, this.camera);
  }
}

function later(fn: () => void, ms: number): void {
  setTimeout(fn, ms);
}
