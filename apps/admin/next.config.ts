import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The catalogue is shared source and is transpiled like the web app's copy.
   * The bank is deliberately not listed anywhere here: it must not be bundled
   * at all, and `serverExternalPackages` cannot keep a workspace package out
   * of the bundle — see lib/bank.ts for how it is loaded instead.
   */
  transpilePackages: ["@guessly/protocol", "@guessly/ui"],

  /**
   * `next dev` otherwise writes its own AGENTS.md and CLAUDE.md into this
   * directory on every run. The repo already carries a hand-written CLAUDE.md
   * at the root; see apps/web/next.config.ts.
   */
  agentRules: false,
};

export default nextConfig;
