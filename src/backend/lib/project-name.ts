/**
 * Converts a user-supplied project name into a safe filesystem filename stem.
 *
 * Rules:
 * - Unicode letters (\p{L}), digits (\p{N}), and spaces are preserved as-is,
 *   so Cyrillic, CJK, Arabic, and other scripts are allowed.
 * - Hyphen (-), underscore (_), and dot (.) are also kept.
 * - Characters forbidden on common filesystems (Windows / macOS / Linux)
 *   — namely \ / : * ? " < > | and the null byte — are replaced with _.
 */
export function sanitizeProjectName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00]/g, "_")
}
