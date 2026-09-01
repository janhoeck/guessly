# shadcn/ui + EGA design system for `apps/web`

**Date:** 2026-09-01
**Status:** approved, ready for implementation planning

## Goal

Install shadcn/ui into `apps/web` and establish the design token vocabulary every
future Guessly screen will be built from, derived from the Elite Gamers Arena
reference shot ([dribbble.com/shots/25946961](https://dribbble.com/shots/25946961-EGA-Esports-Gaming-Logo-Branding-Design)).

This is foundation work. The token names and values are what makes it worth a
spec: every lobby, round, and scoreboard component will reference them, so
getting them wrong now means renaming across every component later.

## Scope

**In scope**

- `shadcn init` inside `apps/web`, Tailwind v4 native
- The token layer: palette, radius, fonts
- Ten generated primitives
- A `/kitchen-sink` route rendering every primitive on the real background
- A contrast regression test

**Out of scope**

- Any real application UI. `app/page.tsx` keeps its create-next-app boilerplate.
- Lobby / join / round / scoreboard screens, and any socket wiring
- Light mode, and any theme toggle
- A shared `packages/ui` workspace

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Theme | Dark only | The reference is dark. Half the tokens, and every component gets designed against the background it actually ships on. |
| Display typeface | Chakra Petch 700 italic | Angular, clipped letterforms. Hardware/tech personality over the athletic one. |
| Surface language | Soft rounded, shadcn default radius | Angular type on calm chrome. Zero per-component override cost, and focus rings stay intact — see "Why not notched". |
| Dark-only mechanism | Permanent `.dark` class on `<html>` | Keeps `shadcn add` working untouched forever — see "The dark-only mechanism". |
| Install location | `apps/web` directly, not `packages/ui` | Only one app has a UI; the game server never will. |

### Why not notched

Cut corners echoing Chakra Petch's letterforms were considered and rejected.
`clip-path` clips an element's border *and* its focus ring, so every notched
control needs a layered background to keep its outline and still loses the
corner of its focus indicator. Guessly is played by typing a guess against a
20-second clock, which makes the input's focus state load-bearing rather than
decorative. The notch is also a per-primitive override forever, not a one-time
setup.

## The dark-only mechanism

This is the non-obvious part of the whole task, and the reason it is written
down.

shadcn's generated components ship `dark:` utilities. Verified against the live
registry at `ui.shadcn.com/r/styles/new-york-v4/`:

- `button.tsx` — `dark:bg-input/30`, `dark:border-input`, `dark:hover:bg-input/50`,
  `dark:hover:bg-accent/50`, `dark:bg-destructive/60`, `dark:aria-invalid:ring-destructive/*`
- `input.tsx` — `dark:bg-input/30`, `dark:aria-invalid:ring-destructive/*`

`init` writes `@custom-variant dark (&:is(.dark *))`, so those utilities only
apply under a `.dark` ancestor. Deleting the `.dark` block and putting the
palette on `:root` — the obvious reading of "dark only" — therefore makes the
outline and ghost buttons and the guess input silently render their *light-mode*
branch on a navy background. Every future `shadcn add` would reintroduce it.

**Resolution:** hardcode `className="dark"` on `<html>` and keep the custom
variant as generated. The palette is defined once in `:root`; there is no
`.dark` palette block. The class is a variant switch, not a second theme.

`app/globals.css` must carry a comment saying exactly that, because a `.dark`
class with no matching `.dark` block is the kind of thing a reader will
"fix" otherwise.

## Token layer

Values are taken from the swatch row printed along the bottom of the reference
shot, converted from HSB to hex to oklch. shadcn's convention is oklch.

```css
:root {
  --radius: 0.625rem;

  --background:          oklch(0.2584 0.0536 255.92); /* #11243D */
  --foreground:          oklch(0.9472 0.0137 258.35); /* #E8EEF7 */
  --card:                oklch(0.2954 0.0597 256.79); /* #182D4A */
  --card-foreground:     oklch(0.9472 0.0137 258.35);
  --popover:             oklch(0.2954 0.0597 256.79);
  --popover-foreground:  oklch(0.9472 0.0137 258.35);
  --primary:             oklch(0.8907 0.1833  96.19); /* #FFD900 */
  --primary-foreground:  oklch(0.2584 0.0536 255.92);
  --secondary:           oklch(0.3238 0.0534 259.36); /* #23344F */
  --secondary-foreground:oklch(0.9472 0.0137 258.35);
  --muted:               oklch(0.3238 0.0534 259.36);
  --muted-foreground:    oklch(0.7520 0.0395 256.99); /* #9FB0C8 — see below */
  --accent:              oklch(0.3713 0.0642 260.58); /* #2C4062 — see below */
  --accent-foreground:   oklch(0.9472 0.0137 258.35);
  --destructive:         oklch(0.5828 0.2235   9.34); /* #DE185E — see below */
  --border:              oklch(0.4187 0.0513 261.36); /* #3D4D69 */
  --input:               oklch(0.5673 0.0609 261.98); /* #63779B — see below */
  --ring:                oklch(0.7703 0.1476 226.43); /* #03C6FC */

  /* Brand accents. Deliberate, non-text use only: highlights, live
     indicators, decorative rules. Never a hover surface — see
     "Why the cyan is not --accent". */
  --brand-cyan:          oklch(0.7703 0.1476 226.43); /* #03C6FC */
  --brand-pink:          oklch(0.6310 0.2425   9.75); /* #F71B68 */
}
```

`--brand-cyan` and `--brand-pink` are mapped through `@theme inline` so they are
reachable as `text-brand-cyan`, `bg-brand-pink` and so on.

Chart and sidebar tokens generated by `init` are kept at their defaults; nothing
in scope uses them, and deleting them would only cause a future `shadcn add` to
write them back.

### Why the cyan is not `--accent`

In shadcn, `--accent` is not a brand accent. It is the subtle hover surface:
`hover:bg-accent` on ghost and outline buttons, `dark:hover:bg-accent/50`,
and the highlighted-item background in menus and selects. Assigning the
reference cyan to it would turn every hover into a solid `#03C6FC` block.

So `--accent` is a quiet elevated navy, `#2C4062`, one step above the card. The
cyan lives where it genuinely belongs — `--ring`, the focus indicator, which is
the highest-traffic moment in this game — plus a `--brand-cyan` token for
deliberate decorative use. The pink gets the same treatment via `--brand-pink`.

### Three deliberate departures from the reference swatches

Every token pair was contrast-checked. Most are comfortable: foreground on
background **13.40:1**, foreground on card **11.90:1**, foreground on accent
**8.93:1**, primary-foreground on primary **11.30:1**, ring on background
**7.81:1**. Three pairs failed and were adjusted.

**1. `--input` is lighter than `--border`.**
The reference steel `#3D4D69` is **1.83:1** against the ground. Acceptable for a
decorative divider; below the 3:1 that WCAG 1.4.11 asks of a real control
boundary. The guess field is the primary control in this game and is used under
time pressure, so it gets `#63779B` — **3.07:1** against the card, **3.46:1**
against the background. shadcn already separates `--border` and `--input`, so
this costs nothing structurally, and decorative rules keep the darker steel.

**2. `--muted-foreground` is lifted from `#94A6C0` to `#9FB0C8`.**
The reference value clears 4.5:1 on the background, card and muted surfaces
(6.31, 5.60, 5.06) but drops to **4.20:1** on the new `--accent` hover surface —
a combination that occurs whenever secondary text sits in a hovered menu or list
row. `#9FB0C8` is the smallest lift that clears 4.5:1 on *every* surface it can
land on: background 7.08, card 6.29, muted 5.68, accent **4.72**.

**3. `--destructive` is the reference pink darkened 10%.**
`#F71B68` is **3.95:1** against the navy, and white text on it is *also*
**3.95:1** — under the 4.5 required for normal-size text. Darkening to pass with
white text pushes the fill toward the background, so the two constraints squeeze
from opposite sides. Walking the ramp, −10% → `#DE185E` is the workable spot:
white text **4.77:1**, fill **3.27:1** against the ground. The brand pink
`#F71B68` remains available as a non-text accent for live/urgent indicators.

## Fonts

Chakra Petch (display) and Inter (body), via `next/font/google`, replacing Geist
Sans and Geist Mono in `app/layout.tsx`.

Exposed as `--font-display` and `--font-sans`, mapped through `@theme inline` so
`font-display` and `font-sans` become Tailwind utilities.

Chakra Petch carries headings, the wordmark, and the countdown. Inter carries
body text and all controls — Chakra Petch is too characterful below roughly
16px, and the game asks players to skim a lyric snippet quickly.

Weights loaded: Chakra Petch 600, 700 plus 700 italic; Inter 400, 500, 600, 700.
Nothing else, to keep the font payload honest.

## Component set

Ten primitives, each mapped to a screen CLAUDE.md already specifies:

| Component | Used by |
|---|---|
| `button` | create, join, start, leave |
| `input` | nickname, room code, guess |
| `label` | the above |
| `card` | lobby panel, round panel |
| `badge` | host marker, disconnected marker |
| `avatar` | player rows |
| `separator` | panel divisions |
| `progress` | the 20-second round timer |
| `dialog` | `lobby:closed` |
| `sonner` | error acks — `NICKNAME_TAKEN`, `RATE_LIMITED`, `LOBBY_FULL` |

Explicitly not installed: `form` (drags in react-hook-form and zod, and the
socket boundary already validates every payload), `tooltip`, `skeleton`.

## Files

```
apps/web/
  components.json               new    aliases resolve via existing "@/*" → "./*"
  components/ui/*.tsx           new    ten generated primitives
  lib/utils.ts                  new    cn(); sits beside existing lib/socket.ts
  lib/theme-contrast.test.ts    new    contrast regression test
  app/globals.css               rewrite  token layer
  app/layout.tsx                edit   fonts, permanent .dark, metadata
  app/kitchen-sink/page.tsx     new    every primitive on the real background
  package.json                  edit   deps + test script
```

Dependencies added to `apps/web`: `radix-ui`, `class-variance-authority`,
`lucide-react`, `clsx`, `tailwind-merge`, `sonner`. Dev: `tw-animate-css`,
`vitest`.

`turbo.json` needs no change. `$TURBO_DEFAULT$` already covers new files and no
new task is introduced — the root `test` task exists but is currently
unimplemented by any package.

`app/layout.tsx` metadata is updated from "Create Next App" to Guessly while the
file is being edited for fonts. `app/page.tsx` is left alone.

## Verification

There is no game logic in this change, so there are no behavioural unit tests to
write. `LobbyStore` and the socket adapter are untouched. Verification is:

1. `pnpm lint`, `pnpm typecheck`, `pnpm build` green from the repository root
2. `/kitchen-sink` renders every primitive on the navy, checked by eye
3. `pnpm test` green — the contrast regression test below

### Contrast regression test

`apps/web/lib/theme-contrast.test.ts` asserts the pairs above still meet their
WCAG targets: body text 4.5:1, UI boundaries and large text 3:1. It converts the
committed token values and computes the ratios, so a future palette tweak cannot
silently undo the three departures documented above — which is precisely the kind
of work that erodes without a guard.

This requires adding `vitest` to `apps/web` and a `test` script, which also
makes the root `pnpm test` do something for the first time.

Assumption flagged at review: this test was offered as optional and recommended.
It is included here. Strike this section if the added tool is unwanted; nothing
else in the spec depends on it.

## Open questions

None blocking. The questions in CLAUDE.md's "Open Questions" section — answer
matching, content sourcing, repetition, scoring curve — are untouched by this
work and remain open.
