/**
 * Kittiwake Harbor: a small snowy dock with three stops —
 *   Fish buyer (crab pour onto the scale while the tally counts up) → Chandlery (pick 1 upgrade)
 *   → Knit shop (pick a hat color) → on to the galley.
 */
import * as THREE from 'three';
import { config } from '../config';
import { makeBoat } from '../art/boat';
import { makeCrew, CREW_LOOKS } from '../art/crew';
import { makeCrab } from '../art/crab';
import { toon, toonUnique, box, cyl, canvasTexture } from '../art/materials';
import { Snow } from '../weather/snow';
import { harborLook, type Look } from '../render/look';
import { SkyDome, SkyEnv, skyFromLook } from '../render/sky';
import { rippleNormalTex, snowNormalTex } from '../render/textures';
import { appraise, UPGRADES, HAT_COLORS, type Appraisal, type TankEntry } from './market';
import type { SaveData } from '../core/save';
import { sfx, music } from '../audio';
import { easeInOut } from '../core/math';

const P = config.palette;

function sign(text: string, color: string): THREE.Mesh {
  const tex = canvasTexture(512, 128, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#2a1b0e';
    g.lineWidth = 8;
    g.strokeRect(4, 4, 504, 120);
    g.fillStyle = '#f6efe0';
    g.font = 'bold 64px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
  });
  // a painted board, lit by the sunset like everything else
  return new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
}

/**
 * Packed snow: a slightly cool off-white (albedo about 0.72, so the low sun doesn't blow it out),
 * matte, with a lumpy wind-packed normal map so it reads as a surface. `rx`/`ry` are tiles per
 * UV unit of the geometry it goes on (pick them so the tiles come out square, about 4 m).
 */
const snowMats = new Map<string, THREE.MeshStandardMaterial>();
function snowMat(rx: number, ry = rx): THREE.MeshStandardMaterial {
  const key = `${rx}_${ry}`;
  let m = snowMats.get(key);
  if (m) return m;
  const n = snowNormalTex().clone();
  n.repeat.set(rx, ry);
  n.needsUpdate = true;
  m = new THREE.MeshStandardMaterial({ color: 0xd9dde4, roughness: 0.86, metalness: 0, normalMap: n, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.7 });
  snowMats.set(key, m);
  return m;
}

function building(w: number, h: number, d: number, wall: number, label: string, labelColor: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, d, toon(wall), 0, h / 2, 0));
  // pitched roof with snow
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2 - 0.3, 0);
  roofShape.lineTo(0, h * 0.55);
  roofShape.lineTo(w / 2 + 0.3, 0);
  roofShape.closePath();
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.4, bevelEnabled: false }), toon(0x5a3a2a));
  roof.position.set(0, h, -d / 2 - 0.2);
  roof.castShadow = true;
  g.add(roof);
  // a snow cap over the roof (brown eaves peek out underneath)
  // (extrude UVs are in metres)
  const snow = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.3, bevelEnabled: false }), snowMat(0.35));
  snow.receiveShadow = true;
  snow.scale.set(0.96, 1.0, 1);
  snow.position.set(0, h + 0.06, -d / 2 - 0.15);
  g.add(snow);
  // glowing windows + door
  const win = toonUnique(P.amber, { emissive: P.amber });
  for (const x of [-w * 0.28, w * 0.28]) g.add(box(0.7, 0.6, 0.05, win, x, h * 0.55, d / 2 + 0.01));
  g.add(box(0.9, 1.6, 0.05, toon(0x3a2a20), 0, 0.8, d / 2 + 0.01));
  const s = sign(label, labelColor);
  s.position.set(0, h + 0.1, d / 2 + 0.24); // in front of the roof's gable end, not inside it
  g.add(s);
  // the door lamp: soft and well off the wall, so the shop front glows instead of hot-spotting
  const lamp = new THREE.PointLight(P.amber, 3, 9, 1.6);
  lamp.position.set(0, h * 0.6, d / 2 + 1.7);
  g.add(lamp);
  return g;
}

export class Harbor {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** golden sunset (src/render/look.ts); the stage grades the frame with it */
  readonly look: Look;
  private sky: SkyDome;
  private env: SkyEnv | null = null;
  private seaNormal: THREE.Texture;
  readonly ui: HTMLDivElement;
  private snow: Snow;
  private boat: THREE.Group;
  private t = 0;
  private camFrom = new THREE.Vector3();
  private camTo = new THREE.Vector3();
  private lookFrom = new THREE.Vector3();
  private lookTo = new THREE.Vector3();
  private camT = 1;
  private stop = 0;
  private stops: { cam: THREE.Vector3; look: THREE.Vector3 }[] = [];
  private pour: { mesh: THREE.Object3D; v: number; y0: number; settled: boolean }[] = [];
  private scale: THREE.Group;
  private needle: THREE.Mesh;
  private model: ReturnType<typeof makeCrew>;
  appraisal!: Appraisal;
  onDone: (() => void) | null = null;
  private chosenUpgrade: string | null = null;

  constructor(
    parent: HTMLElement,
    private save: SaveData,
    private tank: TankEntry[],
    private endTime: number,
    private finds: { boot: boolean; bell: boolean },
  ) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.2, 300);
    const sc = this.scene;
    // golden sunset: the camera looks up the street (−Z); the low sun is behind it, to the
    // right, raking warm light across the shop fronts while the sky above them goes violet
    const hl = (this.look = harborLook(Math.PI));
    sc.fog = new THREE.Fog(hl.fogColor, hl.fogNear, hl.fogFar);
    sc.add(new THREE.HemisphereLight(hl.hemiSky, hl.hemiGround, hl.hemiIntensity * 0.6));
    const sun = new THREE.DirectionalLight(hl.sunColor, hl.sunIntensity);
    sun.position.copy(hl.sunDir).multiplyScalar(40).add(new THREE.Vector3(-1, 0, -5));
    sun.target.position.set(-1, 0, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const ssc = sun.shadow.camera;
    ssc.left = -18;
    ssc.right = 18;
    ssc.top = 12;
    ssc.bottom = -12;
    ssc.near = 5;
    ssc.far = 90;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    sun.shadow.intensity = 0.8;
    sc.add(sun, sun.target);
    // a cool rim from up behind the shops: high enough that its mirror highlight on the glossy
    // harbour water falls below the frame instead of glaring in the foreground
    const rim = new THREE.DirectionalLight(hl.rimColor, hl.rimIntensity);
    rim.position.set(-14, 40, -22);
    sc.add(rim);
    this.sky = new SkyDome(140);
    skyFromLook(this.sky.uniforms, hl, 0, { clouds: 1.3 });
    sc.add(this.sky.mesh);
    // still harbour water: deep teal, glossy, wind ripples (reflects the sunset sky)
    this.seaNormal = rippleNormalTex().clone();
    this.seaNormal.repeat.set(40, 40);
    this.seaNormal.needsUpdate = true;
    // rough enough that the bright sunset sky smears into a soft sheen, not a blown blob
    // (the quay lamps' highlights included: they spread into soft warm streaks)
    const seaMat = new THREE.MeshStandardMaterial({ color: hl.sea.mid, roughness: 0.32, metalness: 0.0, normalMap: this.seaNormal, normalScale: new THREE.Vector2(0.2, 0.2), envMapIntensity: 0.75 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.6;
    sea.receiveShadow = true;
    sc.add(sea);
    // snowy shore
    const shore = new THREE.Mesh(new THREE.BoxGeometry(80, 1, 22), snowMat(18, 5)); // 80 × 22 m top: ~4.4 m tiles
    shore.position.set(0, -0.3, -14);
    shore.receiveShadow = true;
    sc.add(shore);
    // dock
    const dockMat = toon(P.wood);
    const dock = new THREE.Group();
    for (let i = 0; i < 18; i++) dock.add(box(4, 0.15, 0.5, dockMat, 0, 0.2, -3 + i * 0.55));
    for (let i = 0; i < 6; i++) {
      for (const x of [-1.8, 1.8]) {
        const p = cyl(0.15, 0.15, 2, toon(0x5a4030), 8);
        p.position.set(x, -0.6, -3 + i * 1.9);
        dock.add(p);
      }
    }
    dock.position.set(-2, 0, 0);
    sc.add(dock);
    // the Puffin moored alongside
    const art = makeBoat();
    this.boat = art.root;
    this.boat.scale.setScalar(0.9);
    this.boat.position.set(4.6, 0.6, 2);
    this.boat.rotation.y = 0;
    sc.add(this.boat);
    // the three stops
    const buyer = building(5, 3, 4, 0x6c8a9a, 'FISH BUYER', '#1f5c66');
    buyer.position.set(-9, 0, -8);
    const chand = building(5, 3.4, 4, P.hull, 'CHANDLERY', '#7a2a1d');
    chand.position.set(-1, 0, -9);
    const knit = building(4.4, 3, 4, P.slicker, 'KNIT SHOP', '#8a5a12');
    knit.position.set(7, 0, -8);
    sc.add(buyer, chand, knit);
    // lamp posts
    for (const x of [-12, -4.5, 3, 10.5]) {
      const post = cyl(0.07, 0.09, 3, toon(0x2b2f36), 6);
      post.position.set(x, 1.5, -4.6);
      const bulb = box(0.3, 0.3, 0.3, toonUnique(0xffe1a8, { emissive: 0xffc070 }), x, 3.1, -4.6);
      const pl = new THREE.PointLight(0xffc98a, 2.6, 8, 1.8);
      pl.position.set(x, 3, -4.6);
      sc.add(post, bulb, pl);
    }
    // the scale at the fish buyer
    this.scale = new THREE.Group();
    this.scale.add(box(1.6, 0.12, 1.2, toon(0x9aa5ab), 0, 0.9, 0));
    this.scale.add(box(0.15, 0.9, 0.15, toon(0x55606a), 0, 0.45, 0));
    const dial = cyl(0.35, 0.35, 0.06, toon(0xf6efe0), 20);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0, 1.5, 0.4);
    this.scale.add(dial);
    this.needle = box(0.03, 0.3, 0.02, toon(0xc8432f), 0, 1.5, 0.44);
    this.needle.geometry.translate(0, 0.13, 0);
    this.scale.add(this.needle);
    this.scale.position.set(-8.5, 0, -4.5);
    sc.add(this.scale);
    // the player model for the knit shop
    const look = { ...CREW_LOOKS.player, hatColor: save.hatColor, isPlayer: false };
    if (finds.boot) look.boots = 0x7d9a3a;
    this.model = makeCrew(look);
    this.model.root.position.set(6.2, 0.85, -4.6);
    this.model.root.rotation.y = 0.3;
    sc.add(this.model.root);
    this.snow = new Snow(sc, 1200);

    this.stops = [
      { cam: new THREE.Vector3(-5.2, 4.0, 5.2), look: new THREE.Vector3(-8.8, 1.9, -5.6) },
      { cam: new THREE.Vector3(0.5, 3.2, 2.5), look: new THREE.Vector3(-1, 1.6, -8) },
      { cam: new THREE.Vector3(8.5, 2.6, -0.5), look: new THREE.Vector3(6.4, 1.3, -4.8) },
    ];
    this.camera.position.set(2, 6, 12);
    this.camera.lookAt(0, 0, -4);
    this.camFrom.copy(this.camera.position);
    this.lookFrom.set(0, 0, -4);
    this.goStop(0);

    this.appraisal = appraise(tank, endTime);
    this.ui = document.createElement('div');
    this.ui.className = 'harbor-ui interactive';
    parent.appendChild(this.ui);
    music.setMood('harbor');
    music.setIntensity(0);
    this.showBuyer();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private goStop(i: number): void {
    this.stop = i;
    this.camFrom.copy(this.camera.position);
    this.lookFrom.copy(this.lookTo.lengthSq() ? this.lookTo : new THREE.Vector3(0, 0, -4));
    this.camTo.copy(this.stops[i].cam);
    this.lookTo.copy(this.stops[i].look);
    this.camT = 0;
  }

  // ------------------------------------------------------------- stops
  private showBuyer(): void {
    const a = this.appraisal;
    const rows = a.lines
      .map((l, i) => `<div class="tally-row" style="animation-delay:${0.5 + i * 0.6}s"><span>${l.name}</span><span>${l.count} · ${l.kg.toFixed(1)} kg</span><b data-v="${Math.round(l.value)}">$0</b></div>`)
      .join('');
    this.ui.innerHTML = `
      <div class="h-card">
        <div class="h-title">🐟 Fish Buyer</div>
        <div class="h-sub">"Let's see what the Puffin brought in…"</div>
        <div class="tally">${rows || '<div class="tally-row"><span>An empty tank — there is always next trip!</span></div>'}</div>
        ${a.wrong ? `<div class="tally-note">${a.wrong} short or female crab in the tank — the buyer docks ${Math.round(a.penalty * 100)}%</div>` : ''}
        <div class="tally-note">Freshness ${Math.round(a.freshness * 100)}%</div>
        <div class="tally-total">Total <b class="total">$0</b></div>
        <button class="btn primary" data-n="1">Next: the Chandlery →</button>
      </div>`;
    // count up
    const vals = Array.from(this.ui.querySelectorAll<HTMLElement>('[data-v]'));
    vals.forEach((el, i) => {
      const target = Number(el.dataset.v);
      const start = performance.now() + 500 + i * 600;
      const tick = () => {
        const k = Math.min(1, Math.max(0, (performance.now() - start) / 700));
        el.textContent = '$' + Math.round(target * k).toLocaleString('en-US');
        if (k < 1) requestAnimationFrame(tick);
        else sfx.play('tally', { volume: 0.5 });
      };
      requestAnimationFrame(tick);
    });
    const totalEl = this.ui.querySelector<HTMLElement>('.total')!;
    const tStart = performance.now() + 600 + vals.length * 600;
    const tick = () => {
      const k = Math.min(1, Math.max(0, (performance.now() - tStart) / 900));
      totalEl.textContent = '$' + Math.round(a.total * easeInOut(k)).toLocaleString('en-US');
      if (k < 1) requestAnimationFrame(tick);
      else sfx.play('coins', { volume: 0.8 });
    };
    requestAnimationFrame(tick);
    // crabs pour onto the scale
    const n = Math.min(40, Math.max(3, this.tank.length));
    for (let i = 0; i < n; i++) {
      const e = this.tank[i % Math.max(1, this.tank.length)] ?? { species: 'red' };
      const m = makeCrab(e.species, 'm', 0.9 + Math.random() * 0.2);
      m.position.set(-8.5 + (Math.random() - 0.5) * 1.2, 4 + i * 0.25, -4.5 + (Math.random() - 0.5) * 0.8);
      m.rotation.y = Math.random() * 6;
      this.scene.add(m);
      this.pour.push({ mesh: m, v: 0, y0: 1.0 + Math.random() * 0.25 + Math.floor(i / 12) * 0.1, settled: false });
    }
    this.bind();
  }

  private showChandlery(): void {
    const owned = new Set(this.save.upgrades);
    const cards = UPGRADES.map(
      (u) => `<button class="u-card ${owned.has(u.id) ? 'owned' : ''}" data-u="${u.id}" ${owned.has(u.id) ? 'disabled' : ''}>
        <div class="u-icon">${u.icon}</div><div class="u-name">${u.name}</div><div class="u-desc">${owned.has(u.id) ? 'Already aboard' : u.desc}</div></button>`,
    ).join('');
    this.ui.innerHTML = `
      <div class="h-card">
        <div class="h-title">⚓ Chandlery</div>
        <div class="h-sub">Pick one upgrade for the Puffin.</div>
        <div class="u-grid">${cards}</div>
        <button class="btn primary" data-n="2" disabled>Next: the Knit Shop →</button>
      </div>`;
    const next = this.ui.querySelector<HTMLButtonElement>('[data-n="2"]')!;
    if (UPGRADES.every((u) => owned.has(u.id))) next.disabled = false;
    this.ui.querySelectorAll<HTMLButtonElement>('[data-u]').forEach((b) =>
      b.addEventListener('click', () => {
        this.ui.querySelectorAll('.u-card').forEach((c) => c.classList.remove('sel'));
        b.classList.add('sel');
        this.chosenUpgrade = b.dataset.u!;
        next.disabled = false;
        sfx.play('uiTap');
      }),
    );
    this.bind();
  }

  private showKnit(): void {
    const sw = HAT_COLORS.map((c) => `<button class="swatch ${c === this.save.hatColor ? 'sel' : ''}" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('');
    this.ui.innerHTML = `
      <div class="h-card">
        <div class="h-title">🧶 Knit Shop</div>
        <div class="h-sub">A fresh beanie for the next trip?</div>
        <div class="swatches">${sw}</div>
        ${this.finds.boot ? '<div class="tally-note">🥾 You are wearing the lucky boot you fished up.</div>' : ''}
        <button class="btn primary" data-n="3">To the galley — potluck time! →</button>
      </div>`;
    this.ui.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) =>
      b.addEventListener('click', () => {
        this.ui.querySelectorAll('.swatch').forEach((c) => c.classList.remove('sel'));
        b.classList.add('sel');
        this.save.hatColor = Number(b.dataset.c);
        this.model.setHatColor(this.save.hatColor);
        sfx.play('uiTap');
      }),
    );
    this.bind();
  }

  private bind(): void {
    this.ui.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.play('uiConfirm');
        const n = Number(b.dataset.n);
        if (n === 1) {
          this.save.coins += Math.round(this.appraisal.total);
          this.goStop(1);
          this.showChandlery();
        } else if (n === 2) {
          if (this.chosenUpgrade && !this.save.upgrades.includes(this.chosenUpgrade)) this.save.upgrades.push(this.chosenUpgrade);
          this.goStop(2);
          this.showKnit();
        } else {
          this.ui.remove();
          this.onDone?.();
        }
      }),
    );
  }

  update(dt: number, renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera, look: Look) => void): void {
    this.t += dt;
    if (!this.env) {
      this.env = new SkyEnv(renderer, 256);
      this.scene.environment = this.env.update(this.sky.uniforms);
      this.scene.environmentIntensity = 0.7;
    }
    this.sky.uniforms.uSkyTime.value = this.t;
    this.sky.mesh.position.copy(this.camera.position);
    this.seaNormal.offset.set(this.t * 0.004, this.t * 0.0025);
    // camera dolly between stops
    if (this.camT < 1) this.camT = Math.min(1, this.camT + dt / 1.6);
    const k = easeInOut(this.camT);
    this.camera.position.lerpVectors(this.camFrom, this.camTo, k);
    const look = new THREE.Vector3().lerpVectors(this.lookFrom, this.lookTo, k);
    this.camera.position.y += Math.sin(this.t * 0.5) * 0.05;
    this.camera.lookAt(look);
    // the boat bobs at its mooring
    this.boat.position.y = 0.6 + Math.sin(this.t * 0.9) * 0.08;
    this.boat.rotation.z = Math.sin(this.t * 0.7) * 0.02;
    // crabs pour onto the scale
    let onScale = 0;
    for (const p of this.pour) {
      if (p.settled) {
        onScale++;
        continue;
      }
      p.v -= 9.8 * dt;
      p.mesh.position.y += p.v * dt;
      if (p.mesh.position.y <= p.y0) {
        p.mesh.position.y = p.y0;
        if (Math.abs(p.v) > 2) {
          p.v = -p.v * 0.25;
          sfx.play('click', { volume: 0.3, pitch: 1 + Math.random() * 0.4 });
        } else p.settled = true;
      }
    }
    this.needle.rotation.z = -Math.min(2.6, onScale * 0.07) + Math.sin(this.t * 6) * 0.01;
    this.model.root.rotation.y = 0.3 + Math.sin(this.t * 0.6) * 0.4;
    this.snow.update(this.t, this.camera.position, new THREE.Vector2(0.4, 0.2), 0.2, 0.7, window.innerHeight * renderer.getPixelRatio(), 0);
    if (draw) draw(this.scene, this.camera, this.look);
    else renderer.render(this.scene, this.camera);
  }
}
