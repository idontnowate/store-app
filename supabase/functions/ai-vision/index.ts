// @ts-nocheck
// ai-vision — الباقة الذكية: قراءة فاتورة مورد من صورتها، أو بيانات منتج من صورته
//
// يحتاج أسرار الدالة: ANTHROPIC_API_KEY (من console.anthropic.com)، و SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY (موجودان تلقائيًا).
// كل طلب: نتحقق من الدخول، والمتجر، والاشتراك، وأن الباقة مفعّلة ولم يُتجاوز حدها الشهري،
// ثم نرسل الصورة إلى Claude ونحفظ الرموز والكلفة في ai_usage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@0.136.0";

const MODEL = "claude-opus-5-5";

// الأسعار بالدولار لكل مليون رمز (أسعار Anthropic). الطلب قد يُكمَل على نموذج بديل إن رفضه الأول
const PRICES = {
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
    "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
    "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

const MAX_IMAGE_BASE64 = 7_000_000; // نحو 5MB
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];
const LIMIT_FIELD = { invoice: "invoice_limit", product: "product_limit" };

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

class UserError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = "") {
        super(message);
        this.status = status;
        this.code = code;
    }
}

// ===== الكلفة =====
function costOf(model: string, usage) {
    const p = PRICES[model] ?? PRICES[MODEL];
    const input = usage?.input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    const cacheRead = usage?.cache_read_input_tokens ?? 0;
    const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
    const usd = (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.input * 1.25) / 1_000_000;
    return { input, output, cacheRead, cacheWrite, usd: Math.round(usd * 1_000_000) / 1_000_000 };
}

// ===== شكل الرد المطلوب من Claude =====
const INVOICE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["supplier", "invoice_number", "date", "currency", "items", "total", "notes"],
    properties: {
        supplier: { type: "string" },
        invoice_number: { type: "string" },
        date: { type: "string" },
        currency: { type: "string", enum: ["IQD", "USD", "unknown"] },
        items: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "barcode", "qty", "unit_cost", "line_total", "product_id", "confidence"],
                properties: {
                    name: { type: "string" },
                    barcode: { type: "string" },
                    qty: { type: "number" },
                    unit_cost: { type: "number" },
                    line_total: { type: "number" },
                    product_id: { type: "string" },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                },
            },
        },
        total: { type: "number" },
        notes: { type: "string" },
    },
};

const PRODUCT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["name", "category", "barcode", "brand", "description"],
    properties: {
        name: { type: "string" },
        category: { type: "string" },
        barcode: { type: "string" },
        brand: { type: "string" },
        description: { type: "string" },
    },
};

const INVOICE_SYSTEM = `You read photos of supplier purchase invoices for small shops in Iraq and return their contents as data.

The invoice may be printed or handwritten, in Arabic, Kurdish or English, and may use Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) or Eastern separators (٬ ٫). Return every number as a plain number.
Amounts are usually in Iraqi dinars; prices written like "15" or "15 ألف" next to dinar totals usually mean 15,000. Set currency to "USD" only when the invoice is clearly in dollars ($, دولار), "unknown" if you cannot tell.

For each line item: name as written (fix obvious spelling only), barcode only if printed on the invoice (else ""), qty, unit_cost, line_total. If unit_cost is missing but line_total and qty are present, compute it. Skip totals, discounts, taxes and empty rows.
Match each item to the shop's product list when it is clearly the same product (same item, allowing different spelling, abbreviations or word order) and put its id in product_id; otherwise product_id is "". Never guess a match between different sizes, models or capacities.
confidence: "high" when the line is clearly readable, "medium" if one value was hard to read, "low" if you are unsure of the quantity or price.
date as YYYY-MM-DD if written, else "". total is the invoice's final total as written (0 if none). notes: one short Arabic sentence about anything the shop should double-check, or "".`;

const PRODUCT_SYSTEM = `You look at a photo of a product in a small shop in Iraq and suggest how to add it to the shop's inventory.

name: a short, clear Arabic product name as a shopper would search for it, keeping brand, model and size/capacity (e.g. "شاحن سامسونج 25 واط", "حليب المراعي 1 لتر"). Keep English model names as written.
category: choose the best fitting category from the shop's existing categories when one fits; otherwise a short new Arabic category.
barcode: the digits under the barcode if clearly visible in the photo, else "".
brand: the brand if visible, else "".
description: one short Arabic sentence for the online store (what it is and its key spec), no prices, no claims you cannot see.`;

function str(v: unknown, max = 200) {
    return String(v ?? "").trim().slice(0, max);
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "الطريقة غير مسموحة" }, 405);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
    });

    try {
        // ===== من المتصل، ومتجره =====
        const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) throw new UserError("يجب تسجيل الدخول", 401);
        const { data: userData, error: userErr } = await admin.auth.getUser(token);
        if (userErr || !userData.user) throw new UserError("يجب تسجيل الدخول", 401);
        const userId = userData.user.id;

        const { data: member } = await admin.from("store_members").select("store_id").eq("user_id", userId).maybeSingle();
        if (!member) throw new UserError("الحساب غير مرتبط بمتجر", 403);
        const storeId = member.store_id;

        let body: Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            throw new UserError("بيانات غير صالحة");
        }
        const action = str(body.action, 20);

        // ===== الباقة والحد الشهري =====
        const { data: plan } = await admin.from("store_ai_plans").select("*").eq("store_id", storeId).maybeSingle();
        const { data: monthStart } = await admin.rpc("ai_month_start");
        const used = {};
        for (const kind of ["invoice", "product"]) {
            const { count } = await admin.from("ai_usage")
                .select("id", { count: "exact", head: true })
                .eq("store_id", storeId).eq("kind", kind).eq("ok", true)
                .gte("created_at", monthStart);
            used[kind] = count ?? 0;
        }
        const status = {
            enabled: !!plan?.enabled,
            limits: { invoice: plan?.invoice_limit ?? 0, product: plan?.product_limit ?? 0 },
            used,
        };

        if (action === "status") return json(status);
        if (!(action in LIMIT_FIELD)) throw new UserError("عملية غير معروفة");

        if (!plan?.enabled) {
            throw new UserError("الباقة الذكية غير مفعّلة لهذا المتجر. تواصل مع المزود لتفعيلها", 403, "disabled");
        }
        const { data: active } = await admin.rpc("store_is_active", { sid: storeId });
        if (active === false) throw new UserError("اشتراك المتجر منتهٍ", 403, "expired");
        const limitError = () => new UserError(
            action === "invoice"
                ? `وصلت للحد الشهري لقراءة الفواتير (${status.limits.invoice}). تواصل مع المزود لزيادته`
                : `وصلت للحد الشهري لإضافة المنتجات بالصورة (${status.limits.product}). تواصل مع المزود لزيادته`,
            429, "limit");
        if (used[action] >= status.limits[action]) throw limitError();

        // ===== الصورة =====
        const image = String(body.image ?? "");
        const mediaType = str(body.mediaType, 20) || "image/jpeg";
        if (!image || image.length > MAX_IMAGE_BASE64 || !MEDIA_TYPES.includes(mediaType) || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) {
            throw new UserError("الصورة غير صالحة أو كبيرة جدًا");
        }

        // ===== حجز مكان الطلب ضمن الحد (ذريًا في قاعدة البيانات، حتى مع طلبات متزامنة) =====
        const { data: slot, error: slotErr } = await admin.rpc("ai_reserve", {
            p_store: storeId, p_user: userId, p_kind: action, p_limit: status.limits[action],
        });
        if (slotErr || !slot) throw new UserError("تعذر التحقق من حد الباقة، حاول مرة أخرى", 503, "busy");
        if (slot.status === "limit") throw limitError();
        if (slot.status === "hard") {
            throw new UserError("تجاوزت عدد المحاولات المسموح بها هذا الشهر بسبب صور لم تُقرأ. تواصل مع المزود", 429, "limit");
        }
        if (slot.status === "busy") throw new UserError("طلبات كثيرة خلال دقيقة، انتظر قليلًا ثم حاول", 429, "busy");
        const usageId = slot.id;
        // يُكمل سطر الاستخدام المحجوز بنتيجة الطلب
        const finishUsage = (fields) => admin.from("ai_usage").update(fields).eq("id", usageId);

        // ===== الطلب إلى Claude =====
        let system, schema, effort, prompt;
        if (action === "invoice") {
            const products = (Array.isArray(body.products) ? body.products : []).slice(0, 800)
                .map(p => ({ id: str(p?.id, 40), name: str(p?.name, 80), barcode: str(p?.barcode, 20) }))
                .filter(p => p.id && p.name);
            system = INVOICE_SYSTEM;
            schema = INVOICE_SCHEMA;
            effort = "medium";
            prompt = `The shop's product list (id, name, barcode), for matching:\n${JSON.stringify(products)}\n\nRead the invoice in the photo.`;
        } else {
            const categories = (Array.isArray(body.categories) ? body.categories : []).slice(0, 100).map(c => str(c, 40)).filter(Boolean);
            system = PRODUCT_SYSTEM;
            schema = PRODUCT_SCHEMA;
            effort = "low";
            prompt = `The shop's existing categories: ${JSON.stringify(categories)}\n\nDescribe the product in the photo.`;
        }

        // المفتاح كما لُصق في الأسرار: نزيل المسافات والأسطر وعلامات التنصيص الزائدة
        const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
        if (!apiKey) throw new UserError("مفتاح الذكاء غير موجود عند المزود: أضف ANTHROPIC_API_KEY في أسرار الدوال", 502, "key_missing");
        if (!apiKey.startsWith("sk-ant-")) throw new UserError("مفتاح الذكاء عند المزود ليس مفتاح Anthropic API (يبدأ بـ sk-ant-)", 502, "key_format");
        const client = new Anthropic({ apiKey });
        let response;
        try {
            response = await client.beta.messages.create({
                model: MODEL,
                max_tokens: 16000,
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
                output_config: { effort, format: { type: "json_schema", schema } },
                system,
                messages: [{
                    role: "user",
                    content: [
                        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
                        { type: "text", text: prompt },
                    ],
                }],
            });
        } catch (err) {
            console.error("Claude API error:", err);
            // الطلب لم يصل للنموذج أو رُفض قبل المعالجة: لا كلفة، ويُسجَّل فاشلًا (يُحسب ضمن سقف المحاولات)
            await finishUsage({ model: MODEL, ok: false, error: "api" });
            const detail = String(err?.message ?? "");
            if (err instanceof Anthropic.AuthenticationError) throw new UserError("مفتاح الذكاء مرفوض من Anthropic: أنشئ مفتاحًا جديدًا من console.anthropic.com وضعه في ANTHROPIC_API_KEY", 502, "key");
            if (err instanceof Anthropic.PermissionDeniedError) throw new UserError("مفتاح الذكاء لا يملك صلاحية استخدام النموذج. تحقق من حساب Anthropic", 502, "permission");
            if (err instanceof Anthropic.RateLimitError) throw new UserError("الخدمة مشغولة الآن، حاول بعد دقيقة", 503, "busy");
            if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(detail)) {
                throw new UserError("رصيد الذكاء عند المزود انتهى. اشحن الرصيد من console.anthropic.com", 502, "credit");
            }
            if (err instanceof Anthropic.BadRequestError) throw new UserError("تعذرت قراءة الصورة. جرّب صورة أوضح", 400, "bad");
            throw new UserError("تعذر الاتصال بخدمة الذكاء، حاول مرة أخرى", 502, "api");
        }

        // الكلفة تُحسب ويُسجَّل الطلب حتى لو لم ينجح (المزود يدفعها)
        const model = response.model || MODEL;
        const cost = costOf(model, response.usage);
        let result = null;
        let error = "";
        if (response.stop_reason === "refusal") error = "refusal";
        else if (response.stop_reason === "max_tokens") error = "max_tokens";
        else {
            const text = (response.content ?? []).filter(b => b.type === "text").map(b => b.text).join("");
            try {
                result = JSON.parse(text);
            } catch {
                error = "bad_json";
            }
        }

        await finishUsage({
            model,
            input_tokens: cost.input,
            output_tokens: cost.output,
            cache_read_tokens: cost.cacheRead,
            cache_write_tokens: cost.cacheWrite,
            cost_usd: cost.usd,
            ok: !error,
            error,
        });

        if (error) throw new UserError("تعذرت قراءة الصورة. جرّب صورة أوضح وأقرب", 422, error);

        used[action] += 1;
        return json({
            result,
            remaining: Math.max(0, status.limits[action] - used[action]),
            limit: status.limits[action],
        });
    } catch (err) {
        if (err instanceof UserError) return json({ error: err.message, code: err.code }, err.status);
        console.error(err);
        return json({ error: "حدث خطأ في الخادم" }, 500);
    }
});
