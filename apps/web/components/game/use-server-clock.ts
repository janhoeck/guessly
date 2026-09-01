"use client"

import * as React from "react"

import { serverNow } from "@/lib/lobby-client"

/**
 * The server's clock, ticking, for as long as something on screen is counting
 * down against it.
 *
 * `requestAnimationFrame` rather than an interval, for two reasons. The timer
 * bar is a continuous thing and a 100ms interval is visible in it; and rAF
 * stops on its own in a background tab, which is exactly the behaviour wanted —
 * a countdown nobody is looking at does not need drawing, and the first frame
 * after coming back reads the real clock rather than replaying a queue of
 * missed ticks.
 *
 * Nothing here trusts `Date.now()` on its own: `serverNow` carries the offset
 * measured from the last snapshot, so a browser with a wrong system time still
 * counts down correctly. Speed is the score.
 */
export function useServerClock(active: boolean): number {
  const [now, setNow] = React.useState(serverNow)

  React.useEffect(() => {
    if (!active) return

    let frame = requestAnimationFrame(function tick() {
      setNow(serverNow())
      frame = requestAnimationFrame(tick)
    })

    return () => cancelAnimationFrame(frame)
  }, [active])

  return now
}
