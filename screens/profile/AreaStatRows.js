import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';

export const DistrictStatRow = memo(function DistrictStatRow({ stat, drinks, onPress }) {
  return (
    <TouchableOpacity
      style={styles.areaCard}
      onPress={() => onPress(stat.district, stat.centerLat, stat.centerLon, stat.postcodeArea)}
      activeOpacity={0.7}
    >
      <View style={styles.areaHeader}>
        <View style={styles.areaTitleRow}>
          <Text style={styles.areaName} numberOfLines={1} ellipsizeMode="tail">
            {stat.districtDisplayName || stat.district}
          </Text>
          {stat.district && String(stat.district).toUpperCase() !== 'UNKNOWN' && (
            <Text style={styles.districtCodeInline} numberOfLines={1} ellipsizeMode="tail">
              {stat.district}
            </Text>
          )}
        </View>
        <View style={styles.areaCountRow}>
          {drinks > 0 && (
            <View style={styles.inlinePints}>
              <MaterialCommunityIcons name="beer-outline" size={13} color={COLORS.amber} />
              <Text style={styles.inlinePintsText}>{drinks}</Text>
            </View>
          )}
          <Text style={styles.areaCount}>
            {stat.visited} / {stat.total}
          </Text>
        </View>
      </View>
      <View style={styles.areaProgressBarContainer}>
        <View style={styles.areaProgressBarBackground}>
          <View style={[styles.areaProgressBarFill, { width: `${stat.percentage}%` }]} />
        </View>
        <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
      </View>
    </TouchableOpacity>
  );
});

export const PostcodeAreaStatRow = memo(function PostcodeAreaStatRow({ stat, drinks, onPress }) {
  const isInteractive = stat.postcodeArea && stat.postcodeArea !== 'Unknown';
  return (
    <TouchableOpacity
      style={styles.areaCard}
      onPress={() => onPress(stat.postcodeArea)}
      activeOpacity={isInteractive ? 0.7 : 1}
      disabled={!isInteractive}
    >
      <View style={styles.areaHeader}>
        <Text style={styles.areaName}>{stat.postcodeArea}</Text>
        <View style={styles.areaCountRow}>
          {drinks > 0 && (
            <View style={styles.inlinePints}>
              <MaterialCommunityIcons name="beer-outline" size={13} color={COLORS.amber} />
              <Text style={styles.inlinePintsText}>{drinks}</Text>
            </View>
          )}
          <Text style={styles.areaCount}>
            {stat.visited} / {stat.total}
          </Text>
        </View>
      </View>
      <View style={styles.areaProgressBarContainer}>
        <View style={styles.areaProgressBarBackground}>
          <View style={[styles.areaProgressBarFill, { width: `${stat.percentage}%` }]} />
        </View>
        <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
      </View>
      <View style={styles.districtCompletionSummary}>
        <MaterialCommunityIcons name="map-marker-radius" size={16} color={COLORS.darkGrey} />
        <Text style={styles.districtCompletionSummaryText}>
          Areas complete: {stat.completedDistricts} / {stat.totalDistricts}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  areaCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlinePints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 32,
  },
  inlinePintsText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.amber,
  },
  areaCard: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  areaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  areaTitleRow: {
    flex: 1,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  areaName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.darkGrey,
    flexShrink: 1,
  },
  districtCodeInline: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    letterSpacing: 0.3,
  },
  areaCount: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.accentGrey,
    minWidth: 56,
    textAlign: 'right',
  },
  areaProgressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  areaProgressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  areaProgressBarFill: {
    height: '100%',
    backgroundColor: COLORS.darkGrey,
    borderRadius: 4,
  },
  areaPercentage: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    minWidth: 45,
    textAlign: 'right',
  },
  districtCompletionSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  districtCompletionSummaryText: {
    marginLeft: 6,
    fontSize: 14,
    color: COLORS.darkGrey,
  },
});
