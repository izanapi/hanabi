import { NOTES, SCALES, PER_HAND, STRING_COUNT, LOOP_STEPS, clamp, midiForString, noteName, angleForString, stringAt, crossedStrings, chordStrings, stepSeconds, loopStep, bpmFromTaps, innerRadius, harmonicLayer, harmonicOffsets, randomPatch, accompanimentPhrase, recordingClick, frequency } from './music.mjs';
import { InstrumentAudio } from './audio.mjs';

const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d'), audio = new InstrumentAudio();
const config = { root: 0, scale: 'hirajoshi', voice: 'kalimba', octave: 0, mode: 'pluck', palette: 'aurora', bpm: 92, swing: 0, glow: 70, showNotes: true, calm: false, metronome: false };
const fingers = new Map(), pressedKeys = new Set(), pulses = [], particles = [], visualQueue = [];
const strings = Array.from({ length: STRING_COUNT }, (_, id) => ({ id, angle: angleForString(id), energy: 0, innerEnergy: 0, last: -10 }));
const clock = { timer: null, step: 0, next: 0 };
const flow = { enabled: false, startStep: 0, cycle: -1, phrase: [] };
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
$('scale').value = config.scale;
$('palette').value = config.palette;

function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  geometry = { width: rect.width, height: rect.height, cx: rect.width / 2, cy: rect.height * .5,
    radius: Math.max(65, Math.min(rect.width / 2 - 10, rect.height / 2 - 12)), inner: 30 };
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
  }).catch(() => hint('Audio unavailable. Touch a string to retry.'));
}
function colorFor(id, light = 65, alpha = 1) {
  const degree = id % PER_HAND;
  let hue;
  if (config.palette === 'aurora') hue = 155 + degree * 5 + (id >= PER_HAND ? 38 : 0);
  else if (config.palette === 'ember') hue = (22 + degree * 3 + (id >= PER_HAND ? 315 : 0)) % 360;
  else hue = (175 + degree * 13 + (id >= PER_HAND ? 65 : 0)) % 360;
  return `hsla(${hue},95%,${light}%,${alpha})`;
}
function visualize(id, strength = .7, fromLoop = false, interval = 0) {
  if (interval) strings[id].innerEnergy = Math.max(strings[id].innerEnergy, strength);
  strings[id].energy = Math.max(strings[id].energy, strength);
  if (!calm()) {
    pulses.push({ id, age: 0, strength, fromLoop });
    if (pulses.length > 100) pulses.shift();
    for (let i = 0; i < 4; i++) particles.push({ id, age: 0, speed: .5 + Math.random(), spread: (Math.random() - .5) * .09, size: 1 + Math.random() * 1.5 });
    if (particles.length > 180) particles.splice(0, particles.length - 180);
  }
  $('noteReadout').textContent = noteName(midi(id) + interval) + (fromLoop ? ' / LOOP' : id < PER_HAND ? ' / LEFT' : ' / RIGHT');
  $('centerNote').textContent = noteName(midi(id) + interval).replace(/-?\d+$/, '');
  $('centerState').textContent = interval ? `+${interval}` : '';
  lastNoteTime = frameTime;
}
function setLoopState(state) {
  loop.state = state;
  if (state === 'empty' || state === 'armed') $('loopProgress').style.width = '0%';
  const labels = { empty: 'REC', armed: 'ARMED', recording: 'REC', playing: 'PAUSE', paused: 'PLAY' };
  const icons = { empty: '●', armed: '●', recording: '●', playing: 'Ⅱ', paused: '▶' };
  $('loopLabel').textContent = labels[state]; $('loopIcon').textContent = icons[state];
  $('loop').classList.toggle('recording', state === 'armed' || state === 'recording');
  $('loop').classList.toggle('playing', state === 'playing');
  $('loop').setAttribute('aria-label', labels[state] + ': two-bar loop');
  $('clearLoop').disabled = state === 'empty';
  $('bpm').disabled = state === 'recording'; $('tap').disabled = state === 'recording';
  const messages = { empty: '2 BARS', armed: 'PLAY TO RECORD', recording: 'RECORDING · 2 BARS', playing: 'LOOPING', paused: 'PAUSED' };
  $('loopStatus').textContent = messages[state];
}
function emit(id, velocity = .65, brightness = .6, when = audio.time, source = 'live', interval = 0) {
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
      const existing = loop.events.find(event => event.step === step && event.id === id && event.interval === interval);
      if (existing) { existing.velocity = Math.max(existing.velocity, velocity); existing.brightness = brightness; }
      else if (loop.events.length < 256) loop.events.push({ step, id, velocity, brightness, interval });
    }
  }
  audio.play(midi(id) + interval, { voice: source === 'flow' ? 'velvet' : config.voice, velocity, brightness, when, pan: Math.cos(angleForString(id)) * .45 });
  if (when > now + .015) {
    visualQueue.push({ time: when, id, velocity, interval, fromLoop: source === 'loop' });
    if (visualQueue.length > 256) visualQueue.shift();
  } else visualize(id, velocity, source === 'loop', interval);
}
function addHarmonics(id, layer, velocity, brightness, when = audio.time, source = 'live', previous = 0) {
  for (const interval of harmonicOffsets(layer)) {
    if (!harmonicOffsets(previous).includes(interval)) emit(id, velocity * .65, brightness + .15, when, source, interval);
  }
}
function pluck(id, velocity, brightness, layer = 0) {
  if (id === null) return;
  const now = performance.now() / 1000;
  if (now - strings[id].last < .04) return; // Suppress boundary jitter, not musical retriggers.
  strings[id].last = now;
  const notes = config.mode === 'chord' && id < PER_HAND ? chordStrings(id) : [id];
  notes.forEach((note, i) => emit(note, velocity * (i ? .65 : 1), brightness, audio.time + i * .016));
  addHarmonics(id, layer, velocity, brightness);
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
    const click = recordingClick(step, loop, config.metronome);
    if (click) audio.click(when, click.accent);
    if (flow.enabled && step >= flow.startStep) {
      const relative = step - flow.startStep, cycle = Math.floor(relative / LOOP_STEPS);
      if (cycle !== flow.cycle) {
        // Keep each motif for four bars, then vary it. No per-note random noise.
        if (cycle % 2 === 0 || !flow.phrase.length) flow.phrase = accompanimentPhrase(config.scale);
        flow.cycle = cycle;
      }
      for (const note of flow.phrase) if (note.step === relative % LOOP_STEPS) {
        emit(note.id, note.velocity, .38, when, 'flow', note.bass ? -12 : 0);
      }
    }
    if (loop.state === 'playing' || (loop.state === 'recording' && step >= loop.startStep + LOOP_STEPS)) {
      const slot = ((step - loop.startStep) % LOOP_STEPS + LOOP_STEPS) % LOOP_STEPS;
      for (const event of loop.events) if (event.step === slot) emit(event.id, event.velocity * .8, event.brightness, when, 'loop', event.interval || 0);
    }
    if (config.mode === 'arp' && step % 2 === 0) {
      const unique = new Map();
      for (const finger of fingers.values()) if (finger.id !== null) unique.set(finger.id, finger);
      for (const finger of unique.values()) {
        if (when - finger.started < .09) continue;
        const notes = chordStrings(finger.id), index = Math.floor(step / 2) % 4;
        const note = notes[[0, 1, 2, 1][index]];
        emit(note, finger.velocity * .85, finger.brightness, when, 'arp');
        const layer = Number.isFinite(finger.x) ? harmonicLayer(finger, finger.id, geometry, frameTime, calm(), finger.layer) : finger.layer || 0;
        addHarmonics(note, layer, finger.velocity * .85, finger.brightness, when, 'arp');
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
  const finger = { ...point, id, layer: harmonicLayer(point, id, geometry, frameTime, calm()), velocity: .67, brightness: brightnessAt(point), started: audio.time };
  fingers.set(event.pointerId, finger); pluck(id, finger.velocity, finger.brightness, finger.layer);
  hint(config.mode === 'arp' ? 'Hold a string to arpeggiate.' : 'Curl inward for fifth and octave harmonics.');
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
    for (const id of ids) pluck(id, velocity, brightness, harmonicLayer(point, id, geometry, frameTime, calm()));
    const id = stringAt(point.x, point.y, geometry);
    const layer = harmonicLayer(point, id, geometry, frameTime, calm(), id === finger.id ? finger.layer : 0);
    if (id !== null && id === finger.id && layer > finger.layer) addHarmonics(id, layer, velocity, brightness, audio.time, 'live', finger.layer);
    if (id !== finger.id) finger.started = audio.time;
    Object.assign(finger, point, { id, velocity, brightness, layer });
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
    const layer = event.altKey ? 2 : event.shiftKey ? 1 : 0;
    fingers.set(event.code, { id, layer, velocity: .7, brightness: .65, started: audio.time });
    pluck(id, .7, .65, layer);
  } else if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) toggleLoop(); }
});
// Release at document level as focus can move to a control before keyup.
document.addEventListener('keyup', event => { pressedKeys.delete(event.code); fingers.delete(event.code); });
document.addEventListener('keydown', event => { if (event.code === 'Escape' && !$('settings').open) { pause(); hint('Stopped. Touch a string to resume.'); } });

function toggleLoop() {
  startAudio();
  if (loop.state === 'empty') setLoopState('armed');
  else if (loop.state === 'armed') setLoopState('empty');
  else if (loop.state === 'recording') { loop.events = []; setLoopState('empty'); }
  else if (loop.state === 'playing') setLoopState('paused');
  else { loop.startStep = clock.step; loop.startTime = clock.timer === null ? audio.time + .035 : clock.next; setLoopState('playing'); }
}
function toggleFlow() {
  flow.enabled = !flow.enabled;
  $('flow').setAttribute('aria-pressed', String(flow.enabled));
  if (flow.enabled) {
    flow.startStep = clock.timer === null ? 0 : clock.step;
    if (loop.state === 'playing') flow.startStep = loop.startStep + Math.ceil((flow.startStep - loop.startStep) / 16) * 16;
    flow.cycle = -1; flow.phrase = accompanimentPhrase(config.scale); startAudio();
  }
}
$('flow').addEventListener('click', toggleFlow);
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
  $('centerState').textContent = '';
  hint({ pluck: 'One note per string.', chord: 'Left chords, right melody.', arp: 'Hold strings to arpeggiate.' }[config.mode]);
});
$('randomize').addEventListener('click', () => {
  Object.assign(config, randomPatch(config));
  if (flow.enabled) flow.phrase = accompanimentPhrase(config.scale);
  for (const id of ['root', 'scale', 'voice', 'palette']) $(id).value = String(config[id]);
  tuningReadout();
  hint(`${NOTES[config.root]}, ${SCALES[config.scale].name}, ${config.voice}`);
});
for (const id of ['root', 'scale', 'voice', 'octave', 'palette', 'swing']) $(id).addEventListener('change', event => {
  config[id] = ['root', 'octave', 'swing'].includes(id) ? Number(event.target.value) : event.target.value;
  if (['root', 'scale', 'octave'].includes(id)) tuningReadout();
  if (id === 'scale' && flow.enabled) flow.phrase = accompanimentPhrase(config.scale);
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
  muted = !muted; audio.configure({ muted }); $('mute').textContent = muted ? 'MUTED' : 'SOUND';
  $('mute').setAttribute('aria-pressed', String(muted));
});
$('settingsOpen').addEventListener('click', () => { fingers.clear(); pressedKeys.clear(); $('settings').showModal(); });
$('settingsClose').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('click', event => { if (event.target === $('settings')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
function pause() {
  flow.enabled = false; $('flow').setAttribute('aria-pressed', 'false');
  generation++; fingers.clear(); pressedKeys.clear(); visualQueue.length = 0;
  if (clock.timer !== null) clearInterval(clock.timer); clock.timer = null;
  if (loop.state === 'recording') { loop.events = []; setLoopState('empty'); }
  else if (loop.state === 'armed') setLoopState('empty');
  else if (loop.state === 'playing') setLoopState('paused');
  config.metronome = false; $('metronome').checked = false;
  audio.dispose();
}
audio.onInterrupted = () => { pause(); hint('Audio paused. Touch a string to resume.'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('pagehide', pause);
// Native selectors may briefly blur the window; only an actual hidden page stops it.
addEventListener('blur', () => { fingers.clear(); pressedKeys.clear(); });

function draw(ms) {
  const dt = Math.min(.05, (ms - lastFrame) / 1000 || .016); lastFrame = ms; frameTime = ms / 1000;
  const { width, height, cx, cy, radius, inner } = geometry;
  ctx.clearRect(0, 0, width, height);
  const isCalm = calm(), glow = config.glow / 100;
  const spectrum = audio.readSpectrum();
  for (let i = visualQueue.length - 1; i >= 0; i--) {
    const event = visualQueue[i]; if (event.time <= audio.time) { visualize(event.id, event.velocity, event.fromLoop, event.interval); visualQueue.splice(i, 1); }
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
    string.innerEnergy *= Math.exp(-dt * 3);
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
    // Radial equalizer segments, not continuously wriggling filaments.
    // The fixed outer guide remains the touch boundary for the fifth layer.
    const tip = innerRadius(string.id, geometry), whiteEnergy = string.innerEnergy;
    const bin = spectrum ? Math.round(frequency(midi(string.id)) / (audio.context.sampleRate / 1024)) : 0;
    const spectral = spectrum ? (spectrum[Math.min(bin, spectrum.length - 1)] || 0) / 255 : 0;
    const level = isCalm ? Math.min(1, energy + whiteEnergy) : Math.min(1, spectral * .7 + energy * .75 + whiteEnergy);
    const segments = 7, activeSegments = Math.ceil(level * segments), gap = (tip - inner - 7) / segments;
    for (let j = 0; j < segments; j++) {
      const lit = j < activeSegments, distance = inner + 7 + j * gap;
      ctx.strokeStyle = lit ? `rgba(230,255,250,${.4 + level * .55})` : '#daeaff18';
      ctx.lineWidth = lit ? 2.5 : 1.5;
      ctx.shadowColor = '#bcfff0'; ctx.shadowBlur = lit && j === activeSegments - 1 ? glow * 7 : 0;
      ctx.beginPath(); ctx.moveTo(c * distance, s * distance);
      ctx.lineTo(c * (distance + gap * .65), s * (distance + gap * .65)); ctx.stroke();
    }
    // A brief straight spark crowns each lit meter like the core of a firework.
    if (!isCalm && level > .2) {
      ctx.strokeStyle = `rgba(242,255,252,${level * .7})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c * tip, s * tip);
      ctx.lineTo(c * (tip + level * radius * .09), s * (tip + level * radius * .09)); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (config.showNotes) {
      const labelRadius = radius - 9;
      ctx.font = `${energy > .15 ? 11 : 10}px ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = energy > .15 ? colorFor(string.id, 86) : '#929ebd';
      ctx.shadowColor = '#090b18'; ctx.shadowBlur = 5;
      ctx.fillText(noteName(midi(string.id)), c * labelRadius, s * labelRadius);
      ctx.shadowBlur = 0;
    }
  }
  for (const r of [innerRadius(0, geometry), inner + (innerRadius(0, geometry) - inner) * .46]) {
    ctx.strokeStyle = '#d7fff52d'; ctx.lineWidth = .65;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
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
    $('noteReadout').textContent = '';
    $('centerState').textContent = '';
  }
  requestAnimationFrame(draw);
}
tuningReadout(); requestAnimationFrame(draw);
