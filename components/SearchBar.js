import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';

export default function SearchBar({ searchQuery, setSearchQuery, onSearch, onClear }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.searchContainer, { paddingTop: Math.max(insets.top, 8) + 8 }]}>
      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={20} color={AMBER} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor={AMBER}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={onClear} style={styles.clearButton}>
            <MaterialCommunityIcons name="close-circle" size={20} color={AMBER} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DARK_CHARCOAL,
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: AMBER,
    padding: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
});

