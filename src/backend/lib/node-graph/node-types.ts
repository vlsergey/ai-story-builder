import type { PlanNodeType } from '../../../shared/plan-graph.js'
import type { NodeData, NodeContext, TextOutputNode, TextArrayOutputNode } from './node-interfaces.js'

/**
 * Base class for all node types.
 */
export abstract class BaseNode {
  constructor(
    protected data: NodeData,
    protected context: NodeContext,
  ) {}

  getId(): number {
    return this.data.id
  }

  getType(): PlanNodeType {
    return this.data.type
  }

  getTitle(): string {
    return this.data.title
  }

  getContent(): string | null {
    return this.data.content
  }

  /**
   * Returns the output for a given edge type.
   * Must be implemented by subclasses that support outgoing edges.
   */
  abstract getOutput(edgeType: string): unknown
}

/**
 * Text node (plain text content).
 * Implements TextOutputNode for 'text' edges.
 */
export class TextNode extends BaseNode implements TextOutputNode {
  getOutput(edgeType: string): unknown {
    if (edgeType === 'text') {
      return this.getOutputText()
    }
    throw new Error(`TextNode does not support edge type '${edgeType}'`)
  }

  getOutputText(): string {
    return this.data.content ?? ''
  }
}

/**
 * Lore node (similar to text node).
 */
export class LoreNode extends BaseNode implements TextOutputNode {
  getOutput(edgeType: string): unknown {
    if (edgeType === 'text') {
      return this.getOutputText()
    }
    throw new Error(`LoreNode does not support edge type '${edgeType}'`)
  }

  getOutputText(): string {
    return this.data.content ?? ''
  }
}

/**
 * Splitter node.
 * Takes a single incoming text edge, splits by regex pattern stored in content,
 * and outputs an array of texts for 'textArray' edges.
 */
export class SplitterNode extends BaseNode implements TextArrayOutputNode {
  getOutput(edgeType: string): unknown {
    if (edgeType === 'textArray') {
      return this.getOutputTexts()
    }
    throw new Error(`SplitterNode does not support edge type '${edgeType}'`)
  }

  getOutputTexts(): string[] {
    // Try to parse content as JSON array of split parts
    if (this.data.content) {
      try {
        const parsed = JSON.parse(this.data.content)
        if (Array.isArray(parsed)) {
          // Assume each element has a 'content' field (or is a string)
          return parsed.map((item: any) => typeof item === 'string' ? item : item.content || '')
        }
      } catch (e) {
        // Not valid JSON, treat as regex pattern (legacy)
      }
    }

    // Fallback to splitting using pattern from node_type_settings
    let regexPattern = ''
    if (this.data.node_type_settings) {
      try {
        const settings = JSON.parse(this.data.node_type_settings)
        if (settings.separator !== undefined) {
          regexPattern = settings.separator
        }
      } catch (e) {
        // ignore
      }
    }
    // If no separator in settings, fallback to content as regex pattern (legacy)
    if (!regexPattern && this.data.content) {
      regexPattern = this.data.content
    }
    const inputText = this.getInputText()
    if (inputText === null) {
      return []
    }
    return this.splitTextByRegex(inputText, regexPattern)
  }

  private getInputText(): string | null {
    const incoming = this.context.getIncomingEdges(this.data.id)
    const textEdge = incoming.find(edge => edge.type === 'text')
    if (!textEdge) {
      return null
    }
    const sourceNode = this.context.getNode(textEdge.from_node_id)
    if (!sourceNode) {
      return null
    }
    return sourceNode.content ?? null
  }

  private splitTextByRegex(text: string, regexPattern: string): string[] {
    if (!regexPattern.trim()) {
      return [text]
    }
    try {
      const regex = new RegExp(regexPattern, 'g')
      return text.split(regex)
    } catch (error) {
      // If regex is invalid, treat as literal string split
      return text.split(regexPattern)
    }
  }
}

/**
 * Merge node.
 * Does not produce any outgoing edge (except 'text' edges? Actually merge node can output text edges).
 * For now, we treat merge node as a consumer only.
 */
export class MergeNode extends BaseNode {
  getOutput(edgeType: string): unknown {
    if (edgeType === 'text') {
      // Merge node can output its merged content as text.
      // This would require generating the merged content, which depends on inputs.
      // For simplicity, we return empty string; the generation logic is elsewhere.
      return ''
    }
    throw new Error(`MergeNode does not support edge type '${edgeType}'`)
  }
}

/**
 * Factory to create node instances.
 */
export function createNode(data: NodeData, context: NodeContext): BaseNode {
  switch (data.type) {
    case 'text':
      return new TextNode(data, context)
    case 'lore':
      return new LoreNode(data, context)
    case 'split':
      return new SplitterNode(data, context)
    case 'merge':
      return new MergeNode(data, context)
    default:
      throw new Error(`Unknown node type: ${data.type}`)
  }
}