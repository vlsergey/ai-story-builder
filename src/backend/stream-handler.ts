import { ipcMain } from 'electron'
import { generateAll } from './routes/generate-all.js'
import { generateLore } from './routes/generate-lore.js'
import { generatePlan } from './routes/generate-plan.js'

const activeStreams = new Map<string, AbortController>()

export function setupStreamHandlers() {
  ipcMain.handle('stream:start', async (event, { streamId, endpoint, params }) => {
    console.log(`[stream-handler] stream:start ${streamId} endpoint=${endpoint}`, params)
    const abortController = new AbortController()
    activeStreams.set(streamId, abortController)

    const send = (type: string, data: any) => {
      event.sender.send('stream:event', { streamId, type, data })
    }

    const onThinking = (status: string, detail?: string) => {
      send('thinking', { status, detail })
    }

    const onPartialJson = (data: Record<string, unknown>) => {
      send('partial_json', data)
    }

    try {
      let result
      if (endpoint === 'generate-all') {
        result = await generateAll(params, onThinking, onPartialJson)
      } else if (endpoint === 'generate-lore') {
        result = await generateLore(params, onThinking, onPartialJson)
      } else if (endpoint === 'generate-plan') {
        result = await generatePlan(params, onThinking, onPartialJson)
      } else {
        throw new Error(`Unknown endpoint: ${endpoint}`)
      }
      console.log(`[stream-handler] stream ${streamId} completed successfully`)
      send('done', result)
    } catch (error: any) {
      console.error(`[stream-handler] stream ${streamId} error:`, error)
      // Если ошибка имеет статус, передадим его
      const errorData = {
        message: error.message,
        stack: error.stack,
        status: error.status,
      }
      send('error', errorData)
    } finally {
      activeStreams.delete(streamId)
    }
  })

  ipcMain.handle('stream:abort', (event, { streamId }) => {
    console.log(`[stream-handler] stream:abort ${streamId}`)
    const controller = activeStreams.get(streamId)
    if (controller) {
      controller.abort()
      activeStreams.delete(streamId)
      // Отправляем событие отмены? Фронтенд ожидает error с AbortError?
      // Пока просто прерываем, фронтенд сам обработает abort через signal
    }
  })
}