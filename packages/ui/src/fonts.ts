import { Chakra_Petch, Inter } from "next/font/google"

/**
 * The two faces every Guessly screen is set in, loaded once for every app.
 *
 * Chakra Petch is a static family, so its weights are listed explicitly. Both
 * styles are loaded because the display face is used italic — asking for the
 * normal face alone would leave the browser to synthesise a fake oblique.
 *
 * The CSS variables these register are what `styles/globals.css` maps
 * `font-sans` and `font-heading` onto, so a root layout that forgets
 * `fontVariables` renders in the browser's fallbacks with no error to say so.
 */
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  display: "swap",
})

/** Inter is a variable font: one file covers 400 through 700. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
})

/** The class names to put on `<html>`. */
const fontVariables = `${chakraPetch.variable} ${inter.variable}`

export { chakraPetch, inter, fontVariables }
