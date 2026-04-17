import type { FromSchema } from "json-schema-to-ts"

export const FOUND_PROBLEMS_JSON_SCHEMA = {
  type: "object",
  properties: {
    foundProblems: {
      type: "array",
      description: "Problems found in text",
      items: {
        type: "object",
        properties: {
          severity: {
            type: "number",
            description: "Severity of problem from 0 (low, non-critical) to 100 (critical, fatal)",
            minimum: 0,
            maximum: 100,
          },
          description: {
            type: "string",
            description: "Problem description",
          },
          fixProposal: {
            type: "string",
            description: "Proposal to fix, probably with example text snippet",
          },
        },
        required: ["severity", "description", "fixProposal"],
        additionalProperties: false,
      },
    },
  },
  required: ["foundProblems"],
  additionalProperties: false,
} as const

export type FindProblemsResult = FromSchema<typeof FOUND_PROBLEMS_JSON_SCHEMA>

export interface FixIteration {
  input: string
  findProblemsResult?: FindProblemsResult
  fixProblemsResult?: string
}

export interface FixProblemsPlanNodeContent {
  iterations: FixIteration[]
}

export interface FixProblemsPlanNodeSettings {
  aiSystemInstructionsToFindProblems?: string
  aiSystemInstructionsToFixProblems?: string
  aiUserInstructionsToFindProblems?: string
  aiUserInstructionsToFixProblems?: string
  foundProblemsTemplate?: string
  maxIterations?: number
  minSeverityToFix?: number
  sourceNodeIdToFix?: number
}
