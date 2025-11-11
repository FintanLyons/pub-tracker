import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';

/**
 * Submit a report to Supabase database
 */
export const submitReport = async (pubId, pubName, pubArea, reportText) => {
  console.log('📝 Submitting report:', { pubId, pubName, pubArea, reportText });
  
  try {
    const supabaseUrl = getSupabaseUrl();

    const sessionJson = await AsyncStorage.getItem('supabase_session');
    const session = sessionJson ? JSON.parse(sessionJson) : null;
    const accessToken = session?.access_token;
    const headers = getSupabaseHeaders(accessToken);

    console.log('🔗 Supabase URL:', supabaseUrl);

    if (!supabaseUrl || !headers) {
      throw new Error('Supabase not configured');
    }

    // Save report to Supabase database
    const reportData = {
      pub_id: pubId,
      pub_name: pubName,
      pub_area: pubArea || 'Unknown Area',
      report_text: reportText,
    };

    console.log('📤 Sending to Supabase:', reportData);

    const response = await fetch(`${supabaseUrl}/reports`, {
      method: 'POST',
      headers,
      body: JSON.stringify(reportData),
    });

    console.log('📥 Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Supabase error:', response.status, errorText);
      throw new Error(`Failed to save report: ${response.status} - ${errorText}`);
    }

    const savedReport = await response.json();
    console.log('✅ Report saved successfully:', savedReport);

    return {
      success: true,
      report: savedReport,
    };
  } catch (error) {
    console.error('❌ Report submission error:', error);
    throw error;
  }
};

