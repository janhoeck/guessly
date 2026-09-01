import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The web tier is stateless: it renders UI and talks to the game server over
   * a socket. Nothing here should introduce server-held game state.
   */
  transpilePackages: ["@guessly/protocol"],
};

export default nextConfig;
