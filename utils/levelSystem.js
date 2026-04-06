/**
 * Scoring & level rules (client).
 *
 * Keep in sync with server: `compute_user_stats` / `get_achievements` in
 * `scripts/phase6_postcode_migration.sql` (and legacy `phase3_server_functions.sql`).
 */

/** Points required to advance one level (total score). */
export const POINTS_PER_LEVEL = 50;

/** When a pub has no `points` set, visits use this many points. */
export const DEFAULT_PUB_VISIT_POINTS = 10;

/** Points per drink logged (sum of `pub_drinks.count`). */
export const POINTS_PER_DRINK = 1;

/** Bonus when every pub in a postcode district is visited. */
export const DISTRICT_COMPLETION_BONUS_POINTS = 50;

/** Bonus when every pub in a letter postcode area (e.g. SW) is visited. */
export const POSTCODE_AREA_COMPLETION_BONUS_POINTS = 1000;

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
