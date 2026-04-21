// Keyboard-shortcut registry + key-combo helpers.
//
// The admin maps each ACTION (e.g. "new_policy") to a KEY COMBINATION
// (e.g. "ctrl+n"). Code defines the canonical action list so new actions
// can ship without a DB migration; the per-agent bindings override the
// default combo in `agent_shortcuts`.

export type ShortcutActionKey =
  | 'new_policy'
  | 'global_search'
  | 'open_drafts'
  | 'new_client'
  | 'edit_client'
  | 'nav_clients'
  | 'nav_policies'
  | 'show_shortcuts';

export interface ShortcutAction {
  key: ShortcutActionKey;
  // Admin-facing Arabic label.
  label: string;
  // One-line Arabic description of what triggering it does, so the admin
  // knows what they're binding without testing.
  description: string;
  // Suggested default combo. Admin can clear or rebind freely.
  defaultCombo: string | null;
  // Category purely for grouping the admin UI into sections.
  category: 'actions' | 'navigation';
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    key: 'new_policy',
    label: 'معاملة جديدة',
    description: 'فتح مساعد إنشاء معاملة تأمين جديدة',
    defaultCombo: 'alt+n',
    category: 'actions',
  },
  {
    key: 'global_search',
    label: 'البحث العام',
    description: 'فتح شريط البحث العام والتركيز على حقل الإدخال',
    defaultCombo: 'alt+k',
    category: 'actions',
  },
  {
    key: 'open_drafts',
    label: 'فتح المسودات المصغرة',
    description: 'عرض قائمة المسودات المصغرة لاستكمال العمل عليها',
    defaultCombo: 'alt+d',
    category: 'actions',
  },
  {
    key: 'new_client',
    label: 'عميل جديد',
    description: 'فتح نافذة إضافة عميل جديد (من صفحة العملاء)',
    defaultCombo: 'alt+c',
    category: 'actions',
  },
  {
    key: 'edit_client',
    label: 'تعديل بيانات العميل',
    description: 'فتح تعديل بيانات العميل الحالي (داخل صفحة العميل)',
    defaultCombo: 'alt+e',
    category: 'actions',
  },
  {
    key: 'nav_clients',
    label: 'الذهاب إلى العملاء',
    description: 'الانتقال إلى صفحة قائمة العملاء',
    defaultCombo: 'alt+1',
    category: 'navigation',
  },
  {
    key: 'nav_policies',
    label: 'الذهاب إلى المعاملات',
    description: 'الانتقال إلى صفحة المعاملات',
    defaultCombo: 'alt+2',
    category: 'navigation',
  },
  {
    key: 'show_shortcuts',
    label: 'عرض قائمة الاختصارات',
    description: 'فتح لوحة تذكيرية تعرض جميع اختصارات لوحة المفاتيح المخصصة',
    // F1 is dedicated to "help" across most apps, doesn't clash with
    // Alt/Ctrl combos, and is layout-independent (no '/' or '?' issues
    // on Arabic keyboards).
    defaultCombo: 'f1',
    category: 'actions',
  },
];

// --- Combo normalization & matching -----------------------------------

// Lowercase modifier names, in fixed order so "ctrl+shift+n" and
// "shift+ctrl+n" compare equal after normalization.
const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;

// Display names admin sees in the settings UI. Uses '⌃ ⌥ ⇧ ⌘' on Mac
// and plain words on PC — but the STORED form stays "ctrl+alt+k" so it
// re-runs on whatever machine the staff is on.
export function formatComboForDisplay(combo: string | null): string {
  if (!combo) return 'غير مخصص';
  const platformIsMac = typeof navigator !== 'undefined'
    && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = combo.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  return parts
    .map((p) => {
      if (p === 'ctrl') return platformIsMac ? '⌃' : 'Ctrl';
      if (p === 'alt') return platformIsMac ? '⌥' : 'Alt';
      if (p === 'shift') return platformIsMac ? '⇧' : 'Shift';
      if (p === 'meta') return platformIsMac ? '⌘' : 'Win';
      // Printable keys: uppercase the first letter so "k" → "K".
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(platformIsMac ? '' : '+');
}

// Turn a live KeyboardEvent into the normalized combo string. Returns
// null if the event is only a bare modifier (ctrl/alt/shift/meta alone).
export function eventToCombo(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (e.metaKey) mods.push('meta');

  const rawKey = e.key;
  // A pure modifier press (e.g. just Alt) shouldn't register — the admin
  // UI would otherwise capture "alt" and it would match every Alt press.
  const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);
  if (MODIFIER_KEYS.has(rawKey)) return null;

  // Normalize the main key. Arrow keys, Escape, F1-F12, etc. keep their
  // KeyboardEvent name (lowercased). Printable characters are lowercased
  // directly. Digits stay digits.
  let mainKey = rawKey.toLowerCase();
  if (mainKey === ' ') mainKey = 'space';

  // Layout-independence: e.key reflects the active keyboard layout, so
  // pressing the physical N key in Arabic mode yields "ن" and the lookup
  // misses any binding stored as "n". Fall back to e.code, which always
  // names the physical key (KeyN, Digit1, …), whenever e.key didn't
  // produce a clean ASCII letter/digit. This keeps a binding like
  // "ctrl+n" firing regardless of the OS-level keyboard layout.
  if (e.code && !/^[a-z0-9]$/.test(mainKey)) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) {
      mainKey = letter[1].toLowerCase();
    } else {
      const digit = /^Digit([0-9])$/.exec(e.code);
      if (digit) mainKey = digit[1];
    }
  }

  // Re-order modifiers into the canonical order so comparisons work.
  const orderedMods = MOD_ORDER.filter((m) => mods.includes(m));
  return [...orderedMods, mainKey].join('+');
}

// Ignore shortcut presses while the user is typing into a form field
// unless the combo uses a modifier — otherwise binding a bare key like
// "n" to a shortcut would steal every 'n' the user types into a search
// box. Any combo with at least one modifier (ctrl/alt/shift/meta) still
// fires in inputs.
export function shouldIgnoreInputContext(e: KeyboardEvent): boolean {
  const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
  if (hasModifier) return false;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}
