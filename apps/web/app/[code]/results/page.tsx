import { notFound } from "next/navigation"
import { isRoomCode } from "@guessly/protocol"

/**
 * Where a finished game lands.
 *
 * Deliberately blank. The winner screen — final standings, a rematch on the same
 * lobby — is its own piece of work, and an empty page everybody actually arrives
 * at is a better placeholder than a game that stops on the last intermission and
 * leaves five people looking at a dead scoreboard.
 *
 * The code is still checked against the same alphabet the server generates from,
 * so a typo 404s here exactly as it does on the game route.
 */
export default async function ResultsPage({ params }: PageProps<"/[code]/results">) {
  const { code } = await params
  if (!isRoomCode(decodeURIComponent(code).toUpperCase())) notFound()

  return <main className="flex-1" />
}
