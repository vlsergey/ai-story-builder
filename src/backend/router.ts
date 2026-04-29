import type { AiEngineKey } from "@shared/ai-engines.js"
import { initTRPC } from "@trpc/server"
import { z } from "zod"
import type { AiEngineConfig } from "../shared/ai-engine-config.js"
import { PLAN_EDGE_TYPE_VALUES } from "../shared/plan-edge-types.js"
import type { PlanNodeUpdate } from "../shared/plan-graph.js"
import lastAiGenerationEventManager from "./ai/last-ai-generation-event-manager.js"
import { loreEventManager } from "./lore/lore-event-manager.js"
import {
  create,
  deleteLoreNode,
  duplicateLoreNode,
  findAll,
  getLoreNode,
  importLoreNode,
  moveLoreNode,
  patchLoreNode,
  reorderLoreChildren,
  restoreLoreNode,
  sortLoreChildren,
} from "./lore/lore-routes.js"
import { nativeRoutes } from "./native-routes.js"
import { planEdgeEventManager } from "./plan/edges/plan-edge-event-manager.js"
import { PlanEdgeRepository } from "./plan/edges/plan-edge-repository.js"
import { createGraphEdge, deleteGraphEdge, patchGraphEdge } from "./plan/edges/plan-edge-routes.js"
import { buildRoutes as buildPlanRegenerateRoutes } from "./plan/nodes/generate/regenerate-routes.js"
import { planNodeEventManager } from "./plan/nodes/plan-node-event-manager.js"
import { PlanNodeRepository } from "./plan/nodes/plan-node-repository.js"
import { aiGenerateAndReview } from "./plan/nodes/plan-node-routes.js"
import { PlanNodeService } from "./plan/nodes/plan-node-service.js"
import { buildProjectRoutes } from "./projects/projects-routes.js"
import { getAiBilling } from "./routes/ai-billing.js"
import { testEngineConnection } from "./routes/ai-config.js"
import { syncLore } from "./routes/ai-sync.js"
import { settingsRoutes } from "./settings/settings-routes.js"

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

export type RouteBuilder = typeof t

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
      .input((val: unknown) => val as { engineId: AiEngineKey; aiEngineConfig: AiEngineConfig })
      .mutation(({ input }) => testEngineConnection(input.engineId, input.aiEngineConfig)),
    syncLore: t.procedure.mutation(() => syncLore()),
  }),

  project: buildProjectRoutes(t),

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
      aiGenerate: buildPlanRegenerateRoutes(t),
      aiGenerateAndReview: t.procedure.input(z.int()).mutation(({ input }) => aiGenerateAndReview(input)),
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
      findAll: t.procedure.query(() => new PlanNodeRepository().findAll()),
      getById: t.procedure.input(z.int()).query(({ input }) => new PlanNodeService().getById(input)),
      getByIds: t.procedure.input(z.array(z.int())).query(({ input }) => new PlanNodeService().getByIds(input)),
      patch: t.procedure
        .input((v) => v as { id: number; manual: boolean; data: PlanNodeUpdate })
        .mutation(({ input }) => new PlanNodeService().patch(input.id, input.manual, input.data)),
      saveContentToFile: t.procedure
        .input(z.object({ nodeId: z.int(), filePath: z.string() }))
        .mutation(({ input }) => new PlanNodeService().saveContentToFile(input.nodeId, input.filePath)),
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
      create: t.procedure.input(z.any()).mutation(({ input }) => createGraphEdge(input)),
      findAll: t.procedure.query(() => new PlanEdgeRepository().findAll()),
      findByToNodeId: t.procedure.input(z.int()).query(({ input }) => new PlanEdgeRepository().findByToNodeId(input)),
      findByToNodeIdAndType: t.procedure
        .input(z.object({ id: z.int(), type: z.enum(PLAN_EDGE_TYPE_VALUES) }))
        .query(({ input }) => new PlanEdgeRepository().findByToNodeIdAndType(input.id, input.type)),
      patch: t.procedure
        .input(z.object({ id: z.number(), data: z.any() }))
        .mutation(({ input }) => patchGraphEdge(input.id, input.data)),
      delete: t.procedure.input(z.number()).mutation(({ input }) => deleteGraphEdge(input)),
      subscribe: t.procedure.subscription(() => planEdgeEventManager.asSubscription()),
    }),
  }),

  native: nativeRoutes(t),

  settings: settingsRoutes(t),
})

export type AppRouter = typeof appRouter
