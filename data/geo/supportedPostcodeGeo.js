import londonDistricts from './london_postcode_districts.min.json';
import cambridgeDistricts from './cambridge_postcode_districts.min.json';
import londonAreaOutlines from './london_postcode_areas.min.json';
import cambridgeAreaOutlines from './cambridge_postcode_areas.min.json';
import londonAreaLabelPoints from './london_postcode_area_label_points.min.json';
import cambridgeAreaLabelPoints from './cambridge_postcode_area_label_points.min.json';

const mergeFeatureCollections = (...collections) => ({
  type: 'FeatureCollection',
  features: collections.flatMap((collection) => collection?.features || []),
});

export const postcodeDistrictGeojson = mergeFeatureCollections(
  londonDistricts,
  cambridgeDistricts,
);

export const postcodeAreaOutlinesGeojson = mergeFeatureCollections(
  londonAreaOutlines,
  cambridgeAreaOutlines,
);

export const postcodeAreaLabelPointsGeojson = mergeFeatureCollections(
  londonAreaLabelPoints,
  cambridgeAreaLabelPoints,
);
