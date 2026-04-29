import { R_OK } from "node:constants"
import { access, mkdir } from "node:fs/promises"
import {
  clipboard,
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
  shell,
} from "electron"
import z from "zod"
import * as AppMenu from "./main.js"
import type { RouteBuilder } from "./router"

export function nativeRoutes(t: RouteBuilder) {
  return t.router({
    fs: t.router({
      /** Tests a user's permissions for the file or directory specified by `path`. */
      canAccess: t.procedure
        .input(
          z.object({
            path: z.string(),
            mode: z.number().optional(),
          }),
        )
        .mutation(({ input }) => canAccess(input.path, input.mode)),
      canRead: t.procedure.input(z.string()).mutation(({ input }) => canAccess(input, R_OK)),
      mkdir: t.procedure
        .input(
          z.object({
            path: z.string(),
            recursive: z.boolean().optional().default(false),
          }),
        )
        .mutation(({ input }) => mkdir(input.path, { recursive: input.recursive })),
    }),
    clipboard: t.router({
      /** The content in the clipboard as plain text. */
      readText: t.procedure.mutation(() => clipboard.readText()),
      /** Writes the `text` into the clipboard as plain text. */
      writeText: t.procedure.input(z.string()).mutation(({ input }) => clipboard.writeText(input)),
    }),
    menuState: AppMenu.menuStateRoutes(t),
    /** Open the given file in the desktop's default manner. */
    openPath: t.procedure.input(z.string()).mutation(({ input }) => shell.openPath(input)),
    /** Show a native save file dialog. */
    showOpenDialog: t.procedure
      .input((v) => v as OpenDialogOptions | undefined | null)
      .mutation(({ input }) => dialog.showOpenDialog(input || {})),
    /** Shows a message box. */
    showMessageBox: t.procedure
      .input((v) => v as MessageBoxOptions)
      .mutation(({ input }) => dialog.showMessageBox(input)),
    showSaveDialog: t.procedure
      .input((v) => v as SaveDialogOptions | undefined | null)
      .mutation(({ input }) => dialog.showSaveDialog(input || {})),
  })
}

function canAccess(path: string, mode?: number): boolean {
  try {
    access(path, mode)
    return true
  } catch (e) {
    return false
  }
}
