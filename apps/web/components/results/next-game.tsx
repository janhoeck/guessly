"use client"

import {
  MIN_PLAYERS_TO_START,
  type LanguageId,
  type LobbyState,
  type TopicId,
} from "@guessly/protocol"

import { LanguageSelect, LanguageSummary } from "@/components/lobby/language-select"
import { TargetScore, TargetScoreSummary } from "@/components/lobby/target-score"
import { TopicSelect, TopicSummary } from "@/components/lobby/topic-select"
import { Button } from "@guessly/ui/components/ui/button"

/**
 * The next game, set up on the results screen.
 *
 * A finished lobby is a lobby being set up again — the server holds every host
 * power open in `finished` exactly as in `lobby` — so these are the same three
 * controls the lobby modal shows, wired to the same events, rendered from the
 * same snapshot. The host re-picks or leaves everything alone; everybody else
 * sees what they are in for. Play again is a plain `lobby:start`: the server
 * resets the scores and the used answers, and the countdown that follows is
 * round one's.
 *
 * Nobody new can join a finished lobby — the door shut at kick-off and stays
 * shut — so the only players a rematch can wait on are seats that dropped and
 * might come back, and the status line under the button says which of those
 * this room is looking at rather than showing a bare count.
 */
function NextGamePanel({
  state,
  playerId,
  starting,
  onSetTopics,
  onSetLanguage,
  onSetTargetScore,
  onStart,
}: {
  state: LobbyState
  playerId: string
  starting: boolean
  onSetTopics: (topics: TopicId[]) => void
  onSetLanguage: (language: LanguageId) => void
  onSetTargetScore: (targetScore: number) => void
  onStart: () => void
}) {
  const isHost = state.hostId === playerId
  const connected = state.players.filter((player) => player.connected).length
  const missing = MIN_PLAYERS_TO_START - connected
  const canStart = isHost && missing <= 0 && !starting

  const status =
    missing <= 0
      ? isHost
        ? "Same room, same seats — start whenever you like."
        : "Ready when the host is."
      : state.players.length >= MIN_PLAYERS_TO_START
        ? `Waiting for ${missing} player${missing === 1 ? "" : "s"} to come back.`
        : "Not enough players are left — make a new lobby to go again."

  return (
    <section className="flex flex-col gap-5 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <header className="flex flex-col gap-1">
        <h2 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Next game
        </h2>
        <p className="text-sm text-muted-foreground">
          {isHost
            ? "Change anything below, or run it back as it was."
            : "The host sets the next one up."}
        </p>
      </header>

      {isHost ? (
        <TopicSelect selected={state.topics} onChange={onSetTopics} />
      ) : (
        <TopicSummary selected={state.topics} />
      )}

      {isHost ? (
        <LanguageSelect language={state.language} onChange={onSetLanguage} />
      ) : (
        <LanguageSummary language={state.language} />
      )}

      {isHost ? (
        <TargetScore targetScore={state.targetScore} onChange={onSetTargetScore} />
      ) : (
        <TargetScoreSummary targetScore={state.targetScore} />
      )}

      <div className="flex flex-col gap-2">
        {isHost && (
          <Button type="button" size="lg" disabled={!canStart} onClick={onStart}>
            {starting ? "Starting…" : "Play again"}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{status}</p>
      </div>
    </section>
  )
}

export { NextGamePanel }
