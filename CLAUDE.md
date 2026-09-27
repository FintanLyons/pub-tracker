# Pub Tracker — Claude Context

> Your work will be checked by ChatGPT

## What this app is

Pub Tracker is a React Native mobile app for London pub enthusiasts. The core purpose is to let users track every pub they have ever visited, discover new venues, and compete with friends to see who has been to the most pubs.

Users earn points by visiting pubs, completing entire **postcode districts** (e.g. SW1), and completing entire **postcode areas** (e.g. SW). Friends can compare progress on a shared leaderboard. Private leagues with invite codes allow smaller groups to compete against each other.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile framework | React Native 0.81.5 / React 19 / Expo 54 |
| Backend / DB | Supabase (Postgres, Auth, RLS, RPCs) |
| Navigation | React Navigation v7 (bottom tabs) |
| Maps | MapLibre (bundled GeoJSON layers + markers) |
| Build | Expo EAS |

## Push notifications (important)

- Rows go into `notification_outbox` (friend request / league triggers, `enqueue_pub_summon_notifications`, `enqueue_monthly_digest`). Edge Function `process-notification-queue` sends them via Expo (logic in `supabase/functions/_shared/outbox-worker.ts`).
- **Triggering is inside Supabase** (`scripts/notification_scheduling_2026_09.sql`):
  - trigger `tr_kick_notification_queue` calls the worker via pg_net right after an insert commits (delivery in seconds)
  - Supabase Cron (pg_cron): `process-notification-queue` every minute (safety net + retries), `monthly-friends-digest` hourly (it only queues on the last day of the month, 17:00–20:00 Europe/London)
  - `invoke_notification_function()` sends header `x-cron-secret` from Vault secret `notification_cron_secret`, which must equal Edge secret `NOTIFICATION_CRON_SECRET`
- Queue rules (`claim_notification_batch` / `finish_notification_batch`): rows are leased so overlapping runs never double-send; retries after 1 min, 5 min, 30 min, 2 h, then `failed_at`; expiry: summon 2 h, digest 12 h, others 7 days.
- Tapping a notification routes via `services/notificationNavigation.js` (`notificationTarget`).
- Deploy functions: `npx supabase functions deploy <name>` (project is linked).
- Required Edge secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_ACCESS_TOKEN`, `NOTIFICATION_CRON_SECRET`.

## Scoring system

- Each visited pub → **10** (flat; the legacy `pubs.points` column is not used)
- Visiting a pub with `pub_achievements` rows → + those rows' `points`
- Each drink logged (`pub_drinks.count`) → +1
- Approved report → +20 (`missing_pub`) or +5 (`pub_correction`)
- Complete every active pub in a **postcode district** → tiered bonus by district size: <10 pubs 40, <20 60, <30 80, else 100
- Complete every active pub in a **postcode area** (e.g. SW, CB) → +1000
- Level = `floor(total_score / 50) + 1`

Scoring logic lives in two places — keep them in sync if rules change:
- Client: `utils/levelSystem.js` — level math plus exported constants (`POINTS_PER_LEVEL`, `DEFAULT_PUB_VISIT_POINTS`, `POINTS_PER_DRINK`, `getPostcodeDistrictCompletionBonusPoints` / `AREA_COMPLETION_SIZE_TIERS`, `POSTCODE_AREA_COMPLETION_BONUS_POINTS`, `POINTS_NEW_PUB_REPORT`, `POINTS_PUB_CORRECTION_REPORT`) used by Profile settings scoring copy
- Server: `compute_user_stats()` + `postcode_district_completion_bonus()` (see `scripts/schema_baseline_2026_09.sql` §3b). `user_stats` is written **only** by this function via triggers on `visited_pubs`, `pub_drinks` and `reports`.

## Architecture

```
contexts/         AuthContext, NetworkContext, LocationContext,
                  UserStatsContext, LoadingContext

services/         PubService       — fetch pubs, toggle visited/favourite
                  FriendsService   — send/accept requests, leaderboard
                  LeagueService    — create/join/leave leagues
                  UserService      — username search
                  SecureAuthService — email/password login & register, Apple/Google, password reset (emailed code), `ensureUserStub`, `updatePublicUsername` + deferred auth metadata sync, logout
                  authErrors       — isNetworkError / isInvalidSessionError classification
                  ReportService    — report pubs / missing pubs
                  LeaderboardCache — in-memory leaderboard cache

screens/          MapScreen, ProfileScreen (stats + trophy modal), LeaderboardScreen,
                  AuthScreen, ChooseUsernameScreen (post-auth until username set), OnboardingScreen, FilterScreen

screens/map/hooks/  useMapCamera — camera ref, location, fit/center/zoom
                    useViewportPubs — pub fetching, merge, bounds tracking
                    useMapInteraction — search + selection + deep-link + toggles
                    useFilterState, useImageSource

screens/map/        mapUtils.js — pure geometry helpers (bounds, feature search)
                    layerUtils.js — postcode area + district GeoJSON layers

data/geo/           london_postcode_districts.min.json (district polygons);
                    london_postcode_areas.min.json + london_postcode_area_label_points.min.json
                    (letter-area outlines + one label point each — `npm run build:geo` / `python3 scripts/build_london_postcode_areas.py`)
data/               postcode_district_display_names.json — district code → locality label (Balham, …); regenerate via scripts/generate_postcode_district_display_names.py
utils/              postcodeDistrictDisplayNames.js — getPostcodeDistrictDisplayName, formatDistrictWithCode

components/       DraggablePubCard, PubCardContent, SearchBar,
                  SearchSuggestions, AddFriendModal, CreateLeagueModal,
                  JoinLeagueModal, LeagueActionsModal, PubReportFormModal,
                  OfflineOverlay, ErrorBoundary,
                  UserAchievementsPanel (trophy grid in Profile modal),
                  PintGlassIcon, RangeSlider

scripts/          schema_baseline_2026_09.sql — full live DB schema (tables, functions,
                  RLS, triggers, grants); dated migration files; Python data-pipeline
                  scripts. Not deployed code — SQL is run manually in the Supabase SQL editor.
```

## Database

**Source of truth:** the live Supabase project (`ddfdwxrnouneqqzactus`). Claude has **read-only** access via the Supabase MCP (`.mcp.json`) — query the catalogs rather than trusting files. `scripts/schema_baseline_2026_09.sql` is a snapshot of the whole `public` schema as of 2026-09-25; older migrations were deleted (they remain in git history).

**Making DB changes:** write a new dated file in `scripts/` (e.g. `scripts/<topic>_YYYY_MM.sql`) wrapped in `BEGIN/COMMIT`, plus a rollback file for anything risky. The user runs it in the SQL editor; Claude then verifies via MCP.

**Security conventions (important):**
- Supabase auto-grants new tables to `anon`/`authenticated` — **every table must have RLS enabled** with explicit policies.
- `REVOKE ... FROM PUBLIC` alone does nothing on Supabase. For every new function: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` then `GRANT EXECUTE ... TO authenticated` **only** if the app calls it via `supabase.rpc()`.
- The app requires login for every screen; `anon` needs no function access.

### ⚠️ Pending database migrations

- **`scripts/social_security_phase_b_2026_09.sql` — NOT YET RUN (deliberately).** Hides leagues and invite codes from non-members. Run it only once most users have updated to a build that joins leagues via `join_league_by_code()` (commit "Join leagues by code on the server"); older builds can't join leagues after it runs. Remind the user about this whenever database or release work comes up. After running: verify via MCP, update the schema baseline, and delete this bullet.
- **cron-job.org jobs — to disable.** Superseded by Supabase Cron (verified 2026-09-27). Once the user has disabled both jobs, delete this bullet.
- **Edge secret `R2_REQUIRE_CONTENT_LENGTH=true` on `presign-r2-upload` — NOT YET SET (deliberately).** Builds before Batch 7 don't send `contentLength`; set it alongside Phase B, once most users have updated. Until then old builds can still upload without a size limit.

### Tables

| Table | Purpose |
|---|---|
| `Pubs_List` | **The pub catalogue** (London + Cambridge) — text `id`, lat/lon, `postcode_district`, `postcode_area`, address, features, photos (`photo_url1..5`), `is_active`. Public read, no client writes |
| `pub_achievements` | Optional per-pub milestones (CAMRA awards etc.) with bonus `points` |
| `visited_pubs` | User visits — trigger recomputes `user_stats` on INSERT/DELETE |
| `favorite_pubs` | User favourites (visible to accepted friends) |
| `pub_drinks` | Per-user per-pub drink count — trigger recomputes `user_stats` |
| `pub_reviews` | 1–5 star review + text, one per user per pub |
| `user_stats` | Denormalised score / level / pubs_visited / total_drinks — **read-only for clients**, written by `compute_user_stats` |
| `users` | Profiles — `email` (not readable by clients), `username` (unique, nullable until chosen), `avatar_url` |
| `friendships` | One row per friendship, status `pending` / `accepted` |
| `leagues` / `league_members` | Private leagues with a unique 6-character invite `code` |
| `reports` | User pub corrections / missing-pub submissions. Users insert own `pending` rows; approving (set `status='approved'` in dashboard) auto-applies to `Pubs_List` via trigger |
| `user_push_tokens` | Expo push tokens |
| `notification_outbox` / `notification_monthly_digest_log` | Push queue + digest log — server-only (no RLS policies) |
| `pubs`, `pubs_all`, `pub_spatial_assignments` | **Legacy, unused by the app** — pending removal |

### Server RPCs (callable by the app)

- `get_area_stats(user_id)` — per-**postcode district** visited/total/percentage/center + parent `postcode_area`
- `get_borough_stats(user_id)` — per-**postcode area** stats + district completion counts (`total_districts`, `completed_districts`)
- `get_achievements(user_id)` — trophies (`districtTrophies`, `postcodeAreaTrophies`, `pubAchievements`); `totalScore` / `level` / `pubsVisited` read from `user_stats`
- `search_pubs(query, limit)` — name search over active pubs; includes `postcode_district`, `postcode_area`
- `delete_my_account()` — removes all of the caller's data and auth user
- `enqueue_pub_summon_notifications(pub_id, friend_ids, area_label)` — "summon the troops" push to accepted friends

The stats RPCs reject calls for another user's id. Everything else (`compute_user_stats`, report apply/approve, geocoding/HTTP helpers) is server-only. Login is **email + password** (plus Google).

## Key conventions

- **Accent colour** — amber `#D4A017` for all interactive / brand elements
- **Primary text / surfaces** — dark charcoal `#1C1C1C` / `#2C2C2C`
- **Optimistic UI** — visited / favourite update local state immediately, then call the idempotent `setPubVisited(pubId, bool)` / `setPubFavorite` (never "toggle" on the server; writes per pub are queued in tap order). On failure only that pub is reverted and `useToast().showToast(...)` explains it didn't save. Toasts don't show above RN `<Modal>`s — use inline errors there
- **Counters** — use `createLatestValueSync` (`utils/latestValueSync.js`): controls stay disabled until the real value loads; only the latest value is saved, in order
- **Stats refresh** — `refreshUserStats()` merges overlapping calls (`utils/coalescedRunner.js`); callers that fire on every tap should debounce first
- **Viewport-based pub loading** — `useViewportPubs` fetches only the pubs visible on screen (80 ms debounce, bounds-cached). Map rows use `MAP_PUB_COLUMNS` (`detailsLoaded: false`); opening a pub loads the full row via `fetchPubById`. A failed load is never marked as loaded — it retries after 8 s, on the next pan, or on reconnect
- **Map completion colours / area labels** — from server stats (`useUserStats().districtStats` / `postcodeAreaStats`) plus `pendingVisitChanges` for taps the server hasn't counted yet; never count loaded pubs client-side
- **Stats are server-computed** — never aggregate visit counts client-side; use the RPCs
- **Visited/favourite cache** — module-level Sets in `PubService`. Call `clearVisitedFavoriteCache()` on logout (done in `SecureAuthService`)
- **Auth sessions** — only a definite rejection from the auth server (`isInvalidSessionError`) may sign a user out. Offline / timeouts / 5xx keep the session; `AuthContext` falls back to the last cached profile (`auth:lastProfile:v1`) or shows `ConnectionErrorScreen`. Sign-in functions only create the session — the caller loads the profile via `refreshUser()`.
- **`useFocusEffect` staleness check** — ProfileScreen refreshes stats if `lastUpdated` is older than 30 s; opening the trophy modal also refreshes when stale

## Checks before committing

There are no tests or linter. At minimum run:
- `npm run check:undefined` — identifiers used but never declared/imported (runtime `ReferenceError`; Metro bundling does not catch these)
- `npx expo export --platform android --output-dir /tmp/…` — the app bundles

## Colour theme

All colours are defined in `constants/theme.js` and imported as `COLORS`. Do not declare colour constants locally in component files.

## Known issues to be aware of

- `get_achievements` still aggregates trophy JSON from `Pubs_List` / visits on each call; only `totalScore` / `level` / `pubsVisited` are read from `user_stats`. Further gains would require sharing work with `get_area_stats` / `get_borough_stats` or materializing trophy rows.
