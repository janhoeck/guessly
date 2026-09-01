"use client"

import * as React from "react"

/**
 * The picture.
 *
 * `alt` is empty on purpose. The image *is* the puzzle, and the only honest
 * description of it would be the answer — so the round's meaning is carried by
 * the question above it instead, which every player gets either way.
 *
 * The server checks each candidate URL before committing to it, but it checks
 * from the server: a host can answer Node and still refuse a browser. That last
 * mile is this component's fallback, and `no-referrer` is what stops the most
 * common version of it, a host that turns away anything linked from elsewhere.
 *
 * `broken` is per-picture and is reset by identity: the caller keys this on the
 * URL, so a new round gets a new component rather than one carrying the last
 * round's failure.
 */
function RoundImage({ url }: { url: string }) {
  const [broken, setBroken] = React.useState(false)

  if (broken) {
    return (
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        This picture would not load. Everybody is looking at the same blank
        space — sit this one out.
      </p>
    )
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- the source is
       whatever the AI found, on a host nobody knows in advance, so there is no
       remotePatterns list next/image could be given. */
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="max-h-full max-w-full rounded-lg object-contain"
    />
  )
}

export { RoundImage }
