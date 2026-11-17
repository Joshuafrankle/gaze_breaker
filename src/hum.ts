import {
  CanvasTexture,
  Entity,
  Color,
  createSystem,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Pressed,
  Quaternion,
  RayInteractable,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { Cell, Control } from './components.js';
import { echoPhrase, ROWS, STEPS, today } from './echo.js';
import { Synth } from './synth.js';

const STEP_SEC = 0.3; // 100 bpm eighth notes -> 2.4 s loop
const RADIUS = 1; // metres from the player
const STEP_DEG = 9; // 8 steps span 63 deg: inside the 74 deg Meta VR Glasses view
const ROW_GAP = 0.16;
const DWELL_SEC = 1; // look at an orb this long to select it
const SEMITONES = [0, 2, 4, 7, 9]; // C major pentatonic, bottom row first
const C4 = 261.63;
// ponytail: seed pattern is hand-written; ceiling is one fixed starter song.
const SEED: [number, number][] = [[0, 0], [2, 2], [3, 3], [4, 4], [6, 3], [7, 1]];
const HINT = { step: 5, row: 2 }; // empty orb that pulses until the first selection
const PINCH = 0, LOOK = 1, CONTRAST = 2, ECHO = 3;
const DEG = Math.PI / 180;
const SAVE_KEY = 'hum-echo';

function drawLabel(mesh: Mesh, text: string): void {
  const map = (mesh.material as MeshBasicMaterial).map!;
  const c = map.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.fillStyle = '#14142a';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#9ab';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 90);
  g.fillStyle = '#fff';
  g.font = 'bold 46px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  map.needsUpdate = true;
}

function label(text: string): Mesh {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(0.28, 0.105), new MeshBasicMaterial({ map }));
  drawLabel(mesh, text);
  return mesh;
}

export class HumSystem extends createSystem({
  cells: { required: [Cell] },
  controls: { required: [Control] },
  pressedCells: { required: [Cell, Pressed] },
  pressedControls: { required: [Control, Pressed] },
}) {
  private synth = new Synth();
  private anchor!: Group;
  private t = 0;
  private step = -1;
  private dwellMode = false;
  private contrast = false;
  private hinting = true;
  private recenterIn = -1;
  private echo = new Set<number>(); // cell keys (step * ROWS + row) of the phrase being copied; empty = not playing Echo
  private saved: boolean[] = []; // free-play pattern, restored if Echo is abandoned
  private lastDay = 0; // last UTC day Echo was solved
  private streak = 0;
  private echoLabel!: Mesh;
  private pos = new Vector3();
  private fwd = new Vector3();
  private up = new Vector3();
  private quat = new Quaternion();
  private onColors: Color[] = [];
  private offColors: Color[] = [];
  private yellow = new Color(1, 1, 0);
  private grey = new Color(0.35, 0.35, 0.5);
  private gold = new Color(1, 0.7, 0.15);
  private white = new Color(1, 1, 1);

  init(): void {
    const start = () => this.synth.start();
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', start),
      () => window.removeEventListener('keydown', start),
    );

    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}');
      this.lastDay = s.last ?? 0;
      this.streak = s.streak ?? 0;
    } catch {
      /* storage blocked: streak just doesn't persist */
    }

    for (let r = 0; r < ROWS; r++) {
      const hue = 0.55 + (r / (ROWS - 1)) * 0.4; // blue -> magenta
      this.onColors.push(new Color().setHSL(hue, 0.85, 0.58));
      this.offColors.push(new Color().setHSL(hue, 0.3, 0.22));
    }

    const anchorEntity = this.world.createTransformEntity(new Group());
    this.anchor = anchorEntity.object3D as Group;
    this.anchor.position.y = 1.16; // desktop default; re-centred on the player in XR

    const orb = new SphereGeometry(0.055, 24, 16);
    for (let s = 0; s < STEPS; s++) {
      for (let r = 0; r < ROWS; r++) {
        const mesh = new Mesh(
          orb,
          new MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }),
        );
        const a = (s - (STEPS - 1) / 2) * STEP_DEG * DEG;
        mesh.position.set(RADIUS * Math.sin(a), r * ROW_GAP, -RADIUS * Math.cos(a));
        const e = this.world.createTransformEntity(mesh, { parent: anchorEntity });
        e.addComponent(RayInteractable);
        e.addComponent(Cell, {
          step: s,
          row: r,
          on: SEED.some(([ss, rr]) => ss === s && rr === r),
        });
        this.paint(e);
      }
    }

    ['Pinch', 'Look', 'Contrast', 'Echo'].forEach((name, kind) => {
      const mesh = label(name);
      if (kind === ECHO) this.echoLabel = mesh;
      const a = (kind - 1.5) * 17 * DEG; // 4 buttons span 51 deg + their width: inside the glasses view
      mesh.position.set(RADIUS * Math.sin(a), -0.2, -RADIUS * Math.cos(a));
      mesh.lookAt(0, -0.2, 0);
      const e = this.world.createTransformEntity(mesh, { parent: anchorEntity });
      e.addComponent(RayInteractable);
      e.addComponent(Control, { kind });
    });
    this.paintControls();

    // dwell === -1 means the dwell timer already fired this one: a click on top would undo it.
    this.queries.pressedCells.subscribe('qualify', (e) => {
      if (e.getValue(Cell, 'dwell') !== -1) this.toggleCell(e);
    });
    this.queries.pressedControls.subscribe('qualify', (e) => {
      if (e.getValue(Control, 'dwell') !== -1) this.press(e);
    });
    const panel = this.world.getSceneObject('welcome-panel');
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((s) => {
        if (panel) panel.visible = s === VisibilityState.NonImmersive; // 2D page only
        if (s === VisibilityState.Visible) {
          this.synth.start();
          this.recenterIn = 0.5; // wait for a valid head pose
        }
      }),
    );
  }

  update(delta: number): void {
    this.t += delta;
    this.updateListener();
    if (this.recenterIn >= 0 && (this.recenterIn -= delta) < 0) this.recenter();

    const step = Math.floor(this.t / STEP_SEC) % STEPS;
    const stepped = step !== this.step;
    this.step = step;

    for (const e of this.queries.cells.entities) {
      const mesh = e.object3D as Mesh;
      const mat = mesh.material as MeshStandardMaterial;
      const on = e.getValue(Cell, 'on') as boolean;
      const s = e.getValue(Cell, 'step') as number;
      const r = e.getValue(Cell, 'row') as number;
      const ghost = !on && this.echo.has(s * ROWS + r); // part of the melody to copy, not yet placed
      let pulse = (e.getValue(Cell, 'pulse') as number) - delta * 3;

      if (stepped && s === step) {
        pulse = on || ghost ? 1 : 0.3;
        if (on || ghost) this.sound(e); // the phrase plays itself while you copy it
      }
      const hint = this.hinting && s === HINT.step && r === HINT.row;
      if (hint) pulse = Math.max(pulse, 0.6 + 0.4 * Math.sin(this.t * 5));

      let dwell = e.getValue(Cell, 'dwell') as number;
      const hovered = e.hasComponent(Hovered);
      if (!hovered) dwell = 0;
      else if (this.dwellMode && dwell >= 0 && (dwell += delta) >= DWELL_SEC) {
        this.toggleCell(e);
        dwell = -1; // fired: wait until the gaze leaves
      }
      const progress = dwell > 0 ? dwell / DWELL_SEC : 0;

      pulse = Math.max(0, pulse);
      e.setValue(Cell, 'pulse', pulse);
      e.setValue(Cell, 'dwell', dwell);
      mat.emissiveIntensity =
        (on ? 0.5 : 0) + (ghost ? 0.3 : 0) + pulse * 1.6 + (hovered ? 0.35 : 0) + progress;
      mesh.scale.setScalar(1 + pulse * 0.25 + progress * 0.4 + (hovered ? 0.1 : 0));
    }

    // Mode buttons are always dwell-selectable so an eyes-only user can switch modes.
    for (const e of this.queries.controls.entities) {
      let dwell = e.getValue(Control, 'dwell') as number;
      if (!e.hasComponent(Hovered)) dwell = 0;
      else if (dwell >= 0 && (dwell += delta) >= DWELL_SEC * 1.2) {
        this.press(e);
        dwell = -1;
      }
      e.setValue(Control, 'dwell', dwell);
    }
  }

  private toggleCell(e: Entity): void {
    this.synth.start();
    this.hinting = false;
    const on = !(e.getValue(Cell, 'on') as boolean);
    e.setValue(Cell, 'on', on);
    e.setValue(Cell, 'pulse', 1);
    this.paint(e);
    if (on) this.sound(e); // immediate payoff
    if (this.echo.size) this.checkEcho();
  }

  private press(e: Entity): void {
    this.synth.start();
    const kind = e.getValue(Control, 'kind') as number;
    if (kind === PINCH) this.dwellMode = false;
    else if (kind === LOOK) this.dwellMode = true;
    else if (kind === CONTRAST) {
      this.contrast = !this.contrast;
      for (const c of this.queries.cells.entities) this.paint(c);
    } else if (this.echo.size) this.endEcho(true);
    else this.startEcho();
    this.paintControls();
  }

  private startEcho(): void {
    this.hinting = false;
    this.saved = [];
    for (const c of this.queries.cells.entities) {
      this.saved.push(c.getValue(Cell, 'on') as boolean);
      c.setValue(Cell, 'on', false);
    }
    this.echo = new Set(echoPhrase(today()));
    for (const c of this.queries.cells.entities) this.paint(c);
  }

  // restore: put the player's own pattern back (abandoned); a solved phrase stays lit.
  private endEcho(restore: boolean): void {
    this.echo.clear();
    let i = 0;
    for (const c of this.queries.cells.entities) {
      if (restore) c.setValue(Cell, 'on', this.saved[i++]);
      this.paint(c);
    }
  }

  private checkEcho(): void {
    let on = 0, hit = 0;
    for (const c of this.queries.cells.entities) {
      if (!(c.getValue(Cell, 'on') as boolean)) continue;
      on++;
      if (this.echo.has((c.getValue(Cell, 'step') as number) * ROWS + (c.getValue(Cell, 'row') as number))) hit++;
    }
    if (hit !== this.echo.size || on !== hit) return;

    for (const c of this.queries.cells.entities) {
      if (!(c.getValue(Cell, 'on') as boolean)) continue;
      c.setValue(Cell, 'pulse', 1);
      this.sound(c); // all five at once: the reward chord
    }
    const day = today();
    if (this.lastDay !== day) {
      this.streak = this.lastDay === day - 1 ? this.streak + 1 : 1;
      this.lastDay = day;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ last: day, streak: this.streak }));
      } catch {
        /* storage blocked */
      }
    }
    this.endEcho(false);
    this.paintControls(); // "Solved n" + button un-highlight
  }

  private paint(e: Entity): void {
    const mat = (e.object3D as Mesh).material as MeshStandardMaterial;
    const on = e.getValue(Cell, 'on') as boolean;
    const row = e.getValue(Cell, 'row') as number;
    const ghost = !on && this.echo.has((e.getValue(Cell, 'step') as number) * ROWS + row);
    const color = ghost
      ? this.contrast ? this.white : this.gold
      : this.contrast
        ? on ? this.yellow : this.grey
        : on ? this.onColors[row] : this.offColors[row];
    mat.color.copy(color);
    mat.emissive.copy(color); // off orbs only glow on hover, dwell or the playhead
  }

  private paintControls(): void {
    const day = today();
    const streak = this.lastDay >= day - 1 ? this.streak : 0; // a missed day resets it
    drawLabel(
      this.echoLabel,
      this.lastDay === day ? `Solved ${streak}` : streak ? `Echo ${streak}` : 'Echo',
    );
    for (const e of this.queries.controls.entities) {
      const kind = e.getValue(Control, 'kind') as number;
      const selected =
        kind === PINCH ? !this.dwellMode
          : kind === LOOK ? this.dwellMode
          : kind === CONTRAST ? this.contrast
          : this.echo.size > 0;
      const mat = (e.object3D as Mesh).material as MeshBasicMaterial;
      mat.color.setScalar(selected ? 1 : 0.4);
    }
  }

  private sound(e: Entity): void {
    const row = e.getValue(Cell, 'row') as number;
    (e.object3D as Mesh).getWorldPosition(this.pos);
    this.synth.play(C4 * 2 ** (SEMITONES[row] / 12), this.pos.x, this.pos.y, this.pos.z);
  }

  private updateListener(): void {
    const head = this.player.head;
    head.getWorldPosition(this.pos);
    head.getWorldQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.synth.setListener(
      this.pos.x, this.pos.y, this.pos.z,
      this.fwd.x, this.fwd.y, this.fwd.z,
      this.up.x, this.up.y, this.up.z,
    );
  }

  // Put the wall in front of the player, just below eye level, wherever they sit and face.
  private recenter(): void {
    const head = this.player.head;
    head.getWorldPosition(this.pos);
    head.getWorldQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.anchor.position.set(this.pos.x, this.pos.y - 0.44, this.pos.z);
    this.anchor.rotation.y = Math.atan2(-this.fwd.x, -this.fwd.z);
  }
}
