import type { PlanNodeType } from "@shared/plan-node-types"
import {
  BookOpenCheckIcon,
  FileCheck2Icon,
  FileTextIcon,
  type LucideProps,
  MergeIcon,
  RepeatIcon,
  SplitIcon,
  SquareArrowRightEnterIcon,
  SquareArrowRightExitIcon,
} from "lucide-react"
import type { ForwardRefExoticComponent, RefAttributes } from "react"
import { SquareArrowRightRepeatIcon } from "./SquareArrowRightRepeatIcon"

const NodeTypeIcons: Record<
  PlanNodeType,
  ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>
> = {
  "fix-problems": FileCheck2Icon,
  "for-each": RepeatIcon,
  "for-each-input": SquareArrowRightExitIcon,
  "for-each-output": SquareArrowRightEnterIcon,
  "for-each-prev-outputs": SquareArrowRightRepeatIcon,
  lore: BookOpenCheckIcon,
  merge: MergeIcon,
  split: SplitIcon,
  text: FileTextIcon,
}

export default NodeTypeIcons
