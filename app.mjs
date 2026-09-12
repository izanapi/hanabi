import { NOTES, SCALES, PER_HAND, STRING_COUNT, LOOP_STEPS, clamp, midiForString, noteName, angleForString, stringAt, crossedStrings, chordStrings, stepSeconds, loopStep, bpmFromTaps } from './music.mjs';
import { InstrumentAudio } from './audio.mjs';

const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d'), audio = new InstrumentAudio();
const config = { root: 0, scale: 'pentatonic', voice: 'kalimba', octave: 0, mode: 'pluck', palette: 'neon', bpm: 92, swing: 0, glow: 70, showNotes: true, calm: false, metronome: false };
const fingers = new Map(), pressedKeys = new Set(), pulses = [], particles = [], visualQueue = [];
const strings = Array.from({ length: STRING_COUNT }, (_, id) => ({ id, angle: angleForString(id), energy: 0, last: -10 }));
const clock = { timer: null, step: 0, next: 0 };
const loop = { state: 'empty', events: [], startStep: 0, startTime: 0, visibleStep: 0 };
let geometry = { width: 0, height: 0, cx: 0, cy: 0, radius: 0, inner: 34 };
let lastFrame = 0, frameTime = 0, muted = false, lastNoteTime = -10, taps = [], generation = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => config.calm || reducedMotion.matches;
const midi = id => midiForString(id, config.root, config.scale, config.octave);
const selectOptions = (element, options) => {
  for (const [value, label] of options) { const option = document.createElement('option'); option.value = value; option.textContent = label; element.append(option); }
};
selectOptions($('root'), NOTES.map((name, i) => [i, name]));
selectOptions($('scale'), Object.entries(SCALES).map(([key, scale]) => [key, scale.name]));

function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  geometry = { width: rect.width, height: rect.height, cx: rect.width / 2, cy: rect.height * .48,
    radius: Math.max(65, Math.min(rect.width / 2 - 24, rect.height * .48 - 32)), inner: 34 };
  fingers.clear(); pressedKeys.clear();
}
new ResizeObserver(resize).observe($('stage')); resize();
function tuningReadout() {
  $('keyReadout').textContent = `${NOTES[config.root]} · ${SCALES[config.scale].name.toUpperCase()}`;
  $('centerNote').textContent = NOTES[config.root];
}
function hint(message) { $('hint').textContent = message; }
function startAudio() {
  const currentGeneration = generation;
  audio.unlock().then(() => {
    if (generation !== currentGeneration || document.hidden) return;
    if (clock.timer === null) {
      clock.next = audio.time + .035; clock.step = 0;
      clock.timer = setInterval(schedule, 25); schedule();
    }
  }).catch(() => hint('音を開始できませんでした。もう一度、弦に触れてください。'));
}
function colorFor(id, light = 65, alpha = 1) {
  const degree = id % PER_HAND;
  let hue;
  if (config.palette === 'aurora') hue = 155 + degree * 5 + (id >= PER_HAND ? 38 : 0);
  else if (config.palette === 'ember') hue = (22 + degree * 3 + (id >= PER_HAND ? 315 : 0)) % 360;
  else hue = (175 + degree * 13 + (id >= PER_HAND ? 65 : 0)) % 360;
  return `hsla(${hue},95%,${light}%,${alpha})`;
}
function visualize(id, strength = .7, fromLoop = false) {
  strings[id].energy = Math.max(strings[id].energy, strength);
  if (!calm()) {
    pulses.push({ id, age: 0, strength, fromLoop });
    if (pulses.length > 100) pulses.shift();
    for (let i = 0; i < 4; i++) particles.push({ id, age: 0, speed: .5 + Math.random(), spread: (Math.random() - .5) * .09, size: 1 + Math.random() * 1.5 });
    if (particles.length > 180) particles.splice(0, particles.length - 180);
  }
  $('noteReadout').textContent = noteName(midi(id)) + (fromLoop ? ' / LOOP' : id < PER_HAND ? ' / LEFT' : ' / RIGHT');
  $('centerNote').textContent = noteName(midi(id)).replace(/-?\d+$/, '');
  lastNoteTime = frameTime;
}
function setLoopState(state) {
  loop.state = state;
  if (state === 'empty' || state === 'armed') $('loopProgress').style.width = '0%';
  const labels = { empty: 'ループ録音', armed: '録音待ち', recording: '録音中', playing: '一時停止', paused: 'ループ再生' };
  const icons = { empty: '●', armed: '●', recording: '●', playing: 'Ⅱ', paused: '▶' };
  $('loopLabel').textContent = labels[state]; $('loopIcon').textContent = icons[state];
  $('loop').classList.toggle('recording', state === 'armed' || state === 'recording');
  $('loop').classList.toggle('playing', state === 'playing');
  $('loop').setAttribute('aria-label', labels[state] + '：2小節ループ');
  $('clearLoop').disabled = state === 'empty';
  $('bpm').disabled = state === 'recording'; $('tap').disabled = state === 'recording';
  const messages = { empty: '2小節を録って、重ねて弾く。', armed: '最初の一音で録音スタート。', recording: '録音中 · 2小節で自動再生', playing: 'ループ再生中 · 自由に弾き足して。', paused: 'ループ停止中 · フレーズは残っています。' };
  $('loopStatus').textContent = messages[state];
}
function emit(id, velocity = .65, brightness = .6, when = audio.time, source = 'live') {
  if (id === null || !audio.context) return;
  const now = audio.time;
  if (source === 'live' && loop.state === 'armed') {
    // Recording begins on the first played note, never on an unrelated UI gesture.
    loop.events = []; loop.startStep = clock.step;
    loop.startTime = clock.timer === null ? now + .035 : clock.next;
    setLoopState('recording');
  }
  if ((source === 'live' || source === 'arp') && loop.state === 'recording') {
    const step = loopStep(when, loop.startTime, config.bpm);
    if (when < loop.startTime + LOOP_STEPS * stepSeconds(config.bpm)) {
      const existing = loop.events.find(event => event.step === step && event.id === id);
      if (existing) { existing.velocity = Math.max(existing.velocity, velocity); existing.brightness = brightness; }
      else if (loop.events.length < 256) loop.events.push({ step, id, velocity, brightness });
    }
  }
  audio.play(midi(id), { voice: config.voice, velocity, brightness, when, pan: Math.cos(angleForString(id)) * .45 });
  if (when > now + .015) {
    visualQueue.push({ time: when, id, velocity, fromLoop: source === 'loop' });
    if (visualQueue.length > 256) visualQueue.shift();
  } else visualize(id, velocity, source === 'loop');
}
function pluck(id, velocity, brightness) {
  if (id === null) return;
  const now = performance.now() / 1000;
  if (now - strings[id].last < .04) return; // Suppress boundary jitter, not musical retriggers.
  strings[id].last = now;
  const notes = config.mode === 'chord' && id < PER_HAND ? chordStrings(id) : [id];
  notes.forEach((note, i) => emit(note, velocity * (i ? .65 : 1), brightness, audio.time + i * .016));
}
function schedule() {
  if (!audio.context || audio.context.state !== 'running') return;
  const now = audio.time, duration = stepSeconds(config.bpm);
  // Finish recording at the audible boundary, not the look-ahead boundary.
  if (loop.state === 'recording' && now >= loop.startTime + LOOP_STEPS * duration) {
    setLoopState(loop.events.length ? 'playing' : 'empty');
  }
  // Do not replay a burst of old notes if the OS briefly stalls the scheduler.
  if (clock.next < now - .15) { const skipped = Math.ceil((now - clock.next) / duration); clock.step += skipped; clock.next += skipped * duration; }
  while (clock.next < now + .09) {
    const step = clock.step;
    const when = clock.next + (step % 2 ? duration * config.swing : 0);
    if (config.metronome && step % 4 === 0) audio.click(when, step % 16 === 0);
    if (loop.state === 'playing' || (loop.state === 'recording' && step >= loop.startStep + LOOP_STEPS)) {
      const slot = ((step - loop.startStep) % LOOP_STEPS + LOOP_STEPS) % LOOP_STEPS;
      for (const event of loop.events) if (event.step === slot) emit(event.id, event.velocity * .8, event.brightness, when, 'loop');
    }
    if (config.mode === 'arp' && step % 2 === 0) {
      const unique = new Map();
      for (const finger of fingers.values()) if (finger.id !== null) unique.set(finger.id, finger);
      for (const finger of unique.values()) {
        if (when - finger.started < .09) continue;
        const notes = chordStrings(finger.id), index = Math.floor(step / 2) % 4;
        emit(notes[[0, 1, 2, 1][index]], finger.velocity * .85, finger.brightness, when, 'arp');
      }
    }
    clock.step++; clock.next += duration;
  }
}
function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, time: event.timeStamp };
}
const brightnessAt = point => clamp((Math.hypot(point.x - geometry.cx, point.y - geometry.cy) - geometry.inner) / (geometry.radius - geometry.inner), .12, 1);
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault(); startAudio(); canvas.setPointerCapture(event.pointerId);
  const point = eventPoint(event), id = stringAt(point.x, point.y, geometry);
  const finger = { ...point, id, velocity: .67, brightness: brightnessAt(point), started: audio.time };
  fingers.set(event.pointerId, finger); pluck(id, finger.velocity, finger.brightness);
  hint(config.mode === 'arp' ? '線を押さえると、音が巡る。' : '外側で明るく。速くなぞると、強く。');
});
canvas.addEventListener('pointermove', event => {
  const finger = fingers.get(event.pointerId); if (!finger) return;
  event.preventDefault();
  const coalesced = event.getCoalescedEvents?.();
  for (const sample of coalesced?.length ? coalesced : [event]) {
    const point = eventPoint(sample);
    const distance = Math.hypot(point.x - finger.x, point.y - finger.y), dt = Math.max(8, point.time - finger.time);
    const velocity = clamp(.4 + distance / dt * .32, .4, 1), brightness = brightnessAt(point);
    const ids = crossedStrings(finger, point, geometry);
    for (const id of ids) pluck(id, velocity, brightness);
    const id = stringAt(point.x, point.y, geometry);
    if (id !== finger.id) finger.started = audio.time;
    Object.assign(finger, point, { id, velocity, brightness });
  }
});
function release(event) { fingers.delete(event.pointerId); }
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, release);
canvas.addEventListener('contextmenu', event => event.preventDefault());

const keyboard = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU'];
canvas.addEventListener('keydown', event => {
  const index = keyboard.indexOf(event.code);
  if (index >= 0) {
    event.preventDefault(); if (event.repeat || pressedKeys.has(event.code)) return;
    pressedKeys.add(event.code); startAudio();
    const id = index < 7 ? index : PER_HAND + index - 7;
    fingers.set(event.code, { id, velocity: .7, brightness: .65, started: audio.time });
    pluck(id, .7, .65);
  } else if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) toggleLoop(); }
});
// Release at document level as focus can move to a control before keyup.
document.addEventListener('keyup', event => { pressedKeys.delete(event.code); fingers.delete(event.code); });
document.addEventListener('keydown', event => { if (event.code === 'Escape' && !$('settings').open) { pause(); hint('全停止。弦に触れると再開できます。'); } });

function toggleLoop() {
  startAudio();
  if (loop.state === 'empty') setLoopState('armed');
  else if (loop.state === 'armed') setLoopState('empty');
  else if (loop.state === 'recording') { loop.events = []; setLoopState('empty'); }
  else if (loop.state === 'playing') setLoopState('paused');
  else { loop.startStep = clock.step; loop.startTime = clock.timer === null ? audio.time + .035 : clock.next; setLoopState('playing'); }
}
$('loop').addEventListener('click', toggleLoop);
$('clearLoop').addEventListener('click', () => { loop.events = []; setLoopState('empty'); $('loopProgress').style.width = '0%'; });
function changeTempo(value) {
  if (loop.state === 'recording') return;
  config.bpm = clamp(Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 92, 40, 200);
  $('bpm').value = config.bpm; audio.configure({ bpm: config.bpm });
}
$('bpm').addEventListener('change', event => changeTempo(event.target.value));
$('tap').addEventListener('click', () => {
  const now = performance.now(); if (taps.length && now - taps.at(-1) > 2200) taps = [];
  taps.push(now); taps = taps.slice(-5);
  const bpm = bpmFromTaps(taps); if (bpm !== null) changeTempo(bpm);
  $('beatDot').classList.add('on'); startAudio();
});
for (const element of document.querySelectorAll('[data-mode]')) element.addEventListener('click', () => {
  config.mode = element.dataset.mode;
  for (const button of document.querySelectorAll('[data-mode]')) {
    const active = button.dataset.mode === config.mode;
    button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
  }
  $('centerState').textContent = { pluck: 'PLUCK THE LIGHT', chord: 'CHORD & MELODY', arp: 'RIPPLE ARPEGGIO' }[config.mode];
  hint({ pluck: '一本の光に、一つの音。', chord: '左手で和音。右手でメロディー。', arp: '線を押さえて、テンポに乗せる。' }[config.mode]);
});
for (const id of ['root', 'scale', 'voice', 'octave', 'palette', 'swing']) $(id).addEventListener('change', event => {
  config[id] = ['root', 'octave', 'swing'].includes(id) ? Number(event.target.value) : event.target.value;
  if (['root', 'scale', 'octave'].includes(id)) tuningReadout();
});
for (const id of ['volume', 'echo', 'hall', 'decay', 'glow']) $(id).addEventListener('input', event => {
  const value = Number(event.target.value); $(id + 'Value').value = value;
  if (id === 'glow') config.glow = value; else audio.configure({ [id]: value });
});
for (const id of ['showNotes', 'calm', 'metronome']) $(id).addEventListener('change', event => {
  config[id] = event.target.checked;
  if (id === 'metronome' && config.metronome) startAudio();
});
$('mute').addEventListener('click', () => {
  muted = !muted; audio.configure({ muted }); $('mute').textContent = muted ? '音 OFF' : '音 ON';
  $('mute').setAttribute('aria-pressed', String(muted));
});
$('settingsOpen').addEventListener('click', () => { fingers.clear(); pressedKeys.clear(); $('settings').showModal(); });
$('settingsClose').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('click', event => { if (event.target === $('settings')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
function pause() {
  generation++; fingers.clear(); pressedKeys.clear(); visualQueue.length = 0;
  if (clock.timer !== null) clearInterval(clock.timer); clock.timer = null;
  if (loop.state === 'recording') { loop.events = []; setLoopState('empty'); }
  else if (loop.state === 'armed') setLoopState('empty');
  else if (loop.state === 'playing') setLoopState('paused');
  config.metronome = false; $('metronome').checked = false;
  audio.dispose();
}
audio.onInterrupted = () => { pause(); hint('音声を一時停止しました。弦に触れると再開します。'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('pagehide', pause);
// Native selectors may briefly blur the window; only an actual hidden page stops it.
addEventListener('blur', () => { fingers.clear(); pressedKeys.clear(); });

function draw(ms) {
  const dt = Math.min(.05, (ms - lastFrame) / 1000 || .016); lastFrame = ms; frameTime = ms / 1000;
  const { width, height, cx, cy, radius, inner } = geometry;
  ctx.clearRect(0, 0, width, height);
  const isCalm = calm(), glow = config.glow / 100;
  for (let i = visualQueue.length - 1; i >= 0; i--) {
    const event = visualQueue[i]; if (event.time <= audio.time) { visualize(event.id, event.velocity, event.fromLoop); visualQueue.splice(i, 1); }
  }
  ctx.save(); ctx.translate(cx, cy);
  const fog = ctx.createRadialGradient(0, 0, inner, 0, 0, radius * 1.3);
  fog.addColorStop(0, '#37265335'); fog.addColorStop(.6, '#1c254f20'); fog.addColorStop(1, '#090b1800');
  ctx.fillStyle = fog; ctx.fillRect(-radius * 1.3, -radius * 1.3, radius * 2.6, radius * 2.6);
  // Subtle concentric guides make the playable circle legible at rest.
  for (const fraction of [.45, .72, 1]) {
    ctx.strokeStyle = fraction === 1 ? '#7483b321' : '#7483b311'; ctx.lineWidth = .6;
    ctx.beginPath(); ctx.arc(0, 0, radius * fraction, 0, Math.PI * 2); ctx.stroke();
  }
  for (const string of strings) {
    string.energy *= Math.exp(-dt * (isCalm ? 6 : 3.3));
    const energy = string.energy, a = string.angle, c = Math.cos(a), s = Math.sin(a);
    const length = radius * (1 - (string.id % 7) * .008);
    const vibration = isCalm ? 0 : Math.sin(frameTime * 55 + string.id) * energy * 3;
    const start = inner + 8;
    // One curved, vibrating light filament is one tuned note.
    const gradient = ctx.createLinearGradient(c * start, s * start, c * length, s * length);
    gradient.addColorStop(0, colorFor(string.id, 74, .3 + energy * .5));
    gradient.addColorStop(.45, colorFor(string.id, 62, .7));
    gradient.addColorStop(1, colorFor(string.id, 80, .5 + energy * .5));
    ctx.strokeStyle = gradient; ctx.lineWidth = 1 + energy * 1.9;
    ctx.shadowColor = colorFor(string.id); ctx.shadowBlur = (4 + energy * 17) * glow;
    ctx.beginPath(); ctx.moveTo(c * start, s * start);
    ctx.quadraticCurveTo(c * length * .55 - s * vibration, s * length * .55 + c * vibration, c * length, s * length); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = colorFor(string.id, 80, .7 + energy * .3);
    ctx.beginPath(); ctx.arc(c * length, s * length, 1.8 + energy * 1.3, 0, Math.PI * 2); ctx.fill();
    if (config.showNotes) {
      const labelRadius = radius + 13;
      ctx.font = `${energy > .15 ? 11 : 10}px ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = energy > .15 ? colorFor(string.id, 86) : '#929ebd';
      ctx.fillText(noteName(midi(string.id)), c * labelRadius, s * labelRadius);
    }
  }
  if (!isCalm) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i]; pulse.age += dt;
      if (pulse.age > 1) { pulses.splice(i, 1); continue; }
      const a = angleForString(pulse.id), distance = inner + (radius - inner) * Math.min(1, pulse.age * 2.4);
      ctx.fillStyle = colorFor(pulse.id, 83, (1 - pulse.age) * pulse.strength);
      ctx.shadowColor = colorFor(pulse.id); ctx.shadowBlur = 18 * glow;
      ctx.beginPath(); ctx.arc(Math.cos(a) * distance, Math.sin(a) * distance, 2 + pulse.strength * 1.5, 0, Math.PI * 2); ctx.fill();
      if (pulse.age > .35) {
        ctx.strokeStyle = colorFor(pulse.id, 68, (1 - pulse.age) * .25 * glow); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, radius + (pulse.age - .35) * 25, a - .07, a + .07); ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i]; particle.age += dt;
      if (particle.age > .85) { particles.splice(i, 1); continue; }
      const a = angleForString(particle.id) + particle.spread * particle.age;
      const distance = radius * (.5 + particle.age * particle.speed * .65);
      ctx.fillStyle = colorFor(particle.id, 80, (1 - particle.age / .85) * .7 * glow);
      ctx.beginPath(); ctx.arc(Math.cos(a) * distance, Math.sin(a) * distance, particle.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  } else { pulses.length = 0; particles.length = 0; }
  ctx.strokeStyle = '#a498d53a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, inner, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  if (audio.context && clock.timer !== null) {
    const duration = stepSeconds(config.bpm), visibleStep = clock.step - (clock.next - audio.time) / duration;
    $('beatDot').classList.toggle('on', ((visibleStep % 4) + 4) % 4 < .55);
    if (loop.state === 'recording' || loop.state === 'playing') {
      loop.visibleStep = Math.max(0, visibleStep - loop.startStep) % LOOP_STEPS;
      $('loopProgress').style.width = `${loop.visibleStep / LOOP_STEPS * 100}%`;
    }
  } else $('beatDot').classList.remove('on');
  if (frameTime - lastNoteTime > 2) {
    $('centerNote').textContent = NOTES[config.root];
    $('noteReadout').textContent = '28 STRINGS';
  }
  requestAnimationFrame(draw);
}
tuningReadout(); requestAnimationFrame(draw);
