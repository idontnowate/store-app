-- ai.sql — الباقة الذكية: قراءة فاتورة المورد من صورتها، وإضافة منتج من صورته
--
-- شغّله مرة واحدة من Supabase ← SQL Editor بعد provider.sql و rates.sql. يمكن إعادة تشغيله دون ضرر.
-- store_ai_plans: الباقة لكل متجر (مفعّلة، سعرها، الحد الشهري). يتحكم بها المزود فقط.
-- ai_usage: كل طلب للذكاء مع رموزه وكلفته بالدولار. تكتبه دالة ai-vision فقط (بمفتاح الخدمة).
-- الشهر يُحسب بتوقيت بغداد.

-- ===== الباقة لكل متجر =====
create table if not exists public.store_ai_plans (
    store_id uuid primary key,
    enabled boolean not null default false,
    price_iqd numeric not null default 10000,
    invoice_limit int not null default 40,
    product_limit int not null default 200,
    notes text not null default '',
    updated_at timestamptz not null default now(),
    constraint store_ai_plans_limits check (invoice_limit >= 0 and product_limit >= 0 and price_iqd >= 0)
);
alter table public.store_ai_plans enable row level security;

drop policy if exists ai_plans_select on public.store_ai_plans;
drop policy if exists ai_plans_insert on public.store_ai_plans;
drop policy if exists ai_plans_update on public.store_ai_plans;
drop policy if exists ai_plans_delete on public.store_ai_plans;

-- المتجر يرى باقته (ليعرض المتبقي)، والمزود يرى الكل
create policy ai_plans_select on public.store_ai_plans
    for select to authenticated
    using (public.is_store_member(store_id) or public.is_provider());

create policy ai_plans_insert on public.store_ai_plans
    for insert to authenticated
    with check (public.is_provider());

create policy ai_plans_update on public.store_ai_plans
    for update to authenticated
    using (public.is_provider())
    with check (public.is_provider());

create policy ai_plans_delete on public.store_ai_plans
    for delete to authenticated
    using (public.is_provider());

-- ===== سجل الاستخدام والكلفة =====
create table if not exists public.ai_usage (
    id bigserial primary key,
    store_id uuid not null,
    user_id uuid,
    kind text not null,
    model text not null default '',
    input_tokens int not null default 0,
    output_tokens int not null default 0,
    cache_read_tokens int not null default 0,
    cache_write_tokens int not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    ok boolean not null default true,
    error text not null default '',
    created_at timestamptz not null default now(),
    constraint ai_usage_kind check (kind in ('invoice', 'product'))
);
create index if not exists ai_usage_store_created on public.ai_usage (store_id, created_at desc);
alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select on public.ai_usage;

-- لا قواعد إضافة أو تعديل: لا يكتب فيه إلا مفتاح الخدمة (دالة ai-vision)
create policy ai_usage_select on public.ai_usage
    for select to authenticated
    using (public.is_store_member(store_id) or public.is_provider());

-- بداية الشهر الحالي بتوقيت بغداد
create or replace function public.ai_month_start()
returns timestamptz
language sql stable
as $$
    select (date_trunc('month', now() at time zone 'Asia/Baghdad')) at time zone 'Asia/Baghdad';
$$;

-- ===== ملخص الشهر لكل متجر (للوحة المزود) =====
-- p_from: بداية الفترة؛ null = بداية الشهر الحالي
create or replace function public.provider_ai_summary(p_from timestamptz default null)
returns table (
    store_id uuid,
    enabled boolean,
    price_iqd numeric,
    invoice_limit int,
    product_limit int,
    invoices bigint,
    products bigint,
    failed bigint,
    input_tokens bigint,
    output_tokens bigint,
    cost_usd numeric
)
language plpgsql stable security definer set search_path = public
as $$
begin
    if not public.is_provider() then
        raise exception 'not a provider';
    end if;
    return query
    with u as (
        select a.store_id,
               count(*) filter (where a.ok and a.kind = 'invoice') as invoices,
               count(*) filter (where a.ok and a.kind = 'product') as products,
               count(*) filter (where not a.ok) as failed,
               coalesce(sum(a.input_tokens + a.cache_read_tokens + a.cache_write_tokens), 0)::bigint as input_tokens,
               coalesce(sum(a.output_tokens), 0)::bigint as output_tokens,
               coalesce(sum(a.cost_usd), 0) as cost_usd
        from ai_usage a
        where a.created_at >= coalesce(p_from, public.ai_month_start())
        group by a.store_id
    )
    select coalesce(p.store_id, u.store_id),
           coalesce(p.enabled, false),
           coalesce(p.price_iqd, 0),
           coalesce(p.invoice_limit, 0),
           coalesce(p.product_limit, 0),
           coalesce(u.invoices, 0),
           coalesce(u.products, 0),
           coalesce(u.failed, 0),
           coalesce(u.input_tokens, 0),
           coalesce(u.output_tokens, 0),
           coalesce(u.cost_usd, 0)
    from store_ai_plans p
    full outer join u on u.store_id = p.store_id;
end;
$$;
revoke all on function public.provider_ai_summary(timestamptz) from public, anon;
grant execute on function public.provider_ai_summary(timestamptz) to authenticated;

-- ===== حجز مكان الطلب قبل إرساله للذكاء (تستدعيه دالة ai-vision بمفتاح الخدمة فقط) =====
-- بقفل لكل متجر حتى لا تعبر طلبات متزامنة الحد معًا. يُحسب ضمن الحد:
--   - الناجح، والمحجوز الذي ما زال قيد التنفيذ (آخر 5 دقائق)
--   - والفاشل أيضًا ضمن سقف أعلى (الحد × 2 + 10)، لأن المزود يدفع كلفة الطلب الفاشل
--   - و 6 طلبات بالدقيقة للمتجر كحد أقصى
-- يعيد: { status: ok, id } | limit | hard | busy
create or replace function public.ai_reserve(p_store uuid, p_user uuid, p_kind text, p_limit int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    m timestamptz := public.ai_month_start();
    counted int;
    attempts int;
    recent int;
    v_id bigint;
begin
    perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_store::text));

    select count(*) filter (where ok or (error = 'pending' and created_at > now() - interval '5 minutes')),
           count(*)
      into counted, attempts
      from ai_usage
     where store_id = p_store and kind = p_kind and created_at >= m;

    if counted >= p_limit then
        return jsonb_build_object('status', 'limit');
    end if;
    if attempts >= p_limit * 2 + 10 then
        return jsonb_build_object('status', 'hard');
    end if;

    select count(*) into recent from ai_usage
     where store_id = p_store and created_at > now() - interval '1 minute';
    if recent >= 6 then
        return jsonb_build_object('status', 'busy');
    end if;

    insert into ai_usage (store_id, user_id, kind, ok, error)
    values (p_store, p_user, p_kind, false, 'pending')
    returning id into v_id;
    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

revoke all on function public.ai_reserve(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, uuid, text, int) to service_role;
