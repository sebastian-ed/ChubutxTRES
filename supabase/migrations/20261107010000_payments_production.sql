-- RUN ONCE AFTER initial migration. Preserves existing members and their attempts.
create table if not exists public.subscription_invoices (
 id uuid primary key default gen_random_uuid(),
 membership_id uuid not null references public.memberships(id) on delete cascade,
 mp_authorized_payment_id text not null unique,
 mp_payment_id text,
 mp_preapproval_id text not null,
 status text not null default 'pending',
 payment_status text,
 amount_ars numeric(14,2),
 currency text not null default 'ARS',
 debit_date timestamptz,
 approved_at timestamptz,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create unique index if not exists subscription_invoices_mp_payment_unique on public.subscription_invoices(mp_payment_id) where mp_payment_id is not null;
create index if not exists subscription_invoices_member_idx on public.subscription_invoices(membership_id,created_at desc);
alter table public.subscription_invoices enable row level security;
drop policy if exists invoice_own_read on public.subscription_invoices;
create policy invoice_own_read on public.subscription_invoices for select to authenticated using (
 exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=auth.uid()) or public.is_admin()
);
-- Keep historical payment_events untouched (including previously duplicated webhook attempts).
-- New provider_events table guarantees one row per provider resource/event type.
create table if not exists public.provider_events (
 id uuid primary key default gen_random_uuid(), membership_id uuid references public.memberships(id),
 event_type text not null, mp_resource_id text not null,
 payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(event_type,mp_resource_id)
);
alter table public.provider_events enable row level security;
drop policy if exists provider_events_admin_read on public.provider_events;
create policy provider_events_admin_read on public.provider_events for select to authenticated using(public.is_admin());
-- Payment ledger access for admins; member invoices are visible in their account only.
create or replace function public.admin_invoices() returns table (
 id uuid, membership_id uuid, mp_authorized_payment_id text, mp_payment_id text,
 status text,payment_status text,amount_ars numeric,currency text,debit_date timestamptz,
 approved_at timestamptz,created_at timestamptz,organization text,email text
) language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Forbidden'; end if;
 return query select i.id,i.membership_id,i.mp_authorized_payment_id,i.mp_payment_id,i.status,
 i.payment_status,i.amount_ars,i.currency,i.debit_date,i.approved_at,i.created_at,
 p.organization,u.email::text
 from public.subscription_invoices i join public.memberships m on m.id=i.membership_id
 join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
 order by i.created_at desc;
end $$;
revoke all on function public.admin_invoices() from public,anon;
grant execute on function public.admin_invoices() to authenticated;
-- Restricted to service role via RLS; no client inserts/updates.
