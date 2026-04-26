import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller identity using getClaims
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) throw new Error("Unauthorized");

    const callerId = claimsData.claims.sub;

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { user_id, new_password, confirm_email } = await req.json();

    if (!user_id) throw new Error("Missing user_id");

    // Authorization model:
    //   - Super admin: can reset anyone (existing behavior).
    //   - Agent admin: can reset workers in their own agent only —
    //     same agent_id, target user must have role='admin' or 'worker'
    //     in user_roles. Lets owners issue a new password to a member
    //     of their team without going through Thiqa support.
    const { data: isSA } = await adminClient.rpc("is_super_admin", { _user_id: callerId });
    if (!isSA) {
      // Caller must be admin in the same agent as the target user.
      const [{ data: callerRow }, { data: targetRow }] = await Promise.all([
        adminClient
          .from("profiles")
          .select("agent_id")
          .eq("id", callerId)
          .maybeSingle(),
        adminClient
          .from("profiles")
          .select("agent_id")
          .eq("id", user_id)
          .maybeSingle(),
      ]);
      if (!callerRow?.agent_id || callerRow.agent_id !== targetRow?.agent_id) {
        throw new Error("غير مصرح. يمكنك تعديل كلمة مرور المستخدمين في وكالتك فقط.");
      }
      const { data: callerRole } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .eq("agent_id", callerRow.agent_id)
        .eq("role", "admin")
        .maybeSingle();
      if (!callerRole) {
        throw new Error("صلاحيات غير كافية. يجب أن تكون مديراً.");
      }
      // Don't let an admin reset another admin's password — that's a
      // privilege-escalation footgun. Super admins keep the override.
      if (callerId !== user_id) {
        const { data: targetRole } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", user_id)
          .eq("agent_id", callerRow.agent_id)
          .maybeSingle();
        if (targetRole?.role === "admin") {
          throw new Error("لا يمكن تغيير كلمة مرور مدير آخر. تواصل مع دعم ثقة.");
        }
      }
    }

    // Confirm email only
    if (confirm_email) {
      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        email_confirm: true,
      });
      if (error) throw error;

      // Also update profiles table
      await adminClient.from("profiles").update({ email_confirmed: true }).eq("id", user_id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!new_password) throw new Error("Missing new_password");

    if (new_password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password,
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Update password error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
