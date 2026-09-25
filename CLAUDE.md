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

## Push notification scheduling (important)

- On Supabase Free tier, scheduled invokes are handled via **`cron-job.org`** (external scheduler), not Supabase built-in scheduler.
- Two Edge Functions are scheduled:
  - `process-notification-queue` — every 1-2 minutes (drains `notification_outbox`)
  - `monthly-friends-digest` — hourly (`0 * * * *`); function itself only sends on last day of month at 17:00 Europe/London
- Scheduler requests must include header `x-cron-secret` with the same value as Edge secret `NOTIFICATION_CRON_SECRET`.
- Function endpoints:
  - `https://<project-ref>.supabase.co/functions/v1/process-notification-queue`
  - `https://<project-ref>.supabase.co/functions/v1/monthly-friends-digest`
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
                  SecureAuthService — email/password login & register, Google, `ensureUserStub`, `updatePublicUsername` + deferred auth metadata sync, logout
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
- **Optimistic UI** — visited and favourite toggles update local state immediately and roll back on server error
- **Viewport-based pub loading** — `useViewportPubs` fetches only the pubs visible on screen (debounced 400 ms, bounds-cached to prevent duplicate fetches)
- **Stats are server-computed** — never aggregate visit counts client-side; use the RPCs
- **Visited/favourite cache** — module-level Sets in `PubService`. Call `clearVisitedFavoriteCache()` on logout (done in `AuthContext`)
- **`useFocusEffect` staleness check** — ProfileScreen refreshes stats if `lastUpdated` is older than 30 s; opening the trophy modal also refreshes when stale

## Colour theme

All colours are defined in `constants/theme.js` and imported as `COLORS`. Do not declare colour constants locally in component files.

## Known issues to be aware of

- `get_achievements` still aggregates trophy JSON from `Pubs_List` / visits on each call; only `totalScore` / `level` / `pubsVisited` are read from `user_stats`. Further gains would require sharing work with `get_area_stats` / `get_borough_stats` or materializing trophy rows.
