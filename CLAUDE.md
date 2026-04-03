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

## Scoring system

- Each visited pub → `pub.points` (default 10 if not set)
- Complete every pub in a **postcode district** → +50 bonus
- Complete every pub in a **postcode area** (e.g. SW) → +500 bonus
- Level = `floor(total_score / 50) + 1`

Scoring logic lives in two places — keep them in sync if rules change:
- Client: `utils/levelSystem.js` (used for Profile level display; level formula only)
- Server: `scripts/phase6_postcode_migration.sql` (and legacy `scripts/phase3_server_functions.sql`) → `compute_user_stats()` and `get_achievements()`

## Architecture

```
contexts/         AuthContext, NetworkContext, LocationContext,
                  UserStatsContext, LoadingContext

services/         PubService       — fetch pubs, toggle visited/favourite
                  FriendsService   — send/accept requests, leaderboard
                  LeagueService    — create/join/leave leagues
                  UserService      — username search
                  SecureAuthService — login, register, logout
                  ReportService    — report pubs / missing pubs
                  LeaderboardCache — in-memory leaderboard cache

screens/          MapScreen, ProfileScreen (stats + trophy modal), LeaderboardScreen,
                  AuthScreen, FilterScreen

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
                  JoinLeagueModal, LeagueActionsModal, ReportModal,
                  ReportMissingPubModal, OfflineOverlay, ErrorBoundary,
                  UserAchievementsPanel (trophy grid in Profile modal),
                  PintGlassIcon, RangeSlider

scripts/          SQL migrations and Python data-pipeline scripts.
                  Not deployed code — run manually against Supabase.
```

## Database tables

| Table | Purpose |
|---|---|
| `pubs_all` | All London pubs — lat/lon, address, legacy area/borough columns, ownership, features, points, achievement |
| `pub_spatial_assignments` | Per-pub spatial grouping — `postcode_district`, `postcode_area` (primary for map/stats after migration) |
| `visited_pubs` | User visit records — trigger auto-updates `user_stats` on INSERT/DELETE |
| `favorite_pubs` | User favourites |
| `user_stats` | Denormalised score, level, pubs_visited per user — maintained by DB trigger |
| `users` | User profiles — username (unique), email |
| `friendships` | Bidirectional friendship rows with status `pending` / `accepted` |
| `leagues` | Private leagues with a unique 6-character invite code |
| `league_members` | Membership join table |

### Server RPCs

After the postcode migration, definitions live in `scripts/phase6_postcode_migration.sql` (run against Supabase). Legacy copies remain in `scripts/phase3_server_functions.sql`.

- `get_area_stats(user_id)` — per-**postcode district** visited/total/percentage/center + parent `postcode_area`
- `get_borough_stats(user_id)` — per-**postcode area** stats + district completion counts (`total_districts`, `completed_districts`)
- `get_achievements(user_id)` — trophies (`districtTrophies`, `postcodeAreaTrophies`) + totalScore + level
- `search_pubs(query, limit)` — name search; includes `postcode_district`, `postcode_area`
- `compute_user_stats(user_id)` — recompute and upsert a user's `user_stats` row
- `get_email_by_username(username)` — used for username-based login

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

- `get_achievements` recomputes `total_score` and `level` from scratch (3 full-table scans) rather than reading from `user_stats`. Acceptable for now but worth optimising if performance becomes a concern.
