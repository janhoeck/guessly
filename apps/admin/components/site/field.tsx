import * as React from "react"

import { Label } from "@guessly/ui/components/ui/label"
import { cn } from "@guessly/ui/lib/utils"

/**
 * A label, a control and an optional line under it, wired together by id so
 * a screen reader hears the hint with the field. Every form here is a
 * column of these; the control is whatever the caller passes, and it has to
 * carry the `id` this component is given.
 */
function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const hintId = hint === undefined ? undefined : `${id}-hint`
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

export { Field }
