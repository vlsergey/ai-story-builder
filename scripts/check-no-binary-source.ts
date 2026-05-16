#!/usr/bin/env tsx
/**
 * Fail loudly if any tracked source file contains a NUL byte (0x00).
 *
 * Why this is a precommit step:
 * Biome's format check on Linux (CI) refuses files that contain NUL bytes,
 * while Biome on Windows silently tolerates them — so a NUL-containing file
 * can pass `npm run precommit` locally and only fail in CI. This check
 * closes that gap with one cross-platform read pass.
 *
 * Scope is restricted to git-tracked files under `src/`, `scripts/`,
 * and the root config files — generated artefacts (dist/, node_modules/)
 * and binary fixtures legitimately may contain NULs and are skipped via
 * the `git ls-files` filter.
 */
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".scss",
])

function listTrackedFiles(): string[] {
  const out = execSync("git ls-files", { encoding: "utf8" })
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((rel) => TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase()))
}

const offenders: string[] = []
for (const rel of listTrackedFiles()) {
  const full = path.resolve(rel)
  try {
    const buf = fs.readFileSync(full)
    if (buf.includes(0)) offenders.push(rel)
  } catch {
    // Skip files that disappeared between `git ls-files` and our read.
  }
}

if (offenders.length > 0) {
  process.stderr.write(`NUL byte (0x00) found in tracked source file${offenders.length > 1 ? "s" : ""}:\n`)
  for (const f of offenders) process.stderr.write(`  - ${f}\n`)
  process.stderr.write(
    "\nNUL bytes confuse cross-platform tooling (biome on Linux rejects them; git treats the file as binary). " +
      "Replace the raw NUL with a normal escape sequence or a different separator.\n",
  )
  process.exit(1)
}

console.log("No NUL bytes in tracked text-source files.")
