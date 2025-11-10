# SQL Cheat Sheet - Quick Reference

## Apply Migrations (Run in Order)

```sql
-- Step 1: Add feature columns
-- Copy/paste: scripts/migrate_features_to_columns.sql

-- Step 2: Add achievement column
-- Copy/paste: scripts/migrate_achievements_to_column.sql

-- Step 3: Assign features and achievements
-- Copy/paste: scripts/add_features_and_achievements_columns.sql
```

## Common Queries

### View Pub Data
```sql
-- See all pubs with their features and achievements
SELECT 
    id,
    name,
    area,
    has_pub_garden,
    has_live_music,
    has_food_available,
    has_dog_friendly,
    has_pool_darts,
    has_parking,
    has_accommodation,
    has_cask_real_ale,
    achievement
FROM pubs
ORDER BY name;

-- Count features per pub
SELECT 
    name,
    (CASE WHEN has_pub_garden THEN 1 ELSE 0 END +
     CASE WHEN has_live_music THEN 1 ELSE 0 END +
     CASE WHEN has_food_available THEN 1 ELSE 0 END +
     CASE WHEN has_dog_friendly THEN 1 ELSE 0 END +
     CASE WHEN has_pool_darts THEN 1 ELSE 0 END +
     CASE WHEN has_parking THEN 1 ELSE 0 END +
     CASE WHEN has_accommodation THEN 1 ELSE 0 END +
     CASE WHEN has_cask_real_ale THEN 1 ELSE 0 END) as feature_count
FROM pubs
ORDER BY feature_count DESC;
```

### Modify Features
```sql
-- Add a single feature to a pub
UPDATE pubs SET has_pub_garden = true WHERE name = 'Abbey Arms';

-- Add multiple features
UPDATE pubs SET 
    has_food_available = true,
    has_dog_friendly = true,
    has_parking = true
WHERE name = 'George & Dragon';

-- Remove a feature
UPDATE pubs SET has_live_music = false WHERE id = 5;

-- Give all features to a pub
UPDATE pubs SET
    has_pub_garden = true,
    has_live_music = true,
    has_food_available = true,
    has_dog_friendly = true,
    has_pool_darts = true,
    has_parking = true,
    has_accommodation = true,
    has_cask_real_ale = true
WHERE name = 'Best Pub Ever';
```

### Modify Achievements
```sql
-- Add an achievement
UPDATE pubs SET achievement = 'Best Ales' WHERE name = 'Abbey Arms';

-- Change an achievement
UPDATE pubs SET achievement = 'Dog Friendly Champion' WHERE id = 3;

-- Remove an achievement
UPDATE pubs SET achievement = NULL WHERE name = 'Birchwood';

-- List all achievements
SELECT name, achievement 
FROM pubs 
WHERE achievement IS NOT NULL 
ORDER BY name;
```

### Search and Filter
```sql
-- Find pubs with specific features
SELECT name FROM pubs WHERE has_food_available = true;
SELECT name FROM pubs WHERE has_parking = true AND has_dog_friendly = true;
SELECT name FROM pubs WHERE has_live_music = true AND has_cask_real_ale = true;

-- Find pubs WITHOUT a feature
SELECT name FROM pubs WHERE has_accommodation = false;

-- Find pubs with achievements
SELECT name, achievement FROM pubs WHERE achievement IS NOT NULL;

-- Find pubs by area with features
SELECT name, area FROM pubs 
WHERE area = 'Balham' AND has_food_available = true;
```

### Statistics
```sql
-- Count pubs by feature
SELECT 
    'Pub Garden' as feature, COUNT(*) as count FROM pubs WHERE has_pub_garden = true
UNION ALL SELECT 'Live Music', COUNT(*) FROM pubs WHERE has_live_music = true
UNION ALL SELECT 'Food Available', COUNT(*) FROM pubs WHERE has_food_available = true
UNION ALL SELECT 'Dog Friendly', COUNT(*) FROM pubs WHERE has_dog_friendly = true
UNION ALL SELECT 'Pool/Darts', COUNT(*) FROM pubs WHERE has_pool_darts = true
UNION ALL SELECT 'Parking', COUNT(*) FROM pubs WHERE has_parking = true
UNION ALL SELECT 'Accommodation', COUNT(*) FROM pubs WHERE has_accommodation = true
UNION ALL SELECT 'Cask/Real Ale', COUNT(*) FROM pubs WHERE has_cask_real_ale = true
ORDER BY count DESC;

-- Count pubs with achievements
SELECT COUNT(*) FROM pubs WHERE achievement IS NOT NULL;

-- Pubs by area with feature counts
SELECT 
    area,
    COUNT(*) as total_pubs,
    SUM(CASE WHEN has_food_available THEN 1 ELSE 0 END) as with_food,
    SUM(CASE WHEN has_parking THEN 1 ELSE 0 END) as with_parking
FROM pubs
GROUP BY area
ORDER BY area;
```

### Reset Everything
```sql
-- Reset all features (back to false)
UPDATE pubs SET
    has_pub_garden = false,
    has_live_music = false,
    has_food_available = false,
    has_dog_friendly = false,
    has_pool_darts = false,
    has_parking = false,
    has_accommodation = false,
    has_cask_real_ale = false;

-- Reset all achievements
UPDATE pubs SET achievement = NULL;

-- Then re-run: scripts/add_features_and_achievements_columns.sql
```

### Bulk Operations
```sql
-- Give all pubs in an area a feature
UPDATE pubs SET has_parking = true WHERE area = 'Balham';

-- Remove feature from all pubs
UPDATE pubs SET has_accommodation = false;

-- Copy feature from one pub to another
UPDATE pubs SET 
    has_pub_garden = (SELECT has_pub_garden FROM pubs WHERE name = 'Source Pub'),
    has_live_music = (SELECT has_live_music FROM pubs WHERE name = 'Source Pub')
WHERE name = 'Target Pub';
```

## Feature Column Reference

| Column Name | Display Name | Icon | Typical % |
|-------------|--------------|------|-----------|
| `has_pub_garden` | Pub garden | 🌳 | 60% |
| `has_live_music` | Live music | 🎵 | 40% |
| `has_food_available` | Food available | 🍴 | 70% |
| `has_dog_friendly` | Dog friendly | 🐕 | 50% |
| `has_pool_darts` | Pool/darts | 🎱 | 30% |
| `has_parking` | Parking | 🅿️ | 45% |
| `has_accommodation` | Accommodation | 🛏️ | 15% |
| `has_cask_real_ale` | Cask/real ale | 🛢️ | 55% |

## Quick Tips

💡 Use `WHERE` clauses for filtering (e.g., `WHERE has_food_available = true`)  
💡 Use `UPDATE` to modify features/achievements  
💡 Use `NULL` for pubs with no achievement  
💡 Combine features with `AND` for multiple requirements  
💡 Test queries with `LIMIT 5` first before running on all pubs  

## Useful Templates

```sql
-- Find the perfect pub for you
SELECT name, area, achievement
FROM pubs
WHERE has_food_available = true
  AND has_dog_friendly = true
  AND has_parking = true
ORDER BY name;

-- Most feature-rich pubs
SELECT name,
    (CASE WHEN has_pub_garden THEN 1 ELSE 0 END +
     CASE WHEN has_live_music THEN 1 ELSE 0 END +
     CASE WHEN has_food_available THEN 1 ELSE 0 END +
     CASE WHEN has_dog_friendly THEN 1 ELSE 0 END +
     CASE WHEN has_pool_darts THEN 1 ELSE 0 END +
     CASE WHEN has_parking THEN 1 ELSE 0 END +
     CASE WHEN has_accommodation THEN 1 ELSE 0 END +
     CASE WHEN has_cask_real_ale THEN 1 ELSE 0 END) as features
FROM pubs
ORDER BY features DESC
LIMIT 10;
```

---

**Need Help?** See the detailed guides in the scripts folder!

