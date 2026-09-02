import { notFound } from "next/navigation"
import { isRoomCode } from "@guessly/protocol"

import { ResultsRoom } from "@/components/results/results-room"

/**
 * Where a finished game lands: the winner, the standings, and the next game.
 *
 * A composition like every other page — no state, and no reason to ever become
 * a client component. ResultsRoom is the island. The code is checked against
 * the same alphabet the server generates from, so a typo 404s here exactly as
 * it does on the game route.
 */
export default async function ResultsPage({ params }: PageProps<"/[code]/results">) {
  const { code } = await params
  const roomCode = decodeURIComponent(code).toUpperCase()
  if (!isRoomCode(roomCode)) notFound()

  return <ResultsRoom code={roomCode} />
}
