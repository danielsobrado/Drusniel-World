// Observers consume already-published state. Their failures must not turn a
// committed edit into an apparent rejection or prevent history from seeing it.
export function notifyWorkshopListeners(listeners, event, label) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(`${label} listener failed.`, {
        revision: event.document?.revision,
        touchedIds: event.touchedIds,
        metadata: event.metadata,
        reason: event.reason,
      }, error);
    }
  }
}
