import { CORE_LONDON_AREAS } from '../constants/londonAreas';

export const isLondonTrophy = (trophy) => {
  const id = typeof trophy.id === 'string' ? trophy.id : '';
  if (trophy.type === 'district' || trophy.type === 'area') {
    const m = id.match(/^district-([A-Z]+)/i);
    if (m) return CORE_LONDON_AREAS.has(m[1].toUpperCase());
  }
  if (trophy.type === 'postcode_area' || trophy.type === 'borough') {
    const m = id.match(/^(?:postcode[_-]?area|borough)-([A-Z]+)/i);
    if (m) return CORE_LONDON_AREAS.has(m[1].toUpperCase());
    return CORE_LONDON_AREAS.has(id.toUpperCase());
  }
  return true;
};

const sortTrophiesEarnedFirst = (trophies) =>
  [...trophies].sort((a, b) => {
    if (a.isAchieved && !b.isAchieved) return -1;
    if (!a.isAchieved && b.isAchieved) return 1;
    return 0;
  });

export const isAreaTrophyType = (trophy) => {
  const type = trophy?.type;
  return (
    type === 'district'
    || type === 'area'
    || type === 'postcode_area'
    || type === 'borough'
  );
};

/** District + postcode-area completion trophies for the Areas tab. */
export const getAreaTrophies = (achievements) => {
  if (!achievements) return [];
  const areas = [
    ...(achievements.districtTrophies || achievements.areaTrophies || []),
    ...(achievements.postcodeAreaTrophies || achievements.boroughTrophies || []),
  ].filter(isLondonTrophy);
  return sortTrophiesEarnedFirst(areas);
};

/** Pub specials, social, and other non-geography trophies for the Milestones tab. */
export const getMilestoneTrophies = (achievements) => {
  if (!achievements) return [];
  const milestones = (achievements.pubAchievements || []).filter(isLondonTrophy);
  return sortTrophiesEarnedFirst(milestones);
};

/** IDs of earned trophies shown in the profile trophies modal. */
export const getAchievedTrophyIds = (achievements) => {
  if (!achievements) return new Set();
  const all = [...getAreaTrophies(achievements), ...getMilestoneTrophies(achievements)];
  return new Set(
    all.filter((t) => t.isAchieved && t.id).map((t) => t.id),
  );
};
