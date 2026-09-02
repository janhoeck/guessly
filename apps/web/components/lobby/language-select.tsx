"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { LANGUAGES, languageById, type LanguageId } from "@guessly/protocol"

import { Button } from "@/components/ui/button"

/**
 * What language the rounds are written in.
 *
 * Buttons rather than a dropdown, because a menu that has to be opened before
 * it says what is inside is a poor way to show a choice that fits on one line.
 * Like every other control in the lobby it keeps no state of its own: it
 * renders the server's selection and emits a whole new one, and the broadcast
 * is what moves it.
 *
 * The tick is doing real work. Filled and outlined are nearly the same tone in
 * a dark palette, and the one colour that would separate them at a glance is
 * the yellow reserved for the single call to action on the screen — so the
 * selected one is marked the same way the topic menu marks its choices.
 *
 * This is the *content* language and not the interface's: the question, the
 * answer and a lyrics round's paraphrase come back in it, and the game's own
 * furniture stays where it is. Guessing is looser than that — every language's
 * answer counts — and the hint says both, because a host who picks German
 * expecting a translated scoreboard has been misled by a control that was too
 * proud to explain itself.
 */

/**
 * What the interface itself is written in. Naming it is the difference between
 * a hint that reads as a caveat and one that reads as a tautology: an English
 * room has nothing to be warned about.
 */
const INTERFACE_LANGUAGE: LanguageId = "en"

/** One sentence, true whichever language is picked and however many there are. */
function describe(language: LanguageId): string {
  const { label } = languageById(language)
  const rest =
    language === INTERFACE_LANGUAGE ? "" : ` The rest of the game stays ${languageById(INTERFACE_LANGUAGE).label}.`
  return `Questions and answers come in ${label}, and a guess in another language still counts.${rest}`
}

function LanguageSelect({
  language,
  onChange,
  disabled = false,
}: {
  language: LanguageId
  onChange: (language: LanguageId) => void
  disabled?: boolean
}) {
  const labelId = React.useId()

  return (
    <section className="flex flex-col gap-2">
      <span
        id={labelId}
        className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
      >
        Language
      </span>

      <div role="group" aria-labelledby={labelId} className="flex gap-2">
        {LANGUAGES.map((option) => {
          const selected = option.id === language
          return (
            <Button
              key={option.id}
              type="button"
              variant={selected ? "secondary" : "outline"}
              size="lg"
              disabled={disabled}
              aria-pressed={selected}
              /* Re-picking what is already picked is a broadcast nobody needs. */
              onClick={() => !selected && onChange(option.id)}
              className={
                selected
                  ? "flex-1 justify-center gap-2 font-medium"
                  : "flex-1 justify-center gap-2 font-normal text-muted-foreground"
              }
            >
              {selected && <CheckIcon aria-hidden className="text-brand-cyan" />}
              {option.label}
              {/* "English (English)" is a joke at the reader's expense. */}
              {option.endonym !== option.label && (
                <span lang={option.tag} className="opacity-60">
                  {option.endonym}
                </span>
              )}
            </Button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">{describe(language)}</p>
    </section>
  )
}

/** The same choice for everyone who cannot change it. */
function LanguageSummary({ language }: { language: LanguageId }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
        Language
      </span>
      <p className="text-sm">
        Rounds are in{" "}
        <strong className="font-heading font-bold">
          {languageById(language).label}
        </strong>
        .
      </p>
      <p className="text-xs text-muted-foreground">
        A guess in another language still counts.
      </p>
    </section>
  )
}

export { LanguageSelect, LanguageSummary }
