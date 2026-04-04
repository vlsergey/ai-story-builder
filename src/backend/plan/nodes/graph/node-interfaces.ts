/**
 * Interface for nodes that can produce a single text output (for 'text' edges).
 */
export interface TextOutputNode {
  getOutputText(): string
}

/**
 * Interface for nodes that can produce an array of texts (for 'textArray' edges).
 */
export interface TextArrayOutputNode {
  getOutputTexts(): string[]
}
