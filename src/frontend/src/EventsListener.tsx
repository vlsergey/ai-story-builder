import { trpc } from "./ipcClient"

export default function EventsListener() {
  const utils = trpc.useUtils()

  // Settings
  const settingsUtils = utils.settings
  trpc.settings.subscribe.useSubscription(undefined, {
    onData: ({ key }) => {
      console.debug("Settings updated:", key)
      if (Object.hasOwn(settingsUtils, key)) {
        ;(settingsUtils as any)[key].invalidate()
      }
    },
    onError: (err) => {
      console.error("Settings subscription error:", err)
    },
  })

  trpc.plan.nodes.subscribe.useSubscription(undefined, {
    onData: (nodeId: number) => {
      console.log("Plan node updated:", nodeId)
      utils.plan.nodes.invalidate()
    },
    onError: (err) => {
      console.error("Plan node subscription error:", err)
    },
  })

  // Subscribe to plan edge updates
  trpc.plan.edges.subscribe.useSubscription(undefined, {
    onData: (edgeId) => {
      console.log("Plan edge updated:", edgeId)
      utils.plan.edges.invalidate()
    },
    onError: (err) => {
      console.error("Plan edge subscription error:", err)
    },
  })

  // Subscribe to lore node updates
  trpc.lore.subscribe.useSubscription(undefined, {
    onData: (nodeId: number) => {
      console.log("Lore node updated:", nodeId)
      utils.lore.invalidate()
    },
    onError: (err) => {
      console.error("Lore subscription error:", err)
    },
  })

  return <span className="display-hidden" />
}
