import type { Metadata } from "next";
import "@guessly/ui/styles/globals.css";
import { fontVariables } from "@guessly/ui/fonts";

export const metadata: Metadata = {
  title: {
    default: "Guessly Admin",
    template: "%s · Guessly Admin",
  },
  description: "The round bank behind Guessly: every picture and every paraphrase a lobby can be dealt.",
  /** An operator's tool has no business in a search index. */
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `dark` is hardcoded and permanent, exactly as in the game: one theme,
     * and the class is what fires the `dark:` utilities shadcn generates.
     * See the note at the top of packages/ui's globals.css before removing it.
     */
    <html
      lang="en"
      className={`dark ${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
