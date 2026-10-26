-- referrals.sql — نظام الإحالة: كل متجر له رمز، ومن يجلب محلًا جديدًا يربح شهرًا مجانيًا
--
-- شغّله مرة واحدة من Supabase ← SQL Editor بعد policies.sql و rates.sql. يمكن إعادة تشغيله دون ضرر.
-- store_ref_codes: رمز الإحالة لكل متجر (6 أحرف وأرقام). يُنشأ عند أول طلب له بالدالة referral_code.
-- store_referrals: من أحال من. يضيفها المزود عند إنشاء المتجر الجديد، ويمنح المكافأة بنفسه
--   (مثلًا بعد أن يدفع المتجر الجديد)، حتى لا تُستغل الإحالات.

-- ===== الرموز =====
create table if not exists public.store_ref_codes (
    store_id uuid primary key,
    code text not null unique,
    created_at timestamptz not null default now(),
    constraint store_ref_codes_format check (code ~ '^[A-Z0-9]{6}$')
);
alter table public.store_ref_codes enable row level security;

drop policy if exists ref_codes_select on public.store_ref_codes;
create policy ref_codes_select on public.store_ref_codes
    for select to authenticated
    using (public.is_store_member(store_id) or public.is_provider());
-- لا إضافة ولا تعديل من المتصفح: الرمز يُنشأ بالدالة فقط

-- رمز المتجر (يُنشأ أول مرة). لعضو المتجر أو المزود فقط
create or replace function public.referral_code(p_store uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
    c text;
    alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- بدون O و 0 و I و 1 حتى لا تختلط
    i int;
begin
    if not (public.is_store_member(p_store) or public.is_provider()) then
        raise exception 'not allowed';
    end if;
    select code into c from store_ref_codes where store_id = p_store;
    if c is not null then
        return c;
    end if;
    loop
        c := '';
        for i in 1..6 loop
            c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
        end loop;
        begin
            insert into store_ref_codes (store_id, code) values (p_store, c);
            return c;
        exception when unique_violation then
            -- متجر آخر أنشأ رمزه معًا، أو تكرر الرمز: نقرأ رمز المتجر أو نجرب رمزًا آخر
            select code into c from store_ref_codes where store_id = p_store;
            if c is not null then
                return c;
            end if;
        end;
    end loop;
end;
$$;

revoke all on function public.referral_code(uuid) from public, anon;
grant execute on function public.referral_code(uuid) to authenticated;

-- ===== الإحالات =====
create table if not exists public.store_referrals (
    id uuid primary key default gen_random_uuid(),
    referrer_store uuid not null,
    referred_store uuid not null unique, -- المتجر يُحال مرة واحدة فقط
    referred_name text not null default '',
    status text not null default 'pending',
    reward_months int not null default 0,
    created_at timestamptz not null default now(),
    rewarded_at timestamptz,
    constraint store_referrals_self check (referrer_store <> referred_store),
    constraint store_referrals_status check (status in ('pending', 'rewarded', 'rejected')),
    constraint store_referrals_months check (reward_months between 0 and 12),
    constraint store_referrals_name check (char_length(referred_name) <= 120)
);
create index if not exists store_referrals_referrer on public.store_referrals (referrer_store, created_at desc);
alter table public.store_referrals enable row level security;

drop policy if exists referrals_select on public.store_referrals;
drop policy if exists referrals_insert on public.store_referrals;
drop policy if exists referrals_update on public.store_referrals;
drop policy if exists referrals_delete on public.store_referrals;

-- المتجر يرى من أحالهم هو، والمزود يرى الكل ويتحكم بها
create policy referrals_select on public.store_referrals
    for select to authenticated
    using (public.is_store_member(referrer_store) or public.is_provider());

create policy referrals_insert on public.store_referrals
    for insert to authenticated
    with check (public.is_provider());

create policy referrals_update on public.store_referrals
    for update to authenticated
    using (public.is_provider())
    with check (public.is_provider());

create policy referrals_delete on public.store_referrals
    for delete to authenticated
    using (public.is_provider());
