-- Phase 2.4 Step 1: controlled receipt insert/update boundary.

revoke insert, update, delete on table public.migration_receipts from public, anon, authenticated;
revoke insert, update, delete on table public.migration_receipts from tracker_api_owner;

drop policy if exists migration_receipts_tracker_api_insert on public.migration_receipts;
drop policy if exists migration_receipts_tracker_api_update on public.migration_receipts;
drop policy if exists migration_receipts_tracker_api_delete on public.migration_receipts;

create policy migration_receipts_tracker_api_insert
  on public.migration_receipts
  for insert
  to tracker_api_owner
  with check ((select auth.uid()) = user_id);

create policy migration_receipts_tracker_api_update
  on public.migration_receipts
  for update
  to tracker_api_owner
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant insert, update on table public.migration_receipts to tracker_api_owner;
revoke delete on table public.migration_receipts from tracker_api_owner;
