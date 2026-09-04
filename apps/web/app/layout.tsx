import type { Metadata } from "next";
import "@guessly/ui/styles/globals.css";
import { fontVariables } from "@guessly/ui/fonts";
import { Toaster } from "@guessly/ui/components/ui/sonner";

export const metadata: Metadata = {
  title: "Guessly",
  description:
    "A realtime multiplayer party game. Everyone sees the same thing at the same time — work out what it is before your friends do.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
     * `dark` is hardcoded and permanent. Guessly has one theme, and the class
     * is what activates the `dark:` utilities shadcn generates into its own
     * components. See the note at the top of packages/ui's globals.css before
     * removing it — there is no `.dark` palette block to go looking for.
     */
    <html
      lang="en"
      className={`dark ${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
