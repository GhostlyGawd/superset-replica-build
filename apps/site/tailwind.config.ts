import type { Config } from "tailwindcss";
import { swarmPreset } from "../../packages/ui/src/tailwind-preset";

/**
 * Grove launch site Tailwind config. Every design decision lives in the Grove
 * preset (`@swarm/ui/tailwind-preset`), which binds utilities to CSS variables;
 * this file only points the scanner at the sources that use them. Theming is
 * driven by `[data-theme]` + CSS variables, not Tailwind's `dark:` variant.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  presets: [swarmPreset],
} satisfies Config;
