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
  if (display.textContent !== text) display.textContent = text;
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
let audioCtx = null;
function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function beep() {
  if (!audioCtx) return;
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
