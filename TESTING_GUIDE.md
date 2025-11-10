# Testing Guide - Authentication & Leaderboard

## 🚀 Quick Start Testing

Your authentication system is now fully integrated! Here's how to test everything.

---

## 1️⃣ **Test User Registration**

### Steps:
1. Launch the app
2. You should see the **AuthScreen** with Login/Register tabs
3. Click the **Register** tab
4. Fill in:
   - **Email**: `user1@test.com`
   - **Username**: `user1` (3-20 characters, alphanumeric + underscores)
   - **Password**: `password123` (minimum 6 characters)
   - **Confirm Password**: `password123`
5. Click **Create Account**

### Expected Result:
- ✅ Success message: "Account created!"
- ✅ Automatically logged in
- ✅ App shows the main TabNavigator (Map, Profile, Leaderboard, Achievements)
- ✅ Profile screen shows username: `@user1`

---

## 2️⃣ **Test Logout**

### Steps:
1. Go to the **Profile** tab
2. Look for the **logout icon** (🚪) in the top right corner
3. Click the logout button
4. Confirm logout in the alert dialog

### Expected Result:
- ✅ Alert asks: "Are you sure you want to logout?"
- ✅ Click "Logout"
- ✅ App returns to AuthScreen
- ✅ No user data shown

---

## 3️⃣ **Test Login**

### Steps:
1. On the AuthScreen, ensure you're on the **Login** tab
2. Fill in:
   - **Username**: `user1`
   - **Password**: `password123`
3. Click **Login**

### Expected Result:
- ✅ Success message: "Welcome back!"
- ✅ App shows main TabNavigator
- ✅ Profile shows `@user1`

---

## 4️⃣ **Test Username Uniqueness**

### Steps:
1. Logout
2. Try to register again with:
   - Email: `user2@test.com`
   - Username: `user1` (same as before)
   - Password: `password123`
3. Click Create Account

### Expected Result:
- ❌ Error: "This username is already taken. Please choose another."
- ✅ Registration blocked
- ✅ Try with `user2` and it should work

---

## 5️⃣ **Test Multiple Users (Friends Feature)**

### Create 3 test users:

**User 1:**
- Email: `alice@test.com`
- Username: `alice`
- Password: `password123`

**User 2:**
- Email: `bob@test.com`
- Username: `bob`
- Password: `password123`

**User 3:**
- Email: `charlie@test.com`
- Username: `charlie`
- Password: `password123`

### For each user:
1. Logout
2. Register with credentials above
3. Visit some pubs (mark as visited)
4. Go back to Profile to see stats synced

---

## 6️⃣ **Test Friends System**

### Add Friends:
1. Login as `alice`
2. Go to **Leaderboard** tab
3. Click **Friends** tab
4. Click the **+ button** (top right)
5. Click **Search** tab
6. Search for `bob`
7. Click the **+ button** next to bob's name
8. Success! Friend request sent

### Accept Friend Request:
1. Logout and login as `bob`
2. Go to **Leaderboard** → **Friends**
3. Click the **+ button**
4. Click **Requests** tab
5. You should see alice's request
6. Click the **✓ (checkmark)** button
7. Request accepted!

### View Friends Leaderboard:
1. Go back to **Leaderboard** → **Friends** tab
2. You should see both `alice` and `bob` in the leaderboard
3. Sorted by score (total points)
4. Shows rank, username, pubs visited, level, and score

---

## 7️⃣ **Test Leagues System**

### Create a League:
1. Login as `alice`
2. Go to **Leaderboard** tab
3. Click **Leagues** tab
4. Click the **+ button**
5. Enter league name: `London Pub Crawlers`
6. Click **Next**
7. Select friends to add (`bob`, `charlie`)
8. Click **Create**

### View League Leaderboard:
1. You should see the league leaderboard
2. Shows all members sorted by score
3. You can see rank, username, stats

### Switch Between Leagues:
1. Create another league: `Weekend Warriors`
2. Add different friends
3. Go to **Leaderboard** → **Leagues**
4. Click the **⇄ (swap)** icon next to the league name
5. Select a different league
6. Leaderboard updates

---

## 8️⃣ **Test Stats Syncing**

### Automatic Sync:
Stats are automatically synced when:
- ✅ User logs in
- ✅ Leaderboard screen is opened
- ✅ User pulls down to refresh (pull-to-refresh gesture)

### Manual Test:
1. Login as `alice`
2. Go to **Map** tab
3. Mark 5 pubs as visited
4. Go to **Leaderboard** tab
5. Pull down to refresh
6. Check that stats updated

---

## 9️⃣ **Test UI Features**

### Authentication Screen:
- ✅ Tab switcher (Login/Register)
- ✅ Input validation (username format, email format, password length)
- ✅ Password confirmation
- ✅ Loading indicator during registration/login
- ✅ Error messages displayed properly
- ✅ Icons for each input field

### Profile Screen:
- ✅ Shows username `@username` under title
- ✅ Logout button in top right (red icon)
- ✅ Logout confirmation dialog

### Leaderboard Screen:
- ✅ Friends/Leagues tab switcher
- ✅ Gold (🥇), Silver (🥈), Bronze (🥉) rank colors
- ✅ Current user highlighted in amber
- ✅ Pull-to-refresh works
- ✅ Add friend modal opens
- ✅ Create league modal opens
- ✅ Empty states show helpful messages

### Modals:
- ✅ Add Friend Modal:
  - Search tab with username search
  - Requests tab with pending requests
  - Accept/reject buttons
- ✅ Create League Modal:
  - Two-step wizard (name → friends)
  - Step indicator
  - Friend selection with checkmarks

---

## 🐛 Common Issues & Solutions

### Issue: "Supabase not configured" error
**Solution:** Check that `config/supabase.js` has valid URL and API key

### Issue: Can't find users when searching
**Solution:** Make sure users are registered in the database first

### Issue: Stats not updating
**Solution:** Pull down to refresh on the leaderboard screen

### Issue: Logout doesn't work
**Solution:** 
- Check console for errors
- Make sure AuthContext is properly imported
- Restart the app

### Issue: Friends not showing in leaderboard
**Solution:** Make sure friend request is accepted (status = 'accepted' in database)

---

## 📊 Test Checklist

Use this checklist to verify everything works:

### Authentication:
- [ ] User registration works
- [ ] Username uniqueness enforced
- [ ] Email validation works
- [ ] Password validation works
- [ ] Login works
- [ ] Logout works
- [ ] Auth state persists (user stays logged in after app restart)

### Friends:
- [ ] Can search for users
- [ ] Can send friend requests
- [ ] Can view pending requests
- [ ] Can accept friend requests
- [ ] Can reject friend requests
- [ ] Friends leaderboard shows correctly
- [ ] Leaderboard sorted by score
- [ ] Current user highlighted

### Leagues:
- [ ] Can create league
- [ ] Can add friends to league
- [ ] League leaderboard shows correctly
- [ ] Can switch between leagues
- [ ] Can create multiple leagues
- [ ] All members see same leaderboard

### Stats:
- [ ] Stats sync on login
- [ ] Stats sync on leaderboard open
- [ ] Stats update when refreshing
- [ ] Correct calculation (pubs + area bonuses)
- [ ] Level calculated correctly

### UI:
- [ ] No linter errors
- [ ] Smooth animations
- [ ] Loading states work
- [ ] Error messages clear
- [ ] Empty states helpful
- [ ] Icons display correctly
- [ ] Colors match design

---

## 🎉 Success Criteria

Your leaderboard feature is working if:
1. ✅ Users can register with unique usernames
2. ✅ Users can login and logout
3. ✅ Users can find and add friends
4. ✅ Friends can compete on a leaderboard
5. ✅ Users can create and join leagues
6. ✅ Leaderboards show accurate rankings
7. ✅ Stats sync automatically
8. ✅ UI is smooth and responsive

---

## 🚀 Next Steps

Once testing is complete:
1. Add more features (notifications, achievements, etc.)
2. Improve security (add proper password hashing)
3. Add production-ready authentication (Supabase Auth)
4. Deploy to production
5. Share with friends and start competing! 🍻

---

## 📝 Notes

- All test users use `password123` for simplicity
- In production, use stronger passwords and hashing
- For development, RLS (Row Level Security) is disabled
- Enable RLS before going to production

Happy testing! 🎊

