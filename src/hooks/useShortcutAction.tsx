// Thin wrapper around shortcutBus: subscribes a handler to an action
// for the lifetime of the calling component. Handler is re-registered
// whenever its identity changes, so wrap with useCallback when stable
// identity matters (e.g. when the handler closes over a state setter).

import { useEffect } from 'react';
import { onShortcutAction } from '@/lib/shortcutBus';
import type { ShortcutActionKey } from '@/lib/shortcuts';

export function useShortcutAction(
  action: ShortcutActionKey,
  handler: () => void,
): void {
  useEffect(() => {
    return onShortcutAction(action, handler);
  }, [action, handler]);
}
