-- Baza za Barać ponude. Zalijepi cijelu datoteku u Supabase → SQL Editor → Run.
-- Svaki korisnik vidi i mijenja samo svoje podatke (Row Level Security).

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.counters (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  year text not null,
  next int not null default 1,
  primary key (user_id, year)
);

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  naziv text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, naziv)
);

create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  broj text not null,
  datum date,
  kupac text,
  iznos numeric(12, 2),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, broj)
);

-- Pristup samo prijavljenim korisnicima (radi i kad je "Automatically expose new tables" isključeno).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.settings, public.counters, public.customers, public.quotes to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke all on public.settings, public.counters, public.customers, public.quotes from anon;

alter table public.settings enable row level security;
alter table public.counters enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;

drop policy if exists "vlastiti podaci" on public.settings;
drop policy if exists "vlastiti podaci" on public.counters;
drop policy if exists "vlastiti podaci" on public.customers;
drop policy if exists "vlastiti podaci" on public.quotes;
create policy "vlastiti podaci" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "vlastiti podaci" on public.counters for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "vlastiti podaci" on public.customers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "vlastiti podaci" on public.quotes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Atomarno uzima sljedeći broj ponude za godinu (nema duplih brojeva ni s dva uređaja).
create or replace function public.next_broj(p_year text)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.counters (user_id, year, next)
  values (auth.uid(), p_year, 2)
  on conflict (user_id, year) do update set next = public.counters.next + 1
  returning next - 1 into n;
  return n;
end;
$$;

revoke execute on function public.next_broj(text) from public, anon;
grant execute on function public.next_broj(text) to authenticated;
