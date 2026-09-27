import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WASM/data files relative to its own module; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Only the engine's own inputs are read at runtime; avoid tracing the whole repo into the functions.
  outputFileTracingExcludes: {
    "*": ["demo-repo/**", "demo-repo-safe/**", "docs/**", "bob_sessions/**", ".bob/**", "cli/**"],
  },
};

export default nextConfig;
