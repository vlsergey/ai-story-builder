import { EventManager } from '../../lib/event-manager.js';

/**
 * Event manager for plan edge updates.
 * Uses generic EventManager with number payload (edge ID).
 */
export const planEdgeEventManager = new EventManager('plan.edge');