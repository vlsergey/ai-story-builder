import type React from "react"
import { X } from "lucide-react"
import { Button } from "@/ui-components/button"
import { useLocale } from "@/lib/locale"

interface DeleteNodeButtonProps {
  onDelete: (e: React.MouseEvent) => void
  className?: string
  size?: "icon-xs" | "icon-sm" | "icon"
  variant?: "ghost" | "outline" | "destructive"
}

export default function DeleteNodeButton({
  onDelete,
  className = "",
  size = "icon-xs",
  variant = "ghost",
}: DeleteNodeButtonProps) {
  const { t } = useLocale()

  return (
    <Button
      variant={variant}
      size={size}
      onClick={onDelete}
      aria-label={t("planGraph.deleteNode", "Delete node")}
      className={`hover:!bg-destructive hover:!text-destructive-foreground ${className}`}
    >
      <X />
    </Button>
  )
}
