// Admin-facing input that records the next key combo the user presses.
// Click to arm; the next keydown becomes the stored combination. Escape
// clears, Backspace/Delete unbind. The stored value is the normalized
// "ctrl+alt+k" string; what the admin SEES is the display formatting
// from `formatComboForDisplay`.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Keyboard, X } from 'lucide-react';
import {
  eventToCombo,
  formatComboForDisplay,
} from '@/lib/shortcuts';

interface ShortcutKeyCaptureInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  // When a combo is already used by another action, we surface a small
  // tooltip/warning; still allow saving so the admin can rebind both.
  conflictLabel?: string | null;
  disabled?: boolean;
}

export function ShortcutKeyCaptureInput({
  value,
  onChange,
  conflictLabel,
  disabled,
}: ShortcutKeyCaptureInputProps) {
  const [listening, setListening] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listening) return;
    const node = containerRef.current;
    if (!node) return;
    node.focus();

    const handler = (e: KeyboardEvent) => {
      // Escape exits capture without changing the binding, Backspace /
      // Delete explicitly unbind. Both are sentinel paths so the admin
      // can't trap themselves.
      if (e.key === 'Escape') {
        e.preventDefault();
        setListening(false);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        onChange(null);
        setListening(false);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // pure modifier press — wait for the real key
      e.preventDefault();
      onChange(combo);
      setListening(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [listening, onChange]);

  return (
    <div className="flex items-center gap-2 w-full">
      <div
        ref={containerRef}
        tabIndex={0}
        role="button"
        onClick={() => !disabled && setListening(true)}
        onBlur={() => setListening(false)}
        className={cn(
          'flex-1 inline-flex items-center gap-2 rounded-md border px-3 h-10 text-sm cursor-pointer transition-colors',
          'bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring',
          listening && 'ring-2 ring-primary border-primary bg-primary/5',
          !!conflictLabel && !listening && 'border-amber-500/60',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        aria-label="اضغط لتسجيل اختصار"
      >
        <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
        {listening ? (
          <span className="text-primary font-medium">اضغط على المفاتيح الآن…</span>
        ) : value ? (
          <span className="font-mono font-semibold ltr-nums">
            {formatComboForDisplay(value)}
          </span>
        ) : (
          <span className="text-muted-foreground">غير مخصص</span>
        )}
      </div>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onChange(null)}
          title="إزالة الاختصار"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      {conflictLabel && !listening && (
        <span
          className="text-[11px] font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-0.5 shrink-0"
          title={`يتعارض مع: ${conflictLabel}`}
        >
          تعارض
        </span>
      )}
    </div>
  );
}
