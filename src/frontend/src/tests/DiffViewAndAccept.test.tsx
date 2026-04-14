import type React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import DiffViewAndAccept from "../nodes/DiffViewAndAccept"
import { LocaleProvider } from "../lib/locale"

function renderDiff(props: React.ComponentProps<typeof DiffViewAndAccept>) {
  return render(
    <LocaleProvider>
      <DiffViewAndAccept {...props} />
    </LocaleProvider>,
  )
}

describe("DiffViewAndAccept — split mode", () => {
  it("calls onBaseChange (not onChange) when Accept is clicked", () => {
    const onChange = vi.fn()
    const onBaseChange = vi.fn()
    renderDiff({
      oldText: "line1\nold line\nline3",
      newText: "line1\nnew line\nline3",
      viewType: "split",
      onChange,
      onBaseChange,
    })

    fireEvent.click(screen.getByRole("button", { name: "Accept" }))

    // Accept: base is updated (old → new for this hunk), content unchanged
    expect(onBaseChange).toHaveBeenCalledWith("line1\nnew line\nline3")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("calls onChange (not onBaseChange) when Reject is clicked", () => {
    const onChange = vi.fn()
    const onBaseChange = vi.fn()
    renderDiff({
      oldText: "line1\nold line\nline3",
      newText: "line1\nnew line\nline3",
      viewType: "split",
      onChange,
      onBaseChange,
    })

    fireEvent.click(screen.getByRole("button", { name: "Reject" }))

    // Reject: content is reverted to old for this hunk
    expect(onChange).toHaveBeenCalledWith("line1\nold line\nline3")
    expect(onBaseChange).not.toHaveBeenCalled()
  })

  it("calls onAllResolved after the last hunk is decided", () => {
    const onAllResolved = vi.fn()
    renderDiff({
      oldText: "line1\nold line\nline3",
      newText: "line1\nnew line\nline3",
      viewType: "split",
      onAllResolved,
    })

    fireEvent.click(screen.getByRole("button", { name: "Accept" }))

    expect(onAllResolved).toHaveBeenCalledOnce()
  })
})

describe("DiffViewAndAccept — unified mode", () => {
  it("calls onBaseChange when hunk Accept button is clicked", () => {
    const onBaseChange = vi.fn()
    renderDiff({
      oldText: "line1\nold line\nline3",
      newText: "line1\nnew line\nline3",
      viewType: "unified",
      onBaseChange,
    })

    // Click the per-hunk Accept button in the hunk header
    const acceptBtns = screen.getAllByRole("button", { name: "Accept" })
    // The toolbar Accept and the hunk header Accept — click any one
    fireEvent.click(acceptBtns[0])

    expect(onBaseChange).toHaveBeenCalledWith("line1\nnew line\nline3")
  })
})
