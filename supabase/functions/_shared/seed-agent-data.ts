// Shared seed data + seeding logic for a new agent.
// Used by:
//   - supabase/functions/seed-agent-data      (onboarding wizard / thiqa admin manual trigger)
//   - supabase/functions/register-agent       (auto-seed on public self-signup)
// And invoked from ThiqaCreateAgent.tsx via the seed-agent-data HTTP wrapper.
//
// Policy: a new agent starts with an empty workspace. We previously
// seeded sample insurance companies, road services, accident-fee
// services, pricing rules, and per-company prices — but agents asked
// for a clean slate so they can enter their real business data without
// having to delete placeholder rows first.
//
// Two things are still seeded (silent infrastructure):
//   * A single default branch — the policies / clients / payments
//     tables all have a non-null branch_id, so without one the
//     wizard can't insert anything.
//   * The insurance_categories taxonomy — code paths in the wizard
//     reference fixed slugs (THIRD_FULL, HEALTH, LIFE, etc.) and the
//     UI uses the rows to populate the category picker. The agent can
//     rename / hide / reorder them later from the categories page.

export const SEED_INSURANCE_CATEGORIES = [
  { name: "Car Insurance",      name_ar: "تأمين السيارات",   slug: "THIRD_FULL", mode: "FULL",  is_active: true, is_default: true,  sort_order: 1 },
  { name: "Health Insurance",   name_ar: "التأمين الصحي",     slug: "HEALTH",     mode: "LIGHT", is_active: true, is_default: false, sort_order: 10 },
  { name: "Life Insurance",     name_ar: "التأمين على الحياة", slug: "LIFE",       mode: "LIGHT", is_active: true, is_default: false, sort_order: 11 },
  { name: "Property Insurance", name_ar: "تأمين الممتلكات",  slug: "PROPERTY",   mode: "LIGHT", is_active: true, is_default: false, sort_order: 12 },
  { name: "Travel Insurance",   name_ar: "تأمين السفر",       slug: "TRAVEL",     mode: "LIGHT", is_active: true, is_default: false, sort_order: 13 },
  { name: "Business Insurance", name_ar: "تأمين الشركات",     slug: "BUSINESS",   mode: "LIGHT", is_active: true, is_default: false, sort_order: 14 },
];

export async function performSeed(
  supabase: any,
  agentId: string,
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  // 1. Default branch (silent infrastructure — every policy / client
  //    row has a NOT NULL branch_id, so the agent can't do anything
  //    until at least one branch exists).
  const { count: branchCount } = await supabase
    .from("branches").select("id", { count: "exact", head: true }).eq("agent_id", agentId);
  if ((branchCount ?? 0) === 0) {
    const { data: branchData, error: branchErr } = await supabase
      .from("branches")
      .insert({ agent_id: agentId, name: "Main Branch", name_ar: "الفرع الرئيسي", is_default: true })
      .select("id");
    if (!branchErr && branchData?.length) {
      results.branches = 1;
    }
  }

  // 2. Insurance categories. Idempotent on (agent_id, slug) so re-
  //    running the seed doesn't duplicate. Anything beyond what the
  //    agent already has gets inserted; existing rows are left alone.
  const { data: existingCats } = await supabase
    .from("insurance_categories")
    .select("slug")
    .eq("agent_id", agentId);
  const existingSlugs = new Set((existingCats ?? []).map((r: any) => r.slug));
  const catsToInsert = SEED_INSURANCE_CATEGORIES
    .filter((c) => !existingSlugs.has(c.slug))
    .map((c) => ({ ...c, agent_id: agentId }));
  if (catsToInsert.length > 0) {
    const { data, error } = await supabase
      .from("insurance_categories")
      .insert(catsToInsert)
      .select("id");
    if (error) throw error;
    results.insurance_categories = data?.length ?? 0;
  } else {
    results.insurance_categories = 0;
  }

  return results;
}
