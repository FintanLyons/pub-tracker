import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

function SearchSuggestions({
  visible,
  searchQuery,
  districtSuggestions = [],
  pubSuggestions,
  onDistrictPress,
  onPubPress,
  keyboardHeight,
  keyboardTop,
}) {
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;

  // Only show when visible and keyboard has appeared
  if (!visible || keyboardHeight === 0) return null;

  // Use the keyboard's top position directly to eliminate gap
  // This is the Y coordinate where the keyboard starts, which is exactly where we want the card to end
  const availableHeight = keyboardTop > 0 ? keyboardTop : screenHeight - keyboardHeight;
  const searchBarHeight = Math.max(insets.top, 8) + 8 + 56 + 8; // padding + bar height + bottom padding

  return (
    <View style={[styles.container, { height: availableHeight }]}>
      <View style={[styles.content, { paddingTop: searchBarHeight }]}>
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
                  <Text style={styles.suggestionText}>{pub.name}</Text>
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
    flex: 1,
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

