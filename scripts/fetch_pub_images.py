"""
Pub Image Fetching Script

This script searches Google Images for pub photos, downloads them, and uploads to Supabase Storage.
Images are saved with filenames matching pub names (spaces replaced with underscores).

Default behavior: Downloads images and uploads to Supabase Storage
Use --url flag: Store image URLs directly in database (not recommended)

Setup:
1. Install dependencies: pip install supabase google-api-python-client requests python-dotenv pillow
2. Get Google Custom Search API key and CX
3. Create .env file with:
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_service_role_key
   GOOGLE_API_KEY=your_google_api_key
   GOOGLE_CX=your_search_engine_id
4. Create 'pub-photos' bucket in Supabase Storage (make it PUBLIC)
"""

import os
import sys
import requests
from dotenv import load_dotenv
from supabase import create_client, Client
from googleapiclient.discovery import build
import time
from urllib.parse import urlparse
import mimetypes

# Load environment variables (optional - you can also hardcode below)
load_dotenv()

# ============================================================================
# API CONFIGURATION - Set your keys here or in .env file
# ============================================================================
SUPABASE_URL = os.getenv('SUPABASE_URL') or 'https://ddfdwxrnouneqqzactus.supabase.co'
SUPABASE_KEY = os.getenv('SUPABASE_KEY') or 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkZmR3eHJub3VuZXFxemFjdHVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjE4MDY4NSwiZXhwIjoyMDc3NzU2Njg1fQ.1gsFB_2bPoOUUMsOsH-XM74OjauXahlEBfBe8rQDgAY'  # Use service_role key
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY') or 'AIzaSyAGc7eqGA9iSUZSHdH7O5Gdn5M3M27VHng'  # From Google Cloud Console
GOOGLE_CX = os.getenv('GOOGLE_CX') or '0390b4b429a834d06'  # From cse.google.com

# ⚠️  SECURITY NOTE: If hardcoding keys above, make sure this file is in .gitignore
#     Never commit API keys to version control!

if any([key == f'YOUR_{name}_HERE' for key, name in [
    (SUPABASE_KEY, 'SERVICE_ROLE_KEY'),
    (GOOGLE_API_KEY, 'GOOGLE_API_KEY'),
    (GOOGLE_CX, 'GOOGLE_CX')
]]):
    print("❌ Error: Please set your API keys!")
    print("   Option 1: Edit this file and replace YOUR_*_HERE above")
    print("   Option 2: Create .env file with:")
    print("   SUPABASE_URL=https://your-project.supabase.co")
    print("   SUPABASE_KEY=your_service_role_key")
    print("   GOOGLE_API_KEY=your_google_api_key")
    print("   GOOGLE_CX=your_search_engine_id")
    sys.exit(1)

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
google_service = build("customsearch", "v1", developerKey=GOOGLE_API_KEY)

def search_google_images(pub_name: str, area: str) -> str:
    """
    Search Google Images for a pub photo.
    Returns the first image URL found, or None.
    """
    query = f"{pub_name} {area} London pub"
    
    try:
        result = google_service.cse().list(
            q=query,
            cx=GOOGLE_CX,
            searchType='image',
            num=1,
            safe='active',
            imgSize='LARGE',  # Get large-sized images
            imgType='photo'    # Prefer photos over illustrations
        ).execute()
        
        if 'items' in result and len(result['items']) > 0:
            image_url = result['items'][0]['link']
            return image_url
        
        return None
        
    except Exception as e:
        print(f"   ❌ Google API Error: {e}")
        return None

def download_image(url: str) -> tuple:
    """
    Download an image from a URL.
    Returns: (image_bytes, content_type, filename) or None if failed
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=10, stream=True)
        response.raise_for_status()
        
        # Determine content type
        content_type = response.headers.get('content-type', 'image/jpeg')
        
        # Generate filename from URL
        parsed = urlparse(url)
        filename = os.path.basename(parsed.path)
        if not filename or '.' not in filename:
            ext = mimetypes.guess_extension(content_type) or '.jpg'
            filename = f"pub_image{ext}"
        
        return (response.content, content_type, filename)
        
    except Exception as e:
        print(f"   ⚠️  Download error: {e}")
        return None

def upload_to_supabase_storage(image_bytes: bytes, content_type: str, pub_name: str) -> str:
    """
    Upload image to Supabase Storage.
    Returns the public URL, or None if failed.
    """
    try:
        # Convert pub name to filename: replace spaces with underscores, sanitize
        # Format: {pub_name_with_underscores}.{extension}
        safe_name = pub_name.strip()
        # Replace spaces with underscores
        safe_name = safe_name.replace(' ', '_')
        # Remove or replace invalid filename characters (keep & symbol)
        safe_name = "".join(c for c in safe_name if c.isalnum() or c in ('_', '-', '&')).rstrip()
        
        # Get file extension from content type
        ext = mimetypes.guess_extension(content_type) or '.jpg'
        if ext == '.jpe':
            ext = '.jpg'
        
        # Create storage path: pub name with underscores + extension
        storage_path = f"{safe_name}{ext}"
        
        # Upload to Supabase Storage (bucket: pub-photos)
        response = supabase.storage.from_('pub-photos').upload(
            storage_path,
            image_bytes,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        
        # Get public URL
        public_url = supabase.storage.from_('pub-photos').get_public_url(storage_path)
        
        return public_url
        
    except Exception as e:
        print(f"   ⚠️  Storage upload error: {e}")
        return None

def update_pub_image(pub_id: str, image_url: str) -> bool:
    """
    Update pub's photo_url in Supabase.
    """
    try:
        response = supabase.table('pubs').update({
            'photo_url': image_url
        }).eq('id', pub_id).execute()
        
        return bool(response.data)
        
    except Exception as e:
        print(f"   ❌ Update error: {e}")
        return False

def fetch_and_store_image(pub_id: str, pub_name: str, area: str, use_storage: bool = True) -> bool:
    """
    Fetch image for a pub and store it in Supabase Storage.
    Returns True if successful.
    """
    print(f"🔍 Searching for: {pub_name} ({area})")
    
    # Search Google Images
    image_url = search_google_images(pub_name, area)
    
    if not image_url:
        print(f"   ⚠️  No image found")
        return False
    
    print(f"   ✅ Found: {image_url[:60]}...")
    
    # Download and upload to Supabase Storage (default behavior)
    if use_storage:
        print(f"   📥 Downloading image...")
        image_data = download_image(image_url)
        
        if not image_data:
            print(f"   ⚠️  Download failed, storing URL instead")
            return update_pub_image(pub_id, image_url)
        
        image_bytes, content_type, _ = image_data
        
        print(f"   ☁️  Uploading to Supabase Storage...")
        storage_url = upload_to_supabase_storage(image_bytes, content_type, pub_name)
        
        if storage_url:
            print(f"   ✅ Uploaded: {storage_url[:60]}...")
            return update_pub_image(pub_id, storage_url)
        else:
            print(f"   ⚠️  Upload failed, storing original URL instead")
            return update_pub_image(pub_id, image_url)
    
    # Fallback: Just store the URL (if --url flag is used)
    else:
        success = update_pub_image(pub_id, image_url)
        if success:
            print(f"   ✅ URL stored in database")
            return True
        else:
            print(f"   ❌ Failed to store URL")
            return False

def check_file_exists_in_storage(storage_path: str) -> bool:
    """
    Check if a file exists in Supabase Storage.
    Returns True if file exists, False otherwise.
    """
    try:
        # Try to download the file - if it doesn't exist, this will raise an error
        file_data = supabase.storage.from_('pub-photos').download(storage_path)
        return file_data is not None and len(file_data) > 0
    except Exception as e:
        # File doesn't exist or error accessing it
        return False

def extract_storage_path_from_url(url: str) -> str:
    """
    Extract the storage path from a Supabase Storage URL.
    Returns the path or None if not a Supabase Storage URL.
    """
    if not url:
        return None
    
    # Supabase Storage URLs look like: https://project.supabase.co/storage/v1/object/public/bucket-name/path/to/file.jpg
    if '/storage/v1/object/public/pub-photos/' in url:
        # Extract path after pub-photos/
        path = url.split('/storage/v1/object/public/pub-photos/')[1].split('?')[0]
        return path
    return None

def get_pubs_needing_images(only_missing: bool = True):
    """
    Get pubs that need images.
    If only_missing=True, only get pubs without photos or with placeholder photos.
    Also checks if Supabase Storage URLs actually exist.
    """
    query = supabase.table('pubs').select('id,name,area,photo_url')
    
    if only_missing:
        all_pubs = query.execute().data
        pubs_needing_images = []
        
        for pub in all_pubs:
            photo_url = pub.get('photo_url')
            
            # Check if photo_url is missing or placeholder
            if (not photo_url 
                or photo_url == '' 
                or photo_url is None
                or 'placekitten' in str(photo_url)
                or 'placeholder' in str(photo_url).lower()):
                pubs_needing_images.append(pub)
                continue
            
            # Check if it's a Supabase Storage URL and verify file exists
            storage_path = extract_storage_path_from_url(photo_url)
            if storage_path:
                # It's a Supabase Storage URL - check if file actually exists
                if not check_file_exists_in_storage(storage_path):
                    # URL exists but file doesn't - needs image
                    pubs_needing_images.append(pub)
            else:
                # Not a Supabase Storage URL (e.g., external Google Images URL)
                # We want to download it and store it in Supabase Storage
                pubs_needing_images.append(pub)
        
        return pubs_needing_images
    else:
        return query.execute().data

def ensure_storage_bucket():
    """
    Ensure the pub-photos storage bucket exists and is public.
    """
    try:
        # Try to list buckets
        buckets = supabase.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        
        if 'pub-photos' not in bucket_names:
            print("📦 Creating pub-photos storage bucket...")
            # Note: Supabase Python client doesn't have create_bucket method
            # You'll need to create it manually in the dashboard
            print("   ⚠️  Please create 'pub-photos' bucket manually:")
            print("      Supabase Dashboard → Storage → New bucket")
            print("      Name: pub-photos")
            print("      Make it PUBLIC")
            return False
        
        return True
        
    except Exception as e:
        print(f"   ⚠️  Could not verify bucket: {e}")
        return False

def main():
    print("📸 Pub Image Fetching Script\n")
    
    # Check command line arguments
    use_storage = '--url' not in sys.argv  # Default to storage, use --url for URL storage
    only_missing = '--all' not in sys.argv
    
    if use_storage:
        print("☁️  Mode: Download and upload to Supabase Storage (default)\n")
        if not ensure_storage_bucket():
            print("\n❌ Please create the storage bucket first!")
            return
    else:
        print("🔗 Mode: Store image URLs directly\n")
        print("   💡 Tip: Remove --url flag to use Supabase Storage (recommended)")
    
    if only_missing:
        print("📋 Fetching pubs with missing/placeholder images...")
    else:
        print("📋 Fetching all pubs...")
    
    pubs = get_pubs_needing_images(only_missing=only_missing)
    
    if not pubs:
        print("✅ No pubs need images!")
        return
    
    print(f"✅ Found {len(pubs)} pubs\n")
    
    updated = 0
    failed = 0
    
    for i, pub in enumerate(pubs, 1):
        print(f"\n[{i}/{len(pubs)}]")
        
        success = fetch_and_store_image(
            pub['id'],
            pub['name'],
            pub.get('area', ''),
            use_storage=use_storage
        )
        
        if success:
            updated += 1
        else:
            failed += 1
        
        # Rate limiting - wait between requests
        if i < len(pubs):
            time.sleep(1)  # Wait 1 second between requests
    
    print(f"\n📊 Summary:")
    print(f"   ✅ Updated: {updated}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📝 Total: {len(pubs)}")

if __name__ == "__main__":
    main()

