import { EventManager } from '../../lib/event-manager.js';

/**
 * Event manager for plan node updates.
 * Uses generic EventManager with number payload (node ID).
 */
export const planNodeEventManager = new EventManager('plan.node');