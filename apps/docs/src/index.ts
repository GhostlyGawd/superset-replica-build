import { APP_CODENAME } from "@swarm/shared";

/**
 * @swarm/docs — the MDX docs site navigation model (spec §2). The Astro/MDX
 * rendering surface lands in Phase 6; the nav structure is real from Phase 0.
 */

export const DOCS_VERSION = "0.1.0";

export interface DocsNavItem {
  readonly title: string;
  readonly path: string;
}

export const DOCS_NAV: readonly DocsNavItem[] = [
  { title: "Overview", path: "/" },
  { title: "Architecture", path: "/architecture" },
  { title: "Parity", path: "/parity" },
  { title: "Decisions", path: "/decisions" },
];

export const DOCS_TITLE = `${APP_CODENAME} Documentation`;
