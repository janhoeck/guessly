import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Contrast regression guard for the token layer.
 *
 * Several values in styles/globals.css deliberately depart from the Elite Gamers
 * Arena reference swatches on contrast grounds — `--input` is lighter than
 * `--border`, `--muted-foreground` is lifted, `--destructive` is lightened
 * rather than darkened. Each departure looks like a mistake next to the
 * reference, which is exactly why it needs a guard: the obvious "fix" is to
 * put the reference value back.
 *
 * This reads the committed CSS, so it fails on a palette edit rather than on a
 * copy of the palette kept in the test.
 */

const CSS = readFileSync(new URL("./styles/globals.css", import.meta.url), "utf8")

type Oklch = readonly [L: number, C: number, h: number]
/** sRGB, gamma-encoded, each channel 0–1. */
type Srgb = readonly [r: number, g: number, b: number]

/** Reads `--name: oklch(L C H)` out of the committed stylesheet. */
function token(name: string): Oklch {
  const match = new RegExp(
    `^\\s*--${name}:\\s*oklch\\(\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s*\\)`,
    "m"
  ).exec(CSS)
  if (!match) {
    throw new Error(`--${name} is not declared as a plain oklch() in globals.css`)
  }
  const [, l, c, h] = match
  return [Number(l), Number(c), Number(h)]
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))
const encode = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
const decode = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

function toSrgb([L, C, hDeg]: Oklch): Srgb {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3]
  return [
    clamp(encode(clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
    clamp(encode(clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
    clamp(encode(clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))),
  ]
}

/** Source-over compositing, the way a browser lays a `/40` tint on a surface. */
function over(fg: Srgb, alpha: number, bg: Srgb): Srgb {
  return [
    alpha * fg[0] + (1 - alpha) * bg[0],
    alpha * fg[1] + (1 - alpha) * bg[1],
    alpha * fg[2] + (1 - alpha) * bg[2],
  ]
}

function luminance([r, g, b]: Srgb): number {
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)
}

function contrast(a: Srgb, b: Srgb): number {
  const [la, lb] = [luminance(a), luminance(b)]
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const background = toSrgb(token("background"))
const foreground = toSrgb(token("foreground"))
const card = toSrgb(token("card"))
const primary = toSrgb(token("primary"))
const primaryForeground = toSrgb(token("primary-foreground"))
const secondary = toSrgb(token("secondary"))
const secondaryForeground = toSrgb(token("secondary-foreground"))
const muted = toSrgb(token("muted"))
const mutedForeground = toSrgb(token("muted-foreground"))
const accent = toSrgb(token("accent"))
const destructive = toSrgb(token("destructive"))
const input = toSrgb(token("input"))
const ring = toSrgb(token("ring"))
const brandCyan = toSrgb(token("brand-cyan"))

/** WCAG 1.4.3: normal-size text. */
const TEXT = 4.5
/** WCAG 1.4.11: non-text contrast, for control boundaries and indicators. */
const BOUNDARY = 3

describe("text on its surface (WCAG 1.4.3, 4.5:1)", () => {
  const cases: ReadonlyArray<[name: string, fg: Srgb, bg: Srgb]> = [
    ["body text on the background", foreground, background],
    ["body text on a card", foreground, card],
    ["default button and badge label", primaryForeground, primary],
    ["secondary button label", secondaryForeground, secondary],
    ["link button label", primary, background],
    ["avatar fallback initials", mutedForeground, muted],
    ["secondary text on the background", mutedForeground, background],
    ["secondary text on a card", mutedForeground, card],
    // --accent is shadcn's hover surface for menus and selects. None of the ten
    // installed primitives use it yet, so this pair guards the first one that
    // does rather than anything on screen today.
    ["secondary text on a hovered row", mutedForeground, accent],
    ["card footer text", mutedForeground, over(muted, 0.5, card)],
    // The dark branch fills the input and the outline button with `bg-input/30`.
    ["outline button label", foreground, over(input, 0.3, background)],
    ["input placeholder", mutedForeground, over(input, 0.3, background)],
    ["input placeholder, in a card", mutedForeground, over(input, 0.3, card)],
    // radix-nova draws destructive as coloured text on a same-hue tint, so
    // --destructive is read here as a text colour, never as a fill.
    ["destructive label", destructive, over(destructive, 0.2, background)],
    ["destructive label, in a card", destructive, over(destructive, 0.2, card)],
    // The scoreboard's "answered" tick: the cyan as a plate with the ground
    // colour on top of it, which is the only way the accent may carry a glyph.
    ["answered tick on its cyan plate", background, brandCyan],
  ]

  it.each(cases)("%s", (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(TEXT)
  })
})

describe("boundaries and indicators (WCAG 1.4.11, 3:1)", () => {
  const cases: ReadonlyArray<[name: string, fg: Srgb, bg: Srgb]> = [
    // The whole reason --input is lighter than --border: the guess field is
    // this game's primary control, used against a 20-second clock.
    ["input border on the background", input, background],
    ["input border on a card", input, card],
    ["focus ring on the background", ring, background],
    ["focus ring on a card", ring, card],
    // Hover only, and transient. shadcn's own stock dark palette scores 3.83
    // here, so this is held to the boundary threshold rather than 4.5.
    ["destructive label while hovered", destructive, over(destructive, 0.3, card)],
  ]

  it.each(cases)("%s", (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(BOUNDARY)
  })
})

describe("the departures from the reference swatches", () => {
  it("keeps --input lighter than --border, or the guess field loses its 3:1 boundary", () => {
    const border = toSrgb(token("border"))
    expect(luminance(input)).toBeGreaterThan(luminance(border))
    // The reference steel this replaced scored 1.83:1 and would fail here.
    expect(contrast(border, background)).toBeLessThan(BOUNDARY)
  })

  it("keeps the reference pink available as a decorative accent only", () => {
    const brandPink = toSrgb(token("brand-pink"))
    // Documents why --brand-pink cannot stand in for --destructive: as text on
    // its own tint it lands under 4.5:1, which is what forced the lighter token.
    expect(contrast(brandPink, over(brandPink, 0.2, background))).toBeLessThan(TEXT)
  })

  it("uses the cyan as the focus ring rather than as the hover surface", () => {
    // If --accent is ever set to the cyan, every ghost and outline hover turns
    // into a solid #03C6FC block and foreground text stops being readable.
    expect(contrast(foreground, accent)).toBeGreaterThanOrEqual(TEXT)
    expect(token("ring")).toEqual(token("brand-cyan"))
  })
})
