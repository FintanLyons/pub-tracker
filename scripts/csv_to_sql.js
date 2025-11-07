const fs = require('fs');
const path = require('path');

// Read the CSV file
const csvPath = path.join(__dirname, '../pubs_short.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

// Simple CSV parser that handles multi-line fields
function parseCSV(csv) {
  const lines = csv.split('\n');
  const headers = lines[0].split(',');
  const rows = [];
  
  let currentRow = {};
  let currentField = '';
  let currentFieldIndex = 0;
  let inQuotes = false;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.trim() === '') continue;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      
      if (char === ',' && !inQuotes) {
        currentRow[headers[currentFieldIndex]] = currentField.trim();
        currentField = '';
        currentFieldIndex++;
        
        if (currentFieldIndex >= headers.length) {
          currentFieldIndex = 0;
        }
        continue;
      }
      
      currentField += char;
    }
    
    // If we're not in quotes and hit a newline, finish the field
    if (!inQuotes) {
      if (currentFieldIndex < headers.length) {
        currentRow[headers[currentFieldIndex]] = currentField.trim();
      }
      
      // If we have all fields, save the row
      if (Object.keys(currentRow).length === headers.length) {
        rows.push({...currentRow});
        currentRow = {};
      }
      currentField = '';
      currentFieldIndex = 0;
    } else {
      // Still in quotes, add newline to field
      currentField += '\n';
    }
  }
  
  // Handle last row
  if (currentField.trim()) {
    currentRow[headers[currentFieldIndex]] = currentField.trim();
  }
  if (Object.keys(currentRow).length > 0) {
    rows.push(currentRow);
  }
  
  return rows;
}

// Better CSV parser using a library approach
function parseCSVBetter(csv) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    
    if (char === ',' && !inQuotes) {
      currentLine.push(currentField);
      currentField = '';
      continue;
    }
    
    if (char === '\n' && !inQuotes) {
      currentLine.push(currentField);
      lines.push(currentLine);
      currentLine = [];
      currentField = '';
      continue;
    }
    
    currentField += char;
  }
  
  // Last line
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField);
    lines.push(currentLine);
  }
  
  // Convert to objects
  const headers = lines[0];
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].length !== headers.length) continue;
    const row = {};
    headers.forEach((header, index) => {
      row[header] = lines[i][index] || '';
    });
    rows.push(row);
  }
  
  return rows;
}

// Escape SQL strings
function escapeSQL(str) {
  if (!str) return 'NULL';
  return `'${String(str).replace(/'/g, "''").replace(/\n/g, ' ')}'`;
}

// Parse features (they might be in brackets like [feature1, feature2])
function parseFeatures(featuresStr) {
  if (!featuresStr || featuresStr === '[]') return [];
  
  // Remove brackets and split
  const cleaned = featuresStr.replace(/[\[\]"]/g, '');
  if (!cleaned) return [];
  
  return cleaned.split(',').map(f => f.trim()).filter(f => f);
}

// Generate SQL INSERT statements
function generateSQL(rows) {
  const sqlStatements = [];
  const featureStatements = [];
  
  sqlStatements.push('-- Insert pubs');
  sqlStatements.push('BEGIN;');
  sqlStatements.push('');
  
  rows.forEach((row, index) => {
    const features = parseFeatures(row.features || '[]');
    
    // Generate INSERT for pub
    const sql = `INSERT INTO pubs (
  name,
  lat,
  lon,
  address,
  phone,
  description,
  founded,
  history,
  area,
  ownership,
  photo_url,
  points
) VALUES (
  ${escapeSQL(row.name)},
  ${row.lat || 'NULL'},
  ${row.lon || 'NULL'},
  ${escapeSQL(row.address)},
  ${escapeSQL(row.phone)},
  ${escapeSQL(row.description)},
  NULL, -- founded (not in CSV)
  NULL, -- history (not in CSV)
  ${escapeSQL(row.area)},
  NULL, -- ownership (not in CSV)
  ${escapeSQL(row.photoUrl || '')},
  10 -- default points
);`;
    
    sqlStatements.push(sql);
    
    // Store features for later
    if (features.length > 0) {
      features.forEach(feature => {
        featureStatements.push({
          pubIndex: index + 1,
          pubName: row.name,
          feature: feature
        });
      });
    }
    
    sqlStatements.push('');
  });
  
  sqlStatements.push('COMMIT;');
  
  // Generate feature inserts (note: these need pub IDs, which we'll handle differently)
  sqlStatements.push('');
  sqlStatements.push('-- Insert features');
  sqlStatements.push('-- NOTE: These use pub names to find the pub_id. If names are not unique, update manually.');
  sqlStatements.push('BEGIN;');
  sqlStatements.push('');
  
  featureStatements.forEach(f => {
    const sql = `INSERT INTO pub_features (pub_id, feature)
SELECT id, ${escapeSQL(f.feature)}
FROM pubs
WHERE name = ${escapeSQL(f.pubName)}
ON CONFLICT (pub_id, feature) DO NOTHING;`;
    sqlStatements.push(sql);
  });
  
  sqlStatements.push('');
  sqlStatements.push('COMMIT;');
  
  return sqlStatements.join('\n');
}

// Main execution
try {
  console.log('📖 Parsing CSV file...');
  const rows = parseCSVBetter(csvContent);
  console.log(`✅ Parsed ${rows.length} pubs`);
  
  console.log('📝 Generating SQL...');
  const sql = generateSQL(rows);
  
  const outputPath = path.join(__dirname, '../pubs_insert.sql');
  fs.writeFileSync(outputPath, sql, 'utf-8');
  
  console.log(`✅ SQL file generated: ${outputPath}`);
  console.log(`📊 Summary:`);
  console.log(`   - ${rows.length} pubs to insert`);
  console.log(`   - Features will be linked by pub name`);
  console.log('');
  console.log('⚠️  Note: photoUrl values from CSV are kept as-is.');
  console.log('   Use the Google image search script to update them with real photos.');
  
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

