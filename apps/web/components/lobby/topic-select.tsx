"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import {
  ALL_TOPIC_IDS,
  MIN_TOPICS,
  TOPICS,
  topicById,
  type RoundKind,
  type TopicId,
} from "@guessly/protocol"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * What the rounds may be about.
 *
 * The selection is *not* held in local state. Every toggle emits and the
 * server's next snapshot is what re-renders this — same as every other control
 * in the lobby, and the reason no reconciliation is needed when two hosts'
 * worth of events cross on the wire. See use-lobby.ts.
 */

/** Menu headings. Kinds are grouped because they are genuinely different rounds. */
const KIND_LABELS: Record<RoundKind, string> = {
  image: "Pictures",
  lyrics: "Lyrics",
}

const KINDS = Object.keys(KIND_LABELS) as RoundKind[]

/** "All 12 topics", "Flags and Music", "5 topics" — whichever is shortest to read. */
function summarise(selected: TopicId[]): string {
  if (selected.length === ALL_TOPIC_IDS.length) {
    return `All ${ALL_TOPIC_IDS.length} topics`
  }
  if (selected.length <= 2) {
    return selected.map((id) => topicById(id).label).join(" and ")
  }
  return `${selected.length} topics`
}

function TopicSelect({
  selected,
  onChange,
  disabled = false,
}: {
  selected: TopicId[]
  onChange: (topics: TopicId[]) => void
  disabled?: boolean
}) {
  const labelId = React.useId()
  const triggerId = React.useId()

  const chosen = new Set(selected)
  const allSelected = selected.length === ALL_TOPIC_IDS.length

  const toggle = (id: TopicId) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(ALL_TOPIC_IDS.filter((topic) => next.has(topic)))
  }

  return (
    <section className="flex flex-col gap-2">
      <span
        id={labelId}
        className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
      >
        Topics
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            className="w-full justify-between font-normal"
            aria-labelledby={`${labelId} ${triggerId}`}
          >
            {summarise(selected)}
            <ChevronDownIcon className="opacity-60" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="max-h-80">
          <DropdownMenuItem
            disabled={allSelected}
            onSelect={() => onChange([...ALL_TOPIC_IDS])}
          >
            Select all
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {KINDS.map((kind, index) => (
            <React.Fragment key={kind}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{KIND_LABELS[kind]}</DropdownMenuLabel>
              {TOPICS.filter((topic) => topic.kind === kind).map((topic) => {
                const isChecked = chosen.has(topic.id)
                return (
                  <DropdownMenuCheckboxItem
                    key={topic.id}
                    checked={isChecked}
                    /* A lobby needs something to build a round from, so the
                       last one standing cannot be switched off. The server
                       refuses it too; this just says so before the round trip. */
                    disabled={isChecked && selected.length <= MIN_TOPICS}
                    /* Radix closes the menu on select. Picking topics is a
                       multiple-choice job, so it stays open. */
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggle(topic.id)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span>{topic.label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {topic.hint}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                )
              })}
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <p className="text-xs text-muted-foreground">
        {selected.includes("music")
          ? "Picked at random each round."
          : "Picked at random each round — with Music off, every round is a picture."}
      </p>
    </section>
  )
}

/** The same selection for everyone who cannot change it. */
function TopicSummary({ selected }: { selected: TopicId[] }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
        Topics
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {selected.map((id) => (
          <li key={id}>
            <Badge variant="outline">{topicById(id).label}</Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}

export { TopicSelect, TopicSummary }
