-- Sanity checks for public.pub_spatial_assignments

SELECT COUNT(*) AS total_rows FROM public.pub_spatial_assignments;

SELECT assignment_status, COUNT(*) AS row_count
FROM public.pub_spatial_assignments
GROUP BY assignment_status
ORDER BY assignment_status;

SELECT COUNT(*) AS borough_changed_count
FROM public.pub_spatial_assignments
WHERE borough_changed IS TRUE;

SELECT COUNT(*) AS ward_name_matches_existing_area_count
FROM public.pub_spatial_assignments
WHERE ward_name_matches_existing_area IS TRUE;

SELECT pub_name, current_borough, corrected_borough_name, current_area, corrected_ward_name
FROM public.pub_spatial_assignments
WHERE borough_changed IS TRUE
ORDER BY pub_name
LIMIT 25;

SELECT pub_name, current_borough, current_area
FROM public.pub_spatial_assignments
WHERE assignment_status = 'outside_supported_polygons'
ORDER BY pub_name
LIMIT 25;
