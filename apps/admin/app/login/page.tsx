import { LoginForm } from "@/components/login/login-form"
import { Wordmark } from "@guessly/ui/components/wordmark"
import { safeReturnPath } from "@/lib/session"

/**
 * The only page the door does not stand in front of. It composes and holds
 * nothing; the form is the island.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { next } = await searchParams

  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--brand-cyan),transparent_92%),transparent_70%)]"
      />

      <div className="flex w-full max-w-sm flex-col gap-10">
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2.5">
            <Wordmark className="text-4xl" />
            <span className="rounded-sm bg-brand-cyan/15 px-1.5 py-0.5 font-heading text-xs font-semibold tracking-[0.2em] uppercase">
              Admin
            </span>
          </p>
          <p className="text-muted-foreground">
            The back room: every picture and every paraphrase a lobby can be
            dealt, and the way to fix the ones that are wrong.
          </p>
        </div>

        <LoginForm next={safeReturnPath(Array.isArray(next) ? next[0] : next)} />
      </div>
    </main>
  )
}
