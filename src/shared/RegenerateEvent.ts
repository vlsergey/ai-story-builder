import { PlanNodeRow } from './plan-graph.js'

export interface RegenerateEvent {
  inProcess: boolean
  stopping: boolean

  currentNodeStack: PlanNodeRow[]
  firstError?: unknown

  generatedNew: number
  generatedSame: number
  generatedEmpty: number
  skipped: number
}
