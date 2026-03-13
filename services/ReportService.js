import { supabase } from '../config/supabase';

export const submitReport = async (pubId, pubName, pubArea, reportText) => {
  const { data, error } = await supabase
    .from('reports')
    .insert({
      pub_id: pubId,
      pub_name: pubName,
      pub_area: pubArea || 'Unknown Area',
      report_text: reportText,
    })
    .select();

  if (error) throw error;
  return { success: true, report: data };
};

export const submitMissingPubReport = async (pubName, pubLocation) => {
  const { data, error } = await supabase
    .from('reports')
    .insert({
      pub_id: null,
      pub_name: pubName || 'Unknown Pub',
      pub_area: pubLocation || 'Unknown Location',
      report_text: 'Pub Missing',
    })
    .select();

  if (error) throw error;
  return { success: true, report: data };
};
