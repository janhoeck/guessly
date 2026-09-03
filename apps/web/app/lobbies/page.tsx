import { SiteHeader } from "@/components/site/site-header"

/**
 * A placeholder, so the header's second link goes somewhere real.
 *
 * There is nothing here yet on purpose — the browsable list of open lobbies is
 * the next session's work. It exists now because a nav item pointing at a 404
 * is worse than an empty page, and because typed routes will not accept an
 * `href` with no page behind it.
 */
export default function LobbiesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-16">
        <h1 className="font-heading text-3xl font-semibold">Lobbies</h1>
        <p className="max-w-[54ch] text-muted-foreground">
          Nothing to browse yet. For now a lobby is reached by its code — make
          one on the home page and read the code out.
        </p>
      </main>
    </>
  )
}
