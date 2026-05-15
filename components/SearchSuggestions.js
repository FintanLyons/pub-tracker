import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { formatDistrictWithCode } from '../utils/postcodeDistrictDisplayNames';

function SearchSuggestions({
  visible,
  searchQuery,
  districtSuggestions = [],
  pubSuggestions = [],
  onDistrictPress,
  onPubPress,
  onDismiss,
  keyboardHeight,
  keyboardTop,
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;

  // Gate on `visible` only. Do not require keyboardHeight > 0: the first tap on a row blurs the
  // TextInput and dismisses the keyboard, so keyboardHeight becomes 0 before onPress runs — if we
  // unmount here, the suggestion tap is lost (double-tap behaviour).
  if (!visible) return null;

  const searchBarHeight = Math.max(insets.top, 8) + 8 + 56 + 8; // padding + bar height + bottom padding
  // While keyboard is up, end the panel at the keyboard top; after dismiss (still visible briefly)
  // fill the screen so rows stay mounted until onBlur clears `visible`.
  const availableHeight =
    keyboardHeight > 0 && keyboardTop > 0
      ? keyboardTop
      : screenHeight;

  return (
    <View style={[styles.container, { height: availableHeight }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityLabel="Dismiss search"
        accessibilityRole="button"
      />
      <View style={[styles.content, { paddingTop: searchBarHeight }]} pointerEvents="box-none">
        {districtSuggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Postcode districts</Text>
            <View style={styles.suggestionsList}>
              {districtSuggestions.map((district, index) => {
                const code = typeof district === 'object' && district?.code != null
                  ? String(district.code)
                  : String(district);
                const label = typeof district === 'object' && district?.label != null
                  ? String(district.label)
                  : code;
                return (
                  <TouchableOpacity
                    key={`district-${code}-${index}`}
                    style={styles.suggestionItem}
                    onPress={() => onDistrictPress(code)}
                  >
                    <MaterialCommunityIcons name="map-marker-outline" size={18} color={COLORS.amber} />
                    <Text style={styles.suggestionText}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {pubSuggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pubs</Text>
            <View style={styles.suggestionsList}>
              {pubSuggestions.map((pub, index) => (
                <TouchableOpacity
                  key={`pub-${pub.id || index}`}
                  style={styles.suggestionItem}
                  onPress={() => onPubPress(pub)}
                >
                  <MaterialCommunityIcons name="glass-pint-outline" size={18} color={COLORS.amber} />
                  <View style={styles.pubSuggestionContent}>
                    <Text style={styles.suggestionText} numberOfLines={1}>
                      {pub.name}
                    </Text>
                    {!!(pub?.postcodeDistrict || pub?.area) && (
                      <Text style={styles.pubDistrictText} numberOfLines={1}>
                        {formatDistrictWithCode(pub.postcodeDistrict || pub.area)}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {districtSuggestions.length === 0 && pubSuggestions.length === 0 && searchQuery.length > 0 && (
          <View style={styles.noResults}>
            <Text style={styles.noResultsText}>No suggestions found</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    zIndex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.amber,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestionsList: {
    flexDirection: 'column',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  suggestionText: {
    fontSize: 16,
    color: COLORS.charcoal,
    marginLeft: 12,
    flexShrink: 1,
  },
  pubSuggestionContent: {
    marginLeft: 12,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pubDistrictText: {
    fontSize: 13,
    color: COLORS.mediumGrey,
    marginLeft: 8,
    flexShrink: 0,
  },
  noResults: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
  },
  noResultsText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
  },
});

export default React.memo(SearchSuggestions);

