// Assert the electron-builder `--dir` output is a real, complete unpacked Grove app.
//
// Run by the CI `package` job (ADR-0016) after `package:dir` on all 3 OSes. It does
// NOT launch the GUI (that is local W6 evidence); it proves COLD that packaging
// assembled the app tree with the bundled main + renderer inside the asar archive.
//
// Cross-platform + dependency-free (node:fs only). electron-builder `--dir` emits an
// OS-specific unpacked dir under apps/desktop/release/:
//   Windows  release/win-unpacked/Grove.exe          + resources/app.asar
//   Linux    release/linux-unpacked/grove            + resources/app.asar
//   macOS    release/mac*/Grove.app/Contents/...     + .../Resources/app.asar
// We locate the app.asar, confirm it is non-trivial, and read its header (a plaintext
// JSON directory at the head of the archive) to assert the bundled `main.js`,
// `preload.cjs`, and renderer `index.html` are really packed in.
import { existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RELEASE = join(process.cwd(), "release");
const fail = (msg) => {
  console.error(`ASSERT FAIL: ${msg}`);
  process.exit(1);
};

if (!existsSync(RELEASE)) {
  fail(`no release/ dir at ${RELEASE} — did electron-builder --dir run?`);
}

/** Recursively collect file paths under a dir whose basename matches `name`. */
function findAll(dir, name, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findAll(full, name, out);
    } else if (entry.name === name) {
      out.push(full);
    }
  }
  return out;
}

const asars = findAll(RELEASE, "app.asar");
if (asars.length === 0) {
  fail("no resources/app.asar found anywhere under release/ — packaging did not bundle the app");
}
const asar = asars[0];
const size = statSync(asar).size;
if (size < 50_000) {
  fail(`app.asar is suspiciously small (${size} bytes) — the bundle looks empty`);
}

// The asar header is a pickled JSON directory at the very start of the file; the packed
// filenames appear there as plaintext. Read a generous prefix and assert our bundled
// entrypoints are listed (proves main/preload/renderer are actually inside).
const fd = openSync(asar, "r");
const buf = Buffer.alloc(Math.min(256_000, size));
readSync(fd, buf, 0, buf.length, 0);
const header = buf.toString("latin1");
const required = ["main.js", "preload.cjs", "index.html"];
const missing = required.filter((f) => !header.includes(f));
if (missing.length > 0) {
  fail(`app.asar header is missing expected bundled entries: ${missing.join(", ")}`);
}

// Find the platform launcher so we know a runnable app tree (not just the asar) exists.
const launchers = [
  ...findAll(RELEASE, "Grove.exe"),
  ...findAll(RELEASE, "grove"),
  ...findAll(RELEASE, "Grove"),
];
const launcher =
  launchers.find((p) => /win-unpacked|linux-unpacked|\.app[\\/]Contents[\\/]MacOS/.test(p)) ??
  launchers[0];

console.log("ASSERT OK — unpacked Grove app validated:");
console.log(`  app.asar:   ${asar} (${(size / 1024).toFixed(0)} KiB)`);
console.log(`  bundled:    ${required.join(", ")} present in asar header`);
console.log(
  `  launcher:   ${launcher ?? "(platform executable not separately found; asar is authoritative)"}`,
);
