import { PlanNodeRow } from "@shared/plan-graph"

export default interface TypedPlanNodeEditorProps<NodeTypeSettings = unknown> {
  initialValue: PlanNodeRow,
  nodeTypeSettings: NodeTypeSettings,
  onChange: (value: PlanNodeRow) => void,
  onExternalUpdate: (value: PlanNodeRow) => void,
  onNodeTypeSettingsChange: (value: NodeTypeSettings) => void,
  save: (value: PlanNodeRow) => Promise<void>,
  status: 'DEBOUNCE' | 'ERROR' | 'SAVING' | 'SAVED',
  value: PlanNodeRow,
}
