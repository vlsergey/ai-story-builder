import type { PlanNodeType } from "@shared/plan-node-types"
import type { FC } from "react"
import FixProblemsNodeEditor from "./FixProblemsNodeEditor"
import MergeNodeEditor from "./MergeNodeEditor"
import SplitNodeEditor from "./SplitNodeEditor"
import TextNodeEditor from "./TextNodeEditor"
import type TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps"

export const NodeTypeEditors: Partial<Record<PlanNodeType, FC<TypedPlanNodeEditorProps<any>>>> = {
  "fix-problems": FixProblemsNodeEditor,
  merge: MergeNodeEditor,
  text: TextNodeEditor,
  split: SplitNodeEditor,
}
