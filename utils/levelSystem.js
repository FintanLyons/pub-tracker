/**
 * Level System Configuration
 * 
 * Level progression:
 * - Level 1: 0-49 points (50 points required)
 * - Level 2: 50-99 points (50 points required)
 * - Level 3: 100-149 points (50 points required)
 * - Level 4: 150-199 points (50 points required)
 * - And so on...
 * 
 * Each level requires 50 points to complete.
 */

const POINTS_PER_LEVEL = 50;

/**
 * Calculate the level for a given score
 * @param {number} score - The user's current score
 * @returns {number} - The current level (1-based)
 */
export const getLevel = (score) => {
  if (score < 0) return 1;
  // Level 1 starts at 0, so we add 1 to the floor division
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

