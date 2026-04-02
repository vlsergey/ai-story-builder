import { PlanNodeRow } from "@shared/plan-graph"

export default interface TypedPlanNodeEditorProps<NodeTypeSettings = unknown> {
  dbValue: PlanNodeRow,
  initialValue: PlanNodeRow,
  nodeTypeSettings: NodeTypeSettings,
  onChange: (value: PlanNodeRow) => void,
  onExternalUpdate: (value: PlanNodeRow) => void,
  onNodeTypeSettingsChange: (value: NodeTypeSettings) => void,
  onRegenerate: () => void,
  onSave: (value: PlanNodeRow) => Promise<void>,
  status: 'DEBOUNCE' | 'ERROR' | 'SAVING' | 'SAVED',
  value: PlanNodeRow,
}
