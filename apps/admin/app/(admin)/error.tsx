"use client";

import { Button } from "@guessly/ui/components/ui/button";

/**
 * What a broken server render looks like from here. In production Next
 * strips the message on its way to the browser, so this page can only say
 * where to look — and the log is where `loadAdminConfig` names the variable
 * a deploy forgot, and where a bucket that could not be reached says so in
 * its own words.
 */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-6 ring-1 ring-destructive/30">
      <h1 className="font-heading text-2xl font-semibold">Something broke on the server</h1>
      <p className="max-w-[60ch] text-muted-foreground">
        The admin could not finish rendering this page. The server log has the
        details — when the bank cannot be opened, it usually names the
        variable that is missing, or the bucket that could not be reached.
      </p>
      <div>
        <Button type="button" variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
