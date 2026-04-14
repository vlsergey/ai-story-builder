import React, { useState, useRef, useEffect, useCallback } from "react"

interface ResizableTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string
  onChange: (value: string) => void
  /** Initial height in pixels (or CSS string). If not provided, uses auto. */
  initialHeight?: number | string
  /** Callback when user resizes the textarea (height in pixels) */
  onHeightChange?: (height: number) => void
  /** Minimum height in pixels */
  minHeight?: number
  /** Maximum height in pixels */
  maxHeight?: number
  /** Whether to show the resize handle (default true) */
  showHandle?: boolean
}

export default function ResizableTextarea({
  value,
  onChange,
  initialHeight = "auto",
  onHeightChange,
  minHeight = 40,
  maxHeight = 800,
  showHandle = true,
  className = "",
  ...props
}: ResizableTextareaProps) {
  const [height, setHeight] = useState<number | string>(initialHeight)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isDragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  // Update height when initialHeight changes
  useEffect(() => {
    if (initialHeight !== height) {
      setHeight(initialHeight)
    }
  }, [initialHeight, height])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientY - startY.current
      let newHeight = startHeight.current + delta
      if (newHeight < minHeight) newHeight = minHeight
      if (newHeight > maxHeight) newHeight = maxHeight
      setHeight(newHeight)
      onHeightChange?.(newHeight)
    },
    [minHeight, maxHeight, onHeightChange],
  )

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    document.removeEventListener("mousemove", handleMouseMove)
    // eslint-disable-next-line react-hooks/immutability
    document.removeEventListener("mouseup", handleMouseUp)
  }, [handleMouseMove])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    startY.current = e.clientY
    startHeight.current = typeof height === "number" ? height : textareaRef.current?.offsetHeight || minHeight
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isDragging.current) {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }
    }
  }, [handleMouseMove, handleMouseUp])

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full resize-none ${className}`}
        style={{ height: typeof height === "number" ? `${height}px` : height }}
        {...props}
      />
      {showHandle && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-transparent hover:bg-border/50 active:bg-border transition-colors flex items-center justify-center"
          onMouseDown={handleMouseDown}
          title="Drag to resize"
        >
          <div className="w-6 h-0.5 bg-muted-foreground/50 rounded" />
        </div>
      )}
    </div>
  )
}
