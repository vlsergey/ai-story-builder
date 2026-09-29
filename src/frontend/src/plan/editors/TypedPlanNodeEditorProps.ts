import type { PlanNodeRow } from "@shared/plan-graph"

export default interface TypedPlanNodeEditorProps<NodeTypeSettings = unknown> {
  dbValue: PlanNodeRow
  disabled: boolean
  /** The loop does not have this iteration: its prompt and settings still save, what it produced here does not. */
  iterationMissing?: boolean
  initialValue: PlanNodeRow
  nodeTypeSettings: NodeTypeSettings
  onChange: (value: PlanNodeRow) => void
  onExternalUpdate: (value: PlanNodeRow) => void
  onNodeTypeSettingsChange: (value: NodeTypeSettings) => void
  onRegenerate: () => void
  onSave: (value: PlanNodeRow) => Promise<void>
  status: "DEBOUNCE" | "ERROR" | "SAVING" | "SAVED"
  value: PlanNodeRow
}
