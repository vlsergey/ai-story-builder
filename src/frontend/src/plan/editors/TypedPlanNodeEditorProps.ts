import { PlanNodeRow } from "@shared/plan-graph"

export default interface TypedPlanNodeEditorProps {
  initialValue: PlanNodeRow,
  value: PlanNodeRow,
  onChange: (value: PlanNodeRow) => void,
  onExternalUpdate: (value: PlanNodeRow) => void,
  save: (value: PlanNodeRow) => Promise<void>,
  status: 'DEBOUNCE' | 'ERROR' | 'SAVING' | 'SAVED',
}
