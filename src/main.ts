import './style.css';
import { BALL_R, BAND_COUNT, BAND_SIZE, bandOf, generateShot, type Difficulty, type Shot } from './geometry';
import { drawReveal } from './reveal';
import { TableScene } from './scene';
import { loadDifficulty, loadStats, resetStats, saveDifficulty, saveStats, type Stats } from './stats';

const SET_LENGTH = 10;
const LETTERS = ['A', 'B', 'C', 'D'];

type Mode = 'set' | 'endless';

interface Result {
  cutDeg: number;
  correct: boolean;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const table = new TableScene();
let stats: Stats = loadStats();
let difficulty: Difficulty = loadDifficulty();

// Per-run state.
let mode: Mode = 'set';
let results: Result[] = [];
let shot: Shot;
let shownAt = 0;
let selected: number | null = null;
let answered = false;

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const bandLabel = (b: number) => `${b * BAND_SIZE}–${(b + 1) * BAND_SIZE}°`;
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');

// ---------- home ----------

function showHome() {
  document.removeEventListener('keydown', onKey);
  const rows = stats.bands
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
  const best = stats.bestSet[difficulty];
  app.replaceChildren(
    h(`<main class="home">
      <h1>Tightsight</h1>
      <p class="lede">Read the cut from where you stand, then pick the view down the cue that pockets the ball.</p>
      <div class="segmented" role="radiogroup" aria-label="Difficulty">
        ${(['easy', 'medium', 'hard'] as Difficulty[])
          .map((d) => `<button role="radio" aria-checked="${d === difficulty}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`)
          .join('')}
      </div>
      <p class="hint">${
        { easy: 'Wrong Choices miss by a ball-width or more.', medium: 'The closest wrong Choice misses by about half a ball.', hard: 'The closest wrong Choice just catches the jaw.' }[difficulty]
      }</p>
      <div class="actions">
        <button class="primary" data-start="set">Start a Set of ${SET_LENGTH}</button>
        <button data-start="endless">Endless</button>
      </div>
      ${best !== undefined ? `<p class="hint">Best Set on ${difficulty}: ${best} / ${SET_LENGTH}</p>` : ''}
      <section class="stats">
        <h2>Accuracy by Cut Angle</h2>
        <table>
          <thead><tr><th>Cut</th><th>Shots</th><th>Correct</th><th>Avg time</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="link" data-reset>Reset stats</button>
      </section>
    </main>`),
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
  app.querySelector('[data-reset]')!.addEventListener('click', () => {
    if (confirm('Reset all stats?')) {
      stats = resetStats();
      showHome();
    }
  });
}

// ---------- question ----------

function start(m: Mode) {
  mode = m;
  results = [];
  document.addEventListener('keydown', onKey);
  nextShot();
}

function nextShot() {
  if (mode === 'set' && results.length >= SET_LENGTH) return showSummary();
  shot = generateShot(difficulty);
  selected = null;
  answered = false;

  const score = results.filter((r) => r.correct).length;
  const progress = mode === 'set' ? `Shot ${results.length + 1} / ${SET_LENGTH}` : `Shot ${results.length + 1}`;
  const view = h(`<main class="play">
    <header class="bar">
      <button class="link" data-home>← Home</button>
      <span>${progress}</span>
      <span>Score ${score}${results.length ? ` / ${results.length}` : ''}</span>
    </header>
    <section class="standing">
      <figure>
        <canvas width="1600" height="1000" aria-label="Standing View of the shot"></canvas>
        <button class="zoom" aria-label="Enlarge">⤢</button>
      </figure>
      <p class="caption">Standing View. The ringed pocket is the one you're playing.</p>
    </section>
    <section class="answer">
      <p class="prompt">Which Aim View pockets the ball?</p>
      <div class="choices"></div>
      <button class="primary lock" disabled>Lock in</button>
      <div class="reveal" hidden></div>
    </section>
  </main>`);
  app.replaceChildren(view);
  view.querySelector('[data-home]')!.addEventListener('click', showHome);

  table.setShot(shot);
  const standing = view.querySelector<HTMLCanvasElement>('.standing canvas')!;
  table.renderStanding(standing);
  view.querySelector('.standing .zoom')!.addEventListener('click', () => zoom(standing));

  const grid = view.querySelector('.choices')!;
  shot.choices.forEach((c, i) => {
    const card = h(`<figure class="choice" tabindex="0" role="button" aria-label="Choice ${LETTERS[i]}">
      <canvas width="800" height="600"></canvas>
      <figcaption>${LETTERS[i]}</figcaption>
      <button class="zoom" aria-label="Enlarge Choice ${LETTERS[i]}">⤢</button>
    </figure>`);
    const canvas = card.querySelector('canvas')!;
    table.renderAim(canvas, c);
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.zoom')) return zoom(canvas);
      select(i);
    });
    grid.append(card);
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

function lockIn() {
  if (answered || selected === null) return;
  answered = true;
  const ms = performance.now() - shownAt;
  const chosen = shot.choices[selected];
  const correct = selected === shot.correctIndex;
  results.push({ cutDeg: shot.cutDeg, correct });

  const band = stats.bands[bandOf(shot.cutDeg)];
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
    const balls = (chosen.miss / (2 * BALL_R)).toFixed(1);
    const how = chosen.cutDeg > shot.correct.cutDeg ? 'Overcut (too thin)' : 'Undercut (too thick)';
    verdict = `${how}. It misses the pocket by ${cm} cm, about ${balls} ball-widths.`;
  }

  const reveal = app.querySelector<HTMLElement>('.reveal')!;
  reveal.hidden = false;
  reveal.replaceChildren(
    h(`<div>
      <p class="verdict ${correct ? 'good' : 'bad'}"><strong>${correct ? 'Correct' : 'Miss'}</strong> · ${verdict}</p>
      <p class="facts">Cut Angle <strong>${shot.cutDeg.toFixed(1)}°</strong> · answered in ${(ms / 1000).toFixed(1)}s</p>
      <canvas class="diagram" width="1200" height="640" aria-label="Top-down diagram"></canvas>
      <p class="legend"><span class="key good"></span>Correct line and ghost ball ${correct ? '' : '<span class="key bad"></span>Your line'}</p>
      ${
        correct
          ? ''
          : `<div class="compare">
              <figure><img alt="Your Aim View" /><figcaption>Yours (${LETTERS[selected]})</figcaption></figure>
              <figure><img alt="Correct Aim View" /><figcaption>Correct (${LETTERS[shot.correctIndex]})</figcaption></figure>
            </div>`
      }
      <button class="primary next">${mode === 'set' && results.length >= SET_LENGTH ? 'See results' : 'Next shot'}</button>
    </div>`),
  );
  drawReveal(reveal.querySelector('canvas')!, shot, chosen);
  if (!correct) {
    const [mine, right] = reveal.querySelectorAll('img');
    mine.src = cards[selected].querySelector('canvas')!.toDataURL('image/jpeg', 0.9);
    right.src = cards[shot.correctIndex].querySelector('canvas')!.toDataURL('image/jpeg', 0.9);
  }
  reveal.querySelector('.next')!.addEventListener('click', nextShot);
  reveal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onKey(e: KeyboardEvent) {
  if (document.querySelector('.lightbox')) {
    if (e.key === 'Escape') document.querySelector('.lightbox')!.remove();
    return;
  }
  const k = e.key.toLowerCase();
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

function zoom(canvas: HTMLCanvasElement) {
  const box = h(`<div class="lightbox" role="dialog" aria-label="Enlarged view"><img alt="" /></div>`);
  box.querySelector('img')!.src = canvas.toDataURL('image/jpeg', 0.92);
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
}

// ---------- summary ----------

function showSummary() {
  document.removeEventListener('keydown', onKey);
  const score = results.filter((r) => r.correct).length;
  const prevBest = stats.bestSet[difficulty];
  const isBest = prevBest === undefined || score > prevBest;
  if (isBest) {
    stats.bestSet[difficulty] = score;
    saveStats(stats);
  }
  const rows = Array.from({ length: BAND_COUNT }, (_, b) => {
    const inBand = results.filter((r) => bandOf(r.cutDeg) === b);
    if (!inBand.length) return '';
    const c = inBand.filter((r) => r.correct).length;
    return `<tr><td>${bandLabel(b)}</td><td>${c} / ${inBand.length}</td></tr>`;
  }).join('');
  app.replaceChildren(
    h(`<main class="home">
      <h1>${score} / ${SET_LENGTH}</h1>
      <p class="lede">${isBest ? `New best on ${difficulty}.` : `Best on ${difficulty}: ${prevBest} / ${SET_LENGTH}.`}</p>
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

showHome();
