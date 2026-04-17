import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PlanNodeRepository } from "./plan-node-repository.js"
import { setUpTestDb, tearDownTestDb } from "../../db/test-db-utils.js"
import type { ForEachNodeContent } from "../../../shared/for-each-plan-node.js"

describe("PlanNodeRepository", () => {
  beforeEach(() => {
    setUpTestDb()
  })

  afterEach(() => {
    tearDownTestDb()
  })

  describe("updateForEachPrevOutputsStatusInsideForEachContent", () => {
    it("should update status of for-each-prev-outputs nodes for iterations after currentIndex", () => {
      const repo = new PlanNodeRepository()

      // 1. Create a for-each node
      const forEachNodeId = repo.insert({
        title: "ForEach Node",
        type: "for-each",
        content: JSON.stringify({
          currentIndex: 0,
          length: 2,
          overrides: [
            {}, // iteration 0 placeholder (will be filled later)
            {}, // iteration 1 placeholder
          ],
        } as ForEachNodeContent),
        // parent_id defaults to null
        // other fields will use defaults
      })

      // 2. Create child nodes inside for-each:
      //    for-each-input (1), for-each-prev-outputs (2), text (3), for-each-output (4)
      const inputNodeId = repo.insert({
        parent_id: forEachNodeId,
        title: "Input",
        type: "for-each-input",
      })
      const prevOutputsNodeId = repo.insert({
        parent_id: forEachNodeId,
        title: "Prev Outputs",
        type: "for-each-prev-outputs",
      })
      const textNodeId = repo.insert({
        parent_id: forEachNodeId,
        title: "Text",
        type: "text",
      })
      const outputNodeId = repo.insert({
        parent_id: forEachNodeId,
        title: "Output",
        type: "for-each-output",
      })

      // 3. Prepare content of for-each node with overrides for two iterations.
      // Each iteration contains overrides for all child nodes with status GENERATED.
      const overrides: Record<string, any>[] = [
        {
          [inputNodeId]: { content: "input0", status: "GENERATED" },
          [prevOutputsNodeId]: { content: "prev0", status: "GENERATED" },
          [textNodeId]: { content: "text0", status: "GENERATED" },
          [outputNodeId]: { content: "output0", status: "GENERATED" },
        },
        {
          [inputNodeId]: { content: "input1", status: "GENERATED" },
          [prevOutputsNodeId]: { content: "prev1", status: "GENERATED" },
          [textNodeId]: { content: "text1", status: "GENERATED" },
          [outputNodeId]: { content: "output1", status: "GENERATED" },
        },
      ]

      const contentToSave = JSON.stringify({
        currentIndex: 0,
        length: 2,
        overrides,
      } as ForEachNodeContent)
      console.log("contentToSave", contentToSave)

      repo.patch(forEachNodeId, {
        content: contentToSave,
      })

      // 4. Verify initial state: all statuses are GENERATED
      const nodeBefore = repo.findById(forEachNodeId)
      expect(nodeBefore).toBeDefined()
      console.log("raw content before", nodeBefore!.content)
      const contentBefore = JSON.parse(nodeBefore!.content || "{}") as ForEachNodeContent
      // Parse nested strings if needed
      const overridesBefore = contentBefore.overrides?.map((ov) => {
        if (typeof ov === "string") {
          return JSON.parse(ov)
        }
        return ov
      })
      expect(overridesBefore?.[0]?.[prevOutputsNodeId]?.status).toBe("GENERATED")
      expect(overridesBefore?.[1]?.[prevOutputsNodeId]?.status).toBe("GENERATED")

      // 5. Call the method under test
      const changes = repo.updateForEachPrevOutputsStatusInsideForEachContent(forEachNodeId)
      expect(changes).toBe(1) // one row updated (the for-each node)

      // 6. Retrieve updated for-each node and verify changes
      const afterNode = repo.findById(forEachNodeId)
      expect(afterNode).toBeDefined()
      console.log("raw content after", afterNode!.content)
      const contentAfter = JSON.parse(afterNode!.content || "{}") as ForEachNodeContent
      console.log("contentAfter", JSON.stringify(contentAfter, null, 2))
      expect(contentAfter.overrides).toBeDefined()
      expect(contentAfter.overrides).toHaveLength(2)

      // Debug: print overrides
      console.log("overrides[0]", contentAfter.overrides![0])
      console.log("overrides[1]", contentAfter.overrides![1])
      console.log("prevOutputsNodeId", prevOutputsNodeId)

      // Parse nested strings if needed
      const overridesAfter = contentAfter.overrides?.map((ov) => {
        if (typeof ov === "string") {
          return JSON.parse(ov)
        }
        return ov
      })
      // Iteration 0 (index 0) should remain GENERATED (since currentIndex = 0, condition arr.key > currentIndex is false)
      expect(overridesAfter![0][prevOutputsNodeId]?.status).toBe("GENERATED")
      // Iteration 1 (index 1) should become OUTDATED
      expect(overridesAfter![1][prevOutputsNodeId]?.status).toBe("OUTDATED")

      // Other nodes (input, text, output) should keep their statuses unchanged
      expect(overridesAfter![0][inputNodeId]?.status).toBe("GENERATED")
      expect(overridesAfter![0][textNodeId]?.status).toBe("GENERATED")
      expect(overridesAfter![0][outputNodeId]?.status).toBe("GENERATED")
      expect(overridesAfter![1][inputNodeId]?.status).toBe("GENERATED")
      expect(overridesAfter![1][textNodeId]?.status).toBe("GENERATED")
      expect(overridesAfter![1][outputNodeId]?.status).toBe("GENERATED")
    })
  })
})
