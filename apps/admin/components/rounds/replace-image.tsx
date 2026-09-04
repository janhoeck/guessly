"use client"

import * as React from "react"

import type { SaveState } from "@/app/(admin)/rounds/[id]/actions"
import { SaveNotice } from "@/components/rounds/save-notice"
import { Field } from "@/components/site/field"
import { Button } from "@guessly/ui/components/ui/button"
import { Input } from "@guessly/ui/components/ui/input"

/**
 * A new picture for an old round. Its own form rather than a field on the
 * editor, because it is its own save: the bytes go to the bucket and the
 * round is pointed at them in one action, and nothing else on the page is
 * touched. The file field is emptied after a successful upload so the same
 * file is not sent twice by a second click.
 */
function ReplaceImage({
  action,
  maxBytes,
}: {
  action: (previous: SaveState, form: FormData) => Promise<SaveState>
  /** From the bank, by way of the server: client code cannot import it. */
  maxBytes: number
}) {
  const [state, formAction, pending] = React.useActionState<SaveState, FormData>(action, {
    status: "idle",
  })
  const form = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state.status === "saved") form.current?.reset()
  }, [state])

  return (
    <form ref={form} action={formAction} className="flex flex-col gap-4">
      <Field
        id="image"
        label="Replace the picture"
        hint={`PNG, JPEG, GIF, WebP or SVG, up to ${Math.round(maxBytes / 1024 / 1024)} MB. Checked by its bytes, not its name.`}
      >
        <Input
          id="image"
          name="image"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          required
          className="h-auto py-1.5"
        />
      </Field>
      <Field id="sourceUrl" label="Source" hint="Where it came from, for attribution. Optional.">
        <Input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://commons.wikimedia.org/…" />
      </Field>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Uploading…" : "Replace picture"}
        </Button>
        <SaveNotice state={state} />
      </div>
    </form>
  )
}

export { ReplaceImage }
