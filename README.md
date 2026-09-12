# HANABI

A two-handed light instrument. Swipe 28 tuned strings, curl into the inner spectrum ring for additional harmonics, and build phrases with chords, arpeggios and a two-bar loop.

## Play

- The default tuning is **C Insen**, with the Kalimba voice and **Aurora** colors.
- Each colored string has a fixed note in the selected scale. Each side rises in pitch from bottom to top; the right side is one octave above the left.
- Swipe across strings to pluck them. Faster swipes play louder; the outer edge sounds brighter.
- Curl inward into the **white strings** to add a perfect fifth (+7 semitones). Move deeper to add an octave (+12) as well. Two stable rings mark the fifth and octave boundaries. A segmented radial spectrum responds to the actual audio and sends straight sparks outward like the core of a firework.
- Moving inward on the same string adds only the new harmonic, without retriggering the base note. The center remains silent.
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

The settings panel contains octave, color, decay, glow, swing, metronome, note labels and reduced motion. Reduced motion disables spectrum-driven animation, sparks, particles and string vibration. The harmonic touch boundaries stay fixed in either setting.

## Scales and voices

14 selected scales: **Hirajoshi**, Major pentatonic, Minor pentatonic, Ionian / Major, Dorian, Phrygian, Lydian, Mixolydian, Aeolian / Minor, **Ritusen**, **Insen**, **Kumoi**, **Kumoijoshi** and **Ryukyu**. Diminished, chromatic, whole-tone and Locrian choices have been removed, including from randomization.

The pentatonic names describe equal-tempered note sets, not complete traditional tuning or performance systems. Interval spellings were checked against the [Tonal scale dictionary](https://github.com/tonaljs/tonal/blob/main/packages/scale-type/data.ts); the Ryukyu note set matches its ionian-pentatonic entry.

Eight synthesized voices use different source types and articulation:

| Voice | Character |
| --- | --- |
| Kalimba | Fast wooden attack and a soft pitched body |
| Koto | Fractional-delay plucked string with a bright, naturally darkening tail |
| Bamboo | Breath noise, gentle onset and delayed vibrato |
| Glass | Metallic, inharmonic bell partials with a longer ring |
| Neon FM | A strong FM attack that rapidly softens |
| Velvet | Filtered triangle body with a short electric-piano-like tine |
| Orbit | Slowly opening, detuned sawtooth pad |
| Chip | Short square-wave notes with an octave attack |

These are synthesized interpretations, not recordings of acoustic instruments. The voice picker and dice share the same catalog. Koto buffers are cached with a 24-entry limit; all voices share the existing 32-voice ceiling. Three color palettes: **Neon**, **Aurora** and **Ember**.

## Space effects

**ECHO** is a tempo-synced stereo ping-pong delay. Repeats travel left to right and gradually darken. The control increases both wet level and feedback, with feedback bounded below unity. **HALL** is a diffuse, decorrelated stereo reverb with early reflections, a 28 ms pre-delay and an approximately 5.2-second RT60. Echo repeats feed a little signal into the hall as well. Headphones make the stereo movement easiest to hear.

## FLOW accompaniment

The compact **FLOW** button toggles a quiet generative backing part independently of PLUCK, CHORD or ARP. It combines a low tonic/fifth pattern with a sparse melodic motif. The two-bar phrase repeats and varies every four bars, following the current key, scale and tempo. Changing the scale regenerates the motif immediately; a running loop aligns a newly enabled FLOW to its next bar.

Play freely over FLOW or record your part. Accompaniment notes are not copied into the loop and do not trigger an armed recording. Tap FLOW again to stop new accompaniment notes; existing tails fade. Leaving the page, an audio interruption or Esc stops FLOW too.

## Loop

Press **REC**, then play. The first note starts two bars of recording, quantized to sixteenth-note positions. A metronome sounds while armed and throughout the recording, with an accent on each bar. Playback starts automatically, and the recording click stops. The separate manual metronome setting is preserved. Arpeggios and inner fifth/octave layers are recorded too. Metronome and FLOW notes are not recorded.

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
- `voices.mjs`: voice catalog and fractional-delay plucked-string synthesis.
- `app.mjs`: multi-touch, audio-clock scheduling, loops and Canvas rendering.
- `index.html` / `style.css`: performance surface and settings.

```sh
node --test tests/*.test.mjs
```

The tests cover every tuning, string targeting, fast swipes, multi-touch, chords, arpeggios, loop transitions and transposition, recording boundaries, audio lifecycle, voice limits, the inner harmonic layers, randomization and English-only UI. DOM and AudioContext are mocked. Actual iPhone Safari sound, latency, layout and touch feel still require device testing.
