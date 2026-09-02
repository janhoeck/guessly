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
 *
 * It is sized by the stage and never the other way round — see the class below.
 */
function RoundImage({ url }: { url: string }) {
  const [broken, setBroken] = React.useState(false)

  if (broken) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          This picture would not load. Everybody is looking at the same blank
          space — sit this one out.
        </p>
      </div>
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
      /*
       * Taken out of flow and told to fill the stage: `object-contain` then
       * fits the picture inside that box, so a tall photograph is letterboxed
       * instead of setting the box's height and being cropped by it. The
       * earlier `max-h-full` could not do this — a percentage measured against
       * a box the image itself was sizing resolves to the image, which is why
       * pictures kept spilling out of the frame.
       *
       * The padding is on the image rather than on the stage around it: a
       * replaced element fits its *content* box, so `p-3` is breathing room the
       * picture actually honours.
       */
      className="absolute inset-0 size-full rounded-lg object-contain p-3"
    />
  )
}

export { RoundImage }
