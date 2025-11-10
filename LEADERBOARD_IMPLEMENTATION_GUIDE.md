# Leaderboard Feature - Implementation Guide

## 🎯 Overview

This guide walks you through implementing a complete leaderboard system with friends and leagues for your Pub Tracker app.

## 📋 What Has Been Created

### 1. **Services** (Backend Logic)
- `services/UserService.js` - User authentication, registration, and stats management
- `services/FriendsService.js` - Friend requests, acceptance, and friends leaderboard
- `services/LeagueService.js` - League creation, management, and league leaderboards

### 2. **Screens**
- `screens/LeaderboardScreen.js` - Main leaderboard screen with tabs for Friends and Leagues

### 3. **Components**
- `components/AddFriendModal.js` - Modal for searching and adding friends, accepting friend requests
- `components/CreateLeagueModal.js` - Modal for creating leagues and inviting friends

### 4. **Database Schema**
- `scripts/leaderboard_schema.sql` - Complete SQL schema for Supabase

### 5. **Navigation**
- Updated `navigation/TabNavigator.js` - Added Leaderboard tab between Profile and Achievements

---

## 🚀 Step-by-Step Implementation

### **STEP 1: Set Up Database Tables**

1. Open your **Supabase Dashboard** (https://supabase.com)
2. Navigate to **SQL Editor** (left sidebar)
3. Open the file `scripts/leaderboard_schema.sql`
4. Copy and paste the entire content into the SQL Editor
5. Click **Run** to execute the SQL commands

This will create:
- `users` table - Stores user accounts
- `user_stats` table - Stores user statistics
- `friendships` table - Stores friend relationships
- `leagues` table - Stores league information
- `league_members` table - Stores league memberships

**Note:** For development, Row Level Security (RLS) is commented out. For production, uncomment and configure the RLS policies.

---

### **STEP 2: Create User Authentication UI**

You need to create a simple login/registration screen. Here's a minimal example:

**Create `screens/AuthScreen.js`:**

```javascript
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { registerUser, loginUser } from '../services/UserService';

export default function AuthScreen({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleAuth = async () => {
    try {
      if (isLogin) {
        await loginUser(username, password);
      } else {
        await registerUser(email, username, password);
      }
      onAuthSuccess();
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isLogin ? 'Login' : 'Register'}</Text>
      
      {!isLogin && (
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
        />
      )}
      
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      
      <TouchableOpacity style={styles.button} onPress={handleAuth}>
        <Text style={styles.buttonText}>{isLogin ? 'Login' : 'Register'}</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
        <Text style={styles.switchText}>
          {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  input: {
    height: 48,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#D4A017',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  switchText: {
    color: '#757575',
    textAlign: 'center',
    marginTop: 20,
  },
});
```

---

### **STEP 3: Update App.js to Handle Authentication**

Modify your `App.js` to check if a user is logged in:

```javascript
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import TabNavigator from './navigation/TabNavigator';
import AuthScreen from './screens/AuthScreen';
import { getCurrentUser } from './services/UserService';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    const currentUser = await getCurrentUser();
    setUser(currentUser);
    setLoading(false);
  };

  if (loading) {
    return null; // or a loading screen
  }

  return (
    <NavigationContainer>
      {user ? (
        <TabNavigator />
      ) : (
        <AuthScreen onAuthSuccess={checkUser} />
      )}
    </NavigationContainer>
  );
}
```

---

### **STEP 4: Test the Features**

#### **A. User Registration & Login**
1. Launch your app
2. Register a new user with a unique username
3. Log out (you'll need to add a logout button in ProfileScreen)
4. Log back in

#### **B. Friends System**
1. Register multiple test users (use different usernames)
2. Go to the **Leaderboard** tab
3. Click the **Friends** tab
4. Click the **+ button** to open the Add Friend modal
5. Search for a username
6. Send a friend request
7. Log in as the other user
8. Go to Leaderboard → Friends → Requests tab
9. Accept the friend request
10. View the friends leaderboard

#### **C. Leagues System**
1. Go to the **Leaderboard** tab
2. Click the **Leagues** tab
3. Click the **+ button** to create a league
4. Enter a league name
5. Select friends to add (optional)
6. Click **Create**
7. View the league leaderboard
8. Create multiple leagues and switch between them

---

### **STEP 5: Sync User Stats**

The stats are automatically synced when:
- A user logs in
- The leaderboard screen is opened
- The leaderboard is refreshed (pull down)

You can also manually trigger sync by calling:
```javascript
import { syncUserStats } from './services/UserService';
await syncUserStats(userId);
```

Consider adding this to your ProfileScreen or whenever a user visits a pub.

---

## 🔧 Additional Features to Consider

### 1. **Add Logout Button to ProfileScreen**

Add this to your ProfileScreen:

```javascript
import { logoutUser } from '../services/UserService';

// In your component
const handleLogout = async () => {
  await logoutUser();
  // Navigate back to auth screen or reload app
};

// Add button in render
<TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
  <Text style={styles.logoutText}>Logout</Text>
</TouchableOpacity>
```

### 2. **Auto-Sync Stats**

Add this to your MapScreen or wherever users mark pubs as visited:

```javascript
import { getCurrentUser, syncUserStats } from '../services/UserService';

// After marking a pub as visited
const user = await getCurrentUser();
if (user) {
  await syncUserStats(user.id);
}
```

### 3. **Push Notifications for Friend Requests**

Consider using Expo Notifications to notify users when they receive friend requests.

### 4. **League Invitations**

Add a feature to send league invitations to friends instead of automatically adding them.

### 5. **User Profiles**

Create a user profile screen showing:
- Username
- Level
- Score
- Pubs visited
- Achievements

---

## 📊 How the Leaderboard Works

### **Scoring System**
- **Points from pubs**: Each pub visited gives 10 points (default, stored in `pub.points`)
- **Area completion bonus**: 50 points for completing 100% of an area
- **Total score**: Sum of pub points + area bonuses

### **Level System**
- Uses the existing `levelSystem.js`
- Every 50 points = 1 level
- Level progress shown in the Achievements tab

### **Leaderboards**
1. **Friends Leaderboard**: Shows you and all your accepted friends, sorted by score
2. **League Leaderboards**: Shows all members of a specific league, sorted by score

---

## 🎨 UI Features

### **LeaderboardScreen**
- Tab switcher (Friends / Leagues)
- Pull-to-refresh functionality
- Rank indicators (1st = gold, 2nd = silver, 3rd = bronze)
- Current user highlighted in amber
- Empty states with helpful messages

### **AddFriendModal**
- Search users by username
- View and accept/reject friend requests
- Badge showing pending requests count

### **CreateLeagueModal**
- Two-step process (name → add friends)
- Step indicator
- Select multiple friends
- Can create league without friends

---

## 🐛 Troubleshooting

### **"Supabase not configured" error**
- Check that `config/supabase.js` has valid URL and API key

### **"User not found" error**
- Make sure the user is registered in the database
- Check that the username is correct (case-sensitive)

### **Friends not showing in leaderboard**
- Ensure friend requests are accepted (status = 'accepted')
- Try pulling down to refresh

### **League not showing**
- Check that you're a member of the league
- Verify the league exists in the database

### **Stats not updating**
- Call `syncUserStats()` after marking pubs as visited
- Pull down to refresh on the leaderboard screen

---

## 📱 Next Steps

1. **Set up the database** using the SQL schema
2. **Create the auth screen** for login/registration
3. **Update App.js** to handle authentication
4. **Test the features** with multiple users
5. **Add auto-sync** for stats when pubs are visited
6. **Customize the UI** to match your app's design
7. **Add production security** (RLS policies, proper authentication)

---

## 🔐 Security Considerations (Production)

Before deploying to production:

1. **Enable Row Level Security (RLS)** on all tables
2. **Implement proper authentication** using Supabase Auth
3. **Add RLS policies** to restrict access:
   - Users can only read/update their own data
   - Friends can see each other's stats
   - League members can see league data
4. **Validate input** on the backend
5. **Rate limit** API calls to prevent abuse
6. **Hash passwords** (currently passwords are not hashed)

---

## 🎉 You're All Set!

You now have a complete leaderboard system with:
- ✅ User authentication and unique usernames
- ✅ User stats tracking (pubs visited, level, score)
- ✅ Friends system with friend requests
- ✅ Friends leaderboard
- ✅ Multiple leagues
- ✅ League leaderboards
- ✅ Beautiful UI with modals and animations

Happy coding! 🍻

