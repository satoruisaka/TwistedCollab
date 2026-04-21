#!/usr/bin/env python3
"""
MRA_v3_1_upload_to_md.py

Convert user-uploaded files to Markdown format for MRA_v3 chat sessions.

Supports:
- PDF (with OCR fallback)
- TXT (plain text)
- CSV (converted to markdown table)
- MD (pass-through with token count)

Features:
- Converts files to markdown format
- Adds token count and metadata headers
- Optional save to user_uploads directory
- Returns markdown content for immediate chat context

Output directory:
- MRA_v3/data/markdown/user_uploads/

Usage (Command-line):
    # Convert a PDF file
    python MRA_v3_1_upload_to_md.py document.pdf
    
    # Convert without prompting (auto-save)
    python MRA_v3_1_upload_to_md.py document.pdf --auto-save
    
    # Convert without saving (print to stdout)
    python MRA_v3_1_upload_to_md.py document.csv --no-save

Usage (API):
    from MRA_v3_1_upload_to_md import process_uploaded_file
    
    md_content, saved_path = process_uploaded_file(
        file_path="document.pdf",
        save_to_disk=True,
        output_dir="MRA_v3/data/markdown/user_uploads"
    )
"""
import sys
import re
import csv
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional, Tuple

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from utils.document_processor import DocumentProcessor
from errors import DocumentProcessingError, FileNotFoundError as MRAFileNotFoundError


# Output directory
UPLOAD_MD_DIR = Path(__file__).parent / "data" / "markdown" / "user_uploads"
UPLOAD_MD_DIR.mkdir(parents=True, exist_ok=True)


def _make_upload_filename(original_filename: Optional[str], output_dir: Path) -> str:
    """Generate a sortable, human-readable filename for an uploaded document.

    Format: YYYYMMDD_upload_<title_slug>.md
    Where <title_slug> is derived from the first words of the original filename.
    Deduplicates against existing files in output_dir.
    """
    date_str = datetime.now().strftime("%Y%m%d")

    stem = Path(original_filename).stem if original_filename else "document"

    # Normalize to underscore-separated lowercase words, strip special chars
    slug = re.sub(r'[\s\-\.]+', '_', stem.lower())
    slug = re.sub(r'[^a-z0-9_]', '', slug)
    slug = re.sub(r'_+', '_', slug).strip('_')

    # Keep first 5 words only for brevity
    parts = [p for p in slug.split('_') if p]
    slug = '_'.join(parts[:5]) or "document"

    base = f"{date_str}_upload_{slug}"
    output_filename = f"{base}.md"
    output_path = output_dir / output_filename

    counter = 1
    while output_path.exists():
        output_filename = f"{base}_{counter}.md"
        output_path = output_dir / output_filename
        counter += 1

    return output_filename


def process_uploaded_file(
    file_path: str | Path,
    save_to_disk: bool = True,
    output_dir: Optional[Path] = None,
    include_metadata: bool = True,
    original_filename: Optional[str] = None
) -> Tuple[str, Optional[Path]]:
    """
    Process an uploaded file and convert to markdown.
    
    Args:
        file_path: Path to uploaded file (PDF, TXT, CSV, MD)
        save_to_disk: Whether to save converted markdown to disk
        output_dir: Output directory (default: user_uploads)
        include_metadata: Include token count and file metadata
        original_filename: Original filename from the uploader, used to derive
                           the human-readable output filename
    
    Returns:
        Tuple of (markdown_content, saved_file_path)
        saved_file_path is None if save_to_disk=False
    
    Raises:
        FileNotFoundError: File doesn't exist
        DocumentProcessingError: Conversion failed
    """
    file_path = Path(file_path)
    
    if not file_path.exists():
        raise MRAFileNotFoundError(f"File not found: {file_path}")
    
    output_dir = output_dir or UPLOAD_MD_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Determine file type
    suffix = file_path.suffix.lower()
    
    print(f"Processing: {file_path.name}")
    print(f"File type:  {suffix}")
    
    # Use DocumentProcessor for all file types
    processor = DocumentProcessor()
    md_content = processor.convert_to_markdown(
        file_path,
        include_token_count=include_metadata,
        include_metadata=include_metadata
    )
    
    # Save to disk if requested
    saved_path = None
    if save_to_disk:
        # Build human-readable, sortable filename: YYYYMMDD_upload_<title>.md
        source_name = original_filename or file_path.name
        output_filename = _make_upload_filename(source_name, output_dir)
        output_path = output_dir / output_filename
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
        
        print(f"Saved to:   {output_path}")
        saved_path = output_path
    else:
        print("Not saved to disk (in-memory only)")
    
    return md_content, saved_path


def main():
    """Command-line interface for file upload processing."""
    parser = argparse.ArgumentParser(
        description="Convert uploaded files to Markdown for MRA_v3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Convert a PDF and prompt to save
  python MRA_v3_1_upload_to_md.py document.pdf
  
  # Convert a CSV and auto-save
  python MRA_v3_1_upload_to_md.py data.csv --auto-save
  
  # Convert without saving (print to stdout)
  python MRA_v3_1_upload_to_md.py notes.txt --no-save
  
  # Specify custom output directory
  python MRA_v3_1_upload_to_md.py paper.pdf --output-dir /path/to/custom/dir
"""
    )
    
    parser.add_argument(
        "file",
        type=Path,
        help="File to convert (PDF, TXT, CSV, MD)"
    )
    
    parser.add_argument(
        "--auto-save",
        action="store_true",
        help="Automatically save without prompting"
    )
    
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Don't save to disk (print to stdout only)"
    )
    
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=UPLOAD_MD_DIR,
        help=f"Output directory (default: {UPLOAD_MD_DIR})"
    )
    
    parser.add_argument(
        "--no-metadata",
        action="store_true",
        help="Don't include token count and metadata headers"
    )
    
    args = parser.parse_args()
    
    # Determine save behavior
    if args.no_save:
        save_to_disk = False
    elif args.auto_save:
        save_to_disk = True
    else:
        # Prompt user
        response = input(f"\nSave converted markdown to {args.output_dir}? [Y/n]: ").strip().lower()
        save_to_disk = response in ['', 'y', 'yes']
    
    try:
        # Process file
        print("="*80)
        md_content, saved_path = process_uploaded_file(
            file_path=args.file,
            save_to_disk=save_to_disk,
            output_dir=args.output_dir,
            include_metadata=not args.no_metadata
        )
        
        print("="*80)
        print("✅ Conversion successful!")
        
        if saved_path:
            print(f"📁 Saved to: {saved_path}")
        
        # Show content stats
        processor = DocumentProcessor()
        token_count = processor.count_tokens(md_content)
        char_count = len(md_content)
        print(f"📊 Tokens: {token_count:,} | Characters: {char_count:,}")
        
        # Print content if not saved
        if args.no_save:
            print("\n" + "="*80)
            print("MARKDOWN CONTENT:")
            print("="*80)
            print(md_content)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
