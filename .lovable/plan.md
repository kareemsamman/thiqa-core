
## Problem

The Deno type-checker is rejecting almost every edge function in `supabase/functions/`. Until these are fixed, **no edge function can deploy** — including `setup-oauth-user` (the Google registration fix from the previous turn) and `register-agent`. So even though the OAuth/JWT change was correct, it never actually went live.

The errors fall into 5 root causes. None of them are caused by my last edit — they're pre-existing issues that the recent build pass started enforcing.

---

## Root Causes & Fixes

### 1. `npm:nodemailer@6.9.16` cannot be resolved

Affects: `register-agent`, `request-addon-purchase` (and likely `send-password-reset`, `test-platform-smtp`, `setup-oauth-user`).

```
error: Could not find a matching package for 'npm:nodemailer@6.9.16'
```

The Deno runtime in the build sandbox can't find the npm package. Two options:

- **(a)** Add `"nodeModulesDir": "auto"` to a `deno.json` in `supabase/functions/`, OR
- **(b)** Pin nodemailer via `https://esm.sh/nodemailer@6.9.16` instead of `npm:` specifier.

**Plan:** Switch to `esm.sh` import — it's the pattern already used for `@supabase/supabase-js` in these files and is the most stable choice for Supabase edge runtime (per the `edge-function-deploy-errors` guidance: "Prefer `npm:` specifiers over esm.sh for stability" — but here npm is the one failing, so esm.sh is the working path).

Files to update (replace `import nodemailer from "npm:nodemailer@6.9.16"` with `import nodemailer from "https://esm.sh/nodemailer@6.9.16"`):
- `supabase/functions/register-agent/index.ts`
- `supabase/functions/request-addon-purchase/index.ts`
- Search for any other `npm:nodemailer` imports and update them too.

### 2. `agentId: string | null` passed where `string` required

Affects: `generate-broker-report`, `generate-client-payments-invoice`, `send-bulk-debt-sms`, `send-manual-reminder`, and a few others.

`resolveAgentId()` returns `string | null`, but `resolveSmsSettings()`, `checkUsageLimit()`, and `logUsage()` all require `string`.

**Plan:** In each affected function, add a guard right after `resolveAgentId()`:

```ts
const agentId = await resolveAgentId(supabase, user.id);
if (!agentId) {
  return new Response(
    JSON.stringify({ error: "لا يوجد وكيل مرتبط بهذا الحساب" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

This is the safest fix — it surfaces a clear error instead of crashing later. Files: `generate-broker-report`, `generate-client-payments-invoice`, `send-bulk-debt-sms`, `send-manual-reminder`, plus any others surfaced by re-running the type-check.

### 3. `send-invoice-sms` — `smsSettingsData` is possibly null

```ts
const cleanPhone = normalizePhoneFor(smsSettingsData.provider, …)  // smsSettingsData may be null
```

**Plan:** Right after the `resolveSmsSettings()` call in `send-invoice-sms/index.ts`, add:

```ts
if (!smsSettingsData || !smsSettingsData.is_enabled) {
  return new Response(
    JSON.stringify({ error: "خدمة الرسائل غير مفعلة" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

### 4. `send-invoice-sms` — `bunnyCdnUrl` not in scope

In `buildAbInvoiceHtml()` (line 480), the function references `bunnyCdnUrl`, but that variable is declared inside the `Deno.serve` handler and isn't passed in.

**Plan:** Add `bunnyCdnUrl: string` as a parameter to `buildAbInvoiceHtml()` and pass it from the call site. (Already in scope at the call site.)

### 5. Incomplete `AgentBranding` literals

In `generate-payment-receipt/index.ts:147` and `send-invoice-sms/index.ts:436`, default-parameter values for `branding` only set 4 fields, but `AgentBranding` requires 13.

```ts
branding: AgentBranding = { companyName: '…', companyNameEn: '', logoUrl: null, siteDescription: '' }
```

**Plan:** Either:
- Export `DEFAULT_BRANDING` from `_shared/agent-branding.ts` and use it as the default, OR
- Change the parameter type to `Partial<AgentBranding>` and merge with defaults inside the function.

I'll go with **exporting `DEFAULT_BRANDING`** — it's a one-line export change and the call sites become `branding: AgentBranding = DEFAULT_BRANDING`.

---

## Order of Operations

1. Update `_shared/agent-branding.ts` to export `DEFAULT_BRANDING`.
2. Fix the 2 `branding` default-param sites (`generate-payment-receipt`, `send-invoice-sms`).
3. Add `null` guards for `agentId` in: `generate-broker-report`, `generate-client-payments-invoice`, `send-bulk-debt-sms`, `send-manual-reminder` (and any others surfaced).
4. Add the `smsSettingsData` null guard in `send-invoice-sms`.
5. Pass `bunnyCdnUrl` into `buildAbInvoiceHtml`.
6. Swap `npm:nodemailer@6.9.16` → `https://esm.sh/nodemailer@6.9.16` in `register-agent`, `request-addon-purchase`, and any other files using the `npm:` form.
7. After deploy, verify `setup-oauth-user` boots cleanly so the original Google-registration fix actually takes effect.

## Risk

All changes are additive guards or import-source swaps — no behavior changes for the success path of any function. The only user-visible new behavior is that some functions will now return an explicit `400` error message instead of crashing with a 500 when an agent has no `agent_id`.
