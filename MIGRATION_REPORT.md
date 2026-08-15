# Entertainment Tracker Migration Report

## Source
- Workbook: `Entertainment Tracker(1).xlsx`
- Worksheet: `TV Episodes`
- Source rows migrated: **352**
- Source columns: **28**

## Platform counts before normalisation
- Netflix: 240
- Amazon: 66
- BBC: 20
- DisneyPlus: 9
- TV: 7
- (blank): 5
- Now TV: 5

## Season status counts
- Completed: 627
- Not Started: 349
- Watching: 33
- Purchase Only: 12
- Region Blocked: 7

## Data-quality notes
- Missing descriptions: **0**
- Duplicate title groups: **0**
- Maximum populated season number: **17**
- Season 18–23 currently unused.
- Blank platform values were migrated as `Unassigned`.
- `TV` values were preserved as `TV` because the intended current streaming service cannot be inferred safely.

## Platform normalisation
- Amazon → Prime Video
- BBC → BBC iPlayer
- DisneyPlus → Disney+
- Now TV → NOW
- Netflix → Netflix
- TV → TV
- Blank → Unassigned

No records were removed or merged during this migration. Duplicate-title cleanup and the three previously missing synopses were resolved in the revised source workbook before migration.


## Final source refresh — Entertainment Tracker(2).xlsx

- 352 shows retained.
- 0 duplicate titles.
- 0 missing descriptions.
- 0 missing platform/channel values.
- Previously unassigned entries (Sirens (limited series), Ginny and Georgia, The Four Seasons, Bet, Dept.Q) are now assigned to Netflix.
- Current normalized platform counts: Netflix 245; Prime Video 66; BBC iPlayer 20; Disney+ 9; TV 7; NOW 5.
