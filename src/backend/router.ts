import { initTRPC } from "@trpc/server"
import { SettingsRepository } from "./settings/settings-repository.js"
import { z } from "zod"

import { getAiBilling } from "./routes/ai-billing.js"
import { planNodeEventManager } from "./plan/nodes/plan-node-event-manager.js"
import { planEdgeEventManager } from "./plan/edges/plan-edge-event-manager.js"
import { loreEventManager } from "./lore/lore-event-manager.js"

// Project functions
import { refreshEngineModels, setCurrentEngine, testEngineConnection } from "./routes/ai-config.js"

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
} from "./routes/projects.js"

// Lore functions
import {
  findAll,
  getLoreNode,
  create,
  patchLoreNode,
  deleteLoreNode,
  importLoreNode,
  moveLoreNode,
  duplicateLoreNode,
  sortLoreChildren,
  reorderLoreChildren,
  restoreLoreNode,
} from "./lore/lore-routes.js"

import { createGraphEdge, patchGraphEdge, deleteGraphEdge } from "./plan/edges/plan-edge-routes.js"

import { syncLore } from "./routes/ai-sync.js"
import type { AiEngineConfig, AllAiEnginesConfig } from "../shared/ai-engine-config.js"
import type { PlanNodeUpdate } from "../shared/plan-graph.js"
import { PlanNodeService } from "./plan/nodes/plan-node-service.js"
import lastAiGenerationEventManager from "./ai/last-ai-generation-event-manager.js"
import { PlanEdgeRepository } from "./plan/edges/plan-edge-repository.js"
import { PlanNodeRepository } from "./plan/nodes/plan-node-repository.js"
import type { RegenerateOptions } from "../shared/RegenerateOptions.js"
import { aiRegenerateNodeContentOnly, aiRegenerateNodeContentWatchAndReview } from "./plan/nodes/plan-node-routes.js"
import {
  regenerateTreeNodesContents,
  subscribeToRegenerateTreeNodesContentsProgress,
  regenerateTreeNodesContentsStop,
} from "./plan/nodes/generate/regenerateTreeNodesContents.js"
import { THEME_PREFERENCE_VALUES } from "../shared/themes.js"

const t = initTRPC.create({
  // transformer: superjson,
  errorFormatter({ shape, error }) {
    // Это выведется в терминале Электрона при ЛЮБОЙ ошибке в процедурах
    console.error("❌ tRPC Error:", error.message, error.cause)
    return {
      ...shape,
      data: {
        ...shape.data,
        // Добавляем стек для дебага, чтобы видеть, откуда прилетает "путь к файлу"
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    }
  },
})

const dbGuardMiddleware = t.middleware(async ({ next, path }) => {
  const result = await next()

  // Проверяем, что вернула процедура (в ключе 'data')
  if (result.ok && result.data) {
    const data = result.data

    // Ищем признаки объекта SQLite (isOpen, path, name, или конструктор)
    const isDatabase =
      data &&
      (data.constructor?.name === "Database" ||
        (typeof data === "object" && "isOpen" in data && "name" in data) ||
        (typeof data === "object" && "isOpen" in data && "path" in data))

    if (isDatabase) {
      console.error(`🚨 КРИТИЧЕСКАЯ ОШИБКА: Процедура "${path}" вернула объект базы данных вместо данных!`)
      // Вместо базы возвращаем ошибку или пустой массив, чтобы фронтенд не падал
      throw new Error(`Security Leak: Procedure ${path} tried to return DB instance`)
    }
  }

  return result
})

export const appRouter = t.router({
  ai: t.router({
    lastGenerationEvent: t.router({
      get: t.procedure.query(() => lastAiGenerationEventManager.getLastAiGenerationEvent()),
      subscribe: t.procedure.subscription(() => lastAiGenerationEventManager.onGenerationEventAsSubscription()),
    }),
    billing: t.router({
      get: t.procedure.query(() => getAiBilling()),
    }),
    test: t.procedure
      .input((val: unknown) => val as { engineId: string; aiEngineConfig: AiEngineConfig })
      .mutation(({ input }) => testEngineConnection(input.engineId, input.aiEngineConfig)),
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
    get: t.procedure.input(z.number()).query(({ input }) => getLoreNode(input)),
    create: t.procedure
      .input(z.object({ parent_id: z.number().nullable().optional(), name: z.string() }))
      .mutation(({ input }) => create(input)),
    findAll: t.procedure.query(() => findAll()),
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
    subscribe: t.procedure.subscription(() => loreEventManager.asSubscription()),
  }),

  plan: t.router({
    nodes: t.router({
      acceptReview: t.procedure.input(z.int()).mutation(({ input }) => new PlanNodeService().acceptReview(input)),
      aiGenerateOnly: t.procedure
        .input((v) => v as { id: number; options: RegenerateOptions })
        .mutation(({ input }) => aiRegenerateNodeContentOnly(input.id, input.options)),
      aiGenerateWatchAndReview: t.procedure
        .input((v) => v as { id: number; options: RegenerateOptions })
        .subscription(({ input }) => aiRegenerateNodeContentWatchAndReview(input.id, input.options)),
      aiGenerateSummary: t.procedure
        .input(z.int())
        .mutation(({ input }) => new PlanNodeService().aiGenerateSummary(input)),
      aiImprove: t.procedure.input(z.int()).subscription(({ input }) => new PlanNodeService().aiImprove(input)),
      // TODO: optimize via patchPlanNode vectorization
      batchPatch: t.procedure
        .input((v) => v as { id: number; data: PlanNodeUpdate }[])
        .mutation(({ input }) =>
          input.forEach(({ id, data }) => {
            new PlanNodeService().patch(id, false, data)
          }),
        ),
      create: t.procedure.input(z.any()).mutation(({ input }) => new PlanNodeService().create(input)),
      delete: t.procedure.input(z.number()).mutation(({ input }) => new PlanNodeService().delete(input)),
      findAll: t.procedure.use(dbGuardMiddleware).query(() => new PlanNodeRepository().findAll()),
      getById: t.procedure.input(z.int()).query(({ input }) => new PlanNodeService().getById(input)),
      getByIds: t.procedure.input(z.array(z.int())).query(({ input }) => new PlanNodeService().getByIds(input)),
      patch: t.procedure
        .input((v) => v as { id: number; manual: boolean; data: PlanNodeUpdate })
        .mutation(({ input }) => new PlanNodeService().patch(input.id, input.manual, input.data)),
      regenerateTreeNodesContents: t.procedure
        .input((v) => v as RegenerateOptions)
        .mutation(({ input }) => regenerateTreeNodesContents(input)),
      regenerateTreeNodesContentsProgress: t.procedure.subscription(() =>
        subscribeToRegenerateTreeNodesContentsProgress(),
      ),
      regenerateTreeNodesContentsStop: t.procedure.mutation(() => regenerateTreeNodesContentsStop()),
      startReview: t.procedure
        .input(z.object({ id: z.number(), options: z.any().optional() }))
        .mutation(({ input }) => new PlanNodeService().startReview(input.id, input.options)),
      subscribe: t.procedure.subscription(() => planNodeEventManager.asSubscription()),
      forEachNodes: t.router({
        changePage: t.procedure
          .input(z.object({ nodeId: z.int(), page: z.int32() }))
          .mutation(({ input: { nodeId, page } }) => new PlanNodeService().changeForEachNodePage(nodeId, page)),
      }),
    }),
    edges: t.router({
      findAll: t.procedure.query(() => new PlanEdgeRepository().findAll()),
      findByTarget: t.procedure.input(z.int()).query(({ input }) => new PlanEdgeRepository().findByToNodeId(input)),
      create: t.procedure.input(z.any()).mutation(({ input }) => createGraphEdge(input)),
      patch: t.procedure
        .input(z.object({ id: z.number(), data: z.any() }))
        .mutation(({ input }) => patchGraphEdge(input.id, input.data)),
      delete: t.procedure.input(z.number()).mutation(({ input }) => deleteGraphEdge(input)),
      subscribe: t.procedure.subscription(() => planEdgeEventManager.asSubscription()),
    }),
  }),

  settings: t.router({
    get: t.procedure.input(z.string()).query(({ input }) => SettingsRepository.get(input)),
    set: t.procedure
      .input(z.tuple([z.string(), z.any()]))
      .mutation(({ input }) => SettingsRepository.set(input[0], input[1])),

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

    uiTheme: t.router({
      get: t.procedure.query(() => SettingsRepository.getUiTheme()),
      set: t.procedure
        .input(z.enum(THEME_PREFERENCE_VALUES))
        .mutation(({ input }) => SettingsRepository.setUiTheme(input)),
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
        set: t.procedure.input(z.string().nullable()).mutation(({ input }) => setCurrentEngine(input)),
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
      refreshEngineModels: t.procedure.input(z.string()).mutation(({ input }) => refreshEngineModels(input)),
    }),
  }),
})

export type AppRouter = typeof appRouter
