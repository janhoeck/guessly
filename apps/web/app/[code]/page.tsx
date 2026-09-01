import { notFound } from "next/navigation"
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@guessly/protocol"

import { GameRoom } from "@/components/game/game-room"

/**
 * A game, at the URL you would read out: `/<CODE>`.
 *
 * This route sits at the root, so it is the one thing standing between a typo
 * and a game screen for a lobby that could never exist. The code is checked
 * against the same alphabet the server generates from — no I, L, O, 0 or 1 —
 * and anything else is a 404 rather than a room that spends a second connecting
 * before giving up.
 *
 * A composition and nothing else: the page holds no state and never becomes a
 * client component. GameRoom is the island.
 */
const CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

export default async function GamePage({ params }: PageProps<"/[code]">) {
  const { code } = await params
  // Uppercased here as well as on the server, so a link typed in lower case
  // opens the room instead of missing it.
  const roomCode = decodeURIComponent(code).toUpperCase()
  if (!CODE_PATTERN.test(roomCode)) notFound()

  return <GameRoom code={roomCode} />
}
