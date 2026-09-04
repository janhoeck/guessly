import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="font-heading text-2xl font-semibold">Nothing here</h1>
      <p className="max-w-[54ch] text-muted-foreground">
        No page and no round by that address. A round that was deleted is gone
        from the list too.
      </p>
      <p>
        <Link href="/rounds" className="text-primary underline-offset-4 hover:underline">
          Back to the rounds
        </Link>
      </p>
    </main>
  );
}
