-- ChubutxTRES: RLS is enabled on every public table.
create extension if not exists pgcrypto;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '', organization text not null default '',
 tax_id text not null default '', phone text not null default '',
 sector text not null default 'hotelero', role text not null default 'member' check (role in ('member','admin')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.membership_categories (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 name text not null, description text not null default '',
 price_ars integer not null default 0 check(price_ars>=0),
 frequency text not null default 'months' check(frequency in ('months','years')),
 active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
create table public.memberships (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 category_id uuid not null references public.membership_categories(id),
 amount_ars integer not null check(amount_ars>0), frequency text not null check(frequency in ('months','years')),
 status text not null default 'creating' check(status in ('creating','pending','authorized','paused','cancelled','rejected','error')),
 mp_preapproval_id text unique, mp_init_point text, last_provider_update timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index only_one_open_membership on public.memberships(user_id) where status in ('creating','pending','authorized','paused');
create table public.payment_events (
 id uuid primary key default gen_random_uuid(), membership_id uuid references public.memberships(id),
 event_type text not null, mp_resource_id text not null, payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), unique(event_type,mp_resource_id,created_at)
);
create table public.contact_messages (
 id uuid primary key default gen_random_uuid(), name text not null, email text not null,
 message text not null, created_at timestamptz not null default now()
);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin')
$$;
create function public.new_profile() returns trigger language plpgsql security definer set search_path=public as $$
 begin insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''));return new;end
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();
-- role cannot be self-promoted; a user can edit only their non-sensitive profile fields.
create or replace function public.prevent_profile_privilege_change() returns trigger language plpgsql as $$
 begin if auth.uid()=new.id and not public.is_admin() and new.role is distinct from old.role then
 raise exception 'Role changes are forbidden';end if;new.updated_at=now();return new;end
$$;
create trigger profile_privileges before update on public.profiles for each row execute function public.prevent_profile_privilege_change();
alter table public.profiles enable row level security;
alter table public.membership_categories enable row level security;
alter table public.memberships enable row level security;
alter table public.payment_events enable row level security;
alter table public.contact_messages enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profile_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
-- Explicit column grants prevent users from editing role through the public API.
revoke update on public.profiles from authenticated;
grant update(full_name,organization,tax_id,phone,sector) on public.profiles to authenticated;
create policy categories_read on public.membership_categories for select to anon,authenticated using(active or public.is_admin());
create policy categories_admin_update on public.membership_categories for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy memberships_read on public.memberships for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy payment_events_admin_read on public.payment_events for select to authenticated using(public.is_admin());
create policy contact_create on public.contact_messages for insert to anon,authenticated with check(char_length(name) between 1 and 120 and char_length(email) between 3 and 254 and char_length(message) between 1 and 4000);
create policy contact_admin_read on public.contact_messages for select to authenticated using(public.is_admin());
-- Sensitive writes to memberships and payment_events are ONLY allowed by service role edge functions.
insert into public.membership_categories(code,name,description,sort_order) values
 ('hotelero','Hoteleros y lodges','Para empresas de alojamiento que buscan más demanda y mayor actividad fuera de temporada.',1),
 ('prestador','Prestadores turísticos','Para empresas de experiencias, servicios, gastronomía y operadores de turismo.',2),
 ('sponsor','Sponsor corporativo','Para empresas que desean respaldar el desarrollo territorial y económico.',3),
 ('inversor','Aliado estratégico / inversor','Para organizaciones interesadas en proyectos e infraestructura.',4);
create function public.admin_memberships() returns table(
 id uuid,created_at timestamptz,user_id uuid,amount_ars integer,frequency text,status text,
 mp_preapproval_id text,full_name text,organization text,tax_id text,sector text,phone text,email text,category_name text
) language plpgsql stable security definer set search_path=public as $$
 begin if not public.is_admin() then raise exception 'Forbidden';end if;
 return query select m.id,m.created_at,m.user_id,m.amount_ars,m.frequency,m.status,m.mp_preapproval_id,
 p.full_name,p.organization,p.tax_id,p.sector,p.phone,u.email::text,c.name
 from public.memberships m join public.profiles p on p.id=m.user_id
 join auth.users u on u.id=m.user_id join public.membership_categories c on c.id=m.category_id;
 end
$$;
revoke all on function public.admin_memberships() from public,anon;
grant execute on function public.admin_memberships() to authenticated;
-- To grant the first admin, use SQL editor (never frontend):
-- UPDATE public.profiles SET role='admin' WHERE id=(SELECT id FROM auth.users WHERE email='YOUR_ADMIN_EMAIL');
