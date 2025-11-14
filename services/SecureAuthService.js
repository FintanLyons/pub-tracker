/**
 * Secure Authentication Service using Supabase Auth
 * This replaces the basic UserService with proper security:
 * - Password hashing (automatic via Supabase)
 * - Email verification
 * - Session management
 * - Secure token handling
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_CONFIG } from '../config/supabase';
import { fetchLondonPubs } from './PubService';
import { getLevelProgress } from '../utils/levelSystem';

// Initialize Supabase client
const SUPABASE_URL = SUPABASE_CONFIG.url;
const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey;

/**
 * Register a new user with Supabase Auth
 * Password is automatically hashed by Supabase
 * Email verification is sent automatically
 */
export const registerUserSecure = async (email, username, password) => {
  try {
    // 1. Check if email is already registered
    try {
      const emailCheckResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${email}&select=email`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (emailCheckResponse.ok) {
        const existingEmails = await emailCheckResponse.json();
        if (existingEmails.length > 0) {
          throw new Error('EMAIL_ALREADY_EXISTS');
        }
      }
    } catch (emailCheckError) {
      if (emailCheckError.message === 'EMAIL_ALREADY_EXISTS') {
        throw emailCheckError; // Re-throw email exists error
      }
      console.log('Email check skipped:', emailCheckError.message);
    }

    // 2. Check if username is already taken (optional check - will fail gracefully)
    try {
      const checkResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/users?username=eq.${username}&select=username`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (checkResponse.ok) {
        const existingUsers = await checkResponse.json();
        if (existingUsers.length > 0) {
          throw new Error('Username already taken');
        }
      }
      // If check fails, continue anyway - we'll catch duplicates later
    } catch (checkError) {
      if (checkError.message === 'Username already taken') {
        throw checkError; // Re-throw username error
      }
      console.log('Username check skipped:', checkError.message);
      // Continue with registration
    }

    // 3. Register with Supabase Auth (password gets hashed automatically)
    const signUpResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/signup`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          data: {
            username, // Store username in user metadata
          },
        }),
      }
    );

    if (!signUpResponse.ok) {
      const error = await signUpResponse.json();
      const errorMsg = error.msg || error.message || error.error_description || 'Registration failed';
      
      console.log('Registration error from Supabase:', errorMsg);
      
      // Handle specific errors
      if (errorMsg.includes('seconds') || errorMsg.includes('rate limit')) {
        throw new Error('Too many registration attempts. Please wait a minute and try again.');
      }
      
      // Check for duplicate email
      if (errorMsg.toLowerCase().includes('already') || 
          errorMsg.toLowerCase().includes('exist') ||
          errorMsg.toLowerCase().includes('duplicate')) {
        throw new Error('EMAIL_ALREADY_EXISTS');
      }
      
      throw new Error(errorMsg);
    }

    const authData = await signUpResponse.json();
    
    console.log('Registration raw response:', authData);

    // Check if we have the expected data structure
    if (!authData || typeof authData !== 'object') {
      console.error('Invalid auth data:', authData);
      throw new Error('Invalid response from server');
    }

    // Supabase returns different structures depending on email confirmation:
    // - With email confirmation: returns user object directly (no session)
    // - Without email confirmation: returns { user: {...}, session: {...} }
    const userData = authData.user || authData; // Handle both cases
    const sessionData = authData.session || null;

    console.log('Parsed user data:', {
      hasUserData: !!userData,
      hasSession: !!sessionData,
      userId: userData?.id,
      emailConfirmed: userData?.email_confirmed_at,
      username: userData?.user_metadata?.username,
    });

    if (!userData || !userData.id) {
      console.error('User data missing or invalid:', userData);
      throw new Error('Registration failed - user ID missing');
    }

    // Note: session will be null if email confirmation is required
    const hasSession = !!(sessionData && sessionData.access_token);
    const needsEmailVerification = !userData.email_confirmed_at;

    // 4. Create user profile in users table
    let user = {
      id: userData.id,
      email: userData.email || email,
      username: userData.user_metadata?.username || username,
    };

    // Only try to create/fetch profile if we have a session (email verified)
    if (hasSession) {
      try {
        const userProfileResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/users`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${sessionData.access_token}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify({
              id: userData.id,
              email,
              username,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }),
          }
        );

        if (userProfileResponse.ok) {
          const userProfile = await userProfileResponse.json();
          user = Array.isArray(userProfile) ? userProfile[0] : userProfile;
        }
      } catch (profileError) {
        console.log('Profile will be created after email verification');
      }
    }

    // 5. Save session only if email is verified
    if (hasSession) {
      await saveSession(sessionData, user);

      // 6. Initialize user stats
      try {
        await syncUserStats(user.id);
      } catch (statsError) {
        console.log('Stats sync skipped:', statsError.message);
      }
    }

    return {
      user,
      session: sessionData,
      needsEmailVerification,
    };
  } catch (error) {
    // Provide user-friendly error messages
    const errorMsg = error.message || 'Registration failed';
    
    // Expected validation errors - don't log these as errors
    if (errorMsg === 'EMAIL_ALREADY_EXISTS') {
      throw new Error('This email is already registered. Please use the login tab instead.');
    } else if (errorMsg.includes('already registered') || errorMsg.includes('User already registered')) {
      throw new Error('This email is already registered. Please use the login tab instead.');
    } else if (errorMsg.includes('Username already taken')) {
      throw error; // Pass through username error
    } else if (errorMsg.includes('rate limit') || errorMsg.includes('seconds')) {
      throw new Error('Too many attempts. Please wait a minute and try again.');
    } else if (errorMsg.includes('invalid')) {
      throw new Error('Please check your email and password format.');
    }
    
    // Only log unexpected system errors
    console.error('Secure registration error:', error);
    throw error;
  }
};

/**
 * Helper: Find email by username
 */
const findEmailByUsername = async (usernameOrEmail) => {
  console.log('  → findEmailByUsername called with:', usernameOrEmail);
  
  // If it looks like an email, return it
  if (usernameOrEmail.includes('@')) {
    console.log('  → Input is already an email, returning as-is');
    return usernameOrEmail;
  }

  // Otherwise, look up username in users table
  console.log('  → Input is a username, looking up email in database...');
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?username=eq.${usernameOrEmail}&select=email`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    console.log('  → Username lookup response status:', response.status);

    if (!response.ok) {
      console.log('  → ❌ Username lookup failed!');
      throw new Error('User not found');
    }

    const users = await response.json();
    console.log('  → Username lookup result:', users);
    
    if (users.length === 0) {
      console.log('  → ❌ No user found with username:', usernameOrEmail);
      throw new Error('User not found');
    }

    console.log('  → ✅ Email found:', users[0].email);
    return users[0].email;
  } catch (error) {
    console.log('  → ❌ Exception in username lookup:', error.message);
    throw new Error('User not found');
  }
};

/**
 * Login user with Supabase Auth
 * Password is securely verified by Supabase
 * Accepts either username or email
 */
export const loginUserSecure = async (usernameOrEmail, password) => {
  try {
    console.log('=== LOGIN ATTEMPT ===');
    console.log('Input (username or email):', usernameOrEmail);
    console.log('Password length:', password?.length);
    
    // 1. Convert username to email if needed
    console.log('Step 1: Converting username to email...');
    const email = await findEmailByUsername(usernameOrEmail);
    console.log('Email resolved to:', email);

    // 2. Login with Supabase Auth
    console.log('Step 2: Calling Supabase Auth API...');
    console.log('Supabase URL:', SUPABASE_URL);
    const signInResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      }
    );

    console.log('Auth API Response Status:', signInResponse.status);

    if (!signInResponse.ok) {
      const error = await signInResponse.json();
      console.log('Auth API Error Response:', error);
      throw new Error(error.error_description || 'Login failed');
    }

    const authData = await signInResponse.json();
    console.log('Auth API Success! User data received:', {
      userId: authData.user?.id,
      email: authData.user?.email,
      emailConfirmed: authData.user?.email_confirmed_at,
      hasAccessToken: !!authData.access_token,
    });

    // Check if email is verified
    console.log('Step 3: Checking email verification...');
    if (!authData.user.email_confirmed_at) {
      console.log('❌ Email not confirmed!');
      throw new Error('Email not confirmed. Please verify your email before logging in.');
    }
    console.log('✅ Email is confirmed!');

    console.log('Step 4: Fetching user profile from public.users table...');
    console.log('User ID to fetch:', authData.user.id);

    // 3. Fetch user profile
    const userResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${authData.user.id}`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${authData.access_token}`,
        },
      }
    );

    console.log('Profile fetch response status:', userResponse.status);

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.log('❌ Profile fetch failed!');
      console.log('Status:', userResponse.status);
      console.log('Error:', errorText);
      throw new Error('Unable to load user profile. Please try again or contact support.');
    }

    const users = await userResponse.json();
    console.log('Profile fetch result:', {
      found: users.length,
      profiles: users,
    });

    if (!users || users.length === 0) {
      console.log('⚠️  No user profile found!');
      console.log('Step 5: Creating user profile...');
      
      // Try to create the profile if it doesn't exist
      try {
        const profileData = {
          id: authData.user.id,
          email: authData.user.email,
          username: authData.user.user_metadata?.username || authData.user.email.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        console.log('Profile data to create:', profileData);
        
        const createResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/users`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${authData.access_token}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(profileData),
          }
        );

        console.log('Profile creation response status:', createResponse.status);

        if (createResponse.ok) {
          const newUsers = await createResponse.json();
          const user = Array.isArray(newUsers) ? newUsers[0] : newUsers;
          console.log('✅ User profile created successfully:', user);
          
          // 4. Save session
          console.log('Step 6: Saving session...');
          await saveSession(authData, user);
          console.log('✅ Session saved!');
          
          console.log('=== LOGIN SUCCESSFUL ===');
          return {
            user,
            session: authData,
          };
        } else {
          const createError = await createResponse.text();
          console.log('❌ Failed to create user profile!');
          console.log('Status:', createResponse.status);
          console.log('Error:', createError);
          throw new Error('Unable to set up your account. Please contact support.');
        }
      } catch (createError) {
        console.log('❌ Exception creating user profile:', createError);
        throw new Error('Unable to set up your account. Please contact support.');
      }
    }

    const user = users[0];
    console.log('✅ User profile loaded:', user);

    // 4. Save session
    console.log('Step 5: Saving session...');
    await saveSession(authData, user);
    console.log('✅ Session saved!');

    console.log('=== LOGIN SUCCESSFUL ===');
    return {
      user,
      session: authData,
    };
  } catch (error) {
    console.log('=== LOGIN FAILED ===');
    console.log('Error message:', error.message);
    console.log('Error type:', error.constructor.name);
    
    // Expected login errors - don't log these
    const errorMsg = error.message || '';
    const isExpectedError = 
      errorMsg.includes('User not found') ||
      errorMsg.includes('Invalid') ||
      errorMsg.includes('not confirmed') ||
      errorMsg.includes('Email not confirmed') ||
      errorMsg.includes('Unable to load') ||
      errorMsg.includes('Unable to set up');
    
    // Only log unexpected system errors
    if (!isExpectedError) {
      console.error('❌ Unexpected login error:', error);
    } else {
      console.log('(Expected error - user needs to fix something)');
    }
    
    throw error;
  }
};

/**
 * Logout user and clear session
 */
export const logoutUserSecure = async () => {
  try {
    const session = await getSession();
    
    if (session?.access_token) {
      // Call Supabase logout
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
    }

    // Clear local session
    await AsyncStorage.multiRemove(['supabase_session', 'currentUser']);
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

/**
 * Send email verification
 */
export const sendEmailVerification = async () => {
  try {
    const session = await getSession();
    
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        method: 'PUT',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: session.user.email,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send verification email');
    }

    return true;
  } catch (error) {
    console.error('Send verification error:', error);
    throw error;
  }
};

/**
 * Check if email is verified
 */
export const isEmailVerified = async () => {
  try {
    const session = await getSession();
    return !!session?.user?.email_confirmed_at;
  } catch (error) {
    return false;
  }
};

/**
 * Save session to local storage
 */
const saveSession = async (session, user) => {
  try {
    await AsyncStorage.setItem('supabase_session', JSON.stringify(session));
    await AsyncStorage.setItem('currentUser', JSON.stringify(user));
  } catch (error) {
    console.error('Error saving session:', error);
    throw error;
  }
};

/**
 * Get current session
 */
export const getSession = async () => {
  try {
    const sessionJson = await AsyncStorage.getItem('supabase_session');
    if (!sessionJson) return null;
    return JSON.parse(sessionJson);
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
};

/**
 * Get current user
 */
export const getCurrentUserSecure = async () => {
  try {
    const userJson = await AsyncStorage.getItem('currentUser');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

/**
 * Refresh session token
 */
export const refreshSession = async () => {
  try {
    const session = await getSession();
    
    if (!session?.refresh_token) {
      throw new Error('No refresh token');
    }

    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: session.refresh_token,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to refresh session');
    }

    const newSession = await response.json();
    
    // Get user
    const user = await getCurrentUserSecure();
    
    // Save new session
    await saveSession(newSession, user);

    return newSession;
  } catch (error) {
    console.error('Refresh session error:', error);
    // If refresh fails, logout
    await logoutUserSecure();
    throw error;
  }
};

// Note: Stats functions are in UserService but not re-exported here to avoid circular dependency
// Import them directly from UserService where needed: import { syncUserStats } from './UserService'

