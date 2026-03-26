import { EventManager } from '../lib/event-manager.js';

/**
 * Event manager for lore node updates.
 * Uses generic EventManager with number payload (node ID).
 */
export const loreEventManager = new EventManager('lore');