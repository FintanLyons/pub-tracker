import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';
import { refreshSession } from './SecureAuthService';

/**
 * Submit a report to Supabase database
 */
const getSupabaseContext = async () => {
  const supabaseUrl = getSupabaseUrl();

  const sessionJson = await AsyncStorage.getItem('supabase_session');
  const session = sessionJson ? JSON.parse(sessionJson) : null;
  const accessToken = session?.access_token;
  const headers = getSupabaseHeaders(accessToken);

  if (!supabaseUrl || !headers) {
    throw new Error('Supabase not configured');
  }

  return { supabaseUrl, headers };
};

const postReport = async (reportData) => {
  console.log('📤 Sending to Supabase:', reportData);

  const { supabaseUrl, headers } = await getSupabaseContext();
  const url = `${supabaseUrl}/reports`;
  const requestOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(reportData),
  };
  let response = await fetch(url, requestOptions);

  if (response.status === 401) {
    console.log('Report request unauthorized (401). Attempting session refresh...');
    try {
      await refreshSession();
      const refreshedContext = await getSupabaseContext();
      response = await fetch(url, {
        ...requestOptions,
        headers: refreshedContext.headers,
      });
    } catch (refreshError) {
      console.error('Failed to refresh session for report submission:', refreshError);
      // Re-throw the original response error for downstream handling
      throw new Error('Session expired. Please log in again.');
    }
  }

  console.log('📥 Response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Supabase error:', response.status, errorText);
    throw new Error(`Failed to save report: ${response.status} - ${errorText}`);
  }

  const savedReport = await response.json();
  console.log('✅ Report saved successfully:', savedReport);

  return savedReport;
};

export const submitReport = async (pubId, pubName, pubArea, reportText) => {
  console.log('📝 Submitting report:', { pubId, pubName, pubArea, reportText });

  try {
    const reportData = {
      pub_id: pubId,
      pub_name: pubName,
      pub_area: pubArea || 'Unknown Area',
      report_text: reportText,
    };

    return {
      success: true,
      report: await postReport(reportData),
    };
  } catch (error) {
    console.error('❌ Report submission error:', error);
    throw error;
  }
};

export const submitMissingPubReport = async (pubName, pubLocation) => {
  console.log('📝 Submitting missing pub report:', { pubName, pubLocation });

  try {
    const reportData = {
      pub_id: null,
      pub_name: pubName || 'Unknown Pub',
      pub_area: pubLocation || 'Unknown Location',
      report_text: 'Pub Missing',
    };

    return {
      success: true,
      report: await postReport(reportData),
    };
  } catch (error) {
    console.error('❌ Missing pub report submission error:', error);
    throw error;
  }
};

