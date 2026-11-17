import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ExtrudeGeometry,
  Color,
  createSystem,
  Group,
  Hovered,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Pressed,
  Quaternion,
  RayInteractable,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import {
  BH, BOTTOM, BW, CAP_R, COLS, PADDLE_H, PADDLE_W, PADDLE_Y, R, ROWS, TOP, W,
  KIND_BOMB, blast, brickX, brickY, dropCapsule, launch, makeLevel, step, stepCapsules, today, type Capsule, type Events, type Game,
} from './breaker-core.js';
import { Backdrop, Option } from './components.js';
import { CAP_STYLE, brickPalette, canvasPlane, drawChip, drawFx, drawHud, drawMessage, drawProgress, drawToast, glowTexture, iconTexture, makeBackground, patternTexture, setTheme, tileTexture } from './look.js';
import { clearDay, clearedToday, liveStreak, newProgress, rankOf, type Progress } from './progress.js';
import { Synth } from './synth.js';

const D = 1.4; // radius of the curved playfield around the player; its 65 deg arc sits inside the glasses' 74
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // pentatonic: each chained brick climbs one note
const C4 = 261.63;
const PARTS = 48;
const SAVE_KEY = 'gaze-breaker-best';
const START_SPEED = 1.1;

type Panel = ReturnType<typeof canvasPlane>;
const TRAIL = 10; // ball trail length (samples)
const CAP_NAMES = ['WIDE PADDLE', 'SLOW MOTION', 'FIREBALL'];
const CAP_SECONDS = [10, 6, 7];
const CAP_CHIME = [784, 988, 1175];
const DROP_CHANCE = 0.16;
const OPT_KEY = 'gaze-breaker-options';
const PROG_KEY = 'gaze-breaker-progress';
// High-contrast tile colours: the Okabe-Ito colour-blind-safe set, each 3:1 or better against the dark sky.
const HC_COLORS = [0xf0e442, 0xe69f00, 0x56b4e9, 0x009e73, 0xcc79a7];
const OPT_KEYS = ['calm', 'contrast', 'assist'] as const;
const OPT_TEXT = [['CALM', 'Less motion, soft sound'], ['CONTRAST', 'Easier to see'], ['ASSIST', 'Easier to play']];

export class BreakerSystem extends createSystem({
  pressed: { required: [Backdrop, Pressed] },
  options: { required: [Option] },
  pressedOptions: { required: [Option, Pressed] },
}) {
  private synth = new Synth();
  private anchor!: Group;
  private field!: Group;
  private bricks: Mesh[] = [];
  private ball!: Mesh;
  private paddleMesh!: Mesh;
  private hud!: Panel;
  private msg!: Panel;
  private comboPanel!: Panel;
  private toast!: Panel;
  private toastT = 0;
  private toastText = '';
  private caps: Capsule[] = [];
  private capMeshes: Sprite[] = [];
  private capAge: number[] = [];
  private icons: ReturnType<typeof iconTexture>[] = [];
  private fxPanel!: Panel;
  private paletteLevel = -1;
  private tmpColor = new Color();
  private fx = [0, 0, 0]; // seconds left: wide paddle, slow motion, fireball
  private freeze = 0; // hit-stop: the game holds for a few frames on big combos
  private energy = 0; // 0..1 how hot the player's streak is: drives the background and the hats
  private hot = false;
  private bg!: ReturnType<typeof makeBackground>;
  private halo!: Sprite;
  private trail: Sprite[] = [];
  private trailXY = new Float32Array(TRAIL * 2);
  private trailT = 0;
  private clock = 0;
  private plates!: InstancedMesh; // every brick's shadow plate and neon bloom: 2 draw calls instead of 100
  private halos!: InstancedMesh;
  private dummy = new Object3D();
  private mats: MeshStandardMaterial[] = [];
  private parts: Mesh[] = [];
  private pv = new Float32Array(PARTS * 3);
  private plife = new Float32Array(PARTS);
  private pnext = 0;
  private g: Game = { x: 0, y: 0, vx: 0, vy: 0, speed: START_SPEED, paddle: 0, paddleW: PADDLE_W, pierce: false, alive: [], kind: [], idle: 0 };
  private ev: Events = { brick: -1, paddle: false, wall: false, lost: false };
  private state: 'ready' | 'play' | 'over' = 'ready';
  private wait = 0; // seconds spent in 'ready' or 'over'
  private level = 1;
  private score = 0;
  private lives = 3;
  private best = 0;
  private combo = 0;
  private shake = 0;
  private mouseX = 0; // -1..1, 2D desktop fallback
  private immersive = false;
  private blurred = false; // the system menu is open: pause
  private recenterIn = -1;
  private audioT = 0;
  private nudge = 0; // quick surge, gone in a third of a second
  private flash = 0; // 1 right after a big moment, fading over 2 s
  private ringBoost = 0;
  private o = new Vector3();
  private d = new Vector3();
  private p = new Vector3();
  private quat = new Quaternion();
  private colors: Color[] = brickPalette(0, ROWS); // row colours: the opposite hue to the current sky
  private tileMap!: ReturnType<typeof tileTexture>;
  private wallColor = new Color(0x88aaff);
  private hcColors = HC_COLORS.map((h) => new Color(h));
  private hcMaps: ReturnType<typeof patternTexture>[] = [];
  private bombMat!: MeshPhysicalMaterial; // the one special brick: it blasts its neighbours
  private bombColor = new Color(0xffe9a8); // pale hot: stands out from every row colour
  private blasted: number[] = [];
  private dayName = ''; // name of today's shape
  private dayNameFor = -1;
  private ballPlate!: Sprite; // black outlines that keep the ball and paddle visible against any tile
  private paddlePlate!: Sprite;
  private opts = { calm: false, contrast: false, assist: false };
  private optPanels: Panel[] = [];
  private prog: Progress = newProgress(); // daily streak and lifetime bricks, saved on the device
  private progPanel!: Panel;
  private faster = false; // a new level just started and the ball is quicker
  private daily = false; // today's wall was just cleared: celebrate until the next launch

  init(): void {
    const start = () => this.synth.start();
    for (const ev of ['click', 'touchstart', 'pointerup']) {
      window.addEventListener(ev, start);
      this.cleanupFuncs.push(() => window.removeEventListener(ev, start));
    }
    const move = (e: PointerEvent) => (this.mouseX = (e.clientX / window.innerWidth) * 2 - 1);
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    window.addEventListener('pointermove', move);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', start),
      () => window.removeEventListener('keydown', start),
      () => window.removeEventListener('pointermove', move),
    );
    try {
      this.best = Number(localStorage.getItem(SAVE_KEY)) || 0;
      Object.assign(this.opts, JSON.parse(localStorage.getItem(OPT_KEY) ?? '{}'));
      Object.assign(this.prog, JSON.parse(localStorage.getItem(PROG_KEY) ?? '{}'));
      for (const k of ['streak', 'lastDay', 'bricks'] as const) if (!Number.isFinite(this.prog[k])) this.prog[k] = 0;
    } catch {
      /* storage blocked: best score just doesn't persist */
    }

    const anchorEntity = this.world.createTransformEntity(new Group());
    this.anchor = anchorEntity.object3D as Group;
    this.anchor.position.y = 1.6; // desktop default head height; re-centred on the player in XR
    const fieldEntity = this.world.createTransformEntity(new Group(), { parent: anchorEntity });
    this.field = fieldEntity.object3D as Group;
    this.field.position.z = -D;
    this.bg = makeBackground();
    this.anchor.add(this.bg.mesh);

    // Invisible pinch/click target behind everything, so a pinch anywhere you look counts.
    const backdrop = new Mesh(
      new PlaneGeometry(2.6, 2.0),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    backdrop.position.set(0, -0.25, -D - 0.03);
    const be = this.world.createTransformEntity(backdrop, { parent: anchorEntity });
    be.addComponent(RayInteractable);
    be.addComponent(Backdrop);

    const glow = glowTexture();
    const sprite = (color: number, opacity: number) =>
      new Sprite(new SpriteMaterial({ map: glow, color, opacity, blending: AdditiveBlending, transparent: true, depthWrite: false }));

    // Rounded, bevelled tiles with a glossy clear coat, so light slides across them as they sway.
    const bev = 0.007, hw = BW / 2 - bev, hh = BH / 2 - bev, rr = 0.012;
    const outline = new Shape();
    outline.moveTo(-hw + rr, -hh);
    outline.lineTo(hw - rr, -hh); outline.quadraticCurveTo(hw, -hh, hw, -hh + rr);
    outline.lineTo(hw, hh - rr); outline.quadraticCurveTo(hw, hh, hw - rr, hh);
    outline.lineTo(-hw + rr, hh); outline.quadraticCurveTo(-hw, hh, -hw, hh - rr);
    outline.lineTo(-hw, -hh + rr); outline.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
    const brick = new ExtrudeGeometry(outline, {
      depth: 0.03, bevelEnabled: true, bevelThickness: 0.009, bevelSize: bev, bevelSegments: 2, curveSegments: 3,
    });
    brick.translate(0, 0, -0.015);
    const mats = this.colors.map(
      (c) => new MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, metalness: 0.1, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }),
    );
    this.mats = mats;
    this.hcMaps = [0, 1, 2, 3, 4].map((k) => patternTexture(k, BW, BH));
    this.tileMap = tileTexture(BW, BH);
    const bombMap = patternTexture(5, BW, BH);
    this.bombMat = new MeshPhysicalMaterial({
      color: this.bombColor, emissive: this.bombColor, emissiveIntensity: 0.9, metalness: 0.1, roughness: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.08, map: bombMap, emissiveMap: bombMap, // '!' mark: not colour alone
    });
    for (let i = 0; i < COLS * ROWS; i++) {
      const m = new Mesh(brick, mats[Math.floor(i / COLS)]);
      this.put(m, brickX(i), brickY(i));
      this.field.add(m);
      this.bricks.push(m);
    }
    const quad = new PlaneGeometry(1, 1);
    this.plates = new InstancedMesh(
      quad,
      new MeshBasicMaterial({ map: glow, color: 0x000000, opacity: 0.65, transparent: true, depthWrite: false }),
      COLS * ROWS,
    );
    this.halos = new InstancedMesh(
      quad,
      new MeshBasicMaterial({ map: glow, opacity: 0.3, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      COLS * ROWS,
    );
    for (let i = 0; i < COLS * ROWS; i++) {
      this.halos.setColorAt(i, this.colors[Math.floor(i / COLS)]);
      this.glowAt(i, true);
    }
    this.plates.frustumCulled = this.halos.frustumCulled = false;
    this.field.add(this.plates, this.halos);

    this.paddleMesh = new Mesh(
      new BoxGeometry(PADDLE_W, PADDLE_H, 0.04),
      new MeshStandardMaterial({ color: 0xffffff, emissive: 0xaaccff, emissiveIntensity: 0.8 }),
    );
    this.ball = new Mesh(
      new SphereGeometry(R, 20, 14),
      new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 }),
    );
    const plateFor = (parent: Mesh, w: number, h: number) => {
      const p = new Sprite(new SpriteMaterial({ map: glow, color: 0x000000, opacity: 0, transparent: true, depthWrite: false }));
      p.position.z = -0.02;
      p.scale.set(w, h, 1);
      parent.add(p);
      return p;
    };
    this.ballPlate = plateFor(this.ball, R * 7, R * 7);
    this.paddlePlate = plateFor(this.paddleMesh, PADDLE_W * 1.5, PADDLE_H * 6);
    this.field.add(this.paddleMesh, this.ball);

    // A faint rail along the paddle's path, so the edges of the play space read without a box.
    const rail: Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (-W / 2 - 0.1 + (i / 40) * (W + 0.2)) / D;
      rail.push(new Vector3(D * Math.sin(a), PADDLE_Y - 0.035, D * (1 - Math.cos(a))));
    }
    this.field.add(
      new Line(
        new BufferGeometry().setFromPoints(rail),
        new LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.35, blending: AdditiveBlending }),
      ),
    );

    this.halo = sprite(0x88aaff, 0.9);
    this.halo.scale.setScalar(0.2);
    this.field.add(this.halo);
    for (let i = 0; i < TRAIL; i++) {
      const t = sprite(0x66ccff, 0.55 * (1 - i / TRAIL));
      t.scale.setScalar(0.1 * (1 - i / (TRAIL * 1.4)));
      this.field.add(t);
      this.trail.push(t);
    }

    this.icons = CAP_STYLE.map((_, k) => iconTexture(k));
    for (let i = 0; i < 4; i++) {
      this.caps.push({ on: false, x: 0, y: 0, kind: 0 });
      const m = new Sprite(new SpriteMaterial({ map: this.icons[0], transparent: true, depthWrite: false }));
      m.visible = false;
      const gl = sprite(0xffffff, 0.8); // coloured halo behind the badge
      gl.position.z = -0.01;
      gl.scale.setScalar(2.2); // relative to the badge
      m.add(gl);
      this.field.add(m);
      this.capMeshes.push(m);
      this.capAge.push(0);
    }

    const dot = new SphereGeometry(0.01, 8, 6);
    for (let i = 0; i < PARTS; i++) {
      const m = new Mesh(dot, new MeshBasicMaterial());
      m.visible = false;
      this.field.add(m);
      this.parts.push(m);
    }

    this.hud = canvasPlane(1.5, 0.19, 1280);
    this.hud.mesh.position.set(0, BOTTOM - 0.11, 0);
    this.msg = canvasPlane(1.0, 0.24, 1024);
    this.msg.mesh.position.set(0, -0.165, 0.05);
    this.comboPanel = canvasPlane(0.5, 0.09, 512);
    this.comboPanel.mesh.position.set(0, -0.62, -0.03); // behind the ball, so text never hides it
    this.toast = canvasPlane(1.0, 0.1, 768);
    this.toast.mesh.position.set(0, -0.45, -0.03);
    this.fxPanel = canvasPlane(1.1, 0.12, 768); // timers for running power-ups, just under the paddle
    this.fxPanel.mesh.position.set(0, -0.875, -0.03);
    this.field.add(this.hud.mesh, this.msg.mesh, this.comboPanel.mesh, this.toast.mesh, this.fxPanel.mesh);

    // Accessibility toggles, shown between rounds. Look at one to highlight it, pinch to switch it.
    OPT_TEXT.forEach((_, kind) => {
      const panel = canvasPlane(0.4, 0.15, 512);
      this.put(panel.mesh, (kind - 1) * 0.43, -0.61);
      const e = this.world.createTransformEntity(panel.mesh, { parent: fieldEntity });
      e.addComponent(RayInteractable);
      e.addComponent(Option, { kind });
      this.optPanels.push(panel);
    });
    this.progPanel = canvasPlane(1.2, 0.19, 1280);
    this.put(this.progPanel.mesh, 0, -0.395);
    this.field.add(this.progPanel.mesh);
    this.queries.pressedOptions.subscribe('qualify', (e) => {
      if (this.showMenus) this.toggle(e.getValue(Option, 'kind') as number); // pinch only: looking at a card never toggles it
    });

    this.newGame();
    this.applyOptions();

    this.queries.pressed.subscribe('qualify', () => {
      if (this.state === 'ready') this.go();
      else if (this.state === 'over' && this.wait > 0.7) this.newGame();
    });
    const panel = this.world.getSceneObject('welcome-panel');
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        const was = this.immersive;
        this.immersive = s !== VisibilityState.NonImmersive;
        this.blurred = s === VisibilityState.VisibleBlurred;
        if (panel) panel.visible = !this.immersive; // 2D page only
        if (!was && this.immersive) this.newGame(); // always a fresh start when the player enters XR
        if (s === VisibilityState.Visible) {
          this.synth.start();
          this.recenterIn = 0.5; // wait for a valid head pose
        }
      }),
    );
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.033);
    if (this.blurred) {
      this.synth.beat(120, false, 0); // system menu open: hold everything, silence the music
      this.synth.pad(false);
      return;
    }
    if (this.recenterIn >= 0 && (this.recenterIn -= dt) < 0) this.recenter();
    this.updateListener();
    if ((this.audioT -= dt) < 0) {
      this.audioT = 1;
      this.synth.start(); // browsers hold audio back until the first gesture: keep asking, so the music starts as soon as it may
    }

    const g = this.g;
    for (let k = 0; k < this.fx.length; k++) this.fx[k] = Math.max(0, this.fx[k] - dt);
    this.freeze = this.opts.calm ? 0 : Math.max(0, this.freeze - dt);
    const sdt = this.freeze > 0 ? 0 : dt * (this.fx[1] > 0 ? 0.6 : 1); // game time: held by hit-stop, slowed by the power-up
    const sx = this.paddleMesh.scale.x;
    this.paddleMesh.scale.x = sx + ((this.fx[0] > 0 ? 0.46 / PADDLE_W : this.opts.assist ? 1.3 : 1) - sx) * Math.min(1, 12 * dt);
    g.paddleW = PADDLE_W * this.paddleMesh.scale.x;
    g.pierce = this.fx[2] > 0;
    const lim = W / 2 - g.paddleW / 2;
    const target = Math.max(-lim, Math.min(lim, this.aimX()));
    g.paddle += (target - g.paddle) * Math.min(1, 14 * dt); // smoothing on top of the filtered gaze

    if (this.state === 'play') {
      const ev = this.ev;
      step(g, sdt, ev);
      const got = stepCapsules(this.caps, g, sdt);
      if (got >= 0) this.pickup(got);
      if (ev.paddle) {
        this.combo = 0;
        this.tone(110, this.paddleMesh);
        if (Math.abs(g.x - g.paddle) / (g.paddleW / 2 + R) > 0.85) {
          // caught on the very edge: a near-miss reward
          this.score += 50;
          this.best = Math.max(this.best, this.score);
          this.say('CLOSE SAVE!  +50');
          this.tone(988, this.paddleMesh);
        }
      }
      if (ev.wall) this.burst(g.x, g.y, this.wallColor, 3); // ripple where the ball meets an invisible edge
      if (ev.brick >= 0) this.hit(ev.brick);
      if (ev.lost) this.lose();
    } else {
      g.x = g.paddle;
      g.y = PADDLE_Y + PADDLE_H / 2 + R;
      this.wait += dt;
    }
    this.put(this.paddleMesh, g.paddle, PADDLE_Y);
    this.put(this.ball, g.x, g.y);

    for (let i = 0; i < PARTS; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const m = this.parts[i];
      this.plife[i] = life - dt;
      this.pv[i * 3 + 1] -= 1.5 * dt;
      m.position.x += this.pv[i * 3] * dt;
      m.position.y += this.pv[i * 3 + 1] * dt;
      m.position.z += this.pv[i * 3 + 2] * dt;
      m.scale.setScalar(Math.max(0, life * 2));
      if (life <= dt) m.visible = false;
    }

    this.shake *= Math.max(0, 1 - 9 * dt);
    const sh = this.opts.calm ? 0 : this.shake;
    this.field.position.x = (Math.random() - 0.5) * sh;
    this.field.position.y = (Math.random() - 0.5) * sh;

    this.clock += dt;
    // The ring frames react to a chain (every third brick a little, every fifth a lot), power-ups and new levels, not to every brick.
    this.flash = Math.max(0, this.flash - dt * 0.5);
    this.nudge = Math.max(0, this.nudge - dt * 3);
    const lit = Math.max(this.flash, this.nudge, this.fx[2] > 0 ? 0.5 : 0, Math.min(0.6, Math.floor(this.combo / 5) * 0.2));
    this.ringBoost += (lit - this.ringBoost) * Math.min(1, (lit > this.ringBoost ? 10 : 2) * dt); // up fast, down slowly
    // Always a little warm; streaks and the fireball push it hotter, then it settles back.
    this.energy += (Math.min(1, 0.25 + this.combo / 10 + (this.fx[2] > 0 ? 0.3 : 0)) - this.energy) * Math.min(1, 3 * dt);
    const calm = this.opts.calm; // calm: slow drift, no pulsing, no warming
    this.bg.tick(calm ? this.clock * 0.3 : this.clock, calm ? 0 : this.energy, calm ? 0 : this.synth.beatPulse(), this.ringBoost, dt);
    this.synth.beat(Math.min(140, 120 + 4 * (this.level - 1)), this.state !== 'over' && !this.opts.calm, this.energy); // music runs between rounds too
    this.synth.pad(this.opts.calm); // calm mode swaps the beat for a soft ambient pad
    const hot = this.fx[2] > 0 || this.combo >= 5; // fireball or a 5+ chain: the ball burns
    if (hot !== this.hot) {
      this.hot = hot;
      this.halo.material.color.setHex(hot ? 0xff8a33 : 0x88aaff);
      for (const t of this.trail) t.material.color.setHex(hot ? 0xffa040 : 0x66ccff);
    }
    for (let i = 0; i < this.caps.length; i++) {
      const c = this.caps[i];
      const m = this.capMeshes[i];
      m.visible = c.on;
      if (c.on) {
        this.capAge[i] += dt;
        const pop = Math.min(1, this.capAge[i] / 0.15); // springs in when the brick breaks
        m.scale.setScalar(0.15 * pop * (1 + 0.06 * Math.sin(this.clock * 8 + i)));
        this.put(m, c.x, c.y + 0.012 * Math.sin(this.clock * 6 + i)); // gentle bob
      }
    }
    if (this.fx.some((s) => s > 0)) {
      this.fxPanel.mesh.visible = true;
      const key = this.fx.map((s) => Math.ceil(s * 4)).join('|');
      this.fxPanel.draw(key, (c, w, h) =>
        drawFx(c, w, h, this.fx.map((s, kind) => ({ kind, frac: s / CAP_SECONDS[kind] })).filter((it) => it.frac > 0)),
      );
    } else this.fxPanel.mesh.visible = false;
    this.toastT -= dt;
    this.toast.mesh.visible = this.toastT > 0;
    if (this.toastT > 0) this.toast.draw(this.toastText, (c, w, h) => drawToast(c, w, h, this.toastText, '#ffffff'));
    this.put(this.halo, g.x, g.y);
    this.trailT += dt;
    if (this.trailT > 0.03) {
      this.trailT = 0;
      this.trailXY.copyWithin(2, 0, (TRAIL - 1) * 2); // shift history one sample back
      this.trailXY[0] = g.x;
      this.trailXY[1] = g.y;
    }
    for (let i = 0; i < TRAIL; i++) this.put(this.trail[i], this.trailXY[i * 2], this.trailXY[i * 2 + 1]);
    this.mats.forEach((m, r) => (m.emissiveIntensity = 0.22 + 0.08 * Math.sin(this.clock * 2 + r))); // wall breathes
    this.bombMat.emissiveIntensity = 0.8 + 0.4 * Math.sin(this.clock * 6); // bombs throb
    for (let i = 0; i < this.bricks.length && !calm; i++) {
      const b = this.bricks[i];
      if (!b.visible) continue;
      this.put(b, brickX(i), brickY(i) + 0.004 * Math.sin(this.clock * 1.6 + i * 0.6));
      b.rotation.x = 0.12 * Math.sin(this.clock * 1.3 + i * 0.7); // light slides across the glossy face
    }

    const maxLives = this.opts.assist ? 5 : 3;
    this.hud.draw(`${this.score}|${this.best}|${this.level}|${this.lives}|${maxLives}`, (c, w, h) =>
      drawHud(c, w, h, { score: this.score, best: this.best, level: this.level, lives: this.lives, maxLives }),
    );
    for (const e of this.queries.options.entities) {
      const kind = e.getValue(Option, 'kind') as number;
      const panel = this.optPanels[kind];
      panel.mesh.visible = this.showMenus;
      const hov = this.showMenus && e.hasComponent(Hovered); // looking at a card only highlights it
      const on = this.opts[OPT_KEYS[kind]];
      panel.draw(`${on}|${hov}`, (c, w, h) => drawChip(c, w, h, OPT_TEXT[kind][0], OPT_TEXT[kind][1], on, hov));
    }
    this.progPanel.mesh.visible = this.showMenus;
    if (this.showMenus) {
      const day = today();
      const streak = liveStreak(this.prog, day);
      const done = clearedToday(this.prog, day);
      const r = rankOf(this.prog.bricks);
      if (this.dayNameFor !== day) {
        this.dayNameFor = day;
        this.dayName = makeLevel(day, 1).name;
      }
      this.progPanel.draw(`${streak}|${done}|${this.prog.bricks}|${this.dayName}`, (c, w, h) =>
        drawProgress(c, w, h, { streak, done, name: this.dayName, rank: r.name, into: r.into, span: r.span }),
      );
    }
    this.msg.mesh.visible = this.state !== 'play';
    if (this.state !== 'play') {
      const over = this.state === 'over';
      const act = this.immersive ? 'pinch' : 'click';
      const title = over ? 'GAME OVER' : this.daily ? 'DAILY WALL CLEARED' : this.level === 1 && this.score === 0 ? (this.immersive ? 'LOOK TO STEER' : 'MOVE TO STEER') : `LEVEL ${this.level}`;
      const sub = over
        ? `Score ${this.score}  -  ${act} to play again`
        : this.daily
          ? `Streak ${liveStreak(this.prog, today())}  -  ${act} to launch`
          : this.faster ? `Faster ball  -  ${act} to launch`
          : `${act[0].toUpperCase() + act.slice(1)} to launch`;
      this.msg.draw(`${title}|${sub}`, (c, w, h) => drawMessage(c, w, h, title, sub));
    }
    this.comboPanel.mesh.visible = this.state === 'play' && this.combo >= 2;
    if (this.comboPanel.mesh.visible) this.comboPanel.draw(String(this.combo), (c, w, h) => drawToast(c, w, h, `COMBO x${this.combo}`));
  }

  // Where the player is looking, as a position along the curved field (arc length from the centre).
  private aimX(): number {
    const gaze = this.input.xr.gazePointer;
    if (gaze.canTarget()) {
      this.o.copy(gaze.getOrigin());
      this.d.copy(gaze.getDirection());
    } else if (this.immersive) {
      // Quest, controllers or no eye tracking: steer with head direction instead.
      const head = this.player.head;
      head.getWorldPosition(this.o);
      head.getWorldQuaternion(this.quat);
      this.d.set(0, 0, -1).applyQuaternion(this.quat);
    } else {
      return this.mouseX * (W / 2); // 2D page: mouse
    }
    this.p.copy(this.o).add(this.d);
    this.anchor.worldToLocal(this.o);
    this.anchor.worldToLocal(this.p);
    return D * Math.atan2(this.p.x - this.o.x, this.o.z - this.p.z); // yaw angle times radius; the paddle clamps at the edges
  }

  private go(): void {
    this.synth.start();
    this.synth.riser();
    this.daily = false;
    this.g.idle = 0;
    this.state = 'play';
    launch(this.g, (Math.random() - 0.5) * 0.5);
  }

  private hit(i: number): void {
    this.combo++;
    this.score += 10 * this.combo;
    this.best = Math.max(this.best, this.score);
    this.tone(C4 * 2 ** (LADDER[Math.min(this.combo, LADDER.length) - 1] / 12), this.bricks[i]);
    if (this.combo >= 5 && this.combo % 5 === 0) {
      this.freeze = 0.07; // brief hit-stop makes a big chain land
      this.flash = 0.8;
      this.shake = 0.014;
    } else if (this.combo % 3 === 0) this.nudge = 0.5; // a smaller surge every third brick
    this.shatter(i);
    if (this.g.kind[i] === KIND_BOMB) this.explode(i);
    this.checkClear();
  }

  // A bomb brick broke: everything around it goes too (and any bomb among those, in turn).
  private explode(i: number): void {
    blast(this.g, i, this.blasted);
    for (const j of this.blasted) {
      this.score += 20;
      this.shatter(j);
    }
    this.best = Math.max(this.best, this.score);
    this.shake = 0.02;
    this.freeze = 0.08;
    this.synth.boom();
    this.say(this.blasted.length ? `CHAIN BLAST  x${this.blasted.length + 1}` : 'BOOM');
  }

  // A brick broke: pieces fly, a power-up may drop, the wall may be cleared.
  private shatter(i: number): void {
    this.bricks[i].visible = false;
    this.glowAt(i, false);
    const before = rankOf(this.prog.bricks).index;
    this.prog.bricks++;
    const after = rankOf(this.prog.bricks);
    if (after.index > before) {
      this.say(`RANK UP  -  ${after.name}`);
      this.tone(1318.5, this.paddleMesh);
    }
    const bomb = this.g.kind[i] === KIND_BOMB;
    this.burst(brickX(i), brickY(i), bomb ? this.bombColor : this.opts.contrast ? this.hcColors[Math.floor(i / COLS)] : this.colors[Math.floor(i / COLS)], 6);
    if (Math.random() < DROP_CHANCE) {
      const kind = Math.floor(Math.random() * CAP_STYLE.length);
      dropCapsule(this.caps, brickX(i), brickY(i), kind);
      const j = this.caps.findIndex((c) => c.on && c.x === brickX(i) && c.y === brickY(i));
      if (j >= 0) {
        const m = this.capMeshes[j];
        m.material.map = this.icons[kind];
        (m.children[0] as Sprite).material.color.setHex(CAP_STYLE[kind].hex);
        this.capAge[j] = 0;
      }
    }
  }

  // The wall is empty: level up (and the daily streak, the first time each day).
  private checkClear(): void {
    if (this.g.alive.some(Boolean)) return;
    if (this.level === 1 && clearDay(this.prog, today())) {
      this.daily = true; // first clear of the day: streak up, celebrate
      for (const s of [12, 16, 19, 24]) this.tone(C4 * 2 ** (s / 12), this.paddleMesh);
    }
    this.level++;
    this.faster = this.level <= 10;
    this.score += 100;
    this.best = Math.max(this.best, this.score);
    this.save();
    this.g.speed = this.speedFor();
    this.energy = 1; // flash into the next world
    this.flash = 1;
    this.loadWall();
    for (const c of this.caps) c.on = false;
    this.state = 'ready';
    this.wait = 0;
    for (const s of [0, 4, 7, 12]) this.tone(C4 * 2 ** (s / 12), this.paddleMesh); // level-clear chord
  }

  // Put something on the curved field at flat coordinates (x along the arc, y up), facing the player.
  private put(o: Object3D, x: number, y: number): void {
    const a = x / D;
    o.position.set(D * Math.sin(a), y, D * (1 - Math.cos(a)));
    o.rotation.y = -a;
  }

  private burst(x: number, y: number, color: Color, n: number): void {
    const a = x / D;
    for (let k = 0; k < n; k++) {
      const j = this.pnext++ % PARTS;
      const m = this.parts[j];
      (m.material as MeshBasicMaterial).color.copy(color);
      m.position.set(D * Math.sin(a), y, D * (1 - Math.cos(a)));
      m.visible = true;
      this.pv[j * 3] = (Math.random() - 0.5) * 0.9;
      this.pv[j * 3 + 1] = Math.random() * 0.6;
      this.pv[j * 3 + 2] = Math.random() * 0.5;
      this.plife[j] = 0.5;
    }
  }

  private pickup(kind: number): void {
    this.burst(this.g.paddle, PADDLE_Y, this.tmpColor.setHex(CAP_STYLE[kind].hex), 12);
    this.fx[kind] = CAP_SECONDS[kind];
    this.flash = Math.max(this.flash, 0.7);
    this.say(CAP_NAMES[kind]);
    this.tone(CAP_CHIME[kind], this.paddleMesh);
    this.shake = Math.max(this.shake, 0.008);
  }

  private say(text: string): void {
    this.toastText = text;
    this.toastT = 1.1;
  }

  private clearPowerups(): void {
    this.fx.fill(0);
    for (const c of this.caps) c.on = false;
  }

  private lose(): void {
    this.clearPowerups();
    this.faster = false;
    this.combo = 0;
    this.lives--;
    this.shake = 0.02;
    this.tone(82, this.paddleMesh);
    this.save();
    this.state = this.lives > 0 ? 'ready' : 'over';
    this.wait = 0;
  }

  private newGame(): void {
    this.daily = false;
    this.faster = false;
    this.clearPowerups();
    this.level = 1;
    this.score = 0;
    this.lives = this.opts.assist ? 5 : 3;
    this.combo = 0;
    this.g.speed = this.speedFor();
    this.loadWall();
    this.state = 'ready';
    this.wait = 0;
  }

  // The wall is seeded by the UTC day, so everyone plays the same one each day.
  private loadWall(): void {
    this.skin();
    const L = makeLevel(today(), this.level);
    this.g.alive = L.alive;
    this.g.kind = L.kind;
    L.alive.forEach((on, i) => {
      const bomb = L.kind[i] === KIND_BOMB;
      const row = Math.floor(i / COLS);
      this.bricks[i].visible = on;
      this.bricks[i].material = bomb ? this.bombMat : this.mats[row];
      this.halos.setColorAt(i, bomb ? this.bombColor : this.colors[row]);
      this.glowAt(i, on);
    });
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
  }

  // Every level is a new world: the sky, the cards and the brick colours all change together.
  private skin(): void {
    const world = (this.level - 1) % 6;
    if (world === this.paletteLevel) return;
    this.paletteLevel = world;
    this.bg.setPalette(world);
    this.colors = brickPalette(world, ROWS);
    this.applyColors();
  }

  private applyColors(): void {
    const hc = this.opts.contrast;
    setTheme(Math.max(0, this.paletteLevel), hc);
    this.mats.forEach((m, r) => {
      const c = hc ? this.hcColors[r] : this.colors[r];
      m.color.copy(c);
      m.emissive.copy(c);
      m.map = hc ? this.hcMaps[r] : this.tileMap; // contrast: a different pattern per row, not just colour
      m.emissiveMap = hc ? null : this.tileMap;
      m.needsUpdate = true;
    });
  }

  // Place (or hide, by scaling to nothing) the shadow plate and bloom behind brick i.
  private glowAt(i: number, on: boolean): void {
    const d = this.dummy;
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    this.put(d, brickX(i), brickY(i));
    d.translateZ(-0.035);
    d.scale.set(on ? 0.27 : 0, on ? 0.15 : 0, 1);
    d.updateMatrix();
    this.plates.setMatrixAt(i, d.matrix);
    d.scale.set(1, 1, 1);
    d.translateZ(0.005);
    d.scale.set(on ? 0.24 : 0, on ? 0.13 : 0, 1);
    d.updateMatrix();
    this.halos.setMatrixAt(i, d.matrix);
    this.plates.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
  }

  private speedFor(): number {
    return Math.min(2.0, START_SPEED + 0.1 * (this.level - 1)) * (this.opts.assist ? 0.75 : 1); // faster every level; assist: a slower ball
  }

  private toggle(kind: number): void {
    const k = OPT_KEYS[kind];
    this.opts[k] = !this.opts[k];
    if (k === 'assist') this.lives = this.opts.assist ? Math.min(5, this.lives + 2) : Math.min(3, this.lives);
    try {
      localStorage.setItem(OPT_KEY, JSON.stringify(this.opts));
    } catch {
      /* storage blocked: options just don't persist */
    }
    this.applyOptions();
    this.synth.start();
    this.tone(this.opts[k] ? 880 : 660, this.paddleMesh);
  }

  // Make the scene match the options: tile colours, sky dimming, text size, ball speed, steady wall.
  private applyOptions(): void {
    const hc = this.opts.contrast;
    this.applyColors();
    this.ballPlate.material.opacity = hc ? 0.9 : 0;
    this.paddlePlate.material.opacity = hc ? 0.9 : 0;
    this.halo.material.opacity = hc ? 1 : 0.9;
    this.halo.scale.setScalar(hc ? 0.3 : 0.2);
    (this.paddleMesh.material as MeshStandardMaterial).emissiveIntensity = hc ? 1.3 : 0.8;
    (this.plates.material as MeshBasicMaterial).opacity = hc ? 0.95 : 0.85; // shadow plate: a black outline in high contrast
    (this.halos.material as MeshBasicMaterial).opacity = hc ? 0 : 0.15; // no neon bloom in high contrast
    this.bricks.forEach((b, i) => {
      this.put(b, brickX(i), brickY(i));
      b.rotation.x = 0;
    });
    this.bg.setDim(hc ? 0.22 : 1);
    this.bg.setCalm(this.opts.calm);
    this.bg.setRings(hc || this.opts.calm ? 0 : 1); // the ring tunnel is motion: off in calm and contrast
    this.g.speed = this.speedFor();
  }

  // Menus (progress, options) are hidden during play, and during a brand-new player's very first countdown,
  // so the opening is one short instruction instead of a wall of panels.
  private get firstEver(): boolean {
    return this.state === 'ready' && this.prog.bricks === 0 && this.score === 0 && this.level === 1;
  }

  private get showMenus(): boolean {
    return this.state !== 'play' && !this.firstEver;
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, String(this.best));
      localStorage.setItem(PROG_KEY, JSON.stringify(this.prog));
    } catch {
      /* storage blocked */
    }
  }

  private tone(freq: number, at: Mesh): void {
    at.getWorldPosition(this.p);
    this.synth.play(freq, this.p.x, this.p.y, this.p.z);
  }

  private updateListener(): void {
    const head = this.player.head;
    head.getWorldPosition(this.o);
    head.getWorldQuaternion(this.quat);
    this.d.set(0, 0, -1).applyQuaternion(this.quat);
    this.p.set(0, 1, 0).applyQuaternion(this.quat);
    this.synth.setListener(this.o.x, this.o.y, this.o.z, this.d.x, this.d.y, this.d.z, this.p.x, this.p.y, this.p.z);
  }

  // Put the playfield straight ahead of the player, wherever they sit and face.
  private recenter(): void {
    const head = this.player.head;
    head.getWorldPosition(this.o);
    head.getWorldQuaternion(this.quat);
    this.d.set(0, 0, -1).applyQuaternion(this.quat);
    this.anchor.position.copy(this.o);
    this.anchor.rotation.y = Math.atan2(-this.d.x, -this.d.z);
  }
}
