-- Run this once in the Supabase dashboard SQL Editor for project vfotsbbookypijnjcpjg.
-- It creates the personal tables, RLS policies and grants. Never put the secret key in the app.
-- NEPSE Terminal personal schema (single-user, RLS-enforced)
-- Safe to run on a fresh Supabase project. Run in the Supabase SQL Editor.

create table if not exists public.watchlist (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

create table if not exists public.portfolio_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  quantity numeric not null,
  price numeric not null,
  fees numeric not null default 0,
  traded_at text not null,
  source text,
  external_id text,
  kind text not null default 'trade',
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists portfolio_external_unique
  on public.portfolio_transactions(user_id, external_id)
  where external_id is not null;
create index if not exists portfolio_user_symbol
  on public.portfolio_transactions(user_id, symbol, traded_at);

create table if not exists public.trade_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  entry numeric not null,
  stop numeric not null,
  targets jsonb not null,
  quantity integer not null,
  risk_amount numeric,
  risk_percent numeric,
  reward_risk numeric,
  fees numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trade_plans_user_symbol
  on public.trade_plans(user_id, symbol, created_at desc);

create table if not exists public.trade_journal (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id bigint,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  paper boolean not null default false,
  planned_entry numeric,
  planned_stop numeric,
  planned_target numeric,
  actual_entry numeric,
  actual_exit numeric,
  quantity numeric,
  fees numeric,
  pnl numeric,
  reason text,
  mistakes text,
  tags jsonb,
  snapshot text,
  snapshot_image text,
  opened_at text,
  closed_at text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trade_journal_user_symbol
  on public.trade_journal(user_id, symbol, opened_at desc);

create table if not exists public.corporate_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null,
  kind text not null check (kind in ('dividend','bonus','right','other')),
  ex_date text,
  amount numeric,
  shares numeric,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists corporate_ledger_user_symbol
  on public.corporate_ledger(user_id, symbol, ex_date);

create table if not exists public.reconciliation_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null,
  imported_at timestamptz not null default now(),
  rows_count integer not null default 0,
  summary jsonb
);
create index if not exists reconciliation_imports_user
  on public.reconciliation_imports(user_id, imported_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trade_plans_set_updated_at on public.trade_plans;
create trigger trade_plans_set_updated_at before update on public.trade_plans
  for each row execute function public.set_updated_at();
drop trigger if exists trade_journal_set_updated_at on public.trade_journal;
create trigger trade_journal_set_updated_at before update on public.trade_journal
  for each row execute function public.set_updated_at();

alter table public.watchlist enable row level security;
alter table public.portfolio_transactions enable row level security;
alter table public.trade_plans enable row level security;
alter table public.trade_journal enable row level security;
alter table public.corporate_ledger enable row level security;
alter table public.reconciliation_imports enable row level security;

drop policy if exists watchlist_owner on public.watchlist;
create policy watchlist_owner on public.watchlist for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists portfolio_owner on public.portfolio_transactions;
create policy portfolio_owner on public.portfolio_transactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists trade_plans_owner on public.trade_plans;
create policy trade_plans_owner on public.trade_plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists trade_journal_owner on public.trade_journal;
create policy trade_journal_owner on public.trade_journal for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists corporate_ledger_owner on public.corporate_ledger;
create policy corporate_ledger_owner on public.corporate_ledger for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists reconciliation_imports_owner on public.reconciliation_imports;
create policy reconciliation_imports_owner on public.reconciliation_imports for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.watchlist from anon;
revoke all on public.portfolio_transactions from anon;
revoke all on public.trade_plans from anon;
revoke all on public.trade_journal from anon;
revoke all on public.corporate_ledger from anon;
revoke all on public.reconciliation_imports from anon;

grant select, insert, update, delete on public.watchlist to authenticated;
grant select, insert, update, delete on public.portfolio_transactions to authenticated;
grant select, insert, update, delete on public.trade_plans to authenticated;
grant select, insert, update, delete on public.trade_journal to authenticated;
grant select, insert, update, delete on public.corporate_ledger to authenticated;
grant select, insert, update, delete on public.reconciliation_imports to authenticated;
grant usage, select on all sequences in schema public to authenticated;

select 'schema ready' as status;
