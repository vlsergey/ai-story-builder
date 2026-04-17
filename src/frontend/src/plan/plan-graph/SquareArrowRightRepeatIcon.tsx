import { createLucideIcon } from "lucide-react"

export const SquareArrowRightRepeatIcon = createLucideIcon("square-arrow-right-repeat", [
  // Rounded square
  [
    "path",
    { d: "M21 6.344V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.344", key: "rounded-square" },
  ],

  // Right exit arrow
  ["path", { d: "M17 12h4", key: "right-exit-arrow-line" }],
  ["path", { d: "m19 15 3-3-3-3", key: "right-exit-arrow" }],

  // Repeat icon
  ["path", { d: "m11.5 5.5 2.5 2.5 -2.5 2.5", key: "repeat-icon-1" }],
  ["path", { d: "M6 11 a4 4 0 0 1 4 -3 h4", key: "repeat-icon-2" }],
  ["path", { d: "m8.5 18.5 -2.5 -2.5 2.5 -2.5", key: "repeat-icon-3" }],
  ["path", { d: "M14 13 a4 4 0 0 1 -4 3 H6", key: "repeat-icon-4" }],
])
