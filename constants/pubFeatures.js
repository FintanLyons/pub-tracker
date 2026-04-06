import { PUB_FEATURE_CHIPS } from './pubFeatureChips';

/** Display rows for pub card + report form (name + MaterialCommunityIcons icon). */
export const PUB_FEATURES_DISPLAY = PUB_FEATURE_CHIPS.map(({ name, icon }) => ({ name, icon }));

export const hasPubFeature = (pubFeatures, featureName) => {
  if (!pubFeatures || !Array.isArray(pubFeatures)) return false;
  return pubFeatures.some((f) => f.toLowerCase() === featureName.toLowerCase());
};

/** Initial switch map for report form — all off. */
export const defaultFeatureSwitchState = () => {
  const o = {};
  for (const c of PUB_FEATURE_CHIPS) {
    o[c.name] = false;
  }
  return o;
};

/** Map pub.features array (from PubService) to label → has feature. */
export const featureMapFromPubFeatureArray = (pubFeatures) => {
  const o = {};
  for (const c of PUB_FEATURE_CHIPS) {
    o[c.name] = hasPubFeature(pubFeatures, c.name);
  }
  return o;
};
