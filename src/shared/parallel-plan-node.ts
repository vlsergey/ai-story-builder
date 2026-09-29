/**
 * A parallel loop's own content. Its iterations are keyed by what they work
 * on, not by position: identical elements are one iteration, an element
 * inserted upstream does not shift the others, and an unchanged element keeps
 * its result.
 *
 * A key is a prefix of the element's SHA-256 (lowercase hex), at least
 * `MIN_KEY_LENGTH` characters, as long as needed to tell the loop's current
 * elements apart. It grows when they stop being told apart and never shrinks;
 * `hashes` keeps each key's full hash, so a grown key can be traced back to the
 * iteration it renames.
 */
export interface ParallelNodeContent {
  keyLength: number
  /** Key → full hash, for the current iterations. */
  hashes: Record<string, string>
  /** The key of each element, in list order: the loop's output follows it. */
  order: string[]
}

export const MIN_KEY_LENGTH = 6

/** The loop's content, or an empty one when it has not run or cannot be read. */
export function parseParallelContent(content: string | null | undefined): ParallelNodeContent {
  try {
    const parsed = JSON.parse(content || "{}") as Partial<ParallelNodeContent>
    return {
      keyLength: typeof parsed.keyLength === "number" ? parsed.keyLength : MIN_KEY_LENGTH,
      hashes: parsed.hashes && typeof parsed.hashes === "object" ? parsed.hashes : {},
      order: Array.isArray(parsed.order) ? parsed.order : [],
    }
  } catch {
    return { keyLength: MIN_KEY_LENGTH, hashes: {}, order: [] }
  }
}

/** The loop's iterations: each distinct key once, in the order its first element comes. */
export function parallelIterationKeys(content: string | null | undefined): string[] {
  return [...new Set(parseParallelContent(content).order)]
}

export interface ParallelExpansion {
  content: ParallelNodeContent
  /** Iterations whose key grew: their rows move from the old key to the new one. */
  renamed: { from: string; to: string }[]
  /** Distinct keys with the element each one works on. */
  elements: Map<string, string>
}

/**
 * Keys the loop's elements, given its previous content and each element's
 * full hash. The key length is the previous one, grown until the current
 * distinct elements have distinct keys.
 */
export function expandParallel(
  previous: ParallelNodeContent,
  elements: string[],
  hashOf: (element: string) => string,
): ParallelExpansion {
  const fullHashes = elements.map(hashOf)
  const distinct = [...new Set(fullHashes)]
  let keyLength = Math.max(previous.keyLength, MIN_KEY_LENGTH)
  while (new Set(distinct.map((hash) => hash.slice(0, keyLength))).size < distinct.length) keyLength++

  const renamed: { from: string; to: string }[] = []
  if (keyLength > previous.keyLength) {
    const current = new Set(distinct)
    for (const [key, hash] of Object.entries(previous.hashes)) {
      // Only iterations that stay need their rows moved; the others are deleted.
      if (current.has(hash)) renamed.push({ from: key, to: hash.slice(0, keyLength) })
    }
  }

  const hashes: Record<string, string> = {}
  const keyed = new Map<string, string>()
  const order = fullHashes.map((hash, i) => {
    const key = hash.slice(0, keyLength)
    hashes[key] = hash
    if (!keyed.has(key)) keyed.set(key, elements[i])
    return key
  })
  return { content: { keyLength, hashes, order }, renamed, elements: keyed }
}
