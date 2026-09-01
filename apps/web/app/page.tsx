import { EntryPanel } from "@/components/landing/entry-panel"
import { Hero } from "@/components/landing/hero"
import { HowItWorks } from "@/components/landing/how-it-works"
import { RoundPreview } from "@/components/landing/round-preview"
import { Wordmark } from "@/components/site/wordmark"

/**
 * The landing page: a server component that only composes. No state, no socket,
 * nothing that has to become a client component later — see EntryForm for where
 * the interactive half is going to live.
 */
export default function Home() {
  return (
    <>
      <main className="relative isolate flex flex-1 flex-col">
        {/* Ambient wash under the hero. Decorative, and the only gradient on
            the page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--brand-cyan),transparent_92%),transparent_70%)]"
        />

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-6 py-16 sm:py-24 lg:gap-28">
          <section className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
            <div className="flex flex-col gap-10">
              <Hero />
              <EntryPanel />
            </div>
            <RoundPreview className="lg:justify-self-end" />
          </section>

          <HowItWorks />
        </div>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>No account, no install. Make a lobby and read the code out.</p>
          <p>
            <Wordmark className="text-foreground" /> — built for voice chat.
          </p>
        </div>
      </footer>
    </>
  )
}
