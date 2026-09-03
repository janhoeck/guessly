import { LobbyBrowser } from "@/components/lobbies/lobby-browser"
import { SiteHeader } from "@/components/site/site-header"

/**
 * Every lobby that is open right now, and a way into the ones that will have
 * you.
 *
 * A composition like every other page here: it holds no state, imports nothing
 * from `lib/`, and stays a server component. `LobbyBrowser` is the one client
 * island, and the boundary stops there — the header, the heading and the copy
 * around it render on the server and never re-render at all.
 */
export default function LobbiesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12 sm:py-16">
        <div className="flex flex-col gap-3">
          <h1 className="font-heading text-3xl font-semibold">Open lobbies</h1>
          <p className="max-w-[54ch] text-muted-foreground">
            Pick a room and take a seat. A game already under way stays on the
            list so you can see it — you just cannot get into it until it ends.
          </p>
        </div>

        <LobbyBrowser />
      </main>
    </>
  )
}
