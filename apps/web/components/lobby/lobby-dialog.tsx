"use client"

import {
  MIN_PLAYERS_TO_START,
  type LanguageId,
  type LobbyState,
  type TopicId,
} from "@guessly/protocol"

import { LanguageSelect, LanguageSummary } from "@/components/lobby/language-select"
import { PlayerList } from "@/components/lobby/player-list"
import { TargetScore, TargetScoreSummary } from "@/components/lobby/target-score"
import { TopicSelect, TopicSummary } from "@/components/lobby/topic-select"
import { LobbyCode } from "@/components/lobby/lobby-code"
import { Button } from "@guessly/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@guessly/ui/components/ui/dialog"

/**
 * The lobby: a modal, because it is a room you are *in* rather than a page you
 * are looking at. Everything it renders comes from one `LobbyState` it always
 * trusts, and every control emits rather than setting local state.
 *
 * It cannot be dismissed by accident. Escape and a click outside are both
 * refused, and the only way out is the Leave button — which frees the seat for
 * real. A stray keystroke should not cost somebody the lobby they just read out
 * to four friends.
 */
function LobbyDialog({
  state,
  playerId,
  starting,
  onSetTopics,
  onSetLanguage,
  onSetTargetScore,
  onStart,
  onLeave,
}: {
  state: LobbyState
  playerId: string
  starting: boolean
  onSetTopics: (topics: TopicId[]) => void
  onSetLanguage: (language: LanguageId) => void
  onSetTargetScore: (targetScore: number) => void
  onStart: () => void
  onLeave: () => void
}) {
  const isHost = state.hostId === playerId
  const waiting = state.status === "lobby"
  const connected = state.players.filter((player) => player.connected).length
  const missing = MIN_PLAYERS_TO_START - connected
  const canStart = isHost && waiting && missing <= 0 && !starting

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{isHost ? "Your lobby" : "You're in"}</DialogTitle>
          <DialogDescription>
            {isHost
              ? "Read the code out. Everyone joins with it."
              : "Waiting for the host to start the game."}
          </DialogDescription>
        </DialogHeader>

        <LobbyCode code={state.code} />

        <PlayerList players={state.players} hostId={state.hostId} playerId={playerId} />

        {isHost ? (
          <TopicSelect selected={state.topics} onChange={onSetTopics} disabled={!waiting} />
        ) : (
          <TopicSummary selected={state.topics} />
        )}

        {isHost ? (
          <LanguageSelect
            language={state.language}
            onChange={onSetLanguage}
            disabled={!waiting}
          />
        ) : (
          <LanguageSummary language={state.language} />
        )}

        {isHost ? (
          <TargetScore
            targetScore={state.targetScore}
            onChange={onSetTargetScore}
            disabled={!waiting}
          />
        ) : (
          <TargetScoreSummary targetScore={state.targetScore} />
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          {/* The reason the button is off, stated rather than left to be
              guessed at from a greyed-out control. */}
          <p className="text-xs text-muted-foreground sm:mr-auto">
            {!waiting
              ? "The game has started."
              : missing > 0
                ? `Needs ${missing} more player${missing === 1 ? "" : "s"}.`
                : isHost
                  ? "Everyone's in — start when you're ready."
                  : "Ready when the host is."}
          </p>

          <Button type="button" variant="ghost" size="lg" onClick={onLeave}>
            Leave
          </Button>

          {isHost && (
            <Button type="button" size="lg" disabled={!canStart} onClick={onStart}>
              {starting ? "Starting…" : "Start game"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { LobbyDialog }
