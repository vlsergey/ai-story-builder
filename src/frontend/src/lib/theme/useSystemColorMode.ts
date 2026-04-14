import type { ColorMode } from "@shared/themes"
import { useEffect, useState } from "react"

export function useSystemColorMode(): ColorMode {
  // Track OS-level dark/light changes
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return systemDark ? "dark" : "light"
}
