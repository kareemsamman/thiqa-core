/**
 * Tool definitions + implementations for the WhatsApp customer bot.
 *
 * Tools are described via OpenAI's function-calling JSON shape (which
 * Lovable proxies through to OpenAI). Each one runs server-side here;
 * the model only chooses which to invoke and with what args.
 *
 * Scope rule: every tool MUST be parameterized by agent_id (passed in
 * via ToolContext) so a customer messaging agency A can never see
 * agency B's data. Phone-based identification already gates this on
 * the way in; tools enforce it on the way out.
 */

export interface ToolContext {
  supabase: any;
  agentId: string;
  branchId: string | null;
  /** Full request body of the customer's WhatsApp event — used to
   *  populate phone_number on requests we create. */
  customerPhone: string;
  /** Optional: client matched by phone when the conversation started.
   *  Tools default to this when no explicit client_id is given. */
  defaultClientId: string | null;
  supabaseUrl: string;
  serviceKey: string;
  authToken: string; // service_role bearer for invoking other edge fns
  /** chat session id — written onto created customer_requests so the
   *  follow-up UI can jump straight to the chat that triggered it. */
  sessionId: string;
}

/** OpenAI-format function tool definitions, advertised to the model. */
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_clients_smart",
      description:
        "Search the agent's customers by name (Arabic-tolerant), phone number, ID number, or car license plate. Returns up to 5 matches with their basic info. Use this when the customer's identity isn't already known or when they refer to someone other than themselves.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text query. Can be a partial name, phone digits, ID number, or car license plate.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_client_policies",
      description:
        "List all insurance policies for a specific customer (by client_id). Returns policy details, dates, prices, paid/remaining amounts, and the group_id which identifies packages. Pass this to get_invoice_url with all policies in the same group when generating a package invoice.",
      parameters: {
        type: "object",
        properties: {
          client_id: {
            type: "string",
            description: "UUID of the client. If omitted, defaults to the customer who sent the WhatsApp message.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice_url",
      description:
        "Generate and return an HTML invoice URL covering one or more policies. CRITICAL: if the customer asks about a policy that is part of a package (multiple policies sharing a group_id), pass ALL policy IDs in that group, not just the one they asked about. The customer expects the full package invoice.",
      parameters: {
        type: "object",
        properties: {
          policy_ids: {
            type: "array",
            items: { type: "string" },
            description: "UUIDs of policies to include on the invoice. Pass all members of a group together.",
          },
        },
        required: ["policy_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_vehicle",
      description:
        "Look up vehicle details (manufacturer, model, year, color) from the Israeli government open-data API by license plate. MUST be used during the quote flow after the customer gives their car number, so you can confirm the vehicle with them before filing the request.",
      parameters: {
        type: "object",
        properties: {
          car_number: {
            type: "string",
            description: "License plate digits only. Typically 7 or 8 digits.",
          },
        },
        required: ["car_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_customer_request",
      description:
        "Create a follow-up request for the office staff. Use this when the customer needs human attention: asking for a price quote, reporting an accident, or any inquiry the bot can't handle directly. The customer should be told the staff will contact them.",
      parameters: {
        type: "object",
        properties: {
          request_type: {
            type: "string",
            enum: ["quote", "accident", "general"],
            description: "Category of the request.",
          },
          title: {
            type: "string",
            description: "One-line Arabic summary that will appear in the staff's request list.",
          },
          content: {
            type: "string",
            description:
              "Full context the staff need to follow up: customer's exact words, any vehicle/policy info mentioned, etc.",
          },
        },
        required: ["request_type", "title", "content"],
      },
    },
  },
] as const;

// ─── Implementations ────────────────────────────────────────────────

function digitsOnly(s: string): string {
  return (s ?? "").replace(/[^0-9]/g, "");
}

function normalizeArabicSearch(input: string): string {
  return (input ?? "")
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

async function searchClientsSmart(ctx: ToolContext, args: { query: string }) {
  const raw = (args.query ?? "").trim();
  if (!raw) return { results: [], note: "empty query" };

  const normalized = normalizeArabicSearch(raw);
  const digits = digitsOnly(raw);
  const phoneCandidates = new Set<string>();
  if (digits) {
    phoneCandidates.add(digits);
    if (digits.startsWith("972")) phoneCandidates.add("0" + digits.slice(3));
    else if (digits.startsWith("0") && digits.length === 10) phoneCandidates.add("972" + digits.slice(1));
  }

  // Run name + phone + ID searches in parallel
  const [byName, byPhone, byId, byCar] = await Promise.all([
    ctx.supabase
      .from("clients")
      .select("id, full_name, file_number, phone_number, id_number")
      .eq("agent_id", ctx.agentId)
      .is("deleted_at", null)
      .ilike("full_name_normalized", `%${normalized}%`)
      .limit(5),
    digits
      ? ctx.supabase
          .from("clients")
          .select("id, full_name, file_number, phone_number, id_number")
          .eq("agent_id", ctx.agentId)
          .is("deleted_at", null)
          .in("phone_number", Array.from(phoneCandidates))
          .limit(5)
      : Promise.resolve({ data: [] }),
    digits.length === 9
      ? ctx.supabase
          .from("clients")
          .select("id, full_name, file_number, phone_number, id_number")
          .eq("agent_id", ctx.agentId)
          .is("deleted_at", null)
          .eq("id_number", digits)
          .limit(5)
      : Promise.resolve({ data: [] }),
    raw.length >= 4
      ? ctx.supabase
          .from("cars")
          .select("client_id, car_number, clients(id, full_name, file_number, phone_number, id_number, agent_id)")
          .eq("clients.agent_id", ctx.agentId)
          .ilike("car_number", `%${raw}%`)
          .limit(5)
      : Promise.resolve({ data: [] }),
  ]);

  // Merge and dedupe by client.id
  const byCarMapped = (byCar.data ?? [])
    .map((row: any) => row.clients)
    .filter((c: any) => c && c.agent_id === ctx.agentId);
  const merged = new Map<string, any>();
  for (const row of [
    ...(byName.data ?? []),
    ...(byPhone.data ?? []),
    ...(byId.data ?? []),
    ...byCarMapped,
  ]) {
    if (!row) continue;
    if (!merged.has(row.id)) merged.set(row.id, row);
  }

  return {
    results: Array.from(merged.values()).slice(0, 5).map((c: any) => ({
      client_id: c.id,
      full_name: c.full_name,
      file_number: c.file_number,
      phone_number: c.phone_number,
      id_number: c.id_number,
    })),
  };
}

async function listClientPolicies(ctx: ToolContext, args: { client_id?: string }) {
  const clientId = args.client_id || ctx.defaultClientId;
  if (!clientId) {
    return { error: "no_client", message: "No client identified yet — call search_clients_smart first." };
  }

  // Verify the client belongs to this agent (defense in depth)
  const { data: client } = await ctx.supabase
    .from("clients")
    .select("id, full_name, agent_id")
    .eq("id", clientId)
    .eq("agent_id", ctx.agentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!client) {
    return { error: "not_found", message: "Client not found in this agent." };
  }

  const { data: policies } = await ctx.supabase
    .from("policies")
    .select(
      `id, group_id, policy_type_parent, policy_type_child,
       start_date, end_date, issue_date,
       insurance_price, payed_for_company, profit, cancelled,
       cars(car_number),
       insurance_companies(name, name_ar)`
    )
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .eq("skip_recalc", false)
    .order("end_date", { ascending: false, nullsFirst: false });

  // Total paid per policy from policy_payments
  const policyIds = (policies ?? []).map((p: any) => p.id);
  let paidByPolicy: Record<string, number> = {};
  if (policyIds.length > 0) {
    const { data: pays } = await ctx.supabase
      .from("policy_payments")
      .select("policy_id, amount, locked, source, refused")
      .in("policy_id", policyIds);
    for (const p of pays ?? []) {
      if (p.locked || p.source === "system" || p.refused) continue;
      paidByPolicy[p.policy_id] = (paidByPolicy[p.policy_id] ?? 0) + Number(p.amount ?? 0);
    }
  }

  return {
    client: { client_id: client.id, full_name: client.full_name },
    policies: (policies ?? []).map((p: any) => {
      const paid = paidByPolicy[p.id] ?? 0;
      const price = Number(p.insurance_price ?? 0);
      const status = p.cancelled
        ? "cancelled"
        : p.end_date && new Date(p.end_date) < new Date()
          ? "expired"
          : "active";
      return {
        policy_id: p.id,
        group_id: p.group_id, // null for single, uuid for package member
        type: p.policy_type_parent,
        sub_type: p.policy_type_child,
        company: p.insurance_companies?.name_ar || p.insurance_companies?.name || null,
        car_number: p.cars?.car_number || null,
        start_date: p.start_date,
        end_date: p.end_date,
        insurance_price: price,
        paid_amount: paid,
        remaining_amount: Math.max(0, price - paid),
        status,
      };
    }),
  };
}

async function getInvoiceUrl(ctx: ToolContext, args: { policy_ids: string[] }) {
  const policyIds = (args.policy_ids ?? []).filter(Boolean);
  if (policyIds.length === 0) {
    return { error: "empty", message: "No policy_ids provided." };
  }

  // Verify all policies belong to this agent (the policies table joins
  // through clients.agent_id, but cheapest check: compare each)
  const { data: rows } = await ctx.supabase
    .from("policies")
    .select("id, client_id, clients(agent_id)")
    .in("id", policyIds);
  for (const r of rows ?? []) {
    if ((r as any).clients?.agent_id !== ctx.agentId) {
      return { error: "forbidden", message: "Policy outside this agent." };
    }
  }

  // Call the existing invoice generator with skip_sms=true so it just
  // generates the HTML and returns the URL.
  const res = await fetch(`${ctx.supabaseUrl}/functions/v1/send-package-invoice-sms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ policy_ids: policyIds, skip_sms: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[whatsapp-tools] invoice gen failed:", data);
    return { error: "generation_failed", message: data?.error ?? "Unknown error" };
  }
  return {
    invoice_url: data.package_invoice_url ?? data.invoice_url ?? null,
    policy_ids: policyIds,
  };
}

async function lookupVehicle(ctx: ToolContext, args: { car_number: string }) {
  const carNumber = digitsOnly(args.car_number ?? "");
  if (!carNumber || carNumber.length < 6) {
    return {
      found: false,
      car_number: carNumber,
      message: "رقم السيارة قصير. لازم 7 أو 8 أرقام.",
    };
  }
  try {
    const res = await fetch(`${ctx.supabaseUrl}/functions/v1/fetch-vehicle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ car_number: carNumber }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success || !data?.found) {
      return {
        found: false,
        car_number: carNumber,
        message: data?.error ?? "ما لقينا بيانات لهالرقم بقاعدة البيانات الحكومية.",
      };
    }
    return {
      found: true,
      car_number: data.data.car_number,
      manufacturer: data.data.manufacturer_name,
      model: data.data.model,
      year: data.data.year,
      color: data.data.color,
      car_type: data.data.car_type,
      trim_level: data.data.trim_level,
    };
  } catch (err) {
    console.error("[whatsapp-tools] lookup_vehicle threw:", err);
    return {
      found: false,
      car_number: carNumber,
      message: "تعذّر الوصول لقاعدة البيانات الحكومية حالياً.",
    };
  }
}

async function createCustomerRequest(
  ctx: ToolContext,
  args: { request_type: "quote" | "accident" | "general"; title: string; content: string },
) {
  const { error, data } = await ctx.supabase
    .from("customer_requests")
    .insert({
      agent_id: ctx.agentId,
      branch_id: ctx.branchId,
      client_id: ctx.defaultClientId,
      phone_number: ctx.customerPhone,
      request_type: args.request_type,
      title: args.title.slice(0, 200),
      content: args.content.slice(0, 5000),
      status: "open",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[whatsapp-tools] create_customer_request failed:", error);
    return { error: "insert_failed", message: error.message };
  }
  return { request_id: data.id, status: "open" };
}

/** Dispatch a tool call to its implementation. */
export async function executeTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<unknown> {
  try {
    switch (name) {
      case "search_clients_smart":
        return await searchClientsSmart(ctx, args);
      case "list_client_policies":
        return await listClientPolicies(ctx, args);
      case "get_invoice_url":
        return await getInvoiceUrl(ctx, args);
      case "lookup_vehicle":
        return await lookupVehicle(ctx, args);
      case "create_customer_request":
        return await createCustomerRequest(ctx, args);
      default:
        return { error: "unknown_tool", message: `Tool ${name} is not implemented.` };
    }
  } catch (err: any) {
    console.error(`[whatsapp-tools] ${name} threw:`, err);
    return { error: "exception", message: String(err?.message ?? err) };
  }
}
