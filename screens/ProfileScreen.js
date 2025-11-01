import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs } from '../services/PubService';
import PintGlassIcon from '../components/PintGlassIcon';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';

export default function ProfileScreen() {
  const [pubs, setPubs] = useState([]);
  const [visitedCount, setVisitedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [areaStats, setAreaStats] = useState([]);

  const loadStats = useCallback(async () => {
    const allPubs = await fetchLondonPubs();
    setPubs(allPubs);
    setTotalCount(allPubs.length);
    const visited = allPubs.filter(p => p.isVisited);
    setVisitedCount(visited.length);

    // Calculate area breakdown
    const areaMap = {};
    allPubs.forEach(pub => {
      const area = pub.area || 'Unknown';
      if (!areaMap[area]) {
        areaMap[area] = { total: 0, visited: 0 };
      }
      areaMap[area].total++;
      if (pub.isVisited) {
        areaMap[area].visited++;
      }
    });

    const stats = Object.entries(areaMap)
      .map(([area, counts]) => ({
        area,
        ...counts,
        percentage: counts.total > 0 ? Math.round((counts.visited / counts.total) * 100) : 0,
      }))
      .sort((a, b) => b.visited - a.visited || b.total - a.total);

    setAreaStats(stats);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );


  const progressPercentage = totalCount > 0 ? Math.round((visitedCount / totalCount) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <PintGlassIcon size={48} color={DARK_GREY} />
        <Text style={styles.title}>Pub Tracker</Text>
      </View>

      <View style={styles.statsCard}>
        <View style={styles.mainStat}>
          <Text style={styles.visitedNumber}>{visitedCount}</Text>
          <Text style={styles.totalNumber}>/ {totalCount}</Text>
        </View>
        <Text style={styles.statLabel}>Pubs Visited</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${progressPercentage}%` }]} 
            />
          </View>
          <Text style={styles.progressText}>{progressPercentage}%</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Breakdown by Area</Text>
        {areaStats.length === 0 ? (
          <Text style={styles.emptyText}>No areas found</Text>
        ) : (
          areaStats.map((stat, index) => (
            <View key={index} style={styles.areaCard}>
              <View style={styles.areaHeader}>
                <Text style={styles.areaName}>{stat.area}</Text>
                <Text style={styles.areaCount}>
                  {stat.visited} / {stat.total}
                </Text>
              </View>
              <View style={styles.areaProgressBarContainer}>
                <View style={styles.areaProgressBarBackground}>
                  <View 
                    style={[
                      styles.areaProgressBarFill, 
                      { width: `${stat.percentage}%` }
                    ]} 
                  />
                </View>
                <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
              </View>
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
  mainStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  visitedNumber: {
    fontSize: 56,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  totalNumber: {
    fontSize: 32,
    fontWeight: '600',
    color: MEDIUM_GREY,
    marginLeft: 4,
  },
  statLabel: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: DARK_GREY,
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    minWidth: 50,
    textAlign: 'right',
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
  areaCard: {
    backgroundColor: LIGHT_GREY,
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
  areaName: {
    fontSize: 18,
    fontWeight: '600',
    color: DARK_GREY,
    flex: 1,
  },
  areaCount: {
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT_GREY,
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
    backgroundColor: DARK_GREY,
    borderRadius: 4,
  },
  areaPercentage: {
    fontSize: 14,
    fontWeight: '600',
    color: MEDIUM_GREY,
    minWidth: 45,
    textAlign: 'right',
  },
});