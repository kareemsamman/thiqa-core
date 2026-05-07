/**
 * Stateful client-deletion flow for the AI assistant.
 *
 * The AI is otherwise strictly read-only. This module adds a guarded,
 * deterministic delete path that bypasses the LLM:
 *   1. Detect a delete intent in the user's message.
 *   2. Fuzzy-search clients by name (uses `full_name_normalized` so
 *      Arabic alef/hamza variants don't matter).
 *   3. If 1 match → ask "are you sure?". If many → numbered pick list.
 *   4. State (pending_action + candidate IDs) is persisted in
 *      `ai_chat_messages.metadata` of the assistant turn so the NEXT
 *      user message can be interpreted as "pick by number" or
 *      "confirm/cancel" without re-classifying intent.
 *   5. On confirm → call `delete_client_cascade(uuid)` RPC which hard-
 *      deletes the client row + cascades policies/payments/etc.
 *
 * Admin-only — workers fall through to the regular read-only AI.
 */

export type DeleteFlowMetadata =
  | { pending_action: "delete_pick"; candidates: { id: string; full_name: string; file_number: string | null; phone_number: string | null }[] }
  | { pending_action: "delete_confirm"; client: { id: string; full_name: string; file_number: string | null; phone_number: string | null } };

export interface DeleteFlowResult {
  reply: string;
  metadata: DeleteFlowMetadata | null;
}

/** Normalize Arabic text the same way the DB column does. Handles
 *  alef/hamza variants and strips harakat so "كريم" and "كريم" match. */
function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ً-ْ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const DELETE_VERBS = [
  // Arabic — root verbs (any conjugation containing these substrings counts)
  // حذف root
  "احذف",
  "حذف",
  // مسح root
  "امسح",
  "مسح عميل",
  // محا root (yamhi / amha — common in Levantine for "wipe / erase")
  "امحي",
  "امح",
  "محي",
  "محى",
  // الغى root
  "الغي",
  "ألغي",
  "الغ",
  // Common compound forms with "بدي / ابي / اريد"
  "بدي الغي",
  "بدي احذف",
  "بدي امسح",
  "بدي ألغي",
  "بدي امحي",
  "بدي امح",
  "ابي احذف",
  "ابي امحي",
  "اريد حذف",
  "اريد محو",
  // Latin
  "delete",
  "remove",
  "erase",
];

/** Strip whitespace and apply Arabic normalization so partial-letter
 *  typos like "ا لغيه" still match "الغي". */
function normalizeForMatch(s: string): string {
  return normalizeArabic(s).replace(/\s+/g, "");
}

/** Heuristic: does this message look like a "delete a client" request? */
export function isDeleteIntent(message: string): boolean {
  const compact = normalizeForMatch(message);
  return DELETE_VERBS.some((v) => compact.includes(normalizeForMatch(v)));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Single-token Arabic / Latin filler words that get dropped after the
 *  verbs are stripped. Stored as a Set since JS regex \b is ASCII-only
 *  and won't word-segment Arabic — token-based filtering is correct here. */
const FILLER_WORDS = new Set([
  // Arabic prepositions / connectors / fillers
  "في", "على", "عند", "من", "إلى", "الى", "ل",
  "اسم", "باسم", "اسمه", "اسمها", "اسمهم",
  "عميل", "العميل", "زبون", "الزبون",
  "اللي", "التي", "الذي",
  "بدي", "أبي", "ابي", "اريد", "أريد", "ممكن",
  "هذا", "هذه", "ذاك", "تلك",
  "له", "لها", "لهم",
  // Latin
  "client", "customer", "please", "the", "a", "an",
]);

/** Try to extract the client name the user typed. Falls back to the
 *  whole message minus the delete verbs and common filler words.
 *  Verb regex allows OPTIONAL whitespace between every character so
 *  the "ا لغيه" / "الـغي" typo cases still get stripped. Trailing
 *  pronoun suffixes (ه / ها / هم / هما) are also consumed so
 *  "الغيه" reduces to nothing instead of leaving a stray "ه". */
function extractTargetName(message: string): string {
  let s = message;
  // 1. Strip delete verbs.
  for (const v of DELETE_VERBS) {
    const flexible = v.split("").map(escapeRegex).join("\\s*") + "(?:\\s*(?:ها|هما|هم|ه))?";
    s = s.replace(new RegExp(flexible, "gi"), " ");
  }
  // 2. Strip multi-word fillers explicitly (single-word approach below
  //    can't catch them once tokenized).
  s = s.replace(/من\s+فضلك/gi, " ").replace(/لو\s+سمحت/gi, " ");
  // 3. Tokenize on whitespace and drop filler words. \b doesn't work
  //    for Arabic letters in JS, so this is the reliable path.
  const tokens = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !FILLER_WORDS.has(t.toLowerCase()));
  return tokens.join(" ").trim();
}

interface CandidateRow {
  id: string;
  full_name: string;
  file_number: string | null;
  phone_number: string | null;
}

/** Render the candidate list as a numbered Arabic message. */
function renderCandidateList(name: string, list: CandidateRow[]): string {
  const lines = list.map((c, i) => {
    const parts = [`${i + 1}. ${c.full_name}`];
    if (c.file_number) parts.push(`ملف ${c.file_number}`);
    if (c.phone_number) parts.push(c.phone_number);
    return parts.join(" · ");
  });
  return [
    `وجدت أكثر من عميل يطابق "${name}":`,
    "",
    ...lines,
    "",
    "أيهم تقصد؟ اكتب رقم العميل من القائمة (مثلاً: 2)، أو اكتب \"إلغاء\" للتراجع.",
  ].join("\n");
}

/** First step: a fresh delete request. Searches for the name and
 *  returns either a confirm prompt (single match) or a pick list. */
export async function handleDeleteIntent(
  supabase: any,
  agentId: string,
  branchId: string | null,
  message: string,
): Promise<DeleteFlowResult> {
  const target = extractTargetName(message);
  if (!target) {
    return {
      reply: "ما اسم العميل اللي تريد حذفه؟ اكتب الاسم وسأبحث عنه.",
      metadata: null,
    };
  }

  const normalized = normalizeArabic(target);
  let q = supabase
    .from("clients")
    .select("id, full_name, file_number, phone_number, id_number, branch_id")
    .is("deleted_at", null)
    .eq("agent_id", agentId)
    .ilike("full_name_normalized", `%${normalized}%`)
    .limit(8);
  if (branchId) q = q.eq("branch_id", branchId);

  const { data: matches, error } = await q;
  if (error) {
    return {
      reply: `تعذّر البحث عن العميل: ${error.message}`,
      metadata: null,
    };
  }
  if (!matches || matches.length === 0) {
    return {
      reply: `لا يوجد عميل باسم "${target}" في النظام.\n\nيرجى التأكد من الاسم أو البحث برقم الهوية أو الهاتف من صفحة "العملاء".`,
      metadata: null,
    };
  }

  if (matches.length === 1) {
    const c = matches[0];
    const idLine = c.file_number ? ` (ملف ${c.file_number})` : "";
    return {
      reply: [
        `هل أنت متأكد أنك تريد حذف العميل "${c.full_name}"${idLine}؟`,
        "",
        "⚠️ سيتم حذف العميل وكل بياناته (المعاملات، السيارات، المدفوعات) نهائياً ولا يمكن التراجع.",
        "",
        "اكتب \"نعم\" أو \"تأكيد\" للحذف، أو \"إلغاء\" للتراجع.",
      ].join("\n"),
      metadata: {
        pending_action: "delete_confirm",
        client: {
          id: c.id,
          full_name: c.full_name,
          file_number: c.file_number,
          phone_number: c.phone_number,
        },
      },
    };
  }

  const candidates: CandidateRow[] = matches.map((c: any) => ({
    id: c.id,
    full_name: c.full_name,
    file_number: c.file_number,
    phone_number: c.phone_number,
  }));
  return {
    reply: renderCandidateList(target, candidates),
    metadata: { pending_action: "delete_pick", candidates },
  };
}

/** User has been shown a numbered list. Parse their reply as a number
 *  (or "إلغاء") and either move to confirm or cancel. */
export async function handleDeletePick(
  meta: Extract<DeleteFlowMetadata, { pending_action: "delete_pick" }>,
  message: string,
): Promise<DeleteFlowResult> {
  const m = (message || "").trim().toLowerCase();
  if (/^(إلغاء|الغاء|cancel|لا|no)$/i.test(m)) {
    return { reply: "تم إلغاء عملية الحذف.", metadata: null };
  }
  // Convert Arabic-Indic digits to Latin so "٢" parses too.
  const ascii = m.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const match = ascii.match(/\d+/);
  if (!match) {
    return {
      reply: "لم أفهم اختيارك. اكتب رقم العميل من القائمة (مثلاً: 2)، أو \"إلغاء\".",
      metadata: meta,
    };
  }
  const n = parseInt(match[0], 10);
  const idx = n - 1;
  if (idx < 0 || idx >= meta.candidates.length) {
    return {
      reply: `الرقم ${n} غير موجود في القائمة. اختر رقماً بين 1 و${meta.candidates.length}، أو اكتب "إلغاء".`,
      metadata: meta,
    };
  }
  const chosen = meta.candidates[idx];
  const idLine = chosen.file_number ? ` (ملف ${chosen.file_number})` : "";
  return {
    reply: [
      `هل أنت متأكد أنك تريد حذف العميل "${chosen.full_name}"${idLine}؟`,
      "",
      "⚠️ سيتم حذف العميل وكل بياناته (المعاملات، السيارات، المدفوعات) نهائياً ولا يمكن التراجع.",
      "",
      "اكتب \"نعم\" أو \"تأكيد\" للحذف، أو \"إلغاء\" للتراجع.",
    ].join("\n"),
    metadata: { pending_action: "delete_confirm", client: chosen },
  };
}

/** User has been shown the confirmation prompt. Parse yes/no. */
export async function handleDeleteConfirm(
  supabase: any,
  meta: Extract<DeleteFlowMetadata, { pending_action: "delete_confirm" }>,
  message: string,
): Promise<DeleteFlowResult> {
  const m = (message || "").trim().toLowerCase();
  if (/^(نعم|أكد|اكد|تأكيد|تاكيد|yes|y|confirm)$/i.test(m)) {
    const { error } = await supabase.rpc("delete_client_cascade", { p_client_id: meta.client.id });
    if (error) {
      return {
        reply: `تعذّر حذف العميل: ${error.message}`,
        metadata: null,
      };
    }
    return {
      reply: `✅ تم حذف العميل "${meta.client.full_name}" وكل بياناته نهائياً.`,
      metadata: null,
    };
  }
  if (/^(لا|إلغاء|الغاء|no|cancel)$/i.test(m)) {
    return { reply: "تم إلغاء عملية الحذف.", metadata: null };
  }
  return {
    reply: "للحذف اكتب \"نعم\" أو \"تأكيد\". للتراجع اكتب \"إلغاء\".",
    metadata: meta,
  };
}
