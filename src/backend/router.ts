import type { AiEngineKey } from "@shared/ai-engines.js"
import { initTRPC } from "@trpc/server"
import { z } from "zod"
import type { AiEngineConfig } from "../shared/ai-engine-config.js"
import { PLAN_EDGE_TYPE_VALUES } from "../shared/plan-edge-types.js"
import type { PlanNodeDefinitionUpdate, PlanNodeInIteration, PlanNodeUpdate } from "../shared/plan-graph.js"
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
import { type GenerateAdviceInput, generateAdvice } from "./routes/generate-advice.js"
import { settingsRoutes } from "./settings/settings-routes.js"

/** A node in one iteration of its loops. */
const nodeAtPath = z.object({ id: z.int(), path: z.string() })

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
    // Wizard-time advice call: no project sqlite is open yet, so engine,
    // config, prompt template and current wizard field values all come over
    // the wire from the frontend in one shot.
    generateAdvice: t.procedure
      .input((val: unknown) => val as GenerateAdviceInput)
      .subscription(({ input }) => generateAdvice(input)),
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
    // A node's definition is the same in every iteration of its loops; what it
    // produced is per iteration, so every call about state names the `path`.
    nodes: t.router({
      acceptReview: t.procedure
        .input(nodeAtPath)
        .mutation(({ input }) => new PlanNodeService().acceptReview(input.id, input.path)),
      aiGenerate: buildPlanRegenerateRoutes(t),
      aiGenerateAndReview: t.procedure
        .input(nodeAtPath)
        .mutation(({ input }) => aiGenerateAndReview(input.id, input.path)),
      aiGenerateSummary: t.procedure
        .input(nodeAtPath)
        .mutation(({ input }) => new PlanNodeService().aiGenerateSummary(input.id, input.path)),
      aiImprove: t.procedure
        .input(nodeAtPath)
        .subscription(({ input }) => new PlanNodeService().aiImprove(input.id, input.path)),
      batchPatch: t.procedure
        .input((v) => v as { id: number; data: PlanNodeDefinitionUpdate }[])
        .mutation(({ input }) => new PlanNodeService().batchPatch(input)),
      create: t.procedure.input(z.any()).mutation(({ input }) => new PlanNodeService().create(input)),
      delete: t.procedure.input(z.number()).mutation(({ input }) => new PlanNodeService().delete(input)),
      findAll: t.procedure.query(() => new PlanNodeRepository().findAll()),
      findInputs: t.procedure
        .input(nodeAtPath)
        .query(({ input }) => new PlanNodeService().findInputRows(input.id, input.path)),
      findStatesAtPath: t.procedure
        .input(z.string())
        .query(({ input }) => new PlanNodeService().findStatesAtPath(input)),
      getById: t.procedure.input(nodeAtPath).query(({ input }): PlanNodeInIteration => {
        const service = new PlanNodeService()
        const current = service.isCurrentPath(input.id, input.path)
        const movedTo = current ? null : service.currentPathFor(input.id, input.path)
        return { ...service.getRow(input.id, input.path), current, movedTo }
      }),
      patch: t.procedure
        .input(
          z.object({
            id: z.int(),
            path: z.string(),
            manual: z.boolean(),
            data: z.record(z.string(), z.unknown()).transform((data) => data as PlanNodeUpdate),
            rev: z.string().optional(),
          }),
        )
        .mutation(({ input }) =>
          new PlanNodeService().patch(input.id, input.path, input.manual, input.data, input.rev),
        ),
      saveContentToFile: t.procedure
        .input(z.object({ nodeId: z.int(), path: z.string(), filePath: z.string() }))
        .mutation(({ input }) => new PlanNodeService().saveContentToFile(input.nodeId, input.path, input.filePath)),
      startReview: t.procedure
        .input(z.object({ id: z.number(), path: z.string(), options: z.any().optional() }))
        .mutation(({ input }) => new PlanNodeService().startReview(input.id, input.path, input.options)),
      subscribe: t.procedure.subscription(() => planNodeEventManager.asSubscription()),
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
