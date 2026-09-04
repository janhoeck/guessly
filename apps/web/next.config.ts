import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The web tier is stateless: it renders UI and talks to the game server over
   * a socket. Nothing here should introduce server-held game state.
   */
  transpilePackages: ["@guessly/protocol", "@guessly/ui"],

  /**
   * `next dev` otherwise writes its own AGENTS.md and CLAUDE.md into this
   * directory on every run, pointing agents at the version-matched Next docs.
   * The repo already carries a hand-written CLAUDE.md at the root; a second,
   * machine-rewritten one a level down only competes with it and keeps the
   * working tree dirty.
   */
  agentRules: false,
};

export default nextConfig;
