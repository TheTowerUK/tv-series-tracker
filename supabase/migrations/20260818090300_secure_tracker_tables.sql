-- Phase 2.3 Step 2: forced RLS and least-privilege table boundary.
-- Receipt mutations remain deferred to Phase 2.4.

revoke all privileges on table public.shows from public, anon, authenticated;
revoke all privileges on table public.season_progress from public, anon, authenticated;
revoke all privileges on table public.migration_receipts from public, anon, authenticated;

revoke all privileges on table public.shows from tracker_api_owner;
revoke all privileges on table public.season_progress from tracker_api_owner;
revoke all privileges on table public.migration_receipts from tracker_api_owner;
revoke all privileges on type public.season_status from tracker_api_owner;

alter table public.shows enable row level security;
alter table public.shows force row level security;
alter table public.season_progress enable row level security;
alter table public.season_progress force row level security;
alter table public.migration_receipts enable row level security;
alter table public.migration_receipts force row level security;

create policy shows_authenticated_select
  on public.shows
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy season_progress_authenticated_select
  on public.season_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy migration_receipts_authenticated_select
  on public.migration_receipts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy shows_tracker_api_select
  on public.shows
  for select
  to tracker_api_owner
  using ((select auth.uid()) = user_id);

create policy shows_tracker_api_insert
  on public.shows
  for insert
  to tracker_api_owner
  with check ((select auth.uid()) = user_id);

create policy shows_tracker_api_update
  on public.shows
  for update
  to tracker_api_owner
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy shows_tracker_api_delete
  on public.shows
  for delete
  to tracker_api_owner
  using ((select auth.uid()) = user_id);

create policy season_progress_tracker_api_select
  on public.season_progress
  for select
  to tracker_api_owner
  using ((select auth.uid()) = user_id);

create policy season_progress_tracker_api_insert
  on public.season_progress
  for insert
  to tracker_api_owner
  with check ((select auth.uid()) = user_id);

create policy season_progress_tracker_api_update
  on public.season_progress
  for update
  to tracker_api_owner
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy season_progress_tracker_api_delete
  on public.season_progress
  for delete
  to tracker_api_owner
  using ((select auth.uid()) = user_id);

create policy migration_receipts_tracker_api_select
  on public.migration_receipts
  for select
  to tracker_api_owner
  using ((select auth.uid()) = user_id);

grant select on table public.shows to authenticated;
grant select on table public.season_progress to authenticated;
grant select on table public.migration_receipts to authenticated;
grant usage on type public.season_status to authenticated;

grant select, insert, update, delete on table public.shows to tracker_api_owner;
grant select, insert, update, delete on table public.season_progress to tracker_api_owner;
grant select on table public.migration_receipts to tracker_api_owner;
grant usage on type public.season_status to tracker_api_owner;

revoke create on schema public from tracker_api_owner;
