-- provider.sql — لوحة المزود: الاشتراكات، وحساب المزود، وإيقاف المتجر عند انتهاء اشتراكه
--
-- شغّله مرة واحدة من Supabase ← SQL Editor بعد policies.sql. يمكن إعادة تشغيله دون ضرر.
-- بعد تشغيله اجعل حسابك مزودًا (آخر الملف)، ثم انشر الدالة provider-admin.

-- ===== المزودون: من يستطيع فتح لوحة المزود =====
-- لا قواعد قراءة أو كتابة: لا يصل إليه إلا مفتاح الخدمة (داخل دالة provider-admin)
create table if not exists public.providers (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);
alter table public.providers enable row level security;

-- ===== اشتراك كل متجر =====
-- المتجر الذي ليس له صف هنا يُعتبر فعّالًا (حتى لا تتوقف المتاجر الحالية قبل إضافتها)
create table if not exists public.store_subscriptions (
    store_id uuid primary key,
    store_name text not null default '',
    owner_phone text not null default '',
    plan text not null default 'شهري',
    price numeric not null default 0,
    starts_at date not null default current_date,
    expires_at date,
    suspended boolean not null default false,
    notes text not null default '',
    updated_at timestamptz not null default now()
);
alter table public.store_subscriptions enable row level security;

-- أعضاء المتجر يقرؤون اشتراك متجرهم فقط (ليظهر التنبيه والإيقاف في البرنامج)؛ التعديل للمزود فقط
drop policy if exists subs_select on public.store_subscriptions;
create policy subs_select on public.store_subscriptions
    for select to authenticated
    using (public.is_store_member(store_id));

-- المتجر فعّال إذا لم يُوقف يدويًا ولم يمضِ على انتهاء اشتراكه أكثر من 3 أيام (مهلة شروط الاستخدام)
create or replace function public.store_is_active(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select coalesce(
        (select not s.suspended and (s.expires_at is null or current_date <= s.expires_at + 3)
         from store_subscriptions s where s.store_id = sid),
        true
    );
$$;

-- ===== منع التعديل عند انتهاء الاشتراك =====
-- القراءة تبقى متاحة (البيانات ملك العميل حسب شروط الاستخدام)، والإضافة والتعديل والحذف تتوقف
drop policy if exists kv_insert on public.kv_store;
drop policy if exists kv_update on public.kv_store;
drop policy if exists kv_delete on public.kv_store;

create policy kv_insert on public.kv_store
    for insert to authenticated
    with check (
        public.is_store_member(store_id)
        and public.store_is_active(store_id)
        and (not public.is_admin_setting(key) or public.is_store_admin(store_id))
    );

create policy kv_update on public.kv_store
    for update to authenticated
    using (
        public.is_store_member(store_id)
        and public.store_is_active(store_id)
        and (not public.is_admin_key(key) or public.is_store_admin(store_id))
    )
    with check (
        public.is_store_member(store_id)
        and public.store_is_active(store_id)
        and (not public.is_admin_key(key) or public.is_store_admin(store_id))
    );

create policy kv_delete on public.kv_store
    for delete to authenticated
    using (
        public.is_store_member(store_id)
        and public.store_is_active(store_id)
        and (key like 'scan-%' or public.is_store_admin(store_id))
    );

-- ===== إحصائيات المتاجر للوحة المزود =====
-- آخر نشاط وعدد السجلات لكل متجر. لا يستدعيها إلا مفتاح الخدمة
create or replace function public.provider_store_stats()
returns table (store_id uuid, last_activity timestamptz, rows_count bigint)
language sql stable security definer set search_path = public
as $$
    select k.store_id, max(k.updated_at), count(*)
    from kv_store k
    group by k.store_id;
$$;
revoke all on function public.provider_store_stats() from public, anon, authenticated;

-- ===== اجعل حسابك مزودًا =====
-- 1) أنشئ حسابك من Authentication ← Users ← Add user (بريدك الحقيقي وكلمة مرور قوية)
-- 2) غيّر البريد في السطر التالي ثم شغّله:
-- insert into public.providers (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
