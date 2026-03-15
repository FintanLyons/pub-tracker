# Pub Tracker — Claude Context

> Your work will be checked by ChatGPT

## What this app is

Pub Tracker is a React Native mobile app for London pub enthusiasts. The core purpose is to let users track every pub they have ever visited, discover new venues, and compete with friends to see who has been to the most pubs.

Users earn points by visiting pubs, completing entire areas, and completing entire London boroughs. Friends can compare progress on a shared leaderboard. Private leagues with invite codes allow smaller groups to compete against each other.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile framework | React Native 0.81.5 / React 19 / Expo 54 |
| Backend / DB | Supabase (Postgres, Auth, RLS, RPCs) |
| Navigation | React Navigation v7 (bottom tabs) |
| Maps | react-native-maps |
| Build | Expo EAS |

## Scoring system

- Each visited pub → `pub.points` (default 10 if not set)
- Complete every pub in an area → +50 bonus
- Complete every pub in a borough → +200 bonus
- Level = `floor(total_score / 50) + 1`

Scoring logic lives in two places — keep them in sync if rules change:
- Client: `utils/levelSystem.js` (used for the Achievements progress bar only)
- Server: `scripts/phase3_server_functions.sql` → `compute_user_stats()` and `get_achievements()`

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

screens/          MapScreen, ProfileScreen, LeaderboardScreen,
                  AchievementsScreen, AuthScreen, FilterScreen

screens/map/hooks/  useViewportPubs, useFilterState, useAreaStats,
                    useLocation, useMapRegion, useNearestAreas,
                    useImageSource

components/       DraggablePubCard, PubCardContent, SearchBar,
                  SearchSuggestions, AddFriendModal, CreateLeagueModal,
                  JoinLeagueModal, LeagueActionsModal, ReportModal,
                  ReportMissingPubModal, OfflineOverlay, ErrorBoundary,
                  AreaIcon, PintGlassIcon, RangeSlider

scripts/          SQL migrations and Python data-pipeline scripts.
                  Not deployed code — run manually against Supabase.
```

## Database tables

| Table | Purpose |
|---|---|
| `pubs_all` | All London pubs — lat/lon, area, borough, ownership, features, points, achievement |
| `visited_pubs` | User visit records — trigger auto-updates `user_stats` on INSERT/DELETE |
| `favorite_pubs` | User favourites |
| `user_stats` | Denormalised score, level, pubs_visited per user — maintained by DB trigger |
| `users` | User profiles — username (unique), email |
| `friendships` | Bidirectional friendship rows with status `pending` / `accepted` |
| `leagues` | Private leagues with a unique 6-character invite code |
| `league_members` | Membership join table |

### Server RPCs (all in `scripts/phase3_server_functions.sql`)

- `get_area_stats(user_id)` — per-area visited/total/percentage/center
- `get_borough_stats(user_id)` — per-borough stats with area completion counts
- `get_achievements(user_id)` — full trophy list + totalScore + level
- `search_pubs(query, limit)` — name search with exact/prefix/contains ranking
- `compute_user_stats(user_id)` — recompute and upsert a user's `user_stats` row
- `get_email_by_username(username)` — used for username-based login

## Key conventions

- **Accent colour** — amber `#D4A017` for all interactive / brand elements
- **Primary text / surfaces** — dark charcoal `#1C1C1C` / `#2C2C2C`
- **Optimistic UI** — visited and favourite toggles update local state immediately and roll back on server error
- **Viewport-based pub loading** — `useViewportPubs` fetches only the pubs visible on screen (debounced 400 ms, bounds-cached to prevent duplicate fetches)
- **Stats are server-computed** — never aggregate visit counts client-side; use the RPCs
- **Visited/favourite cache** — module-level Sets in `PubService`. Call `clearVisitedFavoriteCache()` on logout (done in `AuthContext`)
- **`useFocusEffect` staleness check** — ProfileScreen and AchievementsScreen refresh stats if `lastUpdated` is older than 30 s

## Colour theme

All colours are defined in `constants/theme.js` and imported as `COLORS`. Do not declare colour constants locally in component files.

## Known issues to be aware of

- `get_achievements` recomputes `total_score` and `level` from scratch (3 full-table scans) rather than reading from `user_stats`. Acceptable for now but worth optimising if performance becomes a concern.
