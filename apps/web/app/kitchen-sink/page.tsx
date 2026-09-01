"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CheckIcon } from "lucide-react"

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"

/**
 * Every primitive in the design system, rendered on the real background.
 *
 * This route exists to be looked at. It is not application UI and nothing here
 * is wired to a socket — it is the check that the token layer holds up on the
 * navy before any screen is built on top of it.
 */

const ROUND_SECONDS = 20

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
          {title}
        </h2>
        {hint ? (
          <p className="max-w-2xl text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <Separator />
      {children}
    </section>
  )
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-12 rounded-lg border border-border ${className}`} />
      <code className="text-xs text-muted-foreground">{name}</code>
    </div>
  )
}

/** The 20-second round clock: the reason --primary and Progress are here. */
function RoundTimer() {
  const [remaining, setRemaining] = useState(ROUND_SECONDS)

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((r) => (r <= 0.1 ? ROUND_SECONDS : r - 0.1))
    }, 100)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Time remaining</span>
        <span className="font-heading text-2xl font-bold tabular-nums">
          {remaining.toFixed(1)}s
        </span>
      </div>
      <Progress value={(remaining / ROUND_SECONDS) * 100} />
    </div>
  )
}

const PLAYERS = [
  { name: "Erik", score: 60, host: true },
  { name: "Jan", score: 45, host: false },
  { name: "Sam", score: 0, host: false },
]

export default function KitchenSink() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="font-heading text-4xl font-bold italic tracking-tight uppercase sm:text-5xl">
          Guessly
        </p>
        <p className="max-w-2xl text-muted-foreground">
          Chakra Petch for display, Inter for everything you actually read.
          Every primitive below is rendered on{" "}
          <code className="text-brand-cyan">--background</code>, the navy the
          game ships on.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge>Dark only</Badge>
          <Badge variant="secondary">Tailwind v4</Badge>
          <Badge variant="outline">shadcn radix-nova</Badge>
        </div>
      </header>

      <Section
        title="Palette"
        hint="Derived from the Elite Gamers Arena reference. The cyan is the focus ring, not a hover surface; the pink is a decorative accent, not the destructive fill."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          <Swatch name="--background" className="bg-background" />
          <Swatch name="--card" className="bg-card" />
          <Swatch name="--secondary" className="bg-secondary" />
          <Swatch name="--accent" className="bg-accent" />
          <Swatch name="--primary" className="bg-primary" />
          <Swatch name="--destructive" className="bg-destructive" />
          <Swatch name="--border" className="bg-border" />
          <Swatch name="--input" className="bg-input" />
          <Swatch name="--ring" className="bg-ring" />
          <Swatch name="--foreground" className="bg-foreground" />
          <Swatch name="--brand-cyan" className="bg-brand-cyan" />
          <Swatch name="--brand-pink" className="bg-brand-pink" />
        </div>
      </Section>

      <Section
        title="Typography"
        hint="Chakra Petch carries headings, the wordmark and the countdown. Inter carries body text and every control: the display face is too characterful below about 16px, and players skim lyric snippets under a clock."
      >
        <div className="flex flex-col gap-4">
          <p className="font-heading text-5xl font-bold italic uppercase">
            Round 3
          </p>
          <p className="font-heading text-2xl font-semibold">
            Guess the song from these lyrics
          </p>
          <p className="max-w-2xl leading-relaxed">
            Every player who answers correctly within the 20 seconds scores
            points, and points scale with speed. A wrong answer, or no answer at
            all, is worth nothing.
          </p>
          <p className="text-sm text-muted-foreground">
            Secondary text sits on --muted-foreground, which clears 4.5:1 on
            every surface it can land on.
          </p>
        </div>
      </Section>

      <Section
        title="Buttons"
        hint="create, join, start, leave. Tab through them: the cyan focus ring is the highest-traffic moment in the game."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Start game</Button>
          <Button variant="secondary">Copy code</Button>
          <Button variant="outline">Change target</Button>
          <Button variant="ghost">Settings</Button>
          <Button variant="destructive">Leave lobby</Button>
          <Button variant="link">How to play</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Confirm">
            <CheckIcon />
          </Button>
          <Button disabled>Waiting for host</Button>
        </div>
      </Section>

      <Section title="Badges" hint="Host marker, disconnected marker.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Host</Badge>
          <Badge variant="secondary">In round</Badge>
          <Badge variant="outline">Spectating</Badge>
          <Badge variant="destructive">Disconnected</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </div>
      </Section>

      <Section
        title="Inputs"
        hint="Nickname, room code, guess. --input is deliberately lighter than --border: this is a real control boundary under a 20-second clock, so it clears 3:1 rather than the reference steel's 1.83:1."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nickname">Nickname</Label>
            <Input id="nickname" placeholder="1-16 characters" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Room code</Label>
            <Input
              id="code"
              defaultValue="K7QMX"
              className="font-heading tracking-[0.3em] uppercase"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="guess">Your guess</Label>
            <Input id="guess" placeholder="Type your answer" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="taken">Nickname (rejected)</Label>
            <Input id="taken" defaultValue="Erik" aria-invalid />
            <p className="text-xs text-destructive">
              That nickname is taken in this lobby.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="locked">Room code (locked)</Label>
            <Input id="locked" defaultValue="K7QMX" disabled />
          </div>
        </div>
      </Section>

      <Section title="Avatars" hint="Player rows.">
        <div className="flex flex-wrap items-center gap-6">
          <Avatar size="sm">
            <AvatarFallback>JA</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>EP</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarImage src="/globe.svg" alt="" />
            <AvatarFallback>GL</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>ME</AvatarFallback>
            <AvatarBadge />
          </Avatar>
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>B</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>C</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+9</AvatarGroupCount>
          </AvatarGroup>
        </div>
      </Section>

      <Section
        title="Round timer"
        hint="Progress, driven from a server-sent deadline in the real game. The server owns the clock; this one is decorative."
      >
        <RoundTimer />
      </Section>

      <Section
        title="Cards and separators"
        hint="Lobby panel, round panel, panel divisions. CardTitle picks up the display face through --font-heading."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Lobby K7QMX</CardTitle>
              <CardDescription>
                Waiting for the host to start. First to 100 points wins.
              </CardDescription>
              <CardAction>
                <Badge>Host</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {PLAYERS.map((player, i) => (
                <div key={player.name}>
                  {i > 0 ? <Separator className="mb-3" /> : null}
                  <div className="flex items-center gap-3">
                    <Avatar size="sm">
                      <AvatarFallback>{player.name.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-sm font-medium">
                      {player.name}
                    </span>
                    {player.host ? (
                      <Badge variant="secondary">Host</Badge>
                    ) : null}
                    <span className="font-heading text-sm tabular-nums">
                      {player.score}
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
            <CardFooter className="justify-between">
              <span className="text-sm text-muted-foreground">3 of 12</span>
              <Button size="sm">Start game</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vertical separator</CardTitle>
              <CardDescription>Both orientations, on --border.</CardDescription>
            </CardHeader>
            <CardContent className="flex h-16 items-center gap-4 text-sm">
              <span>Flags</span>
              <Separator orientation="vertical" />
              <span>Music</span>
              <Separator orientation="vertical" />
              <span>Logos</span>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        title="Dialog"
        hint="lobby:closed, the one moment the game interrupts a player."
      >
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Show lobby closed</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Lobby closed</DialogTitle>
              <DialogDescription>
                The host left and there was nobody left to promote. This lobby is
                gone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Dismiss</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button>Back to join screen</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section
        title="Toasts"
        hint="Error acks. Every client-to-server event returns a Result, and these are what a player sees when one comes back not ok."
      >
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => toast.error("That nickname is already taken.")}
          >
            NICKNAME_TAKEN
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.warning("Slow down, too many actions.")}
          >
            RATE_LIMITED
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.error("That lobby is full.")}
          >
            LOBBY_FULL
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.success("You are in. Waiting for the host.")}
          >
            Joined
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.info("Reconnecting to your seat.")}
          >
            Resuming
          </Button>
        </div>
      </Section>
    </main>
  )
}
