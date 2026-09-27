// Screens for learning to see the ghost ball: the Ghost Ball Trainer and Reference Pictures.

import * as THREE from 'three';
import type { FormatId } from './formats';
import { bindFullscreen, fullscreenButton, fullscreenKey } from './fullscreen';
import { angleOf, sub, type Candidate, type Difficulty, type Shot } from './geometry';
import { buildPlacementMarkings, type PlacingMarks } from './overlay';
import { drawPlacement } from './reveal';
import type { TableScene } from './scene';
import {
  AUTO_MARKS,
  loadMarkSettings,
  loadReference,
  loadTrainer,
  saveMarkSettings,
  saveReference,
  saveTrainer,
  type MarkSettings,
} from './stats';
import {
  AID_OFF_BELOW,
  OVERLAPS,
  STAGES,
  aimFor,
  assess,
  movePlacement,
  overlapCutDeg,
  recentAverage,
  recordPlacement,
  referenceShot,
  startPlacement,
  trainerShot,
  type Assessment,
  type PlacementChange,
  type Placement,
  type Stage,
} from './trainer';
import { addView, repaint, resetViews, type View } from './views';

export interface LearnContext {
  app: HTMLElement;
  table: TableScene;
  h: (html: string) => HTMLElement;
  home: () => void;
  format: () => FormatId;
  difficulty: () => Difficulty;
}

const NUDGE = (0.5 * Math.PI) / 180;
/** In the 3D views the balls are small, so the pointer moves this many times further than the ghost ball. */
const DRAG_GEARING = 4;
const AIM_ASPECT = 4 / 3;
/** Every trainer Stage uses one wide view at full width, the controls in a bar underneath. */
const TRAINER_ASPECT = 16 / 9;
const REFERENCE_SET = 10;

/**
 * Which sets of markings to show after locking in. They carry across Stages while viewing one
 * answer, and all come back on at the next lock-in, so you always see your result first.
 */
const revealShown = { mine: true, correct: true, closeUp: false };

/** One key handler at a time for these screens, removed when leaving them. */
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
function setKeys(handler: ((e: KeyboardEvent) => void) | null) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = handler;
  if (handler) document.addEventListener('keydown', handler);
}

function leave(ctx: LearnContext) {
  setKeys(null);
  ctx.table.showPocketMarker(true);
  ctx.home();
}

/** The first stage not yet passed, for the home screen and as the default. */
export function currentStage(): Stage {
  const t = loadTrainer();
  return ([1, 2, 3] as Stage[]).find((s) => !t[s].done) ?? 3;
}

export const stagesPassed = () => ([1, 2, 3] as Stage[]).filter((s) => loadTrainer()[s].done).length;

// ---------- Ghost Ball Trainer ----------

export function showTrainer(ctx: LearnContext, stage: Stage = currentStage()) {
  const { app, table, h } = ctx;
  let progress = loadTrainer();
  let shot: Shot = trainerShot(ctx.format(), ctx.difficulty());
  let placement: Placement = startPlacement(shot);
  let answered = false;
  /**
   * The shot's locked-in answer. It belongs to the shot, not a Stage: after locking in, every
   * view shows the same result, and Next shot is how to try again.
   */
  let answer: { placement: Placement; stage: Stage; assessment: Assessment; change: PlacementChange } | null = null;
  let view: View;
  // Drag calibration, refreshed after each render.
  let toTable: ((x: number, y: number) => { x: number; z: number }) | null = null;
  let pxPerRad = 0;

  const placed = (): Candidate => aimFor(shot, placement)!;
  let markSettings: MarkSettings = loadMarkSettings();

  /** What each marking does on 'auto': the Stage's own help while it hasn't faded, the aim line outside Stage 3. */
  const autoMarks = (): PlacingMarks => ({
    pocketLine: stage === 1 && progress[1].aid,
    contact: stage === 2 && progress[2].aid,
    aimLine: stage !== 3,
    ghost: true,
  });
  /** The markings actually shown: 'auto' follows autoMarks, otherwise the player's own choice. */
  const marks = (): PlacingMarks => {
    const auto = autoMarks();
    const pick = (k: keyof PlacingMarks) => (markSettings[k] === 'auto' ? auto[k] : markSettings[k] === 'on');
    return { pocketLine: pick('pocketLine'), contact: pick('contact'), aimLine: pick('aimLine'), ghost: pick('ghost') };
  };
  /** Whether any help is showing; a placement made without it counts toward passing the Stage. */
  const helpShowing = () => marks().pocketLine || marks().contact;

  /** How far the ghost ball moves on screen per radian of Placement, from the view just rendered. */
  const calibrate = (c: HTMLCanvasElement) => {
    const { cueR } = shot.table.format;
    const screenX = (p: Placement) => {
      const aim = aimFor(shot, p);
      return aim ? table.project(new THREE.Vector3(aim.ghost.x, cueR, aim.ghost.z), c).x : null;
    };
    const eps = 0.01;
    const here = screenX(placement);
    const ahead = screenX(placement + eps);
    const behind = screenX(placement - eps);
    if (here === null) return;
    if (ahead !== null) pxPerRad = (ahead - here) / eps;
    else if (behind !== null) pxPerRad = (here - behind) / eps;
  };

  const shownSets = () => ({ showMine: revealShown.mine, showCorrect: revealShown.correct });

  const render = (c: HTMLCanvasElement) => {
    const p = placed();
    if (stage === 1) {
      const conv = drawPlacement(c, shot, p, { marks: marks(), reveal: answered, ...shownSets() });
      toTable = conv.toTable;
      const next = aimFor(shot, placement + 0.01);
      if (next) pxPerRad = (conv.toCanvas(next.ghost)[0] - conv.toCanvas(p.ghost)[0]) / 0.01;
    } else if (stage === 2) {
      table.renderStanding(c, (eye, lw) =>
        buildPlacementMarkings(shot, p, { marks: marks(), reveal: answered, ...shownSets() }, lw, eye),
      );
      calibrate(c);
    } else {
      // After locking in, Close-up magnifies this same view rather than adding a second one.
      const closeUpLayers = { ghost: false, contact: false, lines: false, closeUp: answered && revealShown.closeUp };
      table.renderAim(c, p, closeUpLayers, (eye, lw) =>
        buildPlacementMarkings(shot, p, { marks: marks(), reveal: answered, ...shownSets() }, lw, eye),
      );
      calibrate(c);
    }
  };

  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => repaint(view));
  };

  const move = (to: Placement) => {
    if (answered) return;
    placement = movePlacement(shot, placement, to);
    redraw();
  };
  /** Nudge the ghost ball left (−1) or right (+1) on screen. */
  const nudge = (side: number) => move(placement + side * Math.sign(pxPerRad || 1) * NUDGE);

  const stageTabs = () =>
    ([1, 2, 3] as Stage[])
      .map(
        (s) =>
          `<button data-stage="${s}" aria-current="${s === stage}">${s}. ${STAGES[s].name}${progress[s].done ? ' ✓' : ''}</button>`,
      )
      .join('');

  const aidText = () => {
    const showing = helpShowing()
      ? '<strong>Help showing:</strong> this placement counts as aided.'
      : '<strong>No help showing:</strong> this placement counts toward passing the stage.';
    if (stage === 3) return `${showing} ${STAGES[3].aid}`;
    const auto = progress[stage].aid
      ? `Automatic help (${STAGES[stage].aid.toLowerCase().replace(/\.$/, '')}) fades once your last 10 average under ${AID_OFF_BELOW}°.`
      : 'Automatic help has faded; it returns if your last 10 average over 3°.';
    return `${showing} ${auto}`;
  };

  const MARK_LABELS: Record<keyof PlacingMarks, { label: string; help: boolean }> = {
    pocketLine: { label: 'Pocket line', help: true },
    contact: { label: 'Contact point', help: true },
    aimLine: { label: 'Aim line', help: false },
    ghost: { label: 'Ghost ball', help: false },
  };
  const markToggles = () => {
    const shown = marks();
    const allAuto = (Object.keys(markSettings) as (keyof PlacingMarks)[]).every((k) => markSettings[k] === 'auto');
    return `<span>Show</span>${(Object.keys(MARK_LABELS) as (keyof PlacingMarks)[])
      .map((k) => {
        const { label, help } = MARK_LABELS[k];
        const tag = [help ? 'help' : '', markSettings[k] === 'auto' ? 'auto' : ''].filter(Boolean).join(' · ');
        return `<button data-mark="${k}" aria-pressed="${shown[k]}">${label}${tag ? ` <small>${tag}</small>` : ''}</button>`;
      })
      .join('')}${allAuto ? '' : '<button class="link" data-marks-auto>Back to auto</button>'}`;
  };

  /** Re-draw everything that depends on the marking settings. */
  const refreshMarks = () => {
    const row = app.querySelector<HTMLElement>('.mark-toggles');
    if (row) {
      row.innerHTML = markToggles();
      bindMarkToggles(row);
    }
    app.querySelector('.aid')!.innerHTML = aidText();
    redraw();
  };
  const bindMarkToggles = (root: ParentNode) => {
    root.querySelectorAll<HTMLButtonElement>('[data-mark]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.mark as keyof PlacingMarks;
        markSettings = { ...markSettings, [k]: marks()[k] ? 'off' : 'on' };
        saveMarkSettings(markSettings);
        refreshMarks();
      }),
    );
    root.querySelector('[data-marks-auto]')?.addEventListener('click', () => {
      markSettings = { ...AUTO_MARKS };
      saveMarkSettings(markSettings);
      refreshMarks();
    });
  };

  const averageText = () => {
    const avg = recentAverage(progress[stage]);
    const n = Math.min(10, progress[stage].errors.length);
    return avg === null ? 'Avg –' : `Avg ${avg.toFixed(1)}° (last ${n})`;
  };

  function newShot() {
    shot = trainerShot(ctx.format(), ctx.difficulty());
    answer = null;
    restart();
  }

  /**
   * Show this same shot in the current Stage. Once answered, that's the locked-in result seen
   * from this view; before, the ghost ball starts fresh, so help in one Stage can't carry over.
   */
  function restart() {
    placement = answer ? answer.placement : startPlacement(shot);
    answered = !!answer;
    build();
  }

  const bindStageTabs = (root: ParentNode) =>
    root.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) =>
      b.addEventListener('click', () => {
        stage = Number(b.dataset.stage) as Stage;
        restart();
      }),
    );

  function build() {
    const screen = h(`<main class="play learn wide">
      <header class="bar">
        <button class="link" data-home>← Home</button>
        <span>Stage ${stage}/3 · ${STAGES[stage].view}</span>
        <span class="bar-end">${fullscreenButton()}<span class="avg">${averageText()}</span></span>
      </header>
      <section class="learn-tools">
        <div class="mark-toggles overlay-toggles" role="group" aria-label="Show while placing"${answered ? ' hidden' : ''}>${markToggles()}</div>
        <div class="result-toggles overlay-toggles" role="group" aria-label="Show" hidden></div>
      </section>
      <section class="learn-view">
        <figure><canvas class="drag" aria-label="${STAGES[stage].view}: drag to move the ghost ball"></canvas></figure>
        <div class="nudge">
          <button data-nudge="-1" aria-label="Nudge left 0.5°">◀ 0.5°</button>
          <button class="primary lock">Lock in</button>
          <button data-nudge="1" aria-label="Nudge right 0.5°">0.5° ▶</button>
        </div>
      </section>
      <section class="learn-side">
        <div class="stage-tabs" role="group" aria-label="Stage">${stageTabs()}</div>
        <p class="aid">${aidText()}</p>
        <div class="reveal" hidden></div>
      </section>
      <section class="learn-notes">
        <p class="prompt">${
          stage === 3
            ? 'Drag to swing your aim. The white ghost ball is where the cue ball would be at contact: set it so the object ball drops in the ringed pocket.'
            : 'Drag the white ghost ball round the object ball until it would send the object ball into the ringed pocket.'
        }</p>
        <p class="rotate-hint">Turn your phone sideways for a bigger view.</p>
      </section>
    </main>`);
    app.replaceChildren(screen);
    window.scrollTo({ top: 0 });
    table.showPocketMarker(true);
    table.setShot(shot);
    resetViews();
    const canvas = screen.querySelector<HTMLCanvasElement>('.learn-view canvas')!;
    view = addView(canvas, TRAINER_ASPECT, render);

    screen.querySelector('[data-home]')!.addEventListener('click', () => leave(ctx));
    bindFullscreen(screen);
    bindStageTabs(screen);
    bindMarkToggles(screen);
    screen.querySelectorAll<HTMLButtonElement>('[data-nudge]').forEach((b) =>
      b.addEventListener('click', () => nudge(Number(b.dataset.nudge))),
    );
    screen.querySelector('.lock')!.addEventListener('click', () => (answered ? newShot() : lockIn()));

    // Drag: top-down follows the pointer round the ball; the 3D views map sideways movement to the ghost ball.
    let drag: { x: number; from: Placement; perRad: number } | null = null;
    const canvasX = (e: PointerEvent) => (e.clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.clientWidth);
    const canvasY = (e: PointerEvent) => (e.clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.clientHeight);
    canvas.addEventListener('pointerdown', (e) => {
      if (answered) return;
      try {
        canvas.setPointerCapture(e.pointerId); // keep the drag when the pointer leaves the canvas
      } catch {
        // Capture can be refused (e.g. synthetic events); dragging still works inside the canvas.
      }
      drag = { x: canvasX(e), from: placement, perRad: pxPerRad };
      if (stage === 1 && toTable) move(angleOf(sub(toTable(canvasX(e), canvasY(e)), shot.object)));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (stage === 1 && toTable) move(angleOf(sub(toTable(canvasX(e), canvasY(e)), shot.object)));
      else if (drag.perRad) move(drag.from + (canvasX(e) - drag.x) / (drag.perRad * DRAG_GEARING));
    });
    const end = () => (drag = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    if (answer) showResult(false);

    setKeys((e) => {
      if (fullscreenKey(e)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudge(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudge(1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (answered) newShot();
        else lockIn();
      }
    });
  }

  function lockIn() {
    if (answered) return;
    answered = true;
    revealShown.mine = true;
    revealShown.correct = true;
    revealShown.closeUp = false;
    const assessment = assess(shot, placement);
    const r = recordPlacement(progress[stage], assessment.errorDeg, helpShowing());
    progress = { ...progress, [stage]: r.progress };
    saveTrainer(progress);
    answer = { placement, stage, assessment, change: r.change };
    showResult(true);
  }

  /** The feedback panel for the locked-in answer, as seen from the current Stage. */
  function showResult(justLocked: boolean) {
    const { assessment: a, change } = answer!;
    const where =
      a.kind === 'exact'
        ? 'Spot on.'
        : `Your ghost ball was <strong>${a.errorMm.toFixed(1)} mm too ${a.kind}</strong> (${a.errorDeg.toFixed(1)}° round the object ball).`;
    const outcome =
      a.miss === 0
        ? 'Close enough: the object ball still drops.'
        : a.miss > 0.5
          ? 'The object ball would miss the pocket by a long way.'
          : `The object ball would miss by ${(a.miss * 100).toFixed(1)} cm.`;
    const answeredIn = answer!.stage;
    const announce = {
      aidOff: `Nice: your last 10 averaged under ${AID_OFF_BELOW}°, so the help is off now.`,
      aidOn: 'Your last 10 averaged over 3°, so the help is back on for a while.',
      passed: `Stage ${answeredIn} passed: 10 in a row without help, averaging under ${AID_OFF_BELOW}°.${answeredIn < 3 ? ` Try stage ${answeredIn + 1}.` : ''}`,
    };
    const reveal = app.querySelector<HTMLElement>('.reveal')!;
    reveal.hidden = false;
    reveal.replaceChildren(
      h(`<div>
        <p class="verdict ${a.miss > 0 ? 'bad' : 'good'}">${where} ${outcome}</p>
        ${
          answeredIn === stage
            ? ''
            : `<p class="facts">Locked in on Stage ${answeredIn} (${STAGES[answeredIn].view}), seen here from the ${STAGES[stage].view}.</p>`
        }
        ${change ? `<p class="announce">${announce[change]}</p>` : ''}
      </div>`),
    );
    // The control bar's middle button becomes Next shot; the placing toggles make way for the result's.
    app.querySelector<HTMLButtonElement>('.lock')!.textContent = 'Next shot';
    app.querySelector<HTMLElement>('.mark-toggles')!.hidden = true;
    const toggles = app.querySelector<HTMLElement>('.result-toggles')!;
    toggles.hidden = false;
    toggles.innerHTML = `<span>Show</span>
      <button data-show="mine" aria-pressed="${revealShown.mine}"><span class="key placed"></span>Your ghost ball &amp; path</button>
      <button data-show="correct" aria-pressed="${revealShown.correct}"><span class="key good"></span>Correct ghost ball &amp; path</button>
      ${stage === 3 ? `<button data-show="closeUp" aria-pressed="${revealShown.closeUp}">Close-up</button>` : ''}`;
    app.querySelector('.avg')!.textContent = averageText();
    app.querySelector('.aid')!.innerHTML = aidText();
    app.querySelector('.stage-tabs')!.innerHTML = stageTabs();
    bindStageTabs(app);
    repaint(view);
    toggles.querySelectorAll<HTMLButtonElement>('[data-show]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.show as keyof typeof revealShown;
        revealShown[k] = !revealShown[k];
        b.setAttribute('aria-pressed', String(revealShown[k]));
        repaint(view);
      }),
    );
    if (justLocked) reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  build();
}

// ---------- Reference Pictures ----------

const AIM_TIPS = [
  "aim the cue ball's centre at the object ball's centre.",
  "aim the cue ball's centre halfway between the object ball's centre and its edge.",
  "aim the cue ball's centre at the object ball's edge.",
  "aim the cue ball's centre half a radius outside the object ball's edge.",
  "aim the cue ball's centre three-quarters of a radius outside the edge.",
];

export function showReference(ctx: LearnContext) {
  const { app, table, h } = ctx;
  let results: { overlap: number; correct: boolean }[] = [];
  let overlap = 0;
  let shot: Shot;
  let answered = false;
  let view: View;

  const layers = () => (answered ? { ghost: true, contact: true, lines: false, closeUp: false } : undefined);

  function next() {
    if (results.length >= REFERENCE_SET) return summary();
    overlap = Math.floor(Math.random() * OVERLAPS.length);
    shot = referenceShot(ctx.format(), overlap);
    answered = false;
    const score = results.filter((r) => r.correct).length;
    const screen = h(`<main class="play learn">
      <header class="bar">
        <button class="link" data-home>← Home</button>
        <span>Reference Pictures · ${results.length + 1} / ${REFERENCE_SET}</span>
        <span class="bar-end">${fullscreenButton()}<span>Score ${score}${results.length ? ` / ${results.length}` : ''}</span></span>
      </header>
      <section class="learn-view">
        <figure><canvas aria-label="Aim View"></canvas></figure>
      </section>
      <section class="learn-side">
        <p class="prompt">Down on the shot, how much of the object ball does the ghost ball cover?</p>
        <div class="overlaps" role="group" aria-label="Overlap">
          ${OVERLAPS.map((o, i) => `<button data-o="${i}"><strong>${o.label}</strong> ball <kbd>${i + 1}</kbd></button>`).join('')}
        </div>
        <div class="reveal" hidden></div>
      </section>
    </main>`);
    app.replaceChildren(screen);
    window.scrollTo({ top: 0 });
    table.showPocketMarker(false);
    table.setShot(shot);
    resetViews();
    view = addView(screen.querySelector('canvas')!, AIM_ASPECT, (c) => table.renderAim(c, shot.correct, layers()));
    screen.querySelector('[data-home]')!.addEventListener('click', () => leave(ctx));
    bindFullscreen(screen);
    screen.querySelectorAll<HTMLButtonElement>('[data-o]').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.o))));
    setKeys((e) => {
      if (fullscreenKey(e)) return;
      const i = ['1', '2', '3', '4', '5'].indexOf(e.key);
      if (i >= 0 && !answered) answer(i);
      else if (e.key === 'Enter' && answered) {
        e.preventDefault();
        next();
      }
    });
  }

  function answer(i: number) {
    if (answered) return;
    answered = true;
    const correct = i === overlap;
    results.push({ overlap, correct });
    const stats = loadReference();
    stats[overlap].attempts++;
    if (correct) stats[overlap].correct++;
    saveReference(stats);

    app.querySelectorAll<HTMLButtonElement>('[data-o]').forEach((b, j) => {
      b.disabled = true;
      b.classList.toggle('is-correct', j === overlap);
      b.classList.toggle('is-wrong', j === i && !correct);
    });
    const o = OVERLAPS[overlap];
    const reveal = app.querySelector<HTMLElement>('.reveal')!;
    reveal.hidden = false;
    reveal.replaceChildren(
      h(`<div>
        <p class="verdict ${correct ? 'good' : 'bad'}"><strong>${correct ? 'Correct' : `It was ${o.label} ball`}</strong> · a ${overlapCutDeg(o.fraction).toFixed(1)}° cut.</p>
        <p class="facts">For a ${o.label === 'Full' ? 'full-ball' : `${o.label}-ball`} hit, ${AIM_TIPS[overlap]}</p>
        <p class="legend"><span class="key good"></span>Ghost ball and contact point</p>
        <button class="primary next">${results.length >= REFERENCE_SET ? 'See results' : 'Next'}</button>
      </div>`),
    );
    repaint(view);
    reveal.querySelector('.next')!.addEventListener('click', next);
  }

  function summary() {
    setKeys(null);
    resetViews();
    const score = results.filter((r) => r.correct).length;
    const lifetime = loadReference();
    const rows = OVERLAPS.map((o, i) => {
      const mine = results.filter((r) => r.overlap === i);
      const life = lifetime[i];
      return `<tr><td>${o.label}${o.label === 'Full' ? '' : ' ball'}</td><td>${overlapCutDeg(o.fraction).toFixed(1)}°</td>
        <td>${mine.length ? `${mine.filter((r) => r.correct).length} / ${mine.length}` : '–'}</td>
        <td>${life.attempts ? `${Math.round((100 * life.correct) / life.attempts)}%` : '–'}</td></tr>`;
    }).join('');
    app.replaceChildren(
      h(`<main class="home">
        <h1>${score} / ${REFERENCE_SET}</h1>
        <p class="lede">Reference Pictures. Learn these five and every other cut sits between two you know.</p>
        <section class="stats">
          <table><thead><tr><th>Overlap</th><th>Cut</th><th>This set</th><th>All time</th></tr></thead><tbody>${rows}</tbody></table>
        </section>
        <div class="actions">
          <button class="primary" data-again>Another set</button>
          <button data-home>Home</button>
        </div>
      </main>`),
    );
    app.querySelector('[data-again]')!.addEventListener('click', () => {
      results = [];
      next();
    });
    app.querySelector('[data-home]')!.addEventListener('click', () => leave(ctx));
  }

  next();
}
