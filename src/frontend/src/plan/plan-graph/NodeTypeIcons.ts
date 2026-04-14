import { PlanNodeType } from "@shared/plan-graph";
import { BookOpenCheckIcon, FileTextIcon, LucideProps, MergeIcon, RepeatIcon, SplitIcon, SquareArrowRightEnterIcon, SquareArrowRightExitIcon } from "lucide-react";
import { ForwardRefExoticComponent, RefAttributes } from "react";
import { SquareArrowRightRepeatIcon } from "./SquareArrowRightRepeatIcon";

const NodeTypeIcons : Record<PlanNodeType, ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>> = {
  'for-each': RepeatIcon,
  'for-each-input': SquareArrowRightExitIcon,
  'for-each-output': SquareArrowRightEnterIcon,
  'for-each-prev-outputs': SquareArrowRightRepeatIcon,
  'lore': BookOpenCheckIcon,
  'merge': MergeIcon,
  'split': SplitIcon,
  'text': FileTextIcon,
}

export default NodeTypeIcons