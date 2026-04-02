import { FC } from "react";
import { PlanNodeType } from "@shared/plan-graph";
import PlanNodeTextEditor from "./PlanTextNodeEditor";
import TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps";

export const NodeTypeEditors : Partial<Record<PlanNodeType, FC<TypedPlanNodeEditorProps>>> = {
  'text': PlanNodeTextEditor,
  // 'split': SplitNodeEditor,
  // 'merge': MergeNodeEditor,
}
