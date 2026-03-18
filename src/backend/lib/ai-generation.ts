import { generatePlan } from '../routes/generate-plan.js';
import { generateLore } from '../routes/generate-lore.js';
import type { NodeData } from './node-graph/node-interfaces.js';
import type { AiSettings } from '../../shared/ai-settings.js';

/**
 * Generate content for a node using AI.
 * Returns the generated content string, or null if generation is not possible.
 */
export async function generateNodeContent(
  node: NodeData,
  aiSettings?: AiSettings
): Promise<string | null> {
  console.log(`[generateNodeContent] node ${node.id} type ${node.type} prompt: ${node.user_prompt || node.title}`);
  const prompt = node.user_prompt || node.title;
  if (!prompt?.trim()) {
    // No prompt, cannot generate
    console.log(`[generateNodeContent] no prompt, returning null`);
    return null;
  }

  const params = {
    prompt: prompt.trim(),
    mode: 'generate' as const,
    baseContent: node.content || undefined,
    settings: aiSettings || {},
    nodeId: node.id,
  };

  let generatedContent = '';
  let lastContent = '';

  const onPartialJson = (data: Record<string, unknown>) => {
    if (typeof data.content === 'string') {
      generatedContent = data.content;
      lastContent = data.content;
    }
  };

  const onThinking = () => {
    // ignore
  };

  try {
    if (node.type === 'text') {
      console.log(`[generateNodeContent] calling generatePlan for node ${node.id}`);
      await generatePlan(params, onThinking, onPartialJson);
    } else if (node.type === 'lore') {
      console.log(`[generateNodeContent] calling generateLore for node ${node.id}`);
      await generateLore(params, onThinking, onPartialJson);
    } else {
      // Not an AI-generatable node type
      console.log(`[generateNodeContent] unsupported node type ${node.type}`);
      return null;
    }
  } catch (error) {
    console.error(`AI generation failed for node ${node.id}:`, error);
    throw error;
  }

  // If no content was generated, fallback to empty string?
  const result = generatedContent || lastContent || null;
  console.log(`[generateNodeContent] result length: ${result?.length ?? 'null'}`);
  return result;
}