import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Cross-platform dependency preflight for `grove up` (ADR-0015 / ADR-0004). Each
 * tool is probed by EXECUTING its `--version` and parsing the output, treating
 * `ENOENT` (not on PATH) the same as a non-zero exit.
 *
 * The probe runs SHELL-FREE first (`child_process.execFile`): `CreateProcess` /
 * `execvp` resolve a real binary off PATH on every OS. But on Windows an npm-global
 * CLI — `npm i -g bun`, which is one of our OWN install hints — lands as a `.cmd`
 * shim, and `CreateProcess` cannot launch a `.cmd`/`.bat`, so a shell-free probe
 * throws `ENOENT` even though the tool is on PATH (the false negative this guards).
 * ONLY in that case (win32 + `ENOENT`) we retry through the shell so PATHEXT resolves
 * the shim; if that retry also fails the tool is genuinely absent and we surface the
 * original `ENOENT`. `bin`/`versionArgs` are fixed `ToolSpec` literals (never user
 * input), so the shell retry adds no injection surface.
 */

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** Per-probe timeout so a wedged binary can never hang the bootstrap. */
const PROBE_TIMEOUT_MS = 5000;

export interface ToolSpec {
  /** The executable resolved off PATH (e.g. `node`, `bun`, `git`). */
  readonly bin: string;
  /** Human label for the ✓/✗ table. */
  readonly label: string;
  /** A missing REQUIRED tool aborts `grove up`; an optional one only warns. */
  readonly required: boolean;
  /** Args that make the tool print its version and exit (usually `--version`). */
  readonly versionArgs: readonly string[];
  /** Minimum acceptable major version; omitted ⇒ "runnable" is enough. */
  readonly minMajor?: number;
  /** Major version we recommend (noted when present-but-older). */
  readonly recommendedMajor?: number;
  /** Exact, copy-pasteable install guidance shown when the tool is missing. */
  readonly installHint: string;
}

/**
 * The bootstrap's dependency set. Node + Bun + Git are REQUIRED (the daemon runs
 * under Node — ADR-0007a; the repo is Bun + Git driven). Node's floor is the repo's
 * `engines.node` (>= 22, the documented Node-22-LTS fallback of ADR-0007a) with 24
 * recommended. `cloudflared` is OPTIONAL — only the W3 `--remote` tunnel needs it.
 */
export const DEFAULT_TOOLS: readonly ToolSpec[] = [
  {
    bin: "node",
    label: "Node.js",
    required: true,
    versionArgs: ["--version"],
    minMajor: 22,
    recommendedMajor: 24,
    installHint: "Install Node.js 24 from https://nodejs.org — the daemon runs under Node.",
  },
  {
    bin: "bun",
    label: "Bun",
    required: true,
    versionArgs: ["--version"],
    installHint: "Install Bun from https://bun.sh (or `npm i -g bun`).",
  },
  {
    bin: "git",
    label: "Git",
    required: true,
    versionArgs: ["--version"],
    installHint: "Install Git from https://git-scm.com/downloads.",
  },
  {
    bin: "cloudflared",
    label: "cloudflared (optional)",
    required: false,
    versionArgs: ["--version"],
    installHint:
      "Optional — install cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for `grove up --remote` (W3).",
  },
];

export interface ToolCheck {
  readonly spec: ToolSpec;
  /** The tool is runnable (resolved off PATH and exited cleanly). */
  readonly found: boolean;
  /** Runnable AND satisfies `minMajor` (always true when `found` with no floor). */
  readonly ok: boolean;
  readonly version: string | null;
  readonly major: number | null;
  /** One-line status for the table (version, "not found", "needs >= N", …). */
  readonly detail: string;
}

export interface DepReport {
  readonly checks: readonly ToolCheck[];
  /** Every REQUIRED tool is `ok`. */
  readonly ok: boolean;
  /** The REQUIRED tools that are missing or too old (drives the abort message). */
  readonly missingRequired: readonly ToolCheck[];
}

/** Pull the first dotted-numeric version out of a `--version` line. */
function parseVersion(text: string): string | null {
  const match = text.match(/\d+(?:\.\d+)+/);
  return match ? match[0] : null;
}

/**
 * Execute `<bin> <versionArgs>` and return its captured stdio. Runs shell-free first
 * (fast, injection-free); on Windows it retries through the shell on `ENOENT` so a
 * `.cmd`/`.bat` PATH shim (e.g. an `npm i -g`-installed tool) resolves via PATHEXT.
 * If the shell retry also fails, the ORIGINAL `ENOENT` is rethrown so the report
 * still reads "not found on PATH" rather than a shell exit code.
 */
async function runProbe(spec: ToolSpec): Promise<{ stdout: string; stderr: string }> {
  const opts = { timeout: PROBE_TIMEOUT_MS, windowsHide: true } as const;
  try {
    return await execFileAsync(spec.bin, [...spec.versionArgs], opts);
  } catch (err) {
    if (process.platform === "win32" && (err as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        // `exec` runs a command STRING through the shell so PATHEXT resolves the
        // `.cmd`/`.bat` shim — NOT execFile's (args[] + shell:true), which Node
        // deprecates (DEP0190). bin + versionArgs are fixed literals, so the join
        // carries no injection surface.
        return await execAsync([spec.bin, ...spec.versionArgs].join(" "), opts);
      } catch {
        throw err; // shim retry failed too → genuinely absent; keep the ENOENT signal
      }
    }
    throw err;
  }
}

/**
 * Probe ONE tool by executing `<bin> <versionArgs>`. Never throws: a missing binary
 * (`ENOENT`), a non-zero exit, or a timeout all resolve to `found: false`. A present
 * tool below its `minMajor` resolves to `found: true, ok: false`.
 */
export async function verifyTool(spec: ToolSpec): Promise<ToolCheck> {
  try {
    const { stdout, stderr } = await runProbe(spec);
    // Some tools print their version to stderr; consider both streams.
    const version = parseVersion(`${stdout}\n${stderr}`);
    const major = version !== null ? Number.parseInt(version, 10) : null;

    if (spec.minMajor !== undefined && major !== null && major < spec.minMajor) {
      return {
        spec,
        found: true,
        ok: false,
        version,
        major,
        detail: `v${version} — needs >= ${spec.minMajor}`,
      };
    }
    const recommend =
      spec.recommendedMajor !== undefined && major !== null && major < spec.recommendedMajor
        ? ` (v${spec.recommendedMajor} recommended)`
        : "";
    return {
      spec,
      found: true,
      ok: true,
      version,
      major,
      detail: version !== null ? `v${version}${recommend}` : "runnable",
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail = code === "ENOENT" ? "not found on PATH" : `not runnable (${code ?? "error"})`;
    return { spec, found: false, ok: false, version: null, major: null, detail };
  }
}

/** Probe every tool (in parallel) and roll the required-tool verdicts into a report. */
export async function verifyDeps(tools: readonly ToolSpec[] = DEFAULT_TOOLS): Promise<DepReport> {
  const checks = await Promise.all(tools.map((spec) => verifyTool(spec)));
  const missingRequired = checks.filter((check) => check.spec.required && !check.ok);
  return { checks, ok: missingRequired.length === 0, missingRequired };
}

/** Render the ✓/✗ preflight table as a printable block. */
export function formatDepTable(report: DepReport): string {
  const width = report.checks.reduce((max, check) => Math.max(max, check.spec.label.length), 0);
  return report.checks
    .map((check) => {
      const mark = check.ok ? "✓" : check.spec.required ? "✗" : "–";
      return `  ${mark} ${check.spec.label.padEnd(width)}  ${check.detail}`;
    })
    .join("\n");
}
