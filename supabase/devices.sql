-- devices.sql — الأجهزة المتصلة بكل متجر، وحد أعلى لعدد الأجهزة يتحكم به المزود
--
-- شغّله مرة واحدة من Supabase ← SQL Editor بعد policies.sql و rates.sql. يمكن إعادة تشغيله دون ضرر.
-- store_devices: كل جهاز (متصفح) يدخل للبرنامج: المستخدم، نوع الجهاز، أول دخول وآخر نشاط، وهل أوقفه المدير.
-- store_device_plans: الحد الأعلى لعدد أجهزة المتجر. المتجر الذي ليس له صف هنا بلا حد.
-- الجهاز الذي لم يُستخدم 30 يومًا، والجهاز الموقوف، لا يُحسبان من الحد.
-- المدير لا يُمنع من الدخول بسبب الحد (حتى يستطيع إيقاف جهاز قديم)، لكن جهازه يُحسب.

-- ===== حد الأجهزة لكل متجر =====
create table if not exists public.store_device_plans (
    store_id uuid primary key,
    device_limit int not null default 0, -- 0 = بلا حد
    updated_at timestamptz not null default now(),
    constraint store_device_plans_limit check (device_limit >= 0 and device_limit <= 1000)
);
alter table public.store_device_plans enable row level security;

drop policy if exists device_plans_select on public.store_device_plans;
drop policy if exists device_plans_insert on public.store_device_plans;
drop policy if exists device_plans_update on public.store_device_plans;
drop policy if exists device_plans_delete on public.store_device_plans;

-- المتجر يرى حده (ليعرض «3 من 5 أجهزة»)، والمزود يرى ويعدّل الكل
create policy device_plans_select on public.store_device_plans
    for select to authenticated
    using (public.is_store_member(store_id) or public.is_provider());

create policy device_plans_insert on public.store_device_plans
    for insert to authenticated
    with check (public.is_provider());

create policy device_plans_update on public.store_device_plans
    for update to authenticated
    using (public.is_provider())
    with check (public.is_provider());

create policy device_plans_delete on public.store_device_plans
    for delete to authenticated
    using (public.is_provider());

-- ===== الأجهزة =====
create table if not exists public.store_devices (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null,
    device_id text not null,
    user_id uuid,
    username text not null default '',
    display_name text not null default '',
    label text not null default '',      -- اسم يضعه المدير: «كاشير المحل»
    platform text not null default '',   -- أندرويد / آيفون / ويندوز ...
    browser text not null default '',
    model text not null default '',
    installed boolean not null default false,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    revoked boolean not null default false,
    revoked_at timestamptz,
    unique (store_id, device_id)
);
create index if not exists store_devices_store_idx on public.store_devices (store_id, last_seen desc);
alter table public.store_devices enable row level security;

drop policy if exists devices_select on public.store_devices;
drop policy if exists devices_update on public.store_devices;
drop policy if exists devices_delete on public.store_devices;

-- المدير يرى أجهزة متجره، والموظف يرى أجهزته فقط، والمزود يرى الكل
create policy devices_select on public.store_devices
    for select to authenticated
    using (public.is_store_admin(store_id) or user_id = auth.uid() or public.is_provider());

-- المدير يسمّي الجهاز ويوقفه أو يعيد السماح له. التسجيل نفسه عبر device_checkin فقط
create policy devices_update on public.store_devices
    for update to authenticated
    using (public.is_store_admin(store_id))
    with check (public.is_store_admin(store_id));

create policy devices_delete on public.store_devices
    for delete to authenticated
    using (public.is_store_admin(store_id));

-- المدير لا يغيّر إلا الاسم والإيقاف (لا يزوّر بيانات الجهاز أو المستخدم)
revoke update on public.store_devices from authenticated;
grant update (label, revoked, revoked_at) on public.store_devices to authenticated;
grant select, delete on public.store_devices to authenticated;

-- ===== تسجيل الجهاز وتحديث آخر نشاط =====
-- يعيد: ok | revoked (أوقفه المدير) | limit (وصل المتجر للحد) | not_member | bad
create or replace function public.device_checkin(
    p_store uuid,
    p_device text,
    p_platform text default '',
    p_browser text default '',
    p_model text default '',
    p_installed boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    m record;
    d_found boolean;
    d_revoked boolean;
    d_last timestamptz;
    lim int := 0;
    used int := 0;
    stale boolean;
begin
    select role, coalesce(username, '') as username, coalesce(display_name, '') as display_name
      into m from store_members where store_id = p_store and user_id = auth.uid();
    if not found then
        return jsonb_build_object('status', 'not_member');
    end if;
    if p_device is null or length(p_device) < 8 or length(p_device) > 64 then
        return jsonb_build_object('status', 'bad');
    end if;

    -- حتى لا يتجاوز جهازان الحد معًا في نفس اللحظة
    perform pg_advisory_xact_lock(hashtext('store_devices:' || p_store::text));

    select coalesce(device_limit, 0) into lim from store_device_plans where store_id = p_store;
    lim := coalesce(lim, 0);
    select count(*) into used from store_devices
     where store_id = p_store and not revoked and last_seen > now() - interval '30 days';

    select revoked, last_seen into d_revoked, d_last
      from store_devices where store_id = p_store and device_id = p_device;
    d_found := found;
    if d_found and d_revoked then
        return jsonb_build_object('status', 'revoked', 'limit', lim, 'used', used);
    end if;

    -- جهاز جديد، أو قديم عاد بعد 30 يومًا: يحتاج مكانًا ضمن الحد (إلا المدير)
    stale := not d_found or d_last <= now() - interval '30 days';
    if stale and lim > 0 and used >= lim and m.role <> 'admin' then
        return jsonb_build_object('status', 'limit', 'limit', lim, 'used', used);
    end if;

    insert into store_devices (store_id, device_id, user_id, username, display_name, platform, browser, model, installed)
    values (p_store, p_device, auth.uid(), m.username, m.display_name,
            left(coalesce(p_platform, ''), 40), left(coalesce(p_browser, ''), 40), left(coalesce(p_model, ''), 60), coalesce(p_installed, false))
    on conflict (store_id, device_id) do update set
        user_id = excluded.user_id,
        username = excluded.username,
        display_name = excluded.display_name,
        platform = excluded.platform,
        browser = excluded.browser,
        model = case when excluded.model <> '' then excluded.model else store_devices.model end,
        installed = excluded.installed,
        last_seen = now();

    return jsonb_build_object('status', 'ok', 'limit', lim, 'used', used + case when stale then 1 else 0 end, 'new', stale);
end;
$$;

revoke all on function public.device_checkin(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.device_checkin(uuid, text, text, text, text, boolean) to authenticated;

-- ===== للمزود: عدد الأجهزة النشطة لكل متجر =====
create or replace function public.provider_device_summary()
returns table (store_id uuid, active int, total int, device_limit int)
language sql stable security definer set search_path = public
as $$
    select s.store_id,
           count(*) filter (where not d.revoked and d.last_seen > now() - interval '30 days')::int,
           count(d.id)::int,
           coalesce(p.device_limit, 0)
      from (select store_id from store_devices union select store_id from store_device_plans) s
      left join store_devices d on d.store_id = s.store_id
      left join store_device_plans p on p.store_id = s.store_id
     where public.is_provider()
     group by s.store_id, p.device_limit;
$$;

revoke all on function public.provider_device_summary() from public, anon;
grant execute on function public.provider_device_summary() to authenticated;
