import * as React from "react"

import { cn } from "@guessly/ui/lib/utils"

/**
 * The browser's own checkbox, dressed for the table. Native rather than
 * shadcn's, on purpose: a native box carries its name and value into the
 * form's data with no script at all, which is what lets a row stay
 * server-rendered and the list's selection stay a plain form. Nothing here
 * is a client component, so both the rows and the header can render it.
 */
function RoundCheckbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      {...props}
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded-sm scheme-dark accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
    />
  )
}

export { RoundCheckbox }
