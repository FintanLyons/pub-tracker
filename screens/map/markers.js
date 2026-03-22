import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { COLORS } from './constants';

const PUB_MARKER_VISITED = require('../../assets/pub_marker_visited.png');
const PUB_MARKER_UNVISITED = require('../../assets/pub_marker_unvisited.png');

export const BoroughMarker = React.memo(
  ({ summary, completion, onPress, tracksViewChanges }) => {
    if (!summary?.center) return null;

    return (
      <Marker
        coordinate={{
          latitude: summary.center.latitude,
          longitude: summary.center.longitude,
        }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={tracksViewChanges}
        onPress={() => onPress(summary)}
      >
        <Callout tooltip>
          <View style={markerStyles.boroughCallout}>
            <Text style={markerStyles.boroughCalloutText}>{summary.borough}</Text>
          </View>
        </Callout>
      </Marker>
    );
  },
  (prev, next) =>
    prev.tracksViewChanges === next.tracksViewChanges &&
    prev.summary?.borough === next.summary?.borough &&
    prev.summary?.center?.latitude === next.summary?.center?.latitude &&
    prev.summary?.center?.longitude === next.summary?.center?.longitude &&
    prev.completion === next.completion,
);

export const PubMarker = React.memo(
  ({ pub, onPress }) => {
    if (!pub || typeof pub.lat !== 'number' || typeof pub.lon !== 'number') return null;

    return (
      <Marker
        coordinate={{ latitude: pub.lat, longitude: pub.lon }}
        image={pub.isVisited ? PUB_MARKER_VISITED : PUB_MARKER_UNVISITED}
        tracksViewChanges={false}
        anchor={{ x: 0.5, y: 0.5 }}
        onPress={() => onPress(pub)}
      />
    );
  },
  (prev, next) =>
    prev.pub?.id === next.pub?.id &&
    prev.pub?.lat === next.pub?.lat &&
    prev.pub?.lon === next.pub?.lon &&
    prev.pub?.isVisited === next.pub?.isVisited &&
    prev.onPress === next.onPress,
);

const markerStyles = StyleSheet.create({
  boroughCallout: {
    backgroundColor: 'rgba(28, 28, 28, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    maxWidth: 160,
  },
  boroughCalloutText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
