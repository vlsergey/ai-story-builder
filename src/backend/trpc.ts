import { ipcMain } from 'electron';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import {
  SaveAiConfigRequest,
  SetCurrentEngineRequest,
  GeneratePlanParams,
  CreateProjectRequest,
} from '../shared/api-types';

// Import existing route handlers (TS files)
import {
  getAiConfig,
  saveAiConfig,
  setCurrentEngine,
  getEngineModels,
} from './routes/ai-config';
import { generatePlan } from './routes/generate-plan';
import {
  getProjectStatus,
  openProject,
  closeProject,
  createProject,
} from './routes/projects';

// Initialize tRPC (no context needed for now)
const t = initTRPC.create();

// Define the router
export const appRouter = t.router({
  aiConfig: t.router({
    get: t.procedure.query(() => getAiConfig()),
    save: t.procedure
      .input(
        z.object({
          engine: z.string(),
          fields: z.record(z.string(), z.unknown()),
        }) as unknown as z.ZodType<SaveAiConfigRequest>,
      )
      .mutation(({ input }: { input: SaveAiConfigRequest }) => saveAiConfig(input)),
    setCurrentEngine: t.procedure
      .input(
        z.object({
          engine: z.string().nullable(),
        }) as unknown as z.ZodType<SetCurrentEngineRequest>,
      )
      .mutation(({ input }: { input: SetCurrentEngineRequest }) => setCurrentEngine(input)),
    getEngineModels: t.procedure
      .input(z.string())
      .query(({ input }: { input: string }) => getEngineModels(input)),
  }),
  plan: t.router({
    generate: t.procedure
      .input(
        z.object({
          prompt: z.string().optional(),
          mode: z.string().optional(),
          baseContent: z.string().optional(),
          aiGenerationSettings: z.record(z.string(), z.unknown()).optional(),
          includeExistingLore: z.boolean().optional(),
          nodeId: z.number().optional(),
        }) as unknown as z.ZodType<GeneratePlanParams>,
      )
      .mutation(async ({ input }: { input: GeneratePlanParams }) => {
        const noop = () => {};
        return await generatePlan(input as any, noop, noop);
      }),
  }),
  project: t.router({
    status: t.procedure.query(() => getProjectStatus()),
    open: t.procedure
      .input(z.string())
      .mutation(({ input }: { input: string }) => openProject(input)),
    close: t.procedure.mutation(() => closeProject()),
    create: t.procedure
      .input(
        z.object({
          name: z.string().optional(),
          text_language: z.string().optional(),
        }) as unknown as z.ZodType<CreateProjectRequest>,
      )
      .mutation(({ input }: { input: CreateProjectRequest }) => createProject(input)),
  }),
});

export type AppRouter = typeof appRouter;

/**
 * Registers a generic tRPC IPC handler.
 * Frontend can call: window.electron.trpc.invoke('aiConfig.get') etc.
 */
export const registerIpcHandlers = () => {
  ipcMain.handle('trpc', async (_event, { path, input }) => {
    // Use the tRPC router to handle calls, preserving type safety.
    const caller = appRouter.createCaller({});
    const [routerName, procedureName] = path.split('.');
    // @ts-ignore – dynamic access based on string path
    const proc = (caller as any)[routerName][procedureName];
    if (!proc) {
      throw new Error('Unknown tRPC path: ' + path);
    }
    // Procedures without input will receive undefined.
    return await proc(input);
  });
};