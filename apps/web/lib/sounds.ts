"use client"

/**
 * The game's four sounds: the countdown tick, GO, a right answer, a wrong one.
 *
 * All four come from Kenney's "Interface Sounds" pack (kenney.nl, CC0) — one
 * pack on purpose, so they read as one voice: the tick is a short glass ding,
 * GO and a correct answer are rising chimes in different registers, and a miss
 * is a short falling glitch that is over before the field is ready to retype
 * into. The files are in `public/sounds/`, converted to mono WAV because
 * Safari does not decode Ogg Vorbis.
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

/** Per-sound gain, balancing the sources' loudness — the tick sits under the
 *  round it announces, the verdicts sit a little above it. */
const SOUNDS: Record<SoundName, { src: string; gain: number }> = {
  tick: { src: "/sounds/tick.wav", gain: 0.4 },
  go: { src: "/sounds/go.wav", gain: 0.5 },
  correct: { src: "/sounds/correct.wav", gain: 0.55 },
  wrong: { src: "/sounds/wrong.wav", gain: 0.45 },
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
