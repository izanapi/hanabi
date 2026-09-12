# HANABI

A two-handed light instrument. Swipe 28 tuned strings, curl into a breathing white crown for additional harmonics, and build phrases with chords, arpeggios and a two-bar loop.

## Play

- The default tuning is **C Hirajoshi**, with the Kalimba voice.
- Each colored string has a fixed note in the selected scale. Each side rises in pitch from bottom to top; the right side is one octave above the left.
- Swipe across strings to pluck them. Faster swipes play louder; the outer edge sounds brighter.
- Curl inward into the **white strings** to add a perfect fifth (+7 semitones). Move deeper to add an octave (+12) as well. The inner tips slowly grow and shrink, and their visible length determines the harmonic boundary. Small dots mark the deeper octave boundary.
- Moving inward on the same string adds only the new harmonic, without retriggering the base note. A breathing tip can also catch a resting finger. The center remains silent.
- Added fifths are exact chromatic intervals, not scale-quantized notes; depending on the selected scale, they can add out-of-scale color.

| Mode | Left hand | Right hand |
| --- | --- | --- |
| PLUCK | Individual notes | Individual notes |
| CHORD | Three scale tones | Individual notes |
| ARP | Held-string arpeggio | Held-string arpeggio |

CHORD uses alternating scale degrees and folds at the upper boundary of each hand. Pentatonic chords therefore differ from conventional seven-note-scale triads. Inner harmonics can be added in every mode; ARP keeps them on the rhythmic grid.

## Main controls

- **KEY / SCALE / VOICE** select the tuning and sound.
- The **dice** changes key, scale, voice and color. It preserves tempo, octave, play mode, mix, recording state and existing loop notes. Each randomized setting differs from its previous value.
- **ECHO / HALL / VOLUME** sit together in a single row on the main screen.
- **TAP / BPM** set the tempo, from 40 to 200 BPM. There is no external clock synchronization.
- **SOUND / MUTED** toggles the output.

The settings panel contains octave, color, decay, glow, swing, metronome, note labels and reduced motion. Reduced motion freezes the white crown and disables decorative particles and string vibration.

## Scales and voices

20 scales: Hirajoshi, Major pentatonic, Minor pentatonic, Major, Natural minor, Dorian, Lydian, Mixolydian, Phrygian, Locrian, Harmonic minor, Melodic minor (ascending form), Harmonic major, Double harmonic, Minor blues, Major blues, Whole tone, Diminished H-W, Diminished W-H and Chromatic.

Four synthesized voices: **Kalimba**, **Glass**, **Neon FM** and **Velvet**. Three color palettes: **Neon**, **Aurora** and **Ember**.

## Loop

Press **REC**, then play. The first note starts two bars of recording, quantized to sixteenth-note positions. Playback starts automatically. Arpeggios and inner fifth/octave layers are recorded too.

Play freely over the loop. **PAUSE** preserves the phrase; **PLAY** restarts it from the beginning; **CLEAR** erases it. Pressing the loop button while armed or recording cancels that recording. Tempo is locked during recording but can change during playback.

Loops store string positions and added intervals. Changing key, scale or octave transposes them, and changing voice changes their timbre. Loops are held in page memory only and are lost on reload.

## Keyboard

Focus the canvas with a click or Tab.

- `A S D F G H J`: first seven left-hand strings.
- `Q W E R T Y U`: first seven right-hand strings.
- Hold `Shift` when playing a note for the fifth layer; hold `Alt` for fifth and octave.
- `Space`: record, pause or resume the loop.
- `Esc`: stop audio (closes settings first if the dialog is open).

Mouse swipes and multi-touch are supported. Portrait and landscape layouts are included.

## Run

No build step or third-party dependencies.

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Use an HTTP server instead of opening `index.html` as a file because the application uses ES modules. For GitHub Pages, select `main` / root as the publishing source.

Audio starts on the first playing gesture. Hiding or leaving the page, or an audio interruption, stops audio and cancels an unfinished recording. Completed loops are paused and retained. A new gesture unlocks audio again. No microphone, external samples or external services are used.

## Development

- `music.mjs`: scales, tuning, hit testing, swipe interpolation, inner geometry, random patches and loop quantization.
- `audio.mjs`: Web Audio synthesis and effects, capped at 32 active voices.
- `app.mjs`: multi-touch, audio-clock scheduling, loops and Canvas rendering.
- `index.html` / `style.css`: performance surface and settings.

```sh
node --test tests/*.test.mjs
```

The tests cover every tuning, string targeting, fast swipes, multi-touch, chords, arpeggios, loop transitions and transposition, recording boundaries, audio lifecycle, voice limits, the inner harmonic layers, randomization and English-only UI. DOM and AudioContext are mocked. Actual iPhone Safari sound, latency, layout and touch feel still require device testing.
