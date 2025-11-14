import React from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const DARK_GREY = '#2C2C2C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';
const AMBER = '#D4A017';

// All possible features with their icons (in display order)
const ALL_FEATURES = [
  { name: 'Pub garden', icon: 'tree' },
  { name: 'Live music', icon: 'music' },
  { name: 'Food available', icon: 'silverware-fork-knife' },
  { name: 'Dog friendly', icon: 'dog' },
  { name: 'Pool/darts', icon: 'billiards' },
  { name: 'Parking', icon: 'parking' },
  { name: 'Accommodation', icon: 'bed' },
  { name: 'Cask/real ale', icon: 'barrel' },
];
  
// Check if a feature is active for this pub
const hasFeature = (pubFeatures, featureName) => {
  if (!pubFeatures || !Array.isArray(pubFeatures)) return false;
  return pubFeatures.some(f => f.toLowerCase() === featureName.toLowerCase());
};

export default function PubCardContent({
  pub,
  isExpanded,
  getImageSource,
  pointerEvents,
  onScroll,
  scrollEnabled,
  scrollRef
}) {
  return (
    <ScrollView
      style={styles.cardContent}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      scrollEnabled={scrollEnabled !== undefined ? scrollEnabled : isExpanded}
      pointerEvents={pointerEvents}
      onScroll={onScroll}
      scrollEventThrottle={16}
      bounces={false}
      directionalLockEnabled={true}
      ref={scrollRef}
    >
      <Text style={styles.pubName}>{pub.name}</Text>
      
      <View style={styles.areaRow}>
        {pub.area && (
          <Text style={styles.area}>{pub.area}</Text>
        )}
        {pub.ownership && (
          <Text style={styles.ownershipInline}>{pub.ownership}</Text>
        )}
      </View>
      
      {pub.photoUrl && (
        <View style={styles.photoContainer}>
          <Image 
            source={getImageSource(pub.photoUrl)} 
            style={styles.pubPhoto}
            resizeMode="cover"
          />
        </View>
      )}
      
      {/* Features - Always show all 8 feature icons */}
      <View style={styles.featuresContainer}>
        {ALL_FEATURES.map((feature, index) => {
          const isActive = hasFeature(pub.features, feature.name);
          return (
            <View key={index} style={styles.featureIconWrapper}>
              <MaterialCommunityIcons 
                name={feature.icon}
                size={24} 
                color={isActive ? AMBER : MEDIUM_GREY}
                style={[styles.featureIcon, !isActive && styles.featureIconInactive]}
              />
            </View>
          );
        })}
      </View>
      
      {/* Achievement - if present */}
      {pub.achievements && pub.achievements.length > 0 && (
        <View style={styles.achievementContainer}>
          <MaterialCommunityIcons 
            name="trophy" 
            size={16} 
            color={AMBER} 
          />
          <Text style={styles.achievementText}>
            {pub.achievements[0]}
          </Text>
        </View>
      )}
      
      {pub.address && (
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="map-marker" size={16} color={MEDIUM_GREY} />
          <Text style={styles.address}>
            {pub.address
              .split('\n')
              .map(part => part.trim())
              .filter(part => part.length > 0)
              .join(', ')}
          </Text>
        </View>
      )}
      
      {/* Phone and Founded on same row - two columns */}
      {(pub.phone || pub.founded) && (
        <View style={styles.twoColumnRow}>
          <View style={styles.columnLeft}>
      {pub.phone && (
              <>
          <MaterialCommunityIcons name="phone" size={16} color={MEDIUM_GREY} />
          <Text style={styles.phone}>{pub.phone}</Text>
              </>
            )}
        </View>
          
          <Text style={styles.columnSeparator}>|</Text>
      
          <View style={styles.columnRight}>
      {pub.founded && (
              <>
          <MaterialCommunityIcons name="calendar" size={16} color={MEDIUM_GREY} />
                <Text style={styles.founded}>{pub.founded}</Text>
              </>
            )}
          </View>
        </View>
      )}
      
      {pub.history && (
        <View style={styles.historyContainer}>
          <Text style={styles.history}>{pub.history}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cardContent: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 55, // Moved higher up now that buttons and handle have moved up
  },
  pubName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginBottom: 4,
    paddingRight: 40,
    paddingLeft: 0, // Remove left padding to align title to the left
  },
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  area: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 12,
  },
  ownershipInline: {
    fontSize: 14,
    color: MEDIUM_GREY,
    fontWeight: '500',
  },
  photoContainer: {
    width: '100%',
    height: 200,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: LIGHT_GREY,
  },
  pubPhoto: {
    width: '100%',
    height: '100%',
  },
  featuresContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  featureIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
  },
  featureIcon: {
    // No additional styles needed - handled by color prop
  },
  featureIconInactive: {
    opacity: 0.4,
  },
  achievementContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  achievementText: {
    fontSize: 14,
    color: AMBER,
    marginLeft: 8,
    fontWeight: '600',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  address: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
    flex: 1,
  },
  phone: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
  },
  founded: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
  },
  twoColumnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  columnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  columnRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  columnSeparator: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginHorizontal: 12,
  },
  historyContainer: {
    marginTop: 8,
    marginBottom: 16,
  },
  history: {
    fontSize: 14,
    color: DARK_GREY,
    lineHeight: 20,
    textAlign: 'justify',
  },
});

