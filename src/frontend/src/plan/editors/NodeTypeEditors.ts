import { FC } from "react";
import { PlanNodeType } from "@shared/plan-graph";
import TextNodeEditor from "./TextNodeEditor";
import TypedPlanNodeEditorProps from "./TypedPlanNodeEditorProps";
import SplitNodeEditor from "./SplitNodeEditor";
import MergeNodeEditor from "./MergeNodeEditor";

export const NodeTypeEditors : Partial<Record<PlanNodeType, FC<TypedPlanNodeEditorProps<any>>>> = {
  'merge': MergeNodeEditor,
  'text': TextNodeEditor,
  'split': SplitNodeEditor,
}
