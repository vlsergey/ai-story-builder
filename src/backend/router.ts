import { initTRPC } from '@trpc/server';
import { SettingsRepository } from './settings/settings-repository.js';
import superjson from 'superjson';
import { z } from 'zod';

import { getAiBilling } from './routes/ai-billing.js';
import { planNodeEventManager } from './plan/nodes/plan-node-event-manager.js';
import { planEdgeEventManager } from './plan/edges/plan-edge-event-manager.js';
import { loreEventManager } from './lore/lore-event-manager.js';

// Project functions
import {
  refreshEngineModels,
  setCurrentEngine,
  testEngineConnection,
} from './routes/ai-config.js';

// Project functions
import {
  getProjectStatus,
  closeProject,
  openProject,
  getRecentProjects,
  deleteRecentProject,
  listProjectFiles,
  openProjectFolder,
  createProject,
} from './routes/projects.js';

// Lore functions
import {
  getLoreTree,
  getLoreNode,
  createLoreNode,
  patchLoreNode,
  deleteLoreNode,
  importLoreNode,
  moveLoreNode,
  duplicateLoreNode,
  sortLoreChildren,
  reorderLoreChildren,
  restoreLoreNode,
} from './lore/lore-routes.js';

import {
  getPlanNodes,
  getPlanNode,
  createPlanNode,
} from './plan/nodes/plan-node-routes.js';

import {
  getPlanEdges,
  createGraphEdge,
  patchGraphEdge,
  deleteGraphEdge,
} from './plan/edges/plan-edge-routes.js';

import { syncLore } from './routes/ai-sync.js'
import { updateSummary } from './routes/generate-summary.js'
import { AiEngineConfig, AllAiEnginesConfig } from '../shared/ai-engine-config.js';
import { PlanNodeUpdate } from '../shared/plan-graph.js';
import { PlanNodeService } from './plan/nodes/plan-node-service.js';
import lastAiGenerationEventManager from './ai/last-ai-generation-event-manager.js';

const t = initTRPC.create({
  transformer: superjson
});

export const appRouter = t.router({
  ai: t.router({
    lastGenerationEvent: t.router({
      get: t.procedure.query(() => lastAiGenerationEventManager.getLastAiGenerationEvent()),
      subscribe: t.procedure.subscription(lastAiGenerationEventManager.onGenerationEventAsSubscription()),
    }),
    billing: t.router({
      get: t.procedure.query(() => getAiBilling()),
    }),
    test: t.procedure
      .input((val: unknown) => val as { engineId: string, aiEngineConfig: AiEngineConfig })
      .mutation(({input}) => testEngineConnection(input.engineId, input.aiEngineConfig)),
    generateSummary: t.procedure
      .input(z.int())
      .mutation(({ input }) => updateSummary(input)),
    syncLore: t.procedure.mutation(() => syncLore()),
  }),

  project: t.router({
    status: t.procedure.query(() => getProjectStatus()),
    close: t.procedure.mutation(() => closeProject()),
    open: t.procedure.input(z.string()).mutation(({ input }) => openProject(input)),
    recent: t.procedure.query(() => getRecentProjects()),
    recentDelete: t.procedure.input(z.string()).mutation(({ input }) => deleteRecentProject(input)),
    files: t.procedure.query(() => listProjectFiles()),
    openFolder: t.procedure.mutation(() => openProjectFolder()),
    create: t.procedure
      .input(z.object({ name: z.string().optional(), text_language: z.string().optional() }))
      .mutation(({ input }) => createProject(input)),
  }),

  lore: t.router({
    tree: t.procedure.query(() => getLoreTree()),
    get: t.procedure.input(z.number()).query(({ input }) => getLoreNode(input)),
    create: t.procedure
      .input(z.object({ parent_id: z.number().nullable().optional(), name: z.string() }))
      .mutation(({ input }) => createLoreNode(input)),
    patch: t.procedure
      .input(z.object({ id: z.number(), data: z.any() }))
      .mutation(({ input }) => patchLoreNode(input.id, input.data)),
    delete: t.procedure.input(z.number()).mutation(({ input }) => deleteLoreNode(input)),
    import: t.procedure
      .input(z.object({ title: z.string(), content: z.string(), parentId: z.number() }))
      .mutation(({ input }) => importLoreNode(input)),
    move: t.procedure
      .input(z.object({ id: z.number(), parent_id: z.number().nullable().optional() }))
      .mutation(({ input }) => moveLoreNode(input.id, { parent_id: input.parent_id })),
    duplicate: t.procedure.input(z.number()).mutation(({ input }) => duplicateLoreNode(input)),
    sortChildren: t.procedure.input(z.number()).mutation(({ input }) => sortLoreChildren(input)),
    reorderChildren: t.procedure.input(z.array(z.number())).mutation(({ input }) => reorderLoreChildren(input)),
    restore: t.procedure.input(z.number()).mutation(({ input }) => restoreLoreNode(input)),
    subscribe: t.procedure.subscription(loreEventManager.asSubscription()),
  }),

  plan: t.router({
    nodes: t.router({
      acceptReview: t.procedure
        .input(z.int())
        .mutation(({ input }) => new PlanNodeService().acceptReview(input)),
      aiGenerate: t.procedure
        .input(z.int())
        .subscription(({ input }) => new PlanNodeService().aiGenerate(input)),
      aiImprove: t.procedure
        .input(z.int())
        .subscription(({ input }) => new PlanNodeService().aiImprove(input)),
      // TODO: optimize via patchPlanNode vectorization
      batchPatch: t.procedure
        .input((v) => v as ({id: number, data: PlanNodeUpdate}[]))
        .mutation(({ input }) => input.forEach( ({ id, data }) => new PlanNodeService().patch(id, false, data))),
      create: t.procedure.input(z.any()).mutation(({ input }) => createPlanNode(input)),
      delete: t.procedure.input(z.number()).mutation(({ input }) => new PlanNodeService().delete(input)),
      getAll: t.procedure.query(() => getPlanNodes()),
      get: t.procedure.input(z.number()).query(({ input }) => getPlanNode(input)),
      patch: t.procedure
        .input((v) => v as ({id: number, manual: boolean, data: PlanNodeUpdate}))
        .mutation(({ input }) => new PlanNodeService().patch(input.id, input.manual, input.data)),
      regenerate: t.procedure
        .input(z.int())
        .mutation(({ input }) => new PlanNodeService().regenerate(input)),
      startReview: t.procedure.input(z.object({ id: z.number(), options: z.any().optional() }))
        .mutation(({ input }) => new PlanNodeService().startReview(input.id, input.options)),
      subscribe: t.procedure.subscription(planNodeEventManager.asSubscription()),
    }),
    edges: t.router({
      getAll: t.procedure.query(() => getPlanEdges()),
      create: t.procedure.input(z.any()).mutation(({ input }) => createGraphEdge(input)),
      patch: t.procedure.input(z.object({ id: z.number(), data: z.any() }))
        .mutation(({ input }) => patchGraphEdge(input.id, input.data)),
      delete: t.procedure.input(z.number()).mutation(({ input }) => deleteGraphEdge(input)),
      subscribe: t.procedure.subscription(planEdgeEventManager.asSubscription()),
    }),
  }),

  settings: t.router({
    get: t.procedure.input(z.string()).query(({ input }) => SettingsRepository.get(input)),
    set: t.procedure.input(z.tuple([z.string(), z.any()])).mutation(({ input }) => SettingsRepository.set(input[0], input[1])),

    autoGenerateSummary: t.router({
      get: t.procedure.query(() => SettingsRepository.getAutoGenerateSummary()),
      set: t.procedure.input(z.boolean()).mutation(({ input }) => SettingsRepository.setAutoGenerateSummary(input)),
    }),

    layout: t.router({
      get: t.procedure.query(() => SettingsRepository.getLayout()),
      set: t.procedure.input(z.unknown()).mutation(({ input }) => SettingsRepository.saveLayout(input)),
    }),

    textLanguage: t.router({
      get: t.procedure.query(() => SettingsRepository.getTextLanguage()),
      set: t.procedure.input(z.string()).mutation(({ input }) => SettingsRepository.setTextLanguage(input)),
    }),

    verboseAiLogging: t.router({
      get: t.procedure.query(() => SettingsRepository.getVerboseAiLogging()),
      set: t.procedure.input(z.boolean()).mutation(({ input }) => SettingsRepository.setVerboseAiLogging(input)),
    }),

    allAiEnginesConfig: t.router({
      get: t.procedure.query(() => SettingsRepository.getAllAiEnginesConfig()),
      set: t.procedure
        .input((v) => v as AllAiEnginesConfig)
        .mutation(({ input }) => SettingsRepository.saveAllAiEnginesConfig(input)),
      currentEngine: t.router({
        get: t.procedure.query(() => SettingsRepository.getCurrentBackend()),
        set: t.procedure
          .input(z.string().nullable())
          .mutation(({input}) => setCurrentEngine( input )),
        availableModels: t.router({
          get: t.procedure.query(() => SettingsRepository.getCurrentEngineAvailableModels()),
        }),
        defaultAiGenerationSettings: t.router({
          get: t.procedure.query(() => SettingsRepository.getCurrentEngineDefaultAiGenerationSettings()),
        }),
        summaryAiGenerationSettings: t.router({
          get: t.procedure.query(() => SettingsRepository.getCurrentEngineSummaryAiGenerationSettings()),
        }),
      }),
      refreshEngineModels: t.procedure
        .input(z.string())
        .mutation(({input}) => refreshEngineModels(input))
    }),
  }),
});

export type AppRouter = typeof appRouter;

