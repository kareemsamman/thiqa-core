export const THIQA_SUPER_ADMIN_IDENTIFIERS = [
  "morshed500@gmail.com",
  "0525143581@phone.local",
] as const;

export function isThiqaSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();

  return (
    THIQA_SUPER_ADMIN_IDENTIFIERS.includes(normalized as (typeof THIQA_SUPER_ADMIN_IDENTIFIERS)[number]) ||
    normalized.startsWith("0525143581@")
  );
}
