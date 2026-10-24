-- rates.sql — أسعار الصرف المركزية: المزود يسجّل سعر الأسواق مرة واحدة فيصل لكل المتاجر تلقائيًا
--
-- شغّله مرة واحدة من Supabase ← SQL Editor بعد provider.sql. يمكن إعادة تشغيله دون ضرر.
-- الأسعار لكل دولار واحد، بنفس شكل صفحة سعر الصرف في البرنامج:
--   { "baghdad": { "buy": 1685, "sell": 1690 }, "erbil": {...}, "basra": {...}, "official": { "buy": 1310, "sell": null } }

-- هل المستخدم الحالي مزود؟ (security definer لأن جدول providers لا يقرؤه أحد غير مفتاح الخدمة)
create or replace function public.is_provider()
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (select 1 from providers where user_id = auth.uid());
$$;

create table if not exists public.market_rates (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    rates jsonb not null,
    note text not null default '',
    created_by uuid default auth.uid(),
    constraint market_rates_shape check (jsonb_typeof(rates) = 'object' and length(rates::text) < 2000),
    constraint market_rates_note check (char_length(note) <= 200)
);
create index if not exists market_rates_created on public.market_rates (created_at desc);
alter table public.market_rates enable row level security;

drop policy if exists rates_select on public.market_rates;
drop policy if exists rates_insert on public.market_rates;
drop policy if exists rates_delete on public.market_rates;

-- كل مستخدم مسجّل (موظفو المتاجر والمزود) يقرأ الأسعار
create policy rates_select on public.market_rates
    for select to authenticated
    using (true);

-- التسجيل والحذف للمزود فقط
create policy rates_insert on public.market_rates
    for insert to authenticated
    with check (public.is_provider());

create policy rates_delete on public.market_rates
    for delete to authenticated
    using (public.is_provider());

-- وقت التسجيل من الخادم دائمًا، لا من جهاز المزود
create or replace function public.market_rates_stamp()
returns trigger
language plpgsql
as $$
begin
    new.created_at := now();
    new.created_by := auth.uid();
    return new;
end;
$$;

drop trigger if exists market_rates_stamp on public.market_rates;
create trigger market_rates_stamp
    before insert on public.market_rates
    for each row execute function public.market_rates_stamp();
