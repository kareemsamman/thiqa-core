// App-level keydown listener. Resolves the combo against the agent's
// merged binding map and dispatches the matching action via shortcutBus.
// Navigation actions (nav_*) are handled here directly so we don't need
// to mount a subscriber on every page just to call `navigate()`.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentShortcuts } from '@/hooks/useAgentShortcuts';
import { eventToCombo, shouldIgnoreInputContext } from '@/lib/shortcuts';
import { dispatchShortcutAction } from '@/lib/shortcutBus';
import type { ShortcutActionKey } from '@/lib/shortcuts';

// Actions the listener handles itself without going through the bus —
// they don't need a live component on screen, just a navigation side
// effect.
const NAV_TARGETS: Partial<Record<ShortcutActionKey, string>> = {
  nav_clients: '/clients',
  nav_policies: '/policies',
};

export function useGlobalShortcutListener() {
  const { comboToAction } = useAgentShortcuts();
  const navigate = useNavigate();

  useEffect(() => {
    if (comboToAction.size === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreInputContext(e)) return;
      const combo = eventToCombo(e);
      if (!combo) return;
      const action = comboToAction.get(combo);
      if (!action) return;

      // At this point we KNOW the user pressed a bound combo, so we
      // swallow the browser's default behavior (e.g. Alt+N opening the
      // "New" menu in some browsers).
      e.preventDefault();
      e.stopPropagation();

      const navTarget = NAV_TARGETS[action];
      if (navTarget) {
        navigate(navTarget);
        return;
      }

      dispatchShortcutAction(action);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [comboToAction, navigate]);
}
