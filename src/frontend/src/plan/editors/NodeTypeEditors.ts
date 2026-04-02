import { FC } from "react";
import { PlanNodeType } from "@shared/plan-graph";
import TextNodeEditor from "./TextNodeEditor";
import TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps";
import SplitNodeEditor from "./SplitNodeEditor";

export const NodeTypeEditors : Partial<Record<PlanNodeType, FC<TypedPlanNodeEditorProps<any>>>> = {
  'text': TextNodeEditor,
  'split': SplitNodeEditor,
  // 'merge': MergeNodeEditor,
}
