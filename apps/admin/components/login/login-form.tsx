"use client"

import * as React from "react"

import { login, type LoginState } from "@/app/login/actions"
import { Button } from "@guessly/ui/components/ui/button"
import { Input } from "@guessly/ui/components/ui/input"
import { Label } from "@guessly/ui/components/ui/label"

/**
 * The password field and the button, and the one client boundary on the
 * login page: `useActionState` is what lets a wrong password come back as a
 * line under the field rather than a fresh page with an empty one.
 */
function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = React.useActionState<LoginState, FormData>(login, {
    error: null,
  })
  const invalid = state.error !== null

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "password-error" : undefined}
          className="h-11 text-base"
        />
        {invalid && (
          <p id="password-error" role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}

export { LoginForm }
