-- Cloud source of truth: docs/SUPABASE_SETUP.sql (project vfotsbbookypijnjcpjg).
-- One owner policy per table covers SELECT, INSERT, UPDATE and DELETE for
-- authenticated users. anon has no table privileges. service_role is left
-- untouched: it bypasses RLS by design and must never ship in the app.

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
