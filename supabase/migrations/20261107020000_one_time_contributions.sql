-- ChubutxTRES V4. Execute only after 20261107010000_payments_production.sql.
-- Non-recurring contributions are separate from membership renewals.
create table if not exists public.one_time_contributions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 amount_ars integer not null check (amount_ars between 1 and 100000000),
 currency text not null default 'ARS' check (currency='ARS'),
 status text not null default 'creating' check (status in ('creating','pending','in_process','approved','rejected','cancelled','refunded','charged_back','error')),
 mp_preference_id text unique,
 mp_payment_id text unique,
 mp_init_point text,
 provider_detail text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 paid_at timestamptz
);
create index if not exists one_time_contributions_by_user on public.one_time_contributions(user_id,created_at desc);
alter table public.one_time_contributions enable row level security;
drop policy if exists contribution_read on public.one_time_contributions;
create policy contribution_read on public.one_time_contributions for select to authenticated
 using (user_id=auth.uid() or public.is_admin());
-- No client-side INSERT/UPDATE/DELETE policy: only Edge Functions with service role may mutate.
create or replace function public.admin_contributions() returns table (
 id uuid,user_id uuid,created_at timestamptz,amount_ars integer,status text,
 mp_payment_id text,mp_preference_id text,paid_at timestamptz,
 organization text,full_name text,email text
) language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Forbidden'; end if;
 return query select c.id,c.user_id,c.created_at,c.amount_ars,c.status,
 c.mp_payment_id,c.mp_preference_id,c.paid_at,p.organization,p.full_name,u.email::text
 from public.one_time_contributions c
 join public.profiles p on p.id=c.user_id
 join auth.users u on u.id=c.user_id
 order by c.created_at desc;
end $$;
revoke all on function public.admin_contributions() from public,anon;
grant execute on function public.admin_contributions() to authenticated;
