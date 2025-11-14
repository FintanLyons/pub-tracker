"""
Pub Image Fetching Script (DuckDuckGo Version)

This script searches DuckDuckGo Images for pub photos, downloads them, and uploads to Cloudflare R2.
Images are saved with filenames matching pub names (spaces replaced with underscores).
The script updates the pubs_all table in Supabase with the image URLs.

DuckDuckGo Image Search:
- Free (no API key required)
- Rate limit: ~30 requests per minute (approximate, not officially published)
- No daily quota limit

Default behavior: Downloads images and uploads to Cloudflare R2 (and stores the public URL in Supabase)
Use --url flag: Store image URLs directly in database (not recommended)

Setup:
1. Install dependencies: pip install supabase ddgs requests python-dotenv pillow boto3
   Note: The package is now called 'ddgs' (not 'duckduckgo-search')
2. Create .env file in scripts/ directory or project root with:
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your_service_role_key
3. Create an R2 bucket (e.g., 'pub-photos') and make it public via an R2 Access Policy
4. Add R2 credentials to .env:
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET_NAME=...
   R2_PUBLIC_BASE_URL=https://bucket.account.r2.cloudflarestorage.com (or custom domain)

⚠️  SECURITY: Never commit API keys to git! The .env file is in .gitignore.
"""

import os
import sys
import requests
import boto3
from dotenv import load_dotenv
from supabase import create_client, Client
try:
    from ddgs import DDGS  # New package name
except ImportError:
    try:
        from duckduckgo_search import DDGS  # Fallback to old name
    except ImportError:
        print("❌ Error: Please install the ddgs package: pip install ddgs")
        sys.exit(1)
import time
from urllib.parse import urlparse
import mimetypes

# Load environment variables from .env file
load_dotenv()

# ============================================================================
# API CONFIGURATION - Load from environment variables only
# ============================================================================
# ⚠️  SECURITY: Never hardcode API keys in this file!
#     Create a .env file in the scripts/ directory or project root with:
#     SUPABASE_URL=https://your-project.supabase.co
#     SUPABASE_KEY=your_service_role_key

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

# Cloudflare R2 configuration
R2_ACCOUNT_ID = os.getenv('R2_ACCOUNT_ID')
R2_ACCESS_KEY_ID = os.getenv('R2_ACCESS_KEY_ID')
R2_SECRET_ACCESS_KEY = os.getenv('R2_SECRET_ACCESS_KEY')
R2_BUCKET_NAME = os.getenv('R2_BUCKET_NAME')
R2_PUBLIC_BASE_URL = os.getenv('R2_PUBLIC_BASE_URL')

if R2_ACCOUNT_ID and R2_BUCKET_NAME and not R2_PUBLIC_BASE_URL:
    R2_PUBLIC_BASE_URL = f"https://{R2_BUCKET_NAME}.{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Validate that all required environment variables are set
missing_keys = []
if not SUPABASE_URL:
    missing_keys.append('SUPABASE_URL')
if not SUPABASE_KEY:
    missing_keys.append('SUPABASE_KEY')

if not R2_ACCOUNT_ID:
    missing_keys.append('R2_ACCOUNT_ID')
if not R2_ACCESS_KEY_ID:
    missing_keys.append('R2_ACCESS_KEY_ID')
if not R2_SECRET_ACCESS_KEY:
    missing_keys.append('R2_SECRET_ACCESS_KEY')
if not R2_BUCKET_NAME:
    missing_keys.append('R2_BUCKET_NAME')
if not R2_PUBLIC_BASE_URL:
    missing_keys.append('R2_PUBLIC_BASE_URL')

if missing_keys:
    print("❌ Error: Missing required environment variables!")
    print(f"   Missing: {', '.join(missing_keys)}")
    print("\n   Please create a .env file in the scripts/ directory or project root with:")
    print("   SUPABASE_URL=https://your-project.supabase.co")
    print("   SUPABASE_KEY=your_service_role_key")
    print("   R2_ACCOUNT_ID=your_r2_account_id")
    print("   R2_ACCESS_KEY_ID=your_r2_access_key_id")
    print("   R2_SECRET_ACCESS_KEY=your_r2_secret_access_key")
    print("   R2_BUCKET_NAME=your_r2_bucket_name")
    print("   R2_PUBLIC_BASE_URL=https://bucket.account.r2.cloudflarestorage.com (or custom domain)")
    print("\n   Note: The .env file is already in .gitignore and will not be committed.")
    print("\n   DuckDuckGo Image Search: No API key required (free)!")
    sys.exit(1)

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Initialize R2 client
r2_session = boto3.session.Session()
r2_client = r2_session.client(
    service_name='s3',
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
)

# Pagination configuration
PAGE_SIZE = 750  # Supabase default limit is 1000, using 750 for safety

# DuckDuckGo rate limiting
# Approximate rate: 30 requests per minute, but be more conservative
# Increased delay to avoid rate limiting issues
DDG_RATE_LIMIT_SECONDS = 3.5  # More conservative to avoid rate limiting
DDG_RATE_LIMIT_RETRY_SECONDS = 10  # Wait longer if rate limited

def search_duckduckgo_images(pub_name: str, area: str, retry_count: int = 0) -> str:
    """
    Search DuckDuckGo Images for a pub photo.
    Returns the first image URL found, or None.
    
    Args:
        pub_name: Name of the pub
        area: Area/location of the pub
        retry_count: Number of retries attempted (for rate limit handling)
    """
    query = f"{pub_name} {area} London pub"
    max_retries = 2
    
    try:
        # Initialize DuckDuckGo search
        with DDGS() as ddgs:
            # Search for images
            # The images() method returns an iterator/generator
            # Note: New ddgs package uses 'query' as first positional argument
            results = list(ddgs.images(
                query,  # First positional argument (not 'keywords')
                max_results=5,  # Get up to 5 results, we'll use the best one
                safesearch='moderate'  # Moderate safe search
            ))
            
            # Filter for larger images (prefer higher quality)
            if results:
                # DuckDuckGo results may have 'image', 'url', 'thumbnail', etc.
                # Also have 'width' and 'height' fields
                # Sort by image size (area) if available, otherwise use first result
                def get_image_size(result):
                    """Get image size (width * height) from result."""
                    width = result.get('width') or result.get('image_width') or 0
                    height = result.get('height') or result.get('image_height') or 0
                    if isinstance(width, (int, float)) and isinstance(height, (int, float)):
                        return width * height
                    return 0
                
                def get_image_url(result):
                    """Get image URL from result (try different field names)."""
                    # Try common field names for image URL
                    return (result.get('image') or 
                           result.get('url') or 
                           result.get('image_url') or
                           result.get('thumbnail'))
                
                # Sort by image size (largest first)
                sorted_results = sorted(
                    results,
                    key=get_image_size,
                    reverse=True
                )
                
                # Get the first (largest) image URL
                for result in sorted_results:
                    image_url = get_image_url(result)
                    if image_url:
                        return image_url
            
            return None
        
    except Exception as e:
        error_str = str(e).lower()
        error_msg = str(e)
        
        # Check for rate limiting errors
        if ('rate' in error_str or 'limit' in error_str or '429' in error_str or 
            'too many' in error_str or 'blocked' in error_str):
            if retry_count < max_retries:
                wait_time = DDG_RATE_LIMIT_RETRY_SECONDS * (retry_count + 1)
                print(f"   ⚠️  DuckDuckGo Rate Limit: Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
                return search_duckduckgo_images(pub_name, area, retry_count + 1)
            else:
                print(f"   ⚠️  DuckDuckGo Rate Limit: Max retries reached, skipping")
                return None
        
        # Check for timeout or connection errors
        if 'timeout' in error_str or 'connection' in error_str:
            print(f"   ⚠️  DuckDuckGo Connection Error: {e}")
            return None
        
        # Other errors
        print(f"   ❌ DuckDuckGo Search Error: {e}")
        return None

def download_image(url: str, retry_count: int = 0) -> tuple:
    """
    Download an image from a URL.
    Returns: (image_bytes, content_type, filename) or None if failed
    
    Args:
        url: URL of the image to download
        retry_count: Number of retries attempted (for 403 errors)
    """
    max_retries = 2
    
    try:
        # Use a more realistic browser User-Agent to avoid 403 errors
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://www.google.com/',  # Some sites check referer
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site',
        }
        
        response = requests.get(url, headers=headers, timeout=15, stream=True, allow_redirects=True)
        
        # Handle 403 Forbidden errors with retry
        if response.status_code == 403:
            if retry_count < max_retries:
                # Try with different headers
                headers['Referer'] = urlparse(url).scheme + '://' + urlparse(url).netloc
                print(f"   ⚠️  403 Forbidden, retrying with different headers...")
                time.sleep(1)
                return download_image(url, retry_count + 1)
            else:
                print(f"   ⚠️  403 Forbidden: Server blocking direct downloads")
                return None
        
        response.raise_for_status()
        
        # Determine content type
        content_type = response.headers.get('content-type', 'image/jpeg')
        
        # Only process image content types
        if not content_type.startswith('image/'):
            print(f"   ⚠️  URL does not point to an image (content-type: {content_type})")
            return None
        
        # Generate filename from URL
        parsed = urlparse(url)
        filename = os.path.basename(parsed.path)
        if not filename or '.' not in filename:
            ext = mimetypes.guess_extension(content_type) or '.jpg'
            filename = f"pub_image{ext}"
        
        return (response.content, content_type, filename)
        
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 403:
            print(f"   ⚠️  Download error (403 Forbidden): Server may block direct downloads")
        else:
            print(f"   ⚠️  Download error (HTTP {e.response.status_code}): {e}")
        return None
    except Exception as e:
        print(f"   ⚠️  Download error: {e}")
        return None

def upload_to_r2_storage(image_bytes: bytes, content_type: str, pub_name: str) -> str:
    """
    Upload image to Cloudflare R2.
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
        
        r2_client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=storage_path,
            Body=image_bytes,
            ContentType=content_type,
        )
        
        public_url = f"{R2_PUBLIC_BASE_URL.rstrip('/')}/{storage_path}"
        
        return public_url
        
    except Exception as e:
        print(f"   ⚠️  R2 upload error: {e}")
        return None

def update_pub_image(pub_id: str, image_url: str) -> bool:
    """
    Update pub's photo_url in Supabase (pubs_all table).
    """
    try:
        response = supabase.table('pubs_all').update({
            'photo_url': image_url
        }).eq('id', pub_id).execute()
        
        return bool(response.data)
        
    except Exception as e:
        print(f"   ❌ Update error: {e}")
        return False

def fetch_and_store_image(pub_id: str, pub_name: str, area: str, use_storage: bool = True) -> bool:
    """
    Fetch image for a pub and store it in Cloudflare R2.
    Updates the pubs_all table in Supabase with the image URL.
    Returns True if successful.
    """
    print(f"🔍 Searching for: {pub_name} ({area})")
    
    # Search DuckDuckGo Images
    image_url = search_duckduckgo_images(pub_name, area)
    
    if not image_url:
        print(f"   ⚠️  No image found")
        return False
    
    print(f"   ✅ Found: {image_url[:60]}...")
    
    # Download and upload to Cloudflare R2 (default behavior)
    if use_storage:
        print(f"   📥 Downloading image...")
        image_data = download_image(image_url)
        
        if not image_data:
            print(f"   ⚠️  Download failed, storing URL instead")
            return update_pub_image(pub_id, image_url)
        
        image_bytes, content_type, _ = image_data
        
        print(f"   ☁️  Uploading to Cloudflare R2...")
        storage_url = upload_to_r2_storage(image_bytes, content_type, pub_name)
        
        if storage_url:
            print(f"   ✅ Uploaded: {storage_url[:60]}...")
            return update_pub_image(pub_id, storage_url)
        else:
            print(f"   ⚠️  R2 upload failed, storing original URL instead")
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
    Check if a file exists in Cloudflare R2.
    Returns True if file exists, False otherwise.
    """
    try:
        r2_client.head_object(Bucket=R2_BUCKET_NAME, Key=storage_path)
        return True
    except Exception:
        return False

def extract_storage_path_from_url(url: str) -> str:
    """
    Extract the storage path from a Cloudflare R2 URL.
    Returns the path or None if not a Cloudflare R2 URL.
    """
    if not url:
        return None
    
    base = R2_PUBLIC_BASE_URL.rstrip('/') + '/'
    if url.startswith(base):
        path = url[len(base):].split('?')[0]
        return path
    return None

def fetch_all_pubs_paginated() -> list:
    """
    Fetch all pubs from pubs_all table using pagination.
    Returns a list of all pubs with id, name, area, and photo_url.
    """
    all_pubs = []
    start = 0
    
    while True:
        try:
            response = (
                supabase
                .table('pubs_all')
                .select('id,name,area,photo_url')
                .range(start, start + PAGE_SIZE - 1)
                .execute()
            )
            
            chunk = response.data if response else []
            if not chunk:
                break
            
            all_pubs.extend(chunk)
            
            # If we got fewer results than PAGE_SIZE, we've reached the end
            if len(chunk) < PAGE_SIZE:
                break
            
            start += PAGE_SIZE
            time.sleep(0.1)  # Small delay to avoid overwhelming the API
            
        except Exception as e:
            print(f"   ⚠️  Error fetching pubs (offset {start}): {e}")
            break
    
    return all_pubs

def get_pubs_needing_images(only_missing: bool = True):
    """
    Get pubs that need images.
    If only_missing=True, only get pubs without photos or with placeholder photos.
    Also checks if Cloudflare R2 URLs actually exist.
    Uses pagination to fetch all pubs from the database.
    """
    # Fetch all pubs using pagination
    print("📥 Fetching all pubs from database (this may take a moment)...")
    all_pubs = fetch_all_pubs_paginated()
    print(f"   ✅ Fetched {len(all_pubs)} total pubs\n")
    
    if only_missing:
        pubs_needing_images = []
        
        print("🔍 Filtering pubs that need images...")
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
            
            # Check if it's a Cloudflare R2 URL and verify file exists
            storage_path = extract_storage_path_from_url(photo_url)
            if storage_path:
                # It's a Cloudflare R2 URL - check if file actually exists
                if not check_file_exists_in_storage(storage_path):
                    # URL exists but file doesn't - needs image
                    pubs_needing_images.append(pub)
            else:
                # Not a Cloudflare R2 URL (e.g., external image URL)
                # We want to download it and store it in Cloudflare R2
                pubs_needing_images.append(pub)
        
        print(f"   ✅ Found {len(pubs_needing_images)} pubs needing images\n")
        return pubs_needing_images
    else:
        return all_pubs

def main():
    print("📸 Pub Image Fetching Script (DuckDuckGo)\n")
    print("🦆 Using DuckDuckGo Image Search (free, no API key required)\n")
    
    # Check command line arguments
    use_storage = '--url' not in sys.argv  # Default to storage, use --url for URL storage
    only_missing = '--all' not in sys.argv
    
    if use_storage:
        print("☁️  Mode: Download and upload to Cloudflare R2 (default)\n")
    else:
        print("🔗 Mode: Store image URLs directly\n")
        print("   💡 Tip: Remove --url flag to use Cloudflare R2 (recommended)")
    
    if only_missing:
        print("📋 Processing mode: Only pubs with missing/placeholder images\n")
    else:
        print("📋 Processing mode: All pubs\n")
    
    pubs = get_pubs_needing_images(only_missing=only_missing)
    
    if not pubs:
        print("✅ No pubs need images!")
        return
    
    print(f"🚀 Starting to process {len(pubs)} pubs\n")
    print(f"⏱️  Rate limiting: {DDG_RATE_LIMIT_SECONDS} seconds between requests")
    print(f"   (DuckDuckGo limit: ~30 requests per minute)")
    print(f"   Estimated time: ~{len(pubs) * DDG_RATE_LIMIT_SECONDS / 60:.1f} minutes\n")
    
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
        
        # Rate limiting - wait between requests to avoid DuckDuckGo rate limits
        if i < len(pubs):
            # Show progress estimate
            remaining = len(pubs) - i
            estimated_minutes = (remaining * DDG_RATE_LIMIT_SECONDS) / 60
            print(f"   ⏳ Waiting {DDG_RATE_LIMIT_SECONDS} seconds... (~{estimated_minutes:.1f} min remaining)")
            time.sleep(DDG_RATE_LIMIT_SECONDS)
    
    print(f"\n📊 Summary:")
    print(f"   ✅ Updated: {updated}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📝 Total: {len(pubs)}")
    print(f"\n💡 Note: DuckDuckGo is free with no daily quota!")
    print(f"   Processing {len(pubs)} pubs took approximately {len(pubs) * DDG_RATE_LIMIT_SECONDS / 60:.1f} minutes")

if __name__ == "__main__":
    main()

