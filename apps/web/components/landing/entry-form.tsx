import {
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
} from "@guessly/protocol"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Nickname, then the two ways in: make a lobby, or join one with its code.
 *
 * **This file is the landing page's designated client island.** Everything
 * around it — the card, the hero, the round preview — is server-rendered and
 * stays that way; when `lobby:create` and `lobby:join` are wired up, the
 * "use client" directive, the state and the socket calls land *here* and
 * nowhere else. Nothing above this component needs to change for that.
 *
 * One <form> rather than two, because both paths need the same nickname and
 * asking for it twice would be worse than sharing it. The two submit buttons
 * carry their intent in `name="intent"`, which is what a submit handler will
 * read to tell create from join. Until then the form is inert: it has no
 * action and no handler, so the buttons do nothing useful.
 */
function EntryForm() {
  return (
    <form className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nickname">Nickname</Label>
        <Input
          id="nickname"
          name="nickname"
          autoComplete="nickname"
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder="What your friends call you"
          aria-describedby="nickname-hint"
          className="h-11 text-base"
        />
        <p id="nickname-hint" className="text-xs text-muted-foreground">
          Up to {NICKNAME_MAX_LENGTH} characters.
        </p>
      </div>

      <Button
        type="submit"
        name="intent"
        value="create"
        size="lg"
        className="h-11 w-full text-base"
      >
        Create lobby
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          or
        </span>
        <Separator className="flex-1" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Room code</Label>
        <div className="flex gap-2">
          <Input
            id="code"
            name="code"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="K7QMX"
            aria-describedby="code-hint"
            /* Tracked out and centred like a code being read off a screen. The
               text-indent cancels the trailing letter-space so the five
               characters sit optically centred rather than pushed left. */
            className="h-11 flex-1 text-center font-heading text-lg font-semibold tracking-[0.35em] [text-indent:0.35em] uppercase"
          />
          <Button
            type="submit"
            name="intent"
            value="join"
            variant="secondary"
            size="lg"
            className="h-11 shrink-0 px-5 text-base"
          >
            Join
          </Button>
        </div>
        <p id="code-hint" className="text-xs text-muted-foreground">
          {ROOM_CODE_LENGTH} characters. No I, L, O, 0 or 1 — codes get read out
          loud.
        </p>
      </div>
    </form>
  )
}

export { EntryForm }
