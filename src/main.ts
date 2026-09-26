import './style.css';
import {
  DAILY_DIFFICULTY,
  DAILY_FORMAT,
  DAILY_SHOTS,
  dailyKeys,
  dailyNumber,
  dailyOutcomes,
  dailySummary,
  recordDaily,
  shareText,
  today,
  untilTomorrow,
  type Outcome,
} from './daily';
import { FORMAT_IDS, FORMATS, type FormatId } from './formats';
import { BAND_COUNT, BAND_SIZE, DIFFICULTY_MAX_CUT, MIN_TANGENT_CUT, bandOf, missKind, stunScratch, type Difficulty, type Shot } from './geometry';
import { freshKey, keyFromLocation, share, shotFromKey, shotLink, siteUrl, type ShotKey } from './links';
import { drawReveal } from './reveal';
import { TableScene } from './scene';
import {
  loadDifficulty,
  loadFormat,
  loadStats,
  resetStats,
  saveDifficulty,
  saveFormat,
  saveStats,
  statsFor,
  type Stats,
} from './stats';

const SET_LENGTH = 10;
const STANDING_ASPECT = 16 / 10;
const AIM_ASPECT = 4 / 3;
const LETTERS = ['A', 'B', 'C', 'D'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** How a run of Shots is played: a Set, Endless, today's Daily or a single shared Shot Link. */
type Mode = 'set' | 'endless' | 'daily' | 'link';

interface Result {
  cutDeg: number;
  outcome: Outcome;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const table = new TableScene();
let stats: Stats = loadStats();
let difficulty: Difficulty = loadDifficulty();
let format: FormatId = loadFormat();

// Per-run state.
let mode: Mode = 'set';
let results: Result[] = [];
let linkKey: ShotKey | null = null;
let dailyDate = today();
let key: ShotKey;
let shot: Shot;
let shownAt = 0;
let selected: number | null = null;
let answered = false;

/** A 3D view on screen, re-rendered whenever its display size changes. */
interface View {
  canvas: HTMLCanvasElement;
  aspect: number;
  render: (c: HTMLCanvasElement) => void;
}
let views: View[] = [];
let choiceViews: View[] = [];
/** Controls for the open expanded Aim View, so the keyboard can drive it. */
let expanded: { show: (j: number) => void; step: (d: number) => void; choose: () => void; close: () => void } | null = null;

const MAX_RENDER_WIDTH = 3200;

/** Backing-store width for a canvas shown `cssWidth` px wide: device pixels, with a floor for 1x screens. */
const renderWidth = (cssWidth: number) =>
  Math.min(MAX_RENDER_WIDTH, Math.round(cssWidth * Math.max(devicePixelRatio || 1, 1.5)));

function paint(view: View, cssWidth = view.canvas.clientWidth) {
  const w = renderWidth(cssWidth);
  if (!w) return; // not laid out (e.g. hidden)
  const hgt = Math.round(w / view.aspect);
  if (view.canvas.width === w && view.canvas.height === hgt && view.canvas.dataset.painted) return;
  view.canvas.width = w;
  view.canvas.height = hgt;
  view.canvas.dataset.painted = '1';
  view.render(view.canvas);
}

function addView(canvas: HTMLCanvasElement, aspect: number, render: (c: HTMLCanvasElement) => void) {
  const view = { canvas, aspect, render };
  views.push(view);
  paint(view);
  return view;
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => views.forEach((v) => paint(v)), 150);
});

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const bandLabel = (b: number) => `${b * BAND_SIZE}–${(b + 1) * BAND_SIZE}°`;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const EMOJI: Record<Outcome, string> = { correct: '🟩', over: '🟧', under: '🟦' };

/** Briefly swap a button's label to confirm a share or copy. */
async function shareFrom(button: HTMLButtonElement, text: string, url?: string) {
  const result = await share(text, url);
  if (result === 'shared') return;
  const label = button.textContent;
  button.textContent = result === 'copied' ? 'Copied' : 'Could not copy';
  setTimeout(() => (button.textContent = label), 1600);
}

// ---------- full screen ----------

/** Desktop only: phones already fill the screen, and their full-screen support is patchy. */
const canFullscreen = document.fullscreenEnabled && matchMedia('(pointer: fine)').matches;

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function syncFullscreen() {
  const on = !!document.fullscreenElement;
  document.body.classList.toggle('fullscreen', on);
  app.querySelectorAll<HTMLButtonElement>('[data-fullscreen]').forEach((b) => {
    b.textContent = on ? 'Exit full screen' : 'Full screen';
    b.setAttribute('aria-pressed', String(on));
  });
}

document.addEventListener('fullscreenchange', () => {
  syncFullscreen();
  // The layout grows or shrinks, so re-render every view at its new size.
  requestAnimationFrame(() => views.forEach((v) => paint(v)));
});

function clearLink() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// ---------- home ----------

function dailyCard(): string {
  const date = today();
  const outcomes = dailyOutcomes(date);
  const n = dailyNumber(date);
  const sum = dailySummary(date);
  const streak = sum.currentStreak ? ` · 🔥 ${sum.currentStreak}-day streak` : '';
  if (outcomes.length >= DAILY_SHOTS) {
    const score = outcomes.filter((o) => o === 'correct').length;
    return `<section class="daily done">
      <div class="daily-head"><strong>Daily #${n}</strong><span>${score} / ${DAILY_SHOTS}${streak}</span></div>
      <p class="grid">${outcomes.map((o) => EMOJI[o]).join('')}</p>
      <div class="actions"><button data-share-daily>Share result</button><span class="hint">Next Daily in ${untilTomorrow()}</span></div>
    </section>`;
  }
  const label = outcomes.length ? `Continue (${outcomes.length} / ${DAILY_SHOTS})` : 'Play today’s Daily';
  return `<section class="daily">
    <div class="daily-head"><strong>Daily #${n}</strong><span>${DAILY_SHOTS} shots · ${FORMATS[DAILY_FORMAT].short} · ${cap(DAILY_DIFFICULTY)}${streak}</span></div>
    <p class="hint">The same five shots for everyone today.</p>
    <button class="primary" data-daily>${label}</button>
  </section>`;
}

function showHome() {
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('playing');
  window.scrollTo({ top: 0 });
  clearLink();
  views = [];
  const fs = statsFor(stats, format);
  const rows = fs.bands
    .map((b, i) => {
      const acc = b.attempts ? b.correct / b.attempts : 0;
      return `<tr>
        <td>${bandLabel(i)}</td>
        <td>${b.attempts}</td>
        <td><div class="meter"><span style="width:${acc * 100}%"></span></div>${pct(b.correct, b.attempts)}</td>
        <td>${b.attempts ? (b.totalMs / b.attempts / 1000).toFixed(1) + 's' : '–'}</td>
      </tr>`;
    })
    .join('');
  const best = fs.bestSet[difficulty];
  const f = FORMATS[format];
  app.replaceChildren(
    h(`<main class="home">
      <h1>ReadTheCut</h1>
      <p class="lede">The pool aiming trainer for cut shots. Read the cut from where you stand, then pick the view down the cue that pockets the ball.</p>
      ${dailyCard()}
      <section class="practice">
        <h2>Practice</h2>
        <div class="segmented" role="radiogroup" aria-label="Table">
          ${FORMAT_IDS.map((id) => `<button role="radio" aria-checked="${id === format}" data-f="${id}">${FORMATS[id].short}</button>`).join('')}
        </div>
        <p class="hint">${f.name}: ${Math.round(f.length * 100)}×${Math.round(f.width * 100)} cm, ${(f.objectR * 2000).toFixed(1)} mm balls, ${Math.round(f.cornerMouth * 1000)} mm corner pockets.</p>
        <div class="segmented" role="radiogroup" aria-label="Difficulty">
          ${DIFFICULTIES.map((d) => `<button role="radio" aria-checked="${d === difficulty}" data-d="${d}">${cap(d)}</button>`).join('')}
        </div>
        <p class="hint">${
          {
            easy: `Near-straight shots, cuts up to ${DIFFICULTY_MAX_CUT.easy}°. Wrong Choices miss by a ball-width or more.`,
            medium: `Cuts up to ${DIFFICULTY_MAX_CUT.medium}°. The closest wrong Choice misses by about half a ball.`,
            hard: `Cuts up to ${DIFFICULTY_MAX_CUT.hard}°, including thin ones. The closest wrong Choice just catches the jaw.`,
          }[difficulty]
        }</p>
        <div class="actions">
          <button class="primary" data-start="set">Start a Set of ${SET_LENGTH}</button>
          <button data-start="endless">Endless</button>
        </div>
        ${best !== undefined ? `<p class="hint">Best Set on ${f.short} ${difficulty}: ${best} / ${SET_LENGTH}</p>` : ''}
      </section>
      <section class="stats">
        <h2>Accuracy by Cut Angle · ${f.short}</h2>
        <table>
          <thead><tr><th>Cut</th><th>Shots</th><th>Correct</th><th>Avg time</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="link" data-reset>Reset ${f.short} stats</button>
      </section>
    </main>`),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      format = b.dataset.f as FormatId;
      saveFormat(format);
      showHome();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) =>
    b.addEventListener('click', () => {
      difficulty = b.dataset.d as Difficulty;
      saveDifficulty(difficulty);
      showHome();
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((b) =>
    b.addEventListener('click', () => start(b.dataset.start as Mode)),
  );
  app.querySelector('[data-daily]')?.addEventListener('click', () => start('daily'));
  const shareDaily = app.querySelector<HTMLButtonElement>('[data-share-daily]');
  shareDaily?.addEventListener('click', () => shareFrom(shareDaily, shareText(today(), dailyOutcomes(today())), siteUrl()));
  app.querySelector('[data-reset]')!.addEventListener('click', () => {
    if (confirm(`Reset your ${f.name} stats?`)) {
      resetStats(stats, format);
      showHome();
    }
  });
}

// ---------- question ----------

function start(m: Mode, link: ShotKey | null = null) {
  mode = m;
  linkKey = link;
  results = [];
  dailyDate = today();
  document.body.classList.add('playing');
  document.addEventListener('keydown', onKey);
  nextShot();
}

function progressLabel(): string {
  switch (mode) {
    case 'set':
      return `Shot ${results.length + 1} / ${SET_LENGTH}`;
    case 'endless':
      return `Shot ${results.length + 1}`;
    case 'daily':
      return `Daily #${dailyNumber(dailyDate)} · ${dailyOutcomes(dailyDate).length + 1} / ${DAILY_SHOTS}`;
    case 'link':
      return 'Shared shot';
  }
}

function nextShot() {
  if (mode === 'set' && results.length >= SET_LENGTH) return showSummary();
  if (mode === 'daily') {
    const done = dailyOutcomes(dailyDate).length;
    if (done >= DAILY_SHOTS) return showDailyDone();
    key = dailyKeys(dailyDate)[done];
  } else if (mode === 'link') {
    if (results.length) {
      // After the shared Shot, keep training on the same table and difficulty.
      format = linkKey!.format;
      difficulty = linkKey!.difficulty;
      clearLink();
      return start('endless');
    }
    key = linkKey!;
  } else {
    key = freshKey(format, difficulty);
  }
  shot = shotFromKey(key);
  selected = null;
  answered = false;

  const score = results.filter((r) => r.outcome === 'correct').length;
  const f = shot.table.format;
  const view = h(`<main class="play">
    <header class="bar">
      <button class="link" data-home>← Home</button>
      <span>${progressLabel()} · ${f.short}</span>
      <span class="bar-end">
        ${canFullscreen ? '<button class="link" data-fullscreen title="Full screen (F)"></button>' : ''}
        ${mode === 'daily' ? '' : '<button class="link" data-share-shot>Share shot</button>'}
        <span>Score ${score}${results.length ? ` / ${results.length}` : ''}</span>
      </span>
    </header>
    <section class="standing">
      <figure>
        <canvas width="${STANDING_ASPECT * 300}" height="300" aria-label="Standing View of the shot"></canvas>
        <button class="zoom" aria-label="Enlarge">⤢</button>
      </figure>
      <p class="caption">Standing View. The ringed pocket is the one you're playing.</p>
    </section>
    <section class="answer">
      <p class="prompt">Which Aim View pockets the ball? <span>Tap a view to see it large.</span></p>
      <div class="choices"></div>
      <button class="primary lock" disabled>Lock in</button>
      <div class="reveal" hidden></div>
    </section>
  </main>`);
  app.replaceChildren(view);
  view.querySelector('[data-home]')!.addEventListener('click', showHome);
  view.querySelector('[data-fullscreen]')?.addEventListener('click', toggleFullscreen);
  syncFullscreen();
  const shareShot = view.querySelector<HTMLButtonElement>('[data-share-shot]');
  shareShot?.addEventListener('click', () => shareFrom(shareShot, 'Can you read this cut? Pick the aim that pockets it.', shotLink(key)));

  // Build the cards first so every canvas has its laid-out size before rendering.
  const grid = view.querySelector('.choices')!;
  const cards = shot.choices.map((_, i) => {
    const card = h(`<figure class="choice" tabindex="0" role="button" aria-label="Enlarge Choice ${LETTERS[i]}">
      <canvas width="${AIM_ASPECT * 300}" height="300"></canvas>
      <figcaption>${LETTERS[i]}</figcaption>
      <span class="zoom" aria-hidden="true">⤢</span>
    </figure>`);
    grid.append(card);
    return card;
  });

  table.setShot(shot);
  views = [];
  const standing = addView(view.querySelector<HTMLCanvasElement>('.standing canvas')!, STANDING_ASPECT, (c) => table.renderStanding(c));
  view.querySelector('.standing .zoom')!.addEventListener('click', () => zoom(standing));

  choiceViews = cards.map((card, i) => {
    const aim = addView(card.querySelector('canvas')!, AIM_ASPECT, (c) => table.renderAim(c, shot.choices[i]));
    card.addEventListener('click', () => expandChoice(i));
    return aim;
  });
  view.querySelector('.lock')!.addEventListener('click', lockIn);
  shownAt = performance.now();
  window.scrollTo({ top: 0 });
}

function select(i: number) {
  if (answered) return;
  selected = i;
  app.querySelectorAll('.choice').forEach((el, j) => el.classList.toggle('selected', i === j));
  app.querySelector<HTMLButtonElement>('.lock')!.disabled = false;
}

function nextLabel(): string {
  if (mode === 'set' && results.length >= SET_LENGTH) return 'See results';
  if (mode === 'daily' && dailyOutcomes(dailyDate).length >= DAILY_SHOTS) return 'See today’s result';
  if (mode === 'link') return 'Keep training';
  return 'Next shot';
}

function lockIn() {
  if (answered || selected === null) return;
  answered = true;
  const ms = performance.now() - shownAt;
  const chosen = shot.choices[selected];
  const outcome = missKind(shot, chosen);
  const correct = outcome === 'correct';
  results.push({ cutDeg: shot.cutDeg, outcome });
  if (mode === 'daily') recordDaily(dailyDate, outcome);

  const fs = statsFor(stats, shot.table.format.id);
  const band = fs.bands[bandOf(shot.cutDeg)];
  band.attempts++;
  band.totalMs += ms;
  if (correct) band.correct++;
  saveStats(stats);

  const cards = app.querySelectorAll<HTMLElement>('.choice');
  cards.forEach((el, j) => {
    el.classList.toggle('is-correct', j === shot.correctIndex);
    el.classList.toggle('is-wrong', j === selected && !correct);
  });
  app.querySelector<HTMLButtonElement>('.lock')!.hidden = true;

  let verdict: string;
  if (correct) {
    verdict = 'Pocketed.';
  } else {
    const cm = (chosen.miss * 100).toFixed(1);
    const balls = (chosen.miss / (2 * shot.table.format.objectR)).toFixed(1);
    const how = outcome === 'over' ? 'Overcut (too thin)' : 'Undercut (too thick)';
    verdict = `${how}. It misses the pocket by ${cm} cm, about ${balls} ball-widths.`;
  }

  const scratch = stunScratch(shot.table, shot.correct);
  const reveal = app.querySelector<HTMLElement>('.reveal')!;
  reveal.hidden = false;
  reveal.replaceChildren(
    h(`<div>
      <p class="verdict ${correct ? 'good' : 'bad'}"><strong>${correct ? 'Correct' : 'Miss'}</strong> · ${verdict}</p>
      <p class="facts">Cut Angle <strong>${shot.cutDeg.toFixed(1)}°</strong> · answered in ${(ms / 1000).toFixed(1)}s</p>
      <canvas class="diagram" width="1200" height="640" aria-label="Top-down diagram"></canvas>
      <p class="legend"><span class="key good"></span>Correct line and ghost ball ${correct ? '' : '<span class="key bad"></span>Your line'}${
        shot.cutDeg >= MIN_TANGENT_CUT ? `<span class="key tangent${scratch ? ' scratch' : ''}"></span>Cue ball after contact (stun)` : ''
      }</p>
      ${scratch ? `<p class="scratch-note">A stun shot scratches in the ${scratch.kind} pocket here, so play it with follow or draw.</p>` : ''}
      ${
        correct
          ? ''
          : `<div class="compare">
              <figure><canvas aria-label="Your Aim View"></canvas><figcaption>Yours (${LETTERS[selected]})</figcaption></figure>
              <figure><canvas aria-label="Correct Aim View"></canvas><figcaption>Correct (${LETTERS[shot.correctIndex]})</figcaption></figure>
            </div>`
      }
      <button class="primary next">${nextLabel()}</button>
    </div>`),
  );
  drawReveal(reveal.querySelector('canvas')!, shot, chosen);
  if (!correct) {
    const [mine, right] = reveal.querySelectorAll<HTMLCanvasElement>('.compare canvas');
    const pick = selected;
    addView(mine, AIM_ASPECT, (c) => table.renderAim(c, shot.choices[pick]));
    addView(right, AIM_ASPECT, (c) => table.renderAim(c, shot.correct));
  }
  reveal.querySelector('.next')!.addEventListener('click', nextShot);
  reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onKey(e: KeyboardEvent) {
  if (expanded) {
    const k = e.key.toLowerCase();
    const idx = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : ['a', 'b', 'c', 'd'].indexOf(k);
    if (e.key === 'Escape') expanded.close();
    else if (e.key === 'ArrowLeft') expanded.step(-1);
    else if (e.key === 'ArrowRight') expanded.step(1);
    else if (idx >= 0) expanded.show(idx);
    else if (e.key === 'Enter') {
      e.preventDefault();
      expanded.choose();
    }
    return;
  }
  if (document.querySelector('.lightbox')) {
    if (e.key === 'Escape') document.querySelector('.lightbox')!.remove();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'f' && canFullscreen && !e.metaKey && !e.ctrlKey) return toggleFullscreen();
  const idx = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : ['a', 'b', 'c', 'd'].indexOf(k);
  if (idx >= 0 && app.querySelector('.choices')) return select(idx);
  if (e.key === 'Enter' || k === 'n') {
    if (!answered && selected !== null) {
      e.preventDefault();
      lockIn();
    } else if (answered) {
      e.preventDefault();
      app.querySelector<HTMLButtonElement>('.next')?.click();
    }
  }
}

/** Re-render a view at full-screen resolution rather than upscaling the thumbnail. */
function zoom(view: View) {
  const box = h(`<div class="lightbox" role="dialog" aria-label="Enlarged view"><canvas></canvas></div>`);
  document.body.append(box);
  const canvas = box.querySelector('canvas')!;
  const pad = 32;
  const cssWidth = Math.min(window.innerWidth - pad, (window.innerHeight - pad) * view.aspect);
  canvas.style.width = `${cssWidth}px`;
  paint({ ...view, canvas }, cssWidth);
  box.addEventListener('click', () => box.remove());
}

/**
 * Show one Choice large, with A–D tabs, arrows and swipe to compare them, and a
 * button to choose the one on screen. After answering it is for inspection only.
 */
function expandChoice(start: number) {
  let i = start;
  const box = h(`<div class="lightbox expanded" role="dialog" aria-label="Enlarged Aim View">
    <canvas></canvas>
    <div class="lb-controls">
      <button class="lb-step" data-step="-1" aria-label="Previous view">‹</button>
      <div class="lb-tabs">${LETTERS.map((l, j) => `<button data-j="${j}">${l}</button>`).join('')}</div>
      <button class="lb-step" data-step="1" aria-label="Next view">›</button>
      ${answered ? '' : '<button class="primary lb-choose"></button>'}
      <button class="lb-close">Close</button>
    </div>
  </div>`);
  document.body.append(box);
  const canvas = box.querySelector('canvas')!;
  const tabs = [...box.querySelectorAll<HTMLButtonElement>('.lb-tabs button')];
  const chooseBtn = box.querySelector<HTMLButtonElement>('.lb-choose');
  tabs.forEach((t, j) => {
    if (!answered) return;
    t.classList.toggle('is-correct', j === shot.correctIndex);
    t.classList.toggle('is-wrong', j === selected && j !== shot.correctIndex);
  });

  // Use the screen's height too: on a portrait phone a taller crop magnifies the aim area.
  const controlsH = window.innerWidth < 480 ? 120 : 76;
  const pad = 32;
  const availW = window.innerWidth - pad;
  const availH = window.innerHeight - pad - controlsH;
  const aspect = Math.min(AIM_ASPECT, Math.max(0.75, availW / availH));
  const cssWidth = Math.min(availW, availH * aspect);
  canvas.style.width = `${cssWidth}px`;

  const show = (j: number) => {
    i = (j + LETTERS.length) % LETTERS.length;
    delete canvas.dataset.painted; // same size as before, but a different Choice
    paint({ ...choiceViews[i], canvas, aspect }, cssWidth);
    tabs.forEach((t, k) => t.setAttribute('aria-current', String(k === i)));
    if (chooseBtn) chooseBtn.textContent = `Choose ${LETTERS[i]}`;
  };
  const close = () => {
    box.remove();
    expanded = null;
  };
  const choose = () => {
    if (answered) return close();
    select(i);
    close();
    app.querySelector('.lock')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  expanded = { show, step: (d) => show(i + d), choose, close };

  tabs.forEach((t, j) => t.addEventListener('click', () => show(j)));
  box.querySelectorAll<HTMLButtonElement>('.lb-step').forEach((b) => b.addEventListener('click', () => show(i + Number(b.dataset.step))));
  chooseBtn?.addEventListener('click', choose);
  box.querySelector('.lb-close')!.addEventListener('click', close);
  box.addEventListener('click', (e) => {
    if (e.target === box) close();
  });
  // Swipe between views on touch screens.
  let touchX: number | null = null;
  canvas.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
  });
  show(i);
}

// ---------- summaries ----------

function showSummary() {
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('playing');
  window.scrollTo({ top: 0 });
  views = [];
  const score = results.filter((r) => r.outcome === 'correct').length;
  const fs = statsFor(stats, format);
  const prevBest = fs.bestSet[difficulty];
  const isBest = prevBest === undefined || score > prevBest;
  if (isBest) {
    fs.bestSet[difficulty] = score;
    saveStats(stats);
  }
  const rows = Array.from({ length: BAND_COUNT }, (_, b) => {
    const inBand = results.filter((r) => bandOf(r.cutDeg) === b);
    if (!inBand.length) return '';
    const c = inBand.filter((r) => r.outcome === 'correct').length;
    return `<tr><td>${bandLabel(b)}</td><td>${c} / ${inBand.length}</td></tr>`;
  }).join('');
  const label = `${FORMATS[format].short} ${difficulty}`;
  app.replaceChildren(
    h(`<main class="home">
      <h1>${score} / ${SET_LENGTH}</h1>
      <p class="lede">${isBest ? `New best on ${label}.` : `Best on ${label}: ${prevBest} / ${SET_LENGTH}.`}</p>
      <p class="grid">${results.map((r) => EMOJI[r.outcome]).join('')}</p>
      <section class="stats">
        <h2>This Set by Cut Angle</h2>
        <table><thead><tr><th>Cut</th><th>Correct</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      <div class="actions">
        <button class="primary" data-again>Another Set</button>
        <button data-home>Home</button>
      </div>
    </main>`),
  );
  app.querySelector('[data-again]')!.addEventListener('click', () => start('set'));
  app.querySelector('[data-home]')!.addEventListener('click', showHome);
}

function showDailyDone() {
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('playing');
  window.scrollTo({ top: 0 });
  views = [];
  const outcomes = dailyOutcomes(dailyDate);
  const score = outcomes.filter((o) => o === 'correct').length;
  const sum = dailySummary(dailyDate);
  const most = Math.max(1, ...sum.distribution);
  const bars = sum.distribution
    .map((count, i) => `<div class="dist-row"><span>${i}</span><div class="dist-bar${i === score ? ' mine' : ''}" style="width:${Math.max(6, (count / most) * 100)}%">${count}</div></div>`)
    .reverse()
    .join('');
  app.replaceChildren(
    h(`<main class="home">
      <p class="hint">Daily #${dailyNumber(dailyDate)}</p>
      <h1>${score} / ${DAILY_SHOTS}</h1>
      <p class="grid big">${outcomes.map((o) => EMOJI[o]).join('')}</p>
      <p class="hint">🟩 correct · 🟧 overcut · 🟦 undercut</p>
      <div class="actions">
        <button class="primary" data-share>Share result</button>
        <button data-home>Home</button>
      </div>
      <p class="hint">Next Daily in ${untilTomorrow()}.</p>
      <section class="stats">
        <h2>Your Dailies</h2>
        <div class="streaks">
          <div><strong>${sum.played}</strong><span>played</span></div>
          <div><strong>${sum.currentStreak}</strong><span>current streak</span></div>
          <div><strong>${sum.bestStreak}</strong><span>best streak</span></div>
        </div>
        <div class="dist">${bars}</div>
      </section>
    </main>`),
  );
  const btn = app.querySelector<HTMLButtonElement>('[data-share]')!;
  btn.addEventListener('click', () => shareFrom(btn, shareText(dailyDate, outcomes), siteUrl()));
  app.querySelector('[data-home]')!.addEventListener('click', showHome);
}

// ---------- boot ----------

const initialLink = keyFromLocation();
if (initialLink) start('link', initialLink);
else showHome();

window.addEventListener('hashchange', () => {
  const k = keyFromLocation();
  if (k) start('link', k);
});
