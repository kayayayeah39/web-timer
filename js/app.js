'use strict';

// 時刻は Date.now() との差分で計算する(setInterval の遅延やタブ復帰でズレないように)
const $ = (id) => document.getElementById(id);
const display = $('display');
const setter = $('setter');
const startBtn = $('start');
const resetBtn = $('reset');
const modesNav = document.querySelector('.modes');

const state = {
  mode: 'up',        // 'up' = ストップウォッチ, 'down' = カウントダウン
  running: false,
  startedAt: 0,      // 走行開始時刻(ms)
  elapsed: 0,        // 停止までに積算した経過(ms)
  preset: 3 * 60,    // カウントダウン設定(秒)
  done: false,
};
let timerId = null;
let wakeLock = null;

const pad = (n) => String(n).padStart(2, '0');

function format(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ---- 7セグメント表示(SVG で描画。消灯セグメントも薄く描いてデジタル時計風に) ----
const SVG_NS = 'http://www.w3.org/2000/svg';
const hSeg = (c) => `8,${c} 13,${c - 5} 47,${c - 5} 52,${c} 47,${c + 5} 13,${c + 5}`;
const vSeg = (x, y1, y2) => `${x},${y1} ${x + 5},${y1 + 5} ${x + 5},${y2 - 5} ${x},${y2} ${x - 5},${y2 - 5} ${x - 5},${y1 + 5}`;
const SEGMENTS = {
  a: hSeg(6), g: hSeg(50), d: hSeg(94),
  f: vSeg(6, 8, 48), b: vSeg(54, 8, 48),
  e: vSeg(6, 52, 92), c: vSeg(54, 52, 92),
};
const DIGIT_SEGS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

function makeDigit() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-5 0 70 100');
  svg.classList.add('digit');
  for (const [name, points] of Object.entries(SEGMENTS)) {
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('points', points);
    p.dataset.seg = name;
    svg.appendChild(p);
  }
  return svg;
}
function makeColon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 100');
  svg.classList.add('colon');
  for (const y of [28, 72]) {
    const r = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 6, y: y - 6, width: 12, height: 12 }).forEach(([k, v]) => r.setAttribute(k, v));
    svg.appendChild(r);
  }
  return svg;
}

let shownText = '';
function drawDigits(text) {
  if (text === shownText) return;
  // 桁構成(例 "00:00" → "1:00:00")が変わったときだけ作り直す
  const shape = text.replace(/\d/g, '0');
  if (shape !== shownText.replace(/\d/g, '0')) {
    display.replaceChildren(...[...text].map((ch) => (ch === ':' ? makeColon() : makeDigit())));
  }
  [...text].forEach((ch, i) => {
    if (ch === ':') return;
    const on = DIGIT_SEGS[Number(ch)];
    display.children[i].querySelectorAll('polygon').forEach((p) => {
      p.classList.toggle('on', on.includes(p.dataset.seg));
    });
  });
  display.setAttribute('aria-label', text);
  shownText = text;
}

function currentElapsed() {
  return state.elapsed + (state.running ? Date.now() - state.startedAt : 0);
}

function render() {
  let sec;
  if (state.mode === 'up') {
    sec = Math.floor(currentElapsed() / 1000);
  } else {
    const remainMs = state.preset * 1000 - currentElapsed();
    sec = Math.max(0, Math.ceil(remainMs / 1000));
    if (remainMs <= 0 && state.running) finish();
  }
  const text = format(sec);
  drawDigits(text);
  display.classList.toggle('long', text.length > 5);
  display.classList.toggle('done', state.done);

  const idle = !state.running && state.elapsed === 0 && !state.done;
  setter.classList.toggle('hidden', !(state.mode === 'down' && idle));
  modesNav.classList.toggle('locked', !idle);
  startBtn.textContent = state.running ? 'STOP' : (state.elapsed > 0 && !state.done ? 'RESUME' : 'START');
}

function start() {
  if (state.mode === 'down' && state.preset === 0) return;
  if (state.done) reset();
  state.running = true;
  state.startedAt = Date.now();
  timerId = setInterval(render, 100);
  requestWakeLock();
  render();
}

function stop() {
  state.elapsed = currentElapsed();
  state.running = false;
  clearInterval(timerId);
  releaseWakeLock();
  render();
}

function reset() {
  clearInterval(timerId);
  state.running = false;
  state.elapsed = 0;
  state.done = false;
  releaseWakeLock();
  render();
}

function finish() {
  state.elapsed = state.preset * 1000;
  state.running = false;
  state.done = true;
  clearInterval(timerId);
  releaseWakeLock();
  beep();
}

// ---- アラーム音(Web Audio。iOS はユーザー操作で unlock が必要) ----
const muteBtn = $('mute');
let muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch (_) {}
function renderMute() {
  muteBtn.classList.toggle('off', muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? 'サウンドオフ' : 'サウンドオン');
}
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('muted', muted ? '1' : '0'); } catch (_) {}
  if (muted && audioCtx) audioCtx.suspend();
  if (!muted) unlockAudio();
  renderMute();
});
renderMute();

let audioCtx = null;
function unlockAudio() {
  if (muted) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function beep() {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const t = t0 + i * 1.0 + j * 0.2;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    }
  }
}

// ---- 画面スリープ防止(対応ブラウザのみ) ----
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* 非対応・拒否時は無視 */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.running) requestWakeLock();
    render();
  }
});

// ---- イベント ----
startBtn.addEventListener('click', () => {
  unlockAudio();
  state.running ? stop() : start();
});
resetBtn.addEventListener('click', reset);

document.querySelectorAll('.mode').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (state.running) return;
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b === btn));
    state.mode = btn.dataset.mode;
    reset();
  });
});

// +/- ボタン(長押しで連続変更)
const STEP = { h: 3600, m: 60, s: 1 };
const MAX = 99 * 3600 + 59 * 60 + 59;
function adjust(unit, d) {
  state.preset = Math.min(MAX, Math.max(0, state.preset + STEP[unit] * d));
  try { localStorage.setItem('countdownPreset', state.preset); } catch (_) {}
  render();
}
document.querySelectorAll('.adj').forEach((btn) => {
  let holdTimer = null;
  const begin = (e) => {
    e.preventDefault();
    const { unit } = btn.dataset;
    const d = Number(btn.dataset.d);
    adjust(unit, d);
    let delay = 400;
    const repeat = () => { adjust(unit, d); delay = Math.max(60, delay * 0.8); holdTimer = setTimeout(repeat, delay); };
    holdTimer = setTimeout(repeat, delay);
  };
  const end = () => { clearTimeout(holdTimer); holdTimer = null; };
  btn.addEventListener('pointerdown', begin);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, end));
});

// 前回のカウントダウン設定を復元
try {
  const saved = Number(localStorage.getItem('countdownPreset'));
  if (Number.isFinite(saved) && saved > 0 && saved <= MAX) state.preset = saved;
} catch (_) {}

render();
