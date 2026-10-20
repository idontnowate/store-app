// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

// البريد الداخلي للموظف: يُشتق من اسم المستخدم ولا يُرسل إليه أي بريد
const INTERNAL_EMAIL_DOMAIN = "users.storeapp.io";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "الطريقة غير مسموحة" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "يجب تسجيل الدخول" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // من المتصل؟
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "يجب تسجيل الدخول" }, 401);
    const caller = userData.user;

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: "بيانات غير صالحة" }, 400);
    }

    const storeId = String(body.storeId ?? "");
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    const role = body.role === "admin" ? "admin" : "employee";

    if (!storeId || !username || !name) return json({ error: "أكمل جميع الحقول" }, 400);
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        return json({ error: "اسم المستخدم: أحرف إنجليزية وأرقام و . _ - فقط (3 إلى 30 حرفًا)" }, 400);
    }
    if (password.length < 8) return json({ error: "كلمة المرور 8 أحرف على الأقل" }, 400);

    // هل المتصل مدير لهذا المتجر؟
    const { data: membership } = await admin
        .from("store_members")
        .select("role")
        .eq("store_id", storeId)
        .eq("user_id", caller.id)
        .maybeSingle();

    if (!membership || membership.role !== "admin") {
        return json({ error: "هذه العملية للمدير فقط" }, 403);
    }

    // اسم المستخدم فريد على مستوى النظام كله
    const { data: taken } = await admin
        .from("store_members")
        .select("user_id")
        .eq("username", username)
        .maybeSingle();

    if (taken) return json({ error: "اسم المستخدم مستخدم بالفعل" }, 409);

    // إنشاء حساب الدخول
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { username, name },
    });

    if (createErr || !created.user) {
        return json({ error: createErr?.message ?? "تعذر إنشاء الحساب" }, 400);
    }

    // ربط الحساب بالمتجر
    const { error: memberErr } = await admin.from("store_members").insert({
        store_id: storeId,
        user_id: created.user.id,
        role,
        display_name: name,
        username,
    });

    if (memberErr) {
        // نتراجع عن إنشاء الحساب حتى لا يبقى حساب يتيم
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: "تعذر ربط المستخدم بالمتجر" }, 500);
    }

    return json({ ok: true, username, role });
});