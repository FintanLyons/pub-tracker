/**
 * Scoring & level rules (client).
 *
 * Server source of truth: `compute_user_stats` (`scripts/scoring_postcode_district_tiered_bonus.sql`
 * and earlier migrations)
 * (Pubs_List path: `scripts/pub_list_migration.sql` + `scripts/create_pub_achievements_table.sql`).
 * `get_achievements` returns the same totalScore/level as `user_stats`.
 * Per-milestone bonus: `pub_achievements.points` when the pub is visited (see create_pub_achievements_table.sql).
 * Contribution points from `reports`: `scripts/scoring_contribution_reports.sql`.
 */

/** Points required to advance one level (total score). */
export const POINTS_PER_LEVEL = 50;

/** When a pub has no `points` set, visits use this many points. */
export const DEFAULT_PUB_VISIT_POINTS = 10;

/** Points per drink logged (sum of `pub_drinks.count`). */
export const POINTS_PER_DRINK = 1;

/** Area-complete tiers by district size (pub count); must match SQL. */
export const AREA_COMPLETION_SIZE_TIERS = [
  { key: 'S', points: 40 },
  { key: 'M', points: 60 },
  { key: 'L', points: 80 },
  { key: 'XL', points: 100 },
];

export function getPostcodeDistrictCompletionBonusPoints(pubCount) {
  const n = Number(pubCount) || 0;
  if (n < 10) return 40;
  if (n < 20) return 60;
  if (n < 30) return 80;
  return 100;
}

/** Bonus when every pub in a letter postcode region (e.g. SW) is visited. */
export const POSTCODE_AREA_COMPLETION_BONUS_POINTS = 1000;

/** Points per missing-pub report accepted by a moderator. */
export const POINTS_NEW_PUB_REPORT = 20;

/** Points per pub correction report accepted by a moderator. */
export const POINTS_PUB_CORRECTION_REPORT = 5;

/**
 * Calculate the level for a given score
 * @param {number} score - The user's current score
 * @returns {number} - The current level (1-based)
 */
export const getLevel = (score) => {
  if (score < 0) return 1;
  return Math.floor(score / POINTS_PER_LEVEL) + 1;
};

/**
 * Calculate the minimum points required for a level
 * @param {number} level - The level number (1-based)
 * @returns {number} - Minimum points required for that level
 */
export const getMinPointsForLevel = (level) => {
  if (level < 1) return 0;
  return (level - 1) * POINTS_PER_LEVEL;
};

/**
 * Calculate the maximum points for a level (exclusive)
 * @param {number} level - The level number (1-based)
 * @returns {number} - Maximum points for that level (exclusive)
 */
export const getMaxPointsForLevel = (level) => {
  return level * POINTS_PER_LEVEL;
};

/**
 * Calculate progress through the current level
 * @param {number} score - The user's current score
 * @returns {Object} - Object containing level, progress percentage, and points in current level
 */
export const getLevelProgress = (score) => {
  const level = getLevel(score);
  const minPoints = getMinPointsForLevel(level);
  const pointsInCurrentLevel = score - minPoints;
  const pointsNeededForLevel = POINTS_PER_LEVEL;
  const progressPercentage = Math.min(100, (pointsInCurrentLevel / pointsNeededForLevel) * 100);

  return {
    level,
    progressPercentage,
    pointsInCurrentLevel,
    pointsNeededForLevel,
    minPoints,
    maxPoints: getMaxPointsForLevel(level),
  };
};
