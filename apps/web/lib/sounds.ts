"use client"

/**
 * The game's four sounds: the countdown tick, GO, a right answer, a wrong one.
 *
 * All four come from Kenney's "Interface Sounds" pack (kenney.nl, CC0) — one
 * pack on purpose, so they read as one voice, and three of the four are
 * literally one voice: `maximize`/`minimize` is a single soft chime played as
 * a gesture, and the game uses that gesture three ways. GO is it rising in a
 * low, warm register; a correct answer is the same rise an octave and a half
 * up, so a score reads as the same event in a brighter key; a miss is the
 * gesture inverted, falling, which is the direction everybody already reads as
 * "no". The tick is the odd one out and has to be: it plays six times a round,
 * so it is a short low bong rather than a chime — percussion under the chimes
 * instead of a fourth note competing with them.
 *
 * **They are chosen to be quiet in the register the ear is sharpest in.** An
 * earlier set was picked for meaning alone and was shrill: the miss put 44% of
 * its energy above 2kHz and 24% above 4kHz — a thin metallic buzz that cuts
 * through at almost no measured level — and the tick sat at 1.9kHz, near the
 * peak of human hearing sensitivity, six times a round. Every sound here has
 * *no* energy above 2kHz at all, and the gains below balance them by
 * A-weighted loudness rather than by peak, which is why a number that looks
 * low is not quiet. A sound is harsh because of where it sits, not how loud it
 * is, so both were fixed and only one of them was a volume.
 *
 * The tick serves both of the game's countdowns — the three before a round and
 * the three that close it — because it is the same event at either end, and a
 * fifth file would have made two of them into two voices. The files are in
 * `public/sounds/`, converted to mono 16-bit WAV because Safari does not decode
 * Ogg Vorbis.
 *
 * Web Audio rather than `<audio>` for two reasons that matter here. Latency: a
 * tick that lands late reads as a countdown that stutters, and buffer playback
 * is as immediate as it gets. And the autoplay policy: a browser only lets a
 * page make noise after a user gesture, and the countdown is precisely not one
 * — it arrives over the socket. So the context is created and resumed on the
 * first gesture anywhere on the page (every player has clicked or typed long
 * before a round starts), and `playSound` degrades to silence rather than an
 * error when that has not happened. Sound here is garnish: nothing may break,
 * queue, or retry because a speaker was not available.
 */

type SoundName = "tick" | "go" | "correct" | "wrong"

/**
 * Per-sound gain, balancing the sources' *perceived* loudness — A-weighted,
 * because the files are all normalised to the same peak and peaks are not what
 * a person hears. The tick sits furthest under: it announces the round and runs
 * it out, six times, and it is the one sound a player hears whether or not
 * anything happened. GO and a right answer land together a little above it, and
 * a miss just under those — audible enough to be the answer to "did that
 * count?", quiet enough not to be a telling-off.
 */
const SOUNDS: Record<SoundName, { src: string; gain: number }> = {
  tick: { src: "/sounds/tick.wav", gain: 0.34 },
  go: { src: "/sounds/go.wav", gain: 0.42 },
  correct: { src: "/sounds/correct.wav", gain: 0.28 },
  wrong: { src: "/sounds/wrong.wav", gain: 0.28 },
}

let context: AudioContext | null = null
const buffers = new Map<SoundName, AudioBuffer>()

/** Fetch and decode every sound once, into whatever context exists by then.
 *  A file that fails to load simply never plays — see garnish, above. */
function preload(ctx: AudioContext): void {
  for (const [name, { src }] of Object.entries(SOUNDS) as [
    SoundName,
    (typeof SOUNDS)[SoundName],
  ][]) {
    fetch(src)
      .then((response) => response.arrayBuffer())
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => buffers.set(name, buffer))
      .catch(() => {})
  }
}

/**
 * Runs on every gesture, not just the first: iOS suspends a context when the
 * tab loses focus or a call comes in, and the next tap is the moment it may be
 * woken again. `resume()` on a running context is a no-op.
 */
function unlock(): void {
  if (context === null) {
    context = new AudioContext()
    preload(context)
  }
  void context.resume().catch(() => {})
}

// Module scope rather than a hook: the gesture that unlocks audio is usually
// on the landing page, screens before the first component that plays anything.
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { capture: true })
  window.addEventListener("keydown", unlock, { capture: true })
}

export function playSound(name: SoundName): void {
  if (context === null || context.state !== "running") return
  const buffer = buffers.get(name)
  if (buffer === undefined) return

  const source = context.createBufferSource()
  source.buffer = buffer
  const gain = context.createGain()
  gain.gain.value = SOUNDS[name].gain
  source.connect(gain)
  gain.connect(context.destination)
  source.start()
}
