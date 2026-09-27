/**
 * Push text for each notification_outbox kind. Pure (no I/O) so it can be tested
 * outside Deno: names are looked up by the caller in one query per batch.
 */
import { APP_DISPLAY_NAME } from "./app-brand.ts";

export type OutboxPayload = Record<string, unknown>;

export type PushMessage = {
  title: string;
  body: string;
  data: Record<string, unknown>;
};

/** User and league ids a row's text needs (resolved in bulk before building). */
export function referencedIds(kind: string, payload: OutboxPayload | null) {
  const p = payload ?? {};
  const userIds: string[] = [];
  const leagueIds: string[] = [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (kind === "friend_request") {
    const id = str(p.requester_id);
    if (id) userIds.push(id);
  } else if (kind === "pub_summon") {
    const id = str(p.summoner_id);
    if (id) userIds.push(id);
  } else if (kind === "league_added") {
    const who = str(p.added_by_user_id);
    const league = str(p.league_id);
    if (who) userIds.push(who);
    if (league) leagueIds.push(league);
  }
  return { userIds, leagueIds };
}

export function buildPushMessage(
  kind: string,
  payload: OutboxPayload | null,
  usernames: Map<string, string>,
  leagueNames: Map<string, string>,
): PushMessage {
  const p = payload ?? {};
  const nameOf = (id: unknown) =>
    (typeof id === "string" && usernames.get(id)) || "Someone";

  if (kind === "friend_request") {
    return {
      title: "Friend request",
      body: `${nameOf(p.requester_id)} wants to be friends on ${APP_DISPLAY_NAME}`,
      data: { kind, friendship_id: p.friendship_id, requester_id: p.requester_id },
    };
  }

  if (kind === "pub_summon") {
    const pubName = (typeof p.pub_name === "string" && p.pub_name.trim()) || "a pub";
    const pubArea = (typeof p.pub_area === "string" && p.pub_area.trim()) || "London";
    const lat = typeof p.lat === "number" ? p.lat : undefined;
    const lon = typeof p.lon === "number" ? p.lon : undefined;
    const mapsUrl =
      lat != null && lon != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
        : undefined;
    return {
      title: "Summon the troops!",
      body: `${nameOf(p.summoner_id)} has summoned you to ${pubName} in ${pubArea}. Tap here for directions.`,
      data: {
        kind,
        pub_id: p.pub_id,
        summoner_id: p.summoner_id,
        lat,
        lon,
        maps_url: mapsUrl,
      },
    };
  }

  if (kind === "league_added") {
    const leagueName =
      (typeof p.league_id === "string" && leagueNames.get(p.league_id)) || "a league";
    return {
      title: "League",
      body: `${nameOf(p.added_by_user_id)} added you to ${leagueName}`,
      data: { kind, league_id: p.league_id, added_by_user_id: p.added_by_user_id },
    };
  }

  if (kind === "monthly_digest") {
    const friendCount = Number(p.friend_count) || 0;
    const rank = Number(p.rank) || 0;
    const total = Number(p.total_in_board) || friendCount + 1;
    const body =
      friendCount > 0 && rank > 0
        ? `You're #${rank} of ${total} among your friends. Open ${APP_DISPLAY_NAME} to see the full leaderboard.`
        : "Add friends on the Leaderboard tab to compare your pub scores each month.";
    return {
      title: "Monthly leaderboard",
      body,
      data: {
        kind,
        year_month: p.year_month,
        rank: friendCount > 0 ? rank : null,
        friend_count: friendCount,
        total_in_board: total,
      },
    };
  }

  return {
    title: APP_DISPLAY_NAME,
    body: "You have a new notification",
    data: { kind },
  };
}
