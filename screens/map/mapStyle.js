export const customMapStyle = [
  {
    elementType: 'geometry',
    stylers: [{ lightness: 10 }, { saturation: -10 }],
  },
  {
    elementType: 'labels.text.fill',
    stylers: [{ saturation: -20 }, { lightness: 20 }],
  },
  {
    elementType: 'labels.text.stroke',
    stylers: [{ lightness: 30 }],
  },
  {
    featureType: 'poi',
    elementType: 'all',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'all',
    stylers: [{ visibility: 'on' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.text',
    stylers: [{ visibility: 'on' }],
  },
  {
    featureType: 'transit.station',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'on' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ lightness: 25 }, { saturation: -15 }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ lightness: 20 }, { saturation: -20 }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ hue: '#5c97bf' }, { lightness: 35 }, { saturation: -15 }],
  },
  {
    featureType: 'landscape',
    elementType: 'geometry',
    stylers: [{ lightness: 15 }, { saturation: -12 }],
  },
];
