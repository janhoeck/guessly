"use client"

import * as React from "react"
import { LANGUAGES, TOPICS, type LanguageDefinition } from "@guessly/protocol"
import type { BankedRoundRecord, BankedRoundText } from "@guessly/bank"

import type { SaveState } from "@/app/(admin)/rounds/[id]/actions"
import { SaveNotice } from "@/components/rounds/save-notice"
import { Field } from "@/components/site/field"
import { Button } from "@guessly/ui/components/ui/button"
import { Input } from "@guessly/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@guessly/ui/components/ui/select"
import { Textarea } from "@guessly/ui/components/ui/textarea"
import {
  ANSWER_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  SNIPPET_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
} from "@/lib/form"

/**
 * The round, as a form: what it is, what it shows if it is lyrics, and — per
 * language — what it asks and what it accepts.
 *
 * The fields are uncontrolled and the round is their default, so this keeps
 * no copy of the round at all: the server sends the record, the form edits
 * it, `useActionState` carries back what the save said. A language the
 * round was never written in is an empty card rather than an "add language"
 * button, because adding one *is* filling in a question and an answer, and
 * the card says so.
 */

const CARD = "flex flex-col gap-5 rounded-xl bg-card p-5 ring-1 ring-border/60"

function RoundEditor({
  round,
  action,
}: {
  round: BankedRoundRecord
  action: (previous: SaveState, form: FormData) => Promise<SaveState>
}) {
  const [state, formAction, pending] = React.useActionState<SaveState, FormData>(action, {
    status: "idle",
  })
  // Only shelves of the round's own kind: a picture cannot become a
  // paraphrase, and the parser refuses the move — this just does not offer it.
  const topics = TOPICS.filter((topic) => topic.kind === round.kind)
  const catalogued = topics.some((topic) => topic.id === round.topic)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <section aria-labelledby="round-heading" className={CARD}>
        <h2 id="round-heading" className="font-heading text-base font-semibold">
          The round
        </h2>

        <Field
          id="subject"
          label="Subject"
          hint="What the picture or the song is. For the log and this list; players never see it."
        >
          <Input
            id="subject"
            name="subject"
            defaultValue={round.subject}
            maxLength={SUBJECT_MAX_LENGTH}
            required
          />
        </Field>

        <Field
          id="topic"
          label="Topic"
          hint={
            round.kind === "lyrics"
              ? "Only topics that deal lyrics."
              : "Only topics that deal pictures — a round cannot change what it shows."
          }
        >
          <Select name="topic" defaultValue={round.topic}>
            <SelectTrigger id="topic" className="w-full sm:max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {topics.map((topic) => (
                <SelectItem key={topic.id} value={topic.id}>
                  {topic.label}
                </SelectItem>
              ))}
              {!catalogued && (
                <SelectItem value={round.topic}>{round.topic} (not in the catalogue)</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>

        {round.kind === "lyrics" && (
          <>
            <Field
              id="snippet"
              label="Paraphrase"
              hint="Three to five lines in the song's own language: the same images, the same running order, none of the actual words. Real lyrics are copyrighted and this game does not quote them."
            >
              <Textarea
                id="snippet"
                name="snippet"
                defaultValue={round.snippet ?? ""}
                rows={5}
                maxLength={SNIPPET_MAX_LENGTH}
                required
                lang={round.snippetLanguage ?? undefined}
                className="font-heading text-base leading-relaxed"
              />
            </Field>
            <Field
              id="snippetLanguage"
              label="Sung in"
              hint="A language tag like en, de or pt-BR, so a screen reader reads it in the right voice. Leave it blank if you are not sure."
            >
              <Input
                id="snippetLanguage"
                name="snippetLanguage"
                defaultValue={round.snippetLanguage ?? ""}
                placeholder="en"
                className="max-w-32"
              />
            </Field>
          </>
        )}
      </section>

      {LANGUAGES.map((language) => (
        <LanguageSection key={language.id} language={language} text={round.texts[language.id]} />
      ))}

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-border/60 bg-background/95 py-4 backdrop-blur">
        <Button type="submit" size="lg" disabled={pending} className="h-10 px-5">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <SaveNotice state={state} />
      </footer>
    </form>
  )
}

function LanguageSection({
  language,
  text,
}: {
  language: LanguageDefinition
  text: BankedRoundText | undefined
}) {
  const id = language.id
  return (
    <section aria-labelledby={`${id}-heading`} className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-heading`} className="font-heading text-base font-semibold">
          {language.label}{" "}
          <span lang={language.tag} className="font-normal text-muted-foreground">
            {language.endonym}
          </span>
        </h2>
        {text === undefined && (
          <p className="text-xs text-muted-foreground">
            Not written yet. A question and an answer add it.
          </p>
        )}
      </div>

      <Field id={`${id}-question`} label="Question">
        <Input
          id={`${id}-question`}
          name={`${id}.question`}
          defaultValue={text?.question ?? ""}
          maxLength={QUESTION_MAX_LENGTH}
          lang={language.tag}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={`${id}-answer`}
          label="Answer"
          hint="Spelled the way the thing spells itself. Clear this and the question to drop the language."
        >
          <Input
            id={`${id}-answer`}
            name={`${id}.answer`}
            defaultValue={text?.answer ?? ""}
            maxLength={ANSWER_MAX_LENGTH}
            lang={language.tag}
          />
        </Field>
        <Field
          id={`${id}-aliases`}
          label="Also accepted"
          hint="One per line: other spellings, the original title, the artist."
        >
          <Textarea
            id={`${id}-aliases`}
            name={`${id}.aliases`}
            defaultValue={text?.aliases.join("\n") ?? ""}
            rows={3}
            lang={language.tag}
          />
        </Field>
      </div>
    </section>
  )
}

export { RoundEditor }
