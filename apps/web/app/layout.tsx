import type { Metadata } from "next";
import { Chakra_Petch, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

/**
 * Chakra Petch is a static family, so its weights are listed explicitly. Both
 * styles are loaded because the display face is used italic — asking for the
 * normal face alone would leave the browser to synthesise a fake oblique.
 */
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

/** Inter is a variable font: one file covers 400 through 700. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

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
     * components. See the note at the top of app/globals.css before removing
     * it — there is no `.dark` palette block to go looking for.
     */
    <html
      lang="en"
      className={`dark ${chakraPetch.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
