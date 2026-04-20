// Tiny pub/sub bus for shortcut actions.
//
// The global listener dispatches `dispatchShortcutAction('new_policy')`;
// every component that owns the trigger for that action subscribes with
// `onShortcutAction('new_policy', handler)`. Multiple subscribers are
// allowed (e.g. two pages listening for `edit_client`) — each handler
// fires, and handlers are responsible for early-returning when their
// surface isn't active (usually via a route check).

import type { ShortcutActionKey } from './shortcuts';

type Handler = () => void;

const listeners = new Map<ShortcutActionKey, Set<Handler>>();

export function onShortcutAction(
  action: ShortcutActionKey,
  handler: Handler,
): () => void {
  let bucket = listeners.get(action);
  if (!bucket) {
    bucket = new Set();
    listeners.set(action, bucket);
  }
  bucket.add(handler);
  return () => {
    bucket?.delete(handler);
  };
}

export function dispatchShortcutAction(action: ShortcutActionKey): boolean {
  const bucket = listeners.get(action);
  if (!bucket || bucket.size === 0) return false;
  bucket.forEach((h) => {
    try {
      h();
    } catch (err) {
      console.error(`[shortcutBus] handler for "${action}" threw`, err);
    }
  });
  return true;
}
