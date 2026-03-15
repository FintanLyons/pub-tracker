import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PintGlassIcon from '../components/PintGlassIcon';
import { getLevelProgress } from '../utils/levelSystem';
import { useUserStats } from '../contexts/UserStatsContext';
import { COLORS } from '../constants/theme';

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
      return COLORS.mediumGrey;
    }
    switch (trophy.type) {
      case 'borough':
        return COLORS.burgundy;
      case 'achievement':
        return COLORS.sapphire;
      case 'area':
      default:
        return COLORS.amber;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <PintGlassIcon size={48} color={COLORS.darkGrey} />
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
    color: COLORS.darkGrey,
    marginTop: 12,
  },
  statsCard: {
    backgroundColor: COLORS.lightGrey,
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
    color: COLORS.mediumGrey,
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
    color: COLORS.mediumGrey,
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
    backgroundColor: COLORS.amber,
    borderRadius: 6,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.mediumGrey,
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
    backgroundColor: COLORS.lightGrey,
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
    color: COLORS.darkGrey,
    textAlign: 'center',
    marginBottom: 4,
  },
  trophyTitleLocked: {
    color: COLORS.mediumGrey,
    opacity: 0.6,
  },
  trophyDescription: {
    fontSize: 11,
    color: COLORS.accentGrey,
    textAlign: 'center',
  },
  trophyDescriptionLocked: {
    color: COLORS.mediumGrey,
    opacity: 0.5,
  },
});
