import { dialog } from "electron"

/**
 * Show a native save file dialog.
 * @param defaultPath - Suggested default path (can be empty string)
 * @param filters - Array of file filters
 * @returns Selected file path or null if cancelled
 */
export async function saveFileDialog(
  defaultPath: string,
  filters: Array<{ name: string; extensions: string[] }>,
): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    defaultPath,
    filters,
    properties: ["createDirectory", "showOverwriteConfirmation"],
  })
  return result.canceled ? null : result.filePath
}
