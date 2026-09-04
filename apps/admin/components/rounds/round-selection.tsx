"use client"

import * as React from "react"

import type { DeleteManyState } from "@/app/(admin)/rounds/actions"
import { RoundCheckbox } from "@/components/rounds/round-checkbox"
import { Button } from "@guessly/ui/components/ui/button"

/**
 * The list as a form: a checkbox on every row, and one write — delete what
 * is ticked — behind the same two clicks the single round's delete takes.
 *
 * The checkboxes are the browser's, uncontrolled and named `id`, so the
 * rows are still rendered on the server and the submission is a plain
 * FormData the action reads back. What this island keeps is only how many
 * are ticked — counted off the form on every change, never a second list of
 * ids — and whether the second click is armed. React resets the form once
 * the action has landed, so a deletion also empties the selection, and the
 * count is read off the form again rather than assumed.
 */

interface Selection {
  /** How many rows are ticked. */
  selected: number
  /** How many rows there are to tick. */
  total: number
}

const SelectionContext = React.createContext<Selection>({ selected: 0, total: 0 })

const boxesIn = (form: HTMLFormElement | null): HTMLInputElement[] =>
  form === null ? [] : Array.from(form.querySelectorAll<HTMLInputElement>("input[name='id']"))

const countTicked = (form: HTMLFormElement | null): number =>
  boxesIn(form).filter((box) => box.checked).length

function RoundSelection({
  action,
  total,
  range,
  children,
}: {
  action: (previous: DeleteManyState, form: FormData) => Promise<DeleteManyState>
  total: number
  /** "1–24 of 240": the line the list used to print above itself. */
  range: string
  children: React.ReactNode
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [selected, setSelected] = React.useState(0)
  const [armed, setArmed] = React.useState(false)
  const [state, formAction, pending] = React.useActionState<DeleteManyState, FormData>(action, {
    status: "idle",
  })

  const recount = React.useCallback(() => {
    const ticked = countTicked(formRef.current)
    setSelected(ticked)
    if (ticked === 0) setArmed(false)
  }, [])

  // The form has been reset by the time the action's answer renders — see
  // above — and the rows may have changed underneath, so count again.
  React.useEffect(recount, [state, total, recount])

  const clear = () => {
    for (const box of boxesIn(formRef.current)) box.checked = false
    recount()
  }

  const these = selected === 1 ? "this round" : `these ${selected} rounds`
  const them = selected === 1 ? "it" : "them"

  return (
    <SelectionContext.Provider value={{ selected, total }}>
      <form ref={formRef} action={formAction} onChange={recount} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">{range}</p>
          <DeleteNotice state={state} />
        </div>

        {children}

        {selected > 0 && !armed && (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 shadow-lg ring-1 ring-border/60">
            <p className="text-sm">
              <span className="font-medium tabular-nums">{selected}</span> of {total} on this page
              selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" onClick={() => setArmed(true)}>
                Delete {these}
              </Button>
              <Button type="button" variant="ghost" onClick={clear}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {selected > 0 && armed && (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 shadow-lg ring-1 ring-destructive/40">
            <p className="text-sm">
              Delete {these}? Pictures go too, unless another round shows them. There is no undo.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Deleting…" : `Yes, delete ${them}`}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setArmed(false)} disabled={pending}>
                Keep {them}
              </Button>
            </div>
          </div>
        )}
      </form>
    </SelectionContext.Provider>
  )
}

/**
 * The header's box: the whole page at once. Controlled from the count, so
 * it shows all, none or some — and ticking it writes straight into the
 * row's own boxes, which is what the form then counts.
 */
function SelectAllRounds() {
  const { selected, total } = React.useContext(SelectionContext)
  const ref = React.useRef<HTMLInputElement>(null)
  const all = total > 0 && selected === total

  React.useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = selected > 0 && !all
  }, [selected, all])

  return (
    <RoundCheckbox
      ref={ref}
      aria-label="Select every round on this page"
      checked={all}
      onChange={(event) => {
        const ticked = event.currentTarget.checked
        for (const box of boxesIn(event.currentTarget.form)) box.checked = ticked
      }}
    />
  )
}

/**
 * What the last deletion said, beside the count. Polite, like the editor's
 * notice; an error is an alert because it is the one thing to act on.
 */
function DeleteNotice({ state }: { state: DeleteManyState }) {
  if (state.status === "idle") return null

  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    )
  }

  const { deleted, missing } = state
  const gone =
    deleted === 0
      ? "Nothing to delete: those rounds were already gone."
      : `Deleted ${deleted === 1 ? "1 round" : `${deleted} rounds`}.`
  const also =
    deleted > 0 && missing > 0 ? ` ${missing === 1 ? "One was" : `${missing} were`} already gone.` : ""

  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      {gone}
      {also}
    </p>
  )
}

export { RoundSelection, SelectAllRounds }
