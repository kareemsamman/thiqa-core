import { ExternalLink, PackageOpen } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface SelectEmptyHintProps {
  /** Arabic label for the missing resource, e.g. "شركات تأمين" */
  label: string;
  /** Admin path for adding new items, e.g. "/companies" */
  adminPath: string;
  /** Called with the admin path so the wizard can minimize + navigate */
  onNavigate?: (path: string) => void;
  /** When true, only admins get the "add" CTA; regular users see a help line */
  adminOnly?: boolean;
}

/**
 * Empty-state block rendered inside a shadcn <SelectContent> when the
 * underlying list is empty. Tells the user there's nothing to pick AND
 * how to add something. Non-admins get a "contact your admin" hint.
 */
export function SelectEmptyHint({
  label,
  adminPath,
  onNavigate,
  adminOnly = true,
}: SelectEmptyHintProps) {
  const { isAdmin } = useAuth();
  const canAdd = !adminOnly || isAdmin;

  return (
    <div className="px-3 py-4 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <PackageOpen className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        لا توجد {label} متاحة
      </p>
      {canAdd ? (
        onNavigate ? (
          <button
            type="button"
            // Stop the event at pointerdown so Radix's "close-on-outside" in
            // the Select root doesn't fire before our navigation handler.
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNavigate(adminPath);
            }}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
          >
            إضافة {label} الآن
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            يمكنك إضافتها من صفحة الإدارة
          </p>
        )
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          تواصل مع المسؤول لإضافة {label}
        </p>
      )}
    </div>
  );
}
