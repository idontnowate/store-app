-- storefront.sql — المتجر الإلكتروني: صفحة عامة لمنتجات المتجر، وطلبات الزبائن
--
-- شغّله مرة واحدة من Supabase ← SQL Editor بعد policies.sql و provider.sql. يمكن إعادة تشغيله دون ضرر.
--
-- store_catalog: نسخة منشورة من المتجر (الاسم، الهاتف، المنتجات بسعر البيع ومتوفر/نفد).
--   لا تحتوي التكلفة ولا الكميات ولا أي بيانات أخرى من kv_store. يقرؤها أي زائر إذا كان المتجر مفعّلًا.
-- store_orders: طلبات الزبائن. الزائر يضيف طلبًا فقط ولا يستطيع قراءة أي طلب؛ أعضاء المتجر يقرؤون طلبات متجرهم.

-- ===== النسخة المنشورة =====
create table if not exists public.store_catalog (
    store_id uuid primary key,
    slug text unique,
    enabled boolean not null default false,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    constraint store_catalog_slug_format check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
    constraint store_catalog_size check (pg_column_size(data) < 4000000)
);
alter table public.store_catalog enable row level security;

drop policy if exists catalog_public on public.store_catalog;
drop policy if exists catalog_members_select on public.store_catalog;
drop policy if exists catalog_insert on public.store_catalog;
drop policy if exists catalog_update on public.store_catalog;
drop policy if exists catalog_delete on public.store_catalog;

-- أي زائر: المتاجر المفعّلة ذات الاشتراك الفعّال فقط
create policy catalog_public on public.store_catalog
    for select to anon, authenticated
    using (enabled and public.store_is_active(store_id));

-- أعضاء المتجر يرون نسختهم حتى لو كانت متوقفة
create policy catalog_members_select on public.store_catalog
    for select to authenticated
    using (public.is_store_member(store_id));

-- التفعيل لأول مرة للمدير فقط
create policy catalog_insert on public.store_catalog
    for insert to authenticated
    with check (public.is_store_admin(store_id));

-- تحديث المنتجات والأسعار من أي جهاز في المتجر (البيع يغيّر المتوفر)؛ التفعيل والرابط للمدير (انظر المشغّل)
create policy catalog_update on public.store_catalog
    for update to authenticated
    using (public.is_store_member(store_id))
    with check (public.is_store_member(store_id));

create policy catalog_delete on public.store_catalog
    for delete to authenticated
    using (public.is_store_admin(store_id));

create or replace function public.catalog_admin_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if (new.enabled is distinct from old.enabled or new.slug is distinct from old.slug)
       and not public.is_store_admin(new.store_id) then
        raise exception 'only the store admin can change the storefront settings';
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists catalog_admin_fields on public.store_catalog;
create trigger catalog_admin_fields
    before update on public.store_catalog
    for each row execute function public.catalog_admin_fields();

-- ===== الطلبات =====
create table if not exists public.store_orders (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.store_catalog (store_id) on delete cascade,
    customer_name text not null,
    customer_phone text not null,
    address text not null default '',
    note text not null default '',
    items jsonb not null,
    total numeric not null default 0,
    status text not null default 'new',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint store_orders_name check (char_length(customer_name) between 1 and 80),
    constraint store_orders_phone check (customer_phone ~ '^[0-9+ ]{7,20}$'),
    constraint store_orders_address check (char_length(address) <= 300),
    constraint store_orders_note check (char_length(note) <= 500),
    constraint store_orders_items check (
        jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50 and length(items::text) < 20000
    ),
    constraint store_orders_status check (status in ('new', 'accepted', 'done', 'rejected'))
);
create index if not exists store_orders_store_created on public.store_orders (store_id, created_at desc);
alter table public.store_orders enable row level security;

drop policy if exists orders_insert on public.store_orders;
drop policy if exists orders_select on public.store_orders;
drop policy if exists orders_update on public.store_orders;
drop policy if exists orders_delete on public.store_orders;

-- أي زائر يضيف طلبًا جديدًا لمتجر مفعّل وفعّال
create policy orders_insert on public.store_orders
    for insert to anon, authenticated
    with check (
        status = 'new'
        and public.store_is_active(store_id)
        and exists (select 1 from public.store_catalog c where c.store_id = store_orders.store_id and c.enabled)
    );

create policy orders_select on public.store_orders
    for select to authenticated
    using (public.is_store_member(store_id));

create policy orders_update on public.store_orders
    for update to authenticated
    using (public.is_store_member(store_id))
    with check (public.is_store_member(store_id));

create policy orders_delete on public.store_orders
    for delete to authenticated
    using (public.is_store_admin(store_id));

-- حماية من الإغراق: 3 طلبات لنفس الرقم كل 10 دقائق، و 30 طلبًا للمتجر كل 10 دقائق
create or replace function public.orders_throttle()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if (select count(*) from store_orders
        where store_id = new.store_id and customer_phone = new.customer_phone
          and created_at > now() - interval '10 minutes') >= 3 then
        raise exception 'too many orders from this number, try again later';
    end if;
    if (select count(*) from store_orders
        where store_id = new.store_id and created_at > now() - interval '10 minutes') >= 30 then
        raise exception 'too many orders, try again later';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists orders_throttle on public.store_orders;
create trigger orders_throttle
    before insert on public.store_orders
    for each row execute function public.orders_throttle();

create or replace function public.orders_touch()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists orders_touch on public.store_orders;
create trigger orders_touch
    before update on public.store_orders
    for each row execute function public.orders_touch();
