import z from "zod"
import type { RouteBuilder } from "../../../router.js"
import {
  regenerateTreeNodesContents,
  stop,
  subscribeToResponseStreamEvents,
  subscribeToStatusEvents,
} from "./regenerateTreeNodesContents.js"

export function buildRoutes(t: RouteBuilder) {
  return t.router({
    startForAll: t.procedure.mutation(() => regenerateTreeNodesContents(undefined)),
    startForNode: t.procedure.input(z.int()).mutation(({ input }) => regenerateTreeNodesContents(input)),
    stop: t.procedure.mutation(() => stop()),
    subscribeToResponseStreamEvents: t.procedure.subscription(() => subscribeToResponseStreamEvents()),
    subscribeToStatusEvents: t.procedure.subscription(() => subscribeToStatusEvents()),
  })
}
