// @ts-nocheck
// provider-admin — عمليات لوحة المزود. كل طلب يتحقق أولًا أن المتصل موجود في جدول providers
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

// خطأ يظهر للمزود كما هو
class UserError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

const INTERNAL_EMAIL_DOMAIN = "users.storeapp.io";
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const DELETED = "__deleted__";
// مدة الحظر عند تعطيل حساب (عمليًا دائم حتى يُفعَّل)
const BAN_FOREVER = "876000h";

function today() {
    return new Date().toISOString().slice(0, 10);
}

// نفس قاعدة store_is_active: تنبيه قبل 7 أيام، ومهلة 3 أيام بعد الانتهاء، ثم إيقاف
function statusOf(sub) {
    if (!sub) return { status: "none", daysLeft: null };
    const daysLeft = sub.expires_at
        ? Math.round((Date.parse(sub.expires_at) - Date.parse(today())) / 86400000)
        : null;
    if (sub.suspended) return { status: "suspended", daysLeft };
    if (daysLeft === null) return { status: "active", daysLeft };
    if (daysLeft > 7) return { status: "active", daysLeft };
    if (daysLeft >= 0) return { status: "expiring", daysLeft };
    if (daysLeft >= -3) return { status: "grace", daysLeft };
    return { status: "expired", daysLeft };
}

function addMonths(dateStr: string, months: number) {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + months);
    // 31 كانون الثاني + شهر = آخر شباط، لا 3 آذار
    if (d.getUTCDate() < day) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
}

function str(v: unknown) {
    return String(v ?? "").trim();
}

function validDate(v: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
}

function parseSettings(value: unknown) {
    try {
        const v = typeof value === "string" ? JSON.parse(value) : value;
        return v && typeof v === "object" ? v : {};
    } catch {
        return {};
    }
}

async function listAllUsers(admin) {
    const users = [];
    for (let page = 1; page < 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 1000) break;
    }
    return users;
}

function checkNewAccount(username: string, password: string, name: string) {
    if (!USERNAME_RE.test(username)) {
        throw new UserError("اسم المستخدم: أحرف إنجليزية وأرقام و . _ - فقط (3 إلى 30 حرفًا)");
    }
    if (password.length < 8) throw new UserError("كلمة المرور 8 أحرف على الأقل");
    if (!name) throw new UserError("أدخل الاسم الظاهر");
}

async function ensureUsernameFree(admin, username: string) {
    const { data } = await admin.from("store_members").select("user_id").eq("username", username).maybeSingle();
    if (data) throw new UserError("اسم المستخدم مستخدم بالفعل", 409);
}

// ينشئ حساب دخول ويربطه بالمتجر؛ يتراجع عن الحساب إذا فشل الربط
async function createMember(admin, storeId: string, username: string, password: string, name: string, role: string) {
    const { data: created, error } = await admin.auth.admin.createUser({
        email: `${username}@${INTERNAL_EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { username, name },
    });
    if (error || !created.user) throw new UserError(error?.message ?? "تعذر إنشاء الحساب");

    const { error: memberErr } = await admin.from("store_members").insert({
        store_id: storeId,
        user_id: created.user.id,
        role,
        display_name: name,
        username,
    });
    if (memberErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new UserError("تعذر ربط الحساب بالمتجر", 500);
    }
    return created.user.id;
}

async function memberOf(admin, userId: string) {
    const { data } = await admin.from("store_members").select("store_id, role, username").eq("user_id", userId).maybeSingle();
    if (!data) throw new UserError("الحساب غير موجود", 404);
    return data;
}

// ===== العمليات =====
const actions = {
    // كل المتاجر مع اشتراكاتها وحساباتها وآخر نشاط
    async overview(admin) {
        const [members, subs, stats, settings, users] = await Promise.all([
            admin.from("store_members").select("store_id, user_id, role, display_name, username"),
            admin.from("store_subscriptions").select("*"),
            admin.rpc("provider_store_stats"),
            admin.from("kv_store").select("store_id, value").eq("key", "storeSettings"),
            listAllUsers(admin),
        ]);
        for (const r of [members, subs, stats, settings]) if (r.error) throw r.error;

        const userById = new Map(users.map(u => [u.id, u]));
        const stores = new Map();
        const store = (id: string) => {
            if (!stores.has(id)) stores.set(id, { store_id: id, name: "", members: [], subscription: null, last_activity: null, rows_count: 0 });
            return stores.get(id);
        };

        settings.data.forEach(r => {
            const s = parseSettings(r.value);
            const st = store(r.store_id);
            st.name = st.name || str(s.name);
            st.phone = str(s.phone);
        });
        subs.data.forEach(s => {
            const st = store(s.store_id);
            st.subscription = s;
            if (s.store_name) st.name = s.store_name;
        });
        stats.data.forEach(s => {
            const st = store(s.store_id);
            st.last_activity = s.last_activity;
            st.rows_count = s.rows_count;
        });
        members.data.forEach(m => {
            const u = userById.get(m.user_id);
            const bannedUntil = u?.banned_until ? Date.parse(u.banned_until) : 0;
            store(m.store_id).members.push({
                user_id: m.user_id,
                username: m.username,
                display_name: m.display_name,
                role: m.role,
                last_sign_in_at: u?.last_sign_in_at ?? null,
                disabled: bannedUntil > Date.now(),
            });
        });

        const list = [...stores.values()].map(st => ({ ...st, ...statusOf(st.subscription) }));
        list.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
        return { stores: list, today: today() };
    },

    // متجر جديد مع حساب مديره واشتراكه
    async create_store(admin, b) {
        const storeName = str(b.storeName);
        const username = str(b.adminUsername).toLowerCase();
        const password = String(b.adminPassword ?? "");
        const adminName = str(b.adminName);
        const expiresAt = str(b.expiresAt);
        if (!storeName) throw new UserError("أدخل اسم المتجر");
        checkNewAccount(username, password, adminName);
        if (expiresAt && !validDate(expiresAt)) throw new UserError("تاريخ الانتهاء غير صالح");
        await ensureUsernameFree(admin, username);

        const storeId = crypto.randomUUID();
        const userId = await createMember(admin, storeId, username, password, adminName, "admin");

        const { error: subErr } = await admin.from("store_subscriptions").insert({
            store_id: storeId,
            store_name: storeName,
            owner_phone: str(b.ownerPhone),
            plan: str(b.plan) || "شهري",
            price: Number(b.price) || 0,
            starts_at: today(),
            expires_at: expiresAt || null,
            notes: str(b.notes),
        });
        const { error: kvErr } = await admin.from("kv_store").insert({
            store_id: storeId,
            key: "storeSettings",
            value: JSON.stringify({ name: storeName, phone: str(b.ownerPhone) }),
            updated_at: new Date().toISOString(),
        });
        if (subErr || kvErr) {
            await admin.from("store_members").delete().eq("user_id", userId);
            await admin.auth.admin.deleteUser(userId);
            await admin.from("store_subscriptions").delete().eq("store_id", storeId);
            await admin.from("kv_store").delete().eq("store_id", storeId);
            throw new UserError("تعذر إنشاء المتجر", 500);
        }
        return { ok: true, store_id: storeId };
    },

    // تعديل بيانات الاشتراك
    async update_subscription(admin, b) {
        const storeId = str(b.storeId);
        const expiresAt = str(b.expiresAt);
        if (!storeId) throw new UserError("المتجر غير محدد");
        if (expiresAt && !validDate(expiresAt)) throw new UserError("تاريخ الانتهاء غير صالح");

        const { error } = await admin.from("store_subscriptions").upsert({
            store_id: storeId,
            store_name: str(b.storeName),
            owner_phone: str(b.ownerPhone),
            plan: str(b.plan) || "شهري",
            price: Number(b.price) || 0,
            expires_at: expiresAt || null,
            suspended: !!b.suspended,
            notes: str(b.notes),
            updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return { ok: true };
    },

    // تمديد الاشتراك عددًا من الأشهر من تاريخ انتهائه، أو من اليوم إن كان منتهيًا
    async extend(admin, b) {
        const storeId = str(b.storeId);
        const months = Math.floor(Number(b.months));
        if (!storeId) throw new UserError("المتجر غير محدد");
        if (!(months >= 1 && months <= 36)) throw new UserError("عدد الأشهر من 1 إلى 36");

        const { data: sub } = await admin.from("store_subscriptions").select("*").eq("store_id", storeId).maybeSingle();
        const base = sub?.expires_at && sub.expires_at > today() ? sub.expires_at : today();
        const expiresAt = addMonths(base, months);
        const { error } = await admin.from("store_subscriptions").upsert({
            ...(sub ?? { store_id: storeId }),
            expires_at: expiresAt,
            suspended: false,
            updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return { ok: true, expires_at: expiresAt };
    },

    async add_member(admin, b) {
        const storeId = str(b.storeId);
        const username = str(b.username).toLowerCase();
        const password = String(b.password ?? "");
        const name = str(b.name);
        const role = b.role === "admin" ? "admin" : "employee";
        if (!storeId) throw new UserError("المتجر غير محدد");
        checkNewAccount(username, password, name);
        await ensureUsernameFree(admin, username);
        await createMember(admin, storeId, username, password, name, role);
        return { ok: true };
    },

    async reset_password(admin, b) {
        const userId = str(b.userId);
        const password = String(b.password ?? "");
        if (password.length < 8) throw new UserError("كلمة المرور 8 أحرف على الأقل");
        await memberOf(admin, userId);
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) throw new UserError("تعذر تغيير كلمة المرور");
        return { ok: true };
    },

    // تعطيل حساب يمنع دخوله وتجديد جلسته؛ التفعيل يعيده كما كان
    async set_disabled(admin, b) {
        const userId = str(b.userId);
        await memberOf(admin, userId);
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: b.disabled ? BAN_FOREVER : "none" });
        if (error) throw new UserError("تعذر تغيير حالة الحساب");
        return { ok: true };
    },

    async set_role(admin, b) {
        const userId = str(b.userId);
        const role = b.role === "admin" ? "admin" : "employee";
        const m = await memberOf(admin, userId);
        if (m.role === "admin" && role !== "admin") await ensureAnotherAdmin(admin, m.store_id, userId);
        const { error } = await admin.from("store_members").update({ role }).eq("user_id", userId);
        if (error) throw error;
        return { ok: true };
    },

    async delete_member(admin, b) {
        const userId = str(b.userId);
        const m = await memberOf(admin, userId);
        if (m.role === "admin") await ensureAnotherAdmin(admin, m.store_id, userId);
        const { error } = await admin.from("store_members").delete().eq("user_id", userId);
        if (error) throw error;
        await admin.auth.admin.deleteUser(userId);
        return { ok: true };
    },

    // نسخة احتياطية بنفس صيغة الإعدادات، يمكن استعادتها من صفحة الإعدادات في المتجر
    async export_store(admin, b) {
        const storeId = str(b.storeId);
        if (!storeId) throw new UserError("المتجر غير محدد");
        const { data, error } = await admin.from("kv_store").select("key, value").eq("store_id", storeId);
        if (error) throw error;

        const out = {};
        data.forEach(r => {
            const value = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
            if (value !== DELETED && !r.key.startsWith("scan-")) out[r.key] = value;
        });
        const settings = parseSettings(out.storeSettings);
        return {
            app: "store-backup",
            version: 3,
            storeId,
            storeName: str(settings.name),
            date: new Date().toISOString(),
            data: out,
        };
    },
};

// لا يُحذف أو يُخفَّض آخر مدير في المتجر، حتى لا يبقى المتجر بلا من يديره
async function ensureAnotherAdmin(admin, storeId: string, userId: string) {
    const { data } = await admin.from("store_members").select("user_id").eq("store_id", storeId).eq("role", "admin");
    if (!(data ?? []).some(m => m.user_id !== userId)) {
        throw new UserError("هذا آخر مدير في المتجر. أضف مديرًا آخر أولًا");
    }
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "الطريقة غير مسموحة" }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
    });

    // من المتصل؟ وهل هو مزود؟
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "يجب تسجيل الدخول" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "يجب تسجيل الدخول" }, 401);

    const { data: provider } = await admin.from("providers").select("user_id").eq("user_id", userData.user.id).maybeSingle();
    if (!provider) return json({ error: "غير مصرح" }, 403);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: "بيانات غير صالحة" }, 400);
    }

    const name = String(body.action ?? "");
    const action = Object.hasOwn(actions, name) ? actions[name] : null;
    if (!action) return json({ error: "عملية غير معروفة" }, 400);

    try {
        return json(await action(admin, body));
    } catch (err) {
        if (err instanceof UserError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: "حدث خطأ في الخادم" }, 500);
    }
});
