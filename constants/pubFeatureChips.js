/**
 * Single source for filterable pub features: display labels, filter UI icons,
 * and `pub_list` boolean column names used when building `pub.features`.
 */
export const PUB_FEATURE_CHIPS = [
  { name: 'Pub garden',    icon: 'tree',                  flag: 'has_pub_garden' },
  { name: 'Live music',    icon: 'music',                 flag: 'has_live_music' },
  { name: 'Food available', icon: 'silverware-fork-knife', flag: 'has_food_available' },
  { name: 'Dog friendly',  icon: 'dog',                   flag: 'has_dog_friendly' },
  { name: 'Pool/darts',    icon: 'billiards',             flag: 'has_pool_darts' },
  { name: 'Accommodation', icon: 'bed',                   flag: 'has_accommodation' },
  { name: 'Live sport',    icon: 'television-play',       flag: 'has_live_sport' },
];
