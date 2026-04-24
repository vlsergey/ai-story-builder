import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { PlanNodeType } from "@shared/plan-node-types"
import { useTranslation } from "react-i18next"
import { Button } from "@/ui-components/button"
import { Input } from "@/ui-components/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/ui-components/dialog"

interface AddNodeDialogProps {
  nodeType?: PlanNodeType
  open: boolean
  onClose: () => void
  onConfirm: (title: string) => void
}

export default function AddNodeDialog({ nodeType, open, onClose, onConfirm }: AddNodeDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState("")
  const addTitleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      // focus the input on next paint
      setTimeout(() => addTitleInputRef.current?.focus(), 0)
    } else {
      // reset title when dialog closes
      setTitle("")
    }
  }, [open])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose()
      }
    },
    [onClose],
  )

  const handleConfirm = useCallback(() => {
    if (!title.trim()) return
    onConfirm(title)
    setTitle("")
  }, [onConfirm, title])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        onConfirm(title)
      }
      if (e.key === "Escape") {
        if (open) {
          onClose()
          setTitle("")
        }
      }
    },
    [onClose, onConfirm, open, title],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{nodeType && t(`planGraph.addNode.${nodeType}`)}</DialogTitle>
        </DialogHeader>
        <div className="py-3">
          <Input
            ref={addTitleInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("planNode.title.label")}
            className="w-full"
          />
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onClose()
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button variant="default" onClick={handleConfirm} disabled={!title.trim()}>
            {t("common.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
