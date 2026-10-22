-- policies.sql — قواعد الحماية (RLS) المقترحة لجدولي kv_store و store_members
--
-- لماذا؟ منع الموظف من صفحات الإعدادات والسجل يتم في المتصفح فقط (auth.js).
-- هذه القواعد تجعل قاعدة البيانات نفسها تمنع:
--   - أي شخص غير عضو (أو غير مسجل الدخول) من قراءة أو تعديل بيانات أي متجر
--   - الموظف من تعديل إعدادات المتجر
--   - الموظف من تعديل أو حذف سجل العمليات (يستطيع الإضافة فقط)
--
-- طريقة التطبيق: Supabase ← SQL Editor ← الصق الملف ← Run.
-- راجع أسماء الأعمدة وأنواعها قبل التشغيل (نفترض أن store_id من نوع uuid)، وجرّب على نسخة تجريبية إن أمكن.
-- مهم: القواعد في Postgres تُجمع بـ OR، فإذا كانت هناك قاعدة قديمة تسمح بكل شيء ستبقى فعّالة.
-- اعرض القواعد الحالية بـ: select * from pg_policies where tablename in ('kv_store', 'store_members');
-- واحذف القديمة المتساهلة منها (drop policy "<name>" on public.kv_store;) قبل تشغيل هذا الملف.

-- ===== دوال مساعدة (security definer حتى لا تتكرر قواعد store_members على نفسها) =====
create or replace function public.is_store_member(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (select 1 from store_members where store_id = sid and user_id = auth.uid());
$$;

create or replace function public.is_store_admin(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (select 1 from store_members where store_id = sid and user_id = auth.uid() and role = 'admin');
$$;

-- مفاتيح لا يكتبها إلا المدير
create or replace function public.is_admin_key(k text)
returns boolean
language sql immutable
as $$
    select k = 'storeSettings' or k like 'storeLog\_%';
$$;

-- ===== kv_store =====
alter table public.kv_store enable row level security;

drop policy if exists kv_select on public.kv_store;
drop policy if exists kv_insert on public.kv_store;
drop policy if exists kv_update on public.kv_store;
drop policy if exists kv_delete on public.kv_store;

-- القراءة: أعضاء المتجر فقط
create policy kv_select on public.kv_store
    for select to authenticated
    using (public.is_store_member(store_id));

-- الإضافة: أعضاء المتجر؛ الإعدادات للمدير فقط (سطر السجل الجديد يُسمح به للجميع)
create policy kv_insert on public.kv_store
    for insert to authenticated
    with check (
        public.is_store_member(store_id)
        and (key <> 'storeSettings' or public.is_store_admin(store_id))
    );

-- التعديل: أعضاء المتجر؛ الإعدادات وسطور السجل الموجودة للمدير فقط
create policy kv_update on public.kv_store
    for update to authenticated
    using (
        public.is_store_member(store_id)
        and (not public.is_admin_key(key) or public.is_store_admin(store_id))
    )
    with check (
        public.is_store_member(store_id)
        and (not public.is_admin_key(key) or public.is_store_admin(store_id))
    );

-- الحذف: البرنامج لم يعد يحذف الصفوف (يكتب علامة حذف)، إلا رسائل ماسح الباركود scan-*
create policy kv_delete on public.kv_store
    for delete to authenticated
    using (
        public.is_store_member(store_id)
        and (key like 'scan-%' or public.is_store_admin(store_id))
    );

-- ===== store_members =====
-- القراءة فقط من المتصفح؛ الإضافة تتم عبر الدالة create-employee بمفتاح الخدمة
alter table public.store_members enable row level security;

drop policy if exists members_select on public.store_members;

create policy members_select on public.store_members
    for select to authenticated
    using (user_id = auth.uid() or public.is_store_member(store_id));
