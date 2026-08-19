begin;

select plan(23);

select ok(has_table_privilege('authenticated', 'public.shows', 'SELECT'), 'authenticated can select shows');
select ok(has_table_privilege('authenticated', 'public.season_progress', 'SELECT'), 'authenticated can select seasons');
select ok(has_table_privilege('authenticated', 'public.migration_receipts', 'SELECT'), 'authenticated can select receipts');
select ok(not has_table_privilege('authenticated', 'public.shows', 'INSERT,UPDATE,DELETE'), 'authenticated cannot mutate shows');
select ok(not has_table_privilege('authenticated', 'public.season_progress', 'INSERT,UPDATE,DELETE'), 'authenticated cannot mutate seasons');
select ok(not has_table_privilege('authenticated', 'public.migration_receipts', 'INSERT,UPDATE,DELETE'), 'authenticated cannot mutate receipts');

select ok(not has_table_privilege('anon', 'public.shows', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no show privileges');
select ok(not has_table_privilege('anon', 'public.season_progress', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no season privileges');
select ok(not has_table_privilege('anon', 'public.migration_receipts', 'SELECT,INSERT,UPDATE,DELETE'), 'anon has no receipt privileges');

select ok(has_table_privilege('tracker_api_owner', 'public.shows', 'SELECT'), 'tracker_api_owner can select shows');
select ok(has_table_privilege('tracker_api_owner', 'public.shows', 'INSERT'), 'tracker_api_owner can insert shows');
select ok(has_table_privilege('tracker_api_owner', 'public.shows', 'UPDATE'), 'tracker_api_owner can update shows');
select ok(has_table_privilege('tracker_api_owner', 'public.shows', 'DELETE'), 'tracker_api_owner can delete shows');
select ok(has_table_privilege('tracker_api_owner', 'public.season_progress', 'SELECT'), 'tracker_api_owner can select seasons');
select ok(has_table_privilege('tracker_api_owner', 'public.season_progress', 'INSERT'), 'tracker_api_owner can insert seasons');
select ok(has_table_privilege('tracker_api_owner', 'public.season_progress', 'UPDATE'), 'tracker_api_owner can update seasons');
select ok(has_table_privilege('tracker_api_owner', 'public.season_progress', 'DELETE'), 'tracker_api_owner can delete seasons');
select ok(has_table_privilege('tracker_api_owner', 'public.migration_receipts', 'SELECT'), 'tracker_api_owner can select receipts');
select ok(has_table_privilege('tracker_api_owner', 'public.migration_receipts', 'INSERT,UPDATE'), 'tracker_api_owner can insert and update receipts');
select ok(not has_table_privilege('tracker_api_owner', 'public.migration_receipts', 'DELETE'), 'tracker_api_owner cannot delete receipts');

select ok(has_type_privilege('authenticated', 'public.season_status', 'USAGE'), 'authenticated has season_status usage');
select ok(has_type_privilege('tracker_api_owner', 'public.season_status', 'USAGE'), 'tracker_api_owner has season_status usage');
select ok(not has_schema_privilege('tracker_api_owner', 'public', 'CREATE'), 'tracker_api_owner still cannot create in public');

select * from finish();
rollback;
