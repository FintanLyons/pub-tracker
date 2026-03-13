import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PintGlassIcon from '../components/PintGlassIcon';
import { getLevelProgress } from '../utils/levelSystem';
import { useUserStats } from '../contexts/UserStatsContext';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';
const AMBER = '#D4A017';
const BURGUNDY = '#A1183C';
const SAPPHIRE = '#2F4AA1';

export default function AchievementsScreen() {
  const {
    achievements,
    lastUpdated,
    refreshUserStats,
  } = useUserStats();

  const currentScore = achievements?.totalScore || 0;

  const trophies = useMemo(() => {
    if (!achievements) return [];
    const all = [
      ...(achievements.areaTrophies || []),
      ...(achievements.boroughTrophies || []),
      ...(achievements.pubAchievements || []),
    ];
    all.sort((a, b) => {
      if (a.isAchieved && !b.isAchieved) return -1;
      if (!a.isAchieved && b.isAchieved) return 1;
      return 0;
    });
    return all;
  }, [achievements]);

  useFocusEffect(
    useCallback(() => {
      const isStale = !lastUpdated || (Date.now() - lastUpdated > 30000);
      if (!isStale && achievements) return;
      InteractionManager.runAfterInteractions(() => {
        refreshUserStats().catch((error) => {
          console.error('Error refreshing achievements:', error);
        });
      });
    }, [lastUpdated, achievements, refreshUserStats])
  );

  const levelProgress = getLevelProgress(currentScore);

  const trophyRows = [];
  for (let i = 0; i < trophies.length; i += 3) {
    trophyRows.push(trophies.slice(i, i + 3));
  }

  const getTrophyIcon = (trophy) => {
    switch (trophy.type) {
      case 'borough':
        return trophy.isAchieved ? 'crown' : 'crown-outline';
      case 'achievement':
        return trophy.isAchieved ? 'medal' : 'medal-outline';
      case 'area':
      default:
        return trophy.isAchieved ? 'trophy' : 'trophy-outline';
    }
  };

  const getTrophyColor = (trophy) => {
    if (!trophy.isAchieved) {
      return MEDIUM_GREY;
    }
    switch (trophy.type) {
      case 'borough':
        return BURGUNDY;
      case 'achievement':
        return SAPPHIRE;
      case 'area':
      default:
        return AMBER;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <PintGlassIcon size={48} color={DARK_GREY} />
        <Text style={styles.title}>Achievements</Text>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.levelLabel}>Level {levelProgress.level}</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${levelProgress.progressPercentage}%` }]} 
            />
          </View>
        </View>
        
        <Text style={styles.scoreText}>Total Score: {currentScore}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trophy Collection</Text>
        {trophyRows.length === 0 ? (
          <Text style={styles.emptyText}>No trophies available</Text>
        ) : (
          trophyRows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.trophyRow}>
              {row.map((trophy) => (
                <View key={trophy.id} style={styles.trophyContainer}>
                  <View style={[
                    styles.trophyIconContainer,
                    !trophy.isAchieved && styles.trophyIconContainerLocked
                  ]}>
                    <MaterialCommunityIcons
                      name={getTrophyIcon(trophy)}
                      size={48}
                      color={getTrophyColor(trophy)}
                    />
                  </View>
                  <Text 
                    style={[
                      styles.trophyTitle,
                      !trophy.isAchieved && styles.trophyTitleLocked
                    ]}
                    numberOfLines={2}
                  >
                    {trophy.title}
                  </Text>
                  <Text 
                    style={[
                      styles.trophyDescription,
                      !trophy.isAchieved && styles.trophyDescriptionLocked
                    ]}
                    numberOfLines={1}
                  >
                    {trophy.description}
                  </Text>
                </View>
              ))}
              {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, idx) => (
                <View key={`empty-${idx}`} style={styles.trophyContainer} />
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginTop: 12,
  },
  statsCard: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  levelLabel: {
    fontSize: 18,
    color: MEDIUM_GREY,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreText: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textAlign: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: AMBER,
    borderRadius: 6,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textAlign: 'center',
    paddingVertical: 20,
  },
  trophyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  trophyContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
    minWidth: 100,
  },
  trophyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: LIGHT_GREY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  trophyIconContainerLocked: {
    backgroundColor: '#F0F0F0',
    opacity: 0.5,
  },
  trophyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK_GREY,
    textAlign: 'center',
    marginBottom: 4,
  },
  trophyTitleLocked: {
    color: MEDIUM_GREY,
    opacity: 0.6,
  },
  trophyDescription: {
    fontSize: 11,
    color: ACCENT_GREY,
    textAlign: 'center',
  },
  trophyDescriptionLocked: {
    color: MEDIUM_GREY,
    opacity: 0.5,
  },
});
