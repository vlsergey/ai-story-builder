import type { FC } from "react"
import type { PlanNodeType } from "@shared/plan-graph"
import TextNodeEditor from "./TextNodeEditor"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"
import SplitNodeEditor from "./SplitNodeEditor"
import MergeNodeEditor from "./MergeNodeEditor"

export const NodeTypeEditors: Partial<Record<PlanNodeType, FC<TypedPlanNodeEditorProps<any>>>> = {
  merge: MergeNodeEditor,
  text: TextNodeEditor,
  split: SplitNodeEditor,
}
