import { FC } from "react";
import { PlanNodeRow, PlanNodeType } from "@shared/plan-graph";
import PlanNodeTextEditor from "./PlanTextNodeEditor";

export const NodeTypeEditors : Partial<Record<PlanNodeType, FC<{nodeId: number, initialValue: PlanNodeRow}>>> = {
  'text': PlanNodeTextEditor,
  // 'split': SplitNodeEditor,
  // 'merge': MergeNodeEditor,
}
