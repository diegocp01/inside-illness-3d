import './style.css';
import * as THREE from 'three';
import { Stage } from './engine/stage.js';
import { illnesses } from './data/illnesses.js';
import { icons } from './ui/icons.js';
import { bodyFigure, locator } from './ui/locator.js';

const sceneLoaders = {
  cold: () => import('./scenes/cold.js'),
  noro: () => import('./scenes/noro.js'),
  migraine: () => import('./scenes/migraine.js'),
  caries: () => import('./scenes/caries.js'),
  anaemia: () => import('./scenes/anaemia.js'),
  hypertension: () => import('./scenes/hypertension.js'),
  masld: () => import('./scenes/masld.js'),
  obesity: () => import('./scenes/obesity.js'),
  perio: () => import('./scenes/perio.js'),
  diabetes: () => import('./scenes/diabetes.js'),
  asthma: () => import('./scenes/asthma.js'),
  eoe: () => import('./scenes/eoe.js'),
};

const $ = (s) => document.querySelector(s);
const app = $('#app');
const stage = new Stage($('#canvas-host'));
const built = new Map();
let current = null;
let currentBuilt = null;
let step = 0;
let playing = false;
let playTimer = 0;
let dragging = false;
const STEP_TIME = 8;

// ---------- Static icons ----------
$('.search-icon').innerHTML = icons.search;
$('#btn-labels').innerHTML = icons.tag;
$('#btn-rotate').innerHTML = icons.rotate;
$('#btn-reset').innerHTML = icons.reset;
$('#prev').innerHTML = icons.prev;
$('#next').innerHTML = icons.next;
$('#menu-btn').innerHTML = icons.menu;
$('#sidebar-close').innerHTML = icons.prev;
$('.play-icon').innerHTML = icons.play;

// ---------- Sidebar ----------
function renderList(filter = '') {
  const q = filter.trim().toLowerCase();
  const match = (d) => !q || [d.name, d.specific, d.tagline, d.where].join(' ').toLowerCase().includes(q);
  const groups = [
    { key: 'common', title: 'Most common' },
    { key: 'more', title: 'More' },
  ];
  let html = '';
  for (const g of groups) {
    const items = illnesses.filter((d) => d.group === g.key && match(d));
    if (!items.length) continue;
    html += `<div class="group-title">${g.title}</div>`;
    for (const d of items) html += itemHTML(d);
  }
  $('#list').innerHTML = html || `<div class="empty">No match for “${filter}”</div>`;
  if (current) $(`.item[data-id="${current.id}"]`)?.classList.add('active');
}

function itemHTML(d) {
  return `<div class="item" data-id="${d.id}">
    <button class="item-row" data-id="${d.id}">
      <span class="item-icon" style="background:${d.color}">${icons[d.icon] || ''}</span>
      <span class="item-text"><div class="item-name">${d.name}</div><div class="item-tag">${d.tagline}</div></span>
      <span class="item-chev">${icons.next}</span>
    </button>
    <div class="detail"><div class="detail-inner"><div class="detail-body">
      <p class="what">${d.what}</p>
      <div class="stat"><div class="stat-num" style="color:${d.color}">${d.stat.value}</div><div class="stat-label">${d.stat.label}<span class="stat-year">${d.stat.year}</span></div></div>
      <div class="where">${bodyFigure(d.region, d.color)}<div><div class="where-name">${d.where}</div><div class="signs">${d.signs.map((s) => `<span class="sign">${s}</span>`).join('')}</div></div></div>
      <details class="more"><summary>More</summary>
        <p class="helps">${d.helps}</p>
        <ul class="facts">${d.facts.map((f) => `<li>${f}</li>`).join('')}</ul>
        <ul class="sources">${d.sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label} ↗</a></li>`).join('')}</ul>
      </details>
    </div></div></div>
  </div>`;
}

$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.item-row');
  if (!row) return;
  const id = row.dataset.id;
  if (current?.id === id) {
    if (window.innerWidth <= 820) app.classList.remove('list-open');
    return;
  }
  select(id);
  if (window.innerWidth <= 820) setTimeout(() => app.classList.remove('list-open'), 250);
});
$('#search').addEventListener('input', (e) => renderList(e.target.value));
$('#menu-btn').addEventListener('click', () => app.classList.add('list-open'));
$('#sidebar-close').addEventListener('click', () => app.classList.remove('list-open'));

// ---------- Selecting an illness ----------
async function getBuilt(id) {
  if (built.has(id)) return built.get(id);
  const mod = await sceneLoaders[id]();
  // Let the loader paint before the (synchronous) mesh building.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const b = mod.default({ THREE, stage });
  built.set(id, b);
  return b;
}

let selectToken = 0;
async function select(id, { replaceHash = false } = {}) {
  const d = illnesses.find((x) => x.id === id) || illnesses[0];
  const token = ++selectToken;
  current = d;
  stopPlay();
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('active', el.dataset.id === d.id));
  const activeEl = $(`.item[data-id="${d.id}"]`);
  if (activeEl) {
    setTimeout(() => {
      const list = $('#list');
      const top = list.scrollTop + activeEl.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
      list.scrollTo({ top, behavior: 'smooth' });
    }, 470);
  }
  document.documentElement.style.setProperty('--tint', d.color);
  $('#title').textContent = d.name;
  $('#subtitle').textContent = d.specific;
  $('#locator').innerHTML = locator(d.region, d.color);
  $('#seg-sick').textContent = d.sickLabel;
  document.title = `${d.name} · Inside Illness`;
  $('#step-title').textContent = d.steps[0].title;
  $('#step-text').textContent = d.steps[0].text;
  const hash = `#${d.id}`;
  if (location.hash !== hash) history[replaceHash ? 'replaceState' : 'pushState'](null, '', hash);

  const host = $('#canvas-host');
  host.classList.add('fading');
  const needsBuild = !built.has(d.id);
  if (needsBuild) $('#loader').classList.add('on');
  const [b] = await Promise.all([getBuilt(d.id), new Promise((r) => setTimeout(r, 300))]);
  if (token !== selectToken) return;
  $('#loader').classList.remove('on');
  currentBuilt = b;
  stage.mount(b);
  step = 0;
  const first = d.steps[0];
  stage.sick = stage.sickTarget = first.sick;
  // Start a little further out, then glide in.
  const v = b.views[first.view] || b.views.overview;
  const start = new THREE.Vector3().fromArray(v.pos).sub(new THREE.Vector3().fromArray(v.target)).multiplyScalar(1.35).add(new THREE.Vector3().fromArray(v.target));
  stage.flyTo({ pos: start.toArray(), target: v.target }, 0);
  host.classList.remove('fading');
  applyStep(0, 2.2);
}

// ---------- Story ----------
function applyStep(i, duration = 1.8) {
  const d = current;
  step = Math.max(0, Math.min(d.steps.length - 1, i));
  const s = d.steps[step];
  stage.sickTarget = s.sick;
  stage.flyTo(currentBuilt.views[s.view] || currentBuilt.views.overview, duration);
  const t = $('#step-title'), p = $('#step-text');
  t.textContent = s.title;
  p.textContent = s.text;
  for (const el of [t, p]) {
    el.classList.remove('fade');
    void el.offsetWidth;
    el.classList.add('fade');
  }
  $('#dots').innerHTML = d.steps.map((_, k) => `<button class="${k === step ? 'on' : ''}" data-k="${k}" aria-label="Step ${k + 1}"></button>`).join('');
  $('#prev').disabled = step === 0;
  $('#prev').style.opacity = step === 0 ? 0.35 : 1;
  $('#next').style.opacity = step === d.steps.length - 1 ? 0.35 : 1;
  playTimer = 0;
}

$('#dots').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  stopPlay();
  applyStep(+b.dataset.k);
});
$('#prev').addEventListener('click', () => { stopPlay(); applyStep(step - 1); });
$('#next').addEventListener('click', () => { stopPlay(); applyStep(step + 1); });
$('#play').addEventListener('click', () => (playing ? stopPlay() : startPlay()));

function startPlay() {
  playing = true;
  if (step >= current.steps.length - 1) applyStep(0);
  playTimer = 0;
  $('.play-icon').innerHTML = icons.pause;
  $('.play-label').textContent = 'Pause';
}
function stopPlay() {
  playing = false;
  $('.play-icon').innerHTML = icons.play;
  $('.play-label').textContent = 'Play';
  $('#story-bar').style.width = '0%';
}

// ---------- Healthy / sick controls ----------
const seg = $('#segmented');
seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  stopPlay();
  stage.sickTarget = +b.dataset.v;
});
const slider = $('#progress');
slider.addEventListener('pointerdown', () => { dragging = true; stopPlay(); });
window.addEventListener('pointerup', () => (dragging = false));
slider.addEventListener('input', () => {
  const v = slider.value / 1000;
  stage.sickTarget = v;
  stage.sick = v;
});

// ---------- Tools ----------
const btnLabels = $('#btn-labels');
btnLabels.addEventListener('click', () => toggleLabels());
function toggleLabels() {
  const on = btnLabels.getAttribute('aria-pressed') !== 'true';
  btnLabels.setAttribute('aria-pressed', on);
  stage.setLabelsVisible(on);
}
const btnRotate = $('#btn-rotate');
btnRotate.addEventListener('click', () => toggleRotate());
function toggleRotate() {
  const on = btnRotate.getAttribute('aria-pressed') !== 'true';
  btnRotate.setAttribute('aria-pressed', on);
  stage.autoRotateEnabled = on;
}
$('#btn-reset').addEventListener('click', () => {
  const s = current.steps[step];
  stage.flyTo(currentBuilt.views[s.view] || currentBuilt.views.overview, 1.2);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') { stopPlay(); applyStep(step + 1); }
  else if (e.key === 'ArrowLeft') { stopPlay(); applyStep(step - 1); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const i = illnesses.indexOf(current) + (e.key === 'ArrowDown' ? 1 : -1);
    select(illnesses[(i + illnesses.length) % illnesses.length].id);
  } else if (e.key === ' ') { e.preventDefault(); stopPlay(); stage.sickTarget = stage.sickTarget > 0.5 ? 0 : 1; }
  else if (e.key.toLowerCase() === 'l') toggleLabels();
  else if (e.key.toLowerCase() === 'r') toggleRotate();
});

// ---------- Per-frame UI sync ----------
let lastRO = '';
const ro = $('#readout');
let lastT = 0;
stage.onFrame = (s, t) => {
  const dt = Math.min(0.1, t - lastT);
  lastT = t;
  if (!current) return;
  seg.dataset.v = stage.sickTarget > 0.5 ? '1' : '0';
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === seg.dataset.v));
  if (!dragging) slider.value = Math.round(s * 1000);
  const r = current.readout ? current.readout(s, t) : null;
  if (r) {
    const key = r.label + r.value + (r.unit || '') + r.tone;
    if (key !== lastRO) {
      lastRO = key;
      ro.style.display = '';
      ro.dataset.tone = r.tone || '';
      ro.querySelector('.ro-label').textContent = r.label;
      ro.querySelector('b').textContent = r.value;
      ro.querySelector('small').textContent = r.unit || '';
    }
  } else ro.style.display = 'none';
  if (playing) {
    playTimer += dt;
    $('#story-bar').style.width = `${Math.min(100, (playTimer / STEP_TIME) * 100)}%`;
    if (playTimer >= STEP_TIME) {
      if (step < current.steps.length - 1) applyStep(step + 1);
      else stopPlay();
    }
  }
};

window.addEventListener('popstate', () => {
  const id = location.hash.slice(1);
  if (id && id !== current?.id && sceneLoaders[id]) select(id, { replaceHash: true });
});

// Dev-only hook for local debugging tools (*.local.js files are gitignored).
if (import.meta.env.DEV) {
  window.__app = { stage, select, built: () => currentBuilt };
  import.meta.glob('./*.local.js', { eager: true });
}

renderList();
const initial = location.hash.slice(1);
select(sceneLoaders[initial] ? initial : 'cold', { replaceHash: true });
