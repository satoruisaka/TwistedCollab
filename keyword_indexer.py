"""
keyword_indexer.py - Full-text keyword search indexer (SQLite FTS5)

Provides fast incremental keyword search across all text-based data
sources.  Change detection is done via MD5 file hashes, so only new
or modified files are re-indexed on each run.

Companion to faiss_indexer.py (semantic). RetrievalManager uses both.
"""

import sqlite3
import json
import re
import hashlib
import logging
import threading
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

import config

logger = logging.getLogger(__name__)


class KeywordIndexer:
    """
    Lightweight full-text indexer backed by SQLite FTS5.

    Schema:
        documents (FTS5):  filename, filepath, file_type, date, content, metadata
        file_metadata:     filepath PK, file_hash, file_mtime, indexed_at, file_type
        index_stats:       file_type PK, total_files, last_updated
    """

    # Default data sources – paths come from config so they stay in sync
    # with FAISSIndexer and the rest of the app.
    DEFAULT_DATA_SOURCES: Dict[str, Path] = {
        # Academic papers
        "my_papers":        config.SOURCE_AUTHORED_DIR,
        "reference_papers": config.SOURCE_REFERENCE_DIR,
        # Working / output documents
        "notes":        config.SOURCE_NOTES_DIR,
        "user_uploads": config.SOURCE_USER_UPLOADS_DIR,
        # News
        "news_articles": config.SOURCE_NEWS_ARTICLES_DIR,
        "twistednews":   config.SOURCE_TWISTEDNEWS_DIR,
        # Runtime artefacts
        "sessions":  config.SESSIONS_DIR,
        "web_cache": config.WEB_CACHE_DIR
    }

    def __init__(
        self,
        db_path: Optional[Path] = None,
        data_sources: Optional[Dict[str, Path]] = None,
        verbose: bool = False,
    ):
        self.db_path = db_path or (config.DATA_DIR / "keyword_index.db")
        self.DATA_SOURCES: Dict[str, Path] = (
            data_sources if data_sources is not None else self.DEFAULT_DATA_SOURCES
        )
        self.verbose = verbose
        self.conn: Optional[sqlite3.Connection] = None
        self._lock = threading.Lock()  # serialise concurrent writes
        self._init_db()

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------

    def _log(self, msg: str) -> None:
        if self.verbose:
            logger.info("[KeywordIndexer] %s", msg)
        else:
            logger.debug("[KeywordIndexer] %s", msg)

    # ------------------------------------------------------------------
    # DB initialisation
    # ------------------------------------------------------------------

    def _init_db(self) -> None:
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

        self.conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
                filename,
                filepath,
                file_type,
                date,
                content,
                metadata,
                tokenize='porter unicode61'
            )
        """)

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS file_metadata (
                filepath    TEXT PRIMARY KEY,
                file_hash   TEXT,
                file_mtime  REAL,
                indexed_at  TEXT,
                file_type   TEXT
            )
        """)

        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS index_stats (
                file_type    TEXT PRIMARY KEY,
                total_files  INTEGER,
                last_updated TEXT
            )
        """)

        self.conn.commit()
        self._log(f"Database ready: {self.db_path}")

    # ------------------------------------------------------------------
    # File utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _get_file_hash(filepath: Path) -> str:
        hasher = hashlib.md5()
        try:
            with open(filepath, "rb") as f:
                hasher.update(f.read())
            return hasher.hexdigest()
        except Exception as e:
            logger.warning("Could not hash %s: %s", filepath, e)
            return ""

    @staticmethod
    def _parse_date_from_filename(filename: str) -> Optional[str]:
        """Return YYYY-MM-DD if found in filename, else None."""
        match = re.search(r"(\d{4})(\d{2})(\d{2})", filename)
        if match:
            y, m, d = match.groups()
            try:
                datetime(int(y), int(m), int(d))
                return f"{y}-{m}-{d}"
            except ValueError:
                pass
        return None

    # File extensions that are safe to index as text
    TEXT_EXTENSIONS = {".md", ".txt", ".json", ".markdown", ".csv"}

    @staticmethod
    def _extract_content(filepath: Path) -> str:
        try:
            if filepath.suffix == ".json":
                with open(filepath, "r", encoding="utf-8") as f:
                    return json.dumps(json.load(f), indent=2)
            else:
                # .md / .txt / .csv etc.
                return filepath.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            logger.warning("Could not read %s: %s", filepath, e)
            return ""

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    def _ensure_connection(self) -> None:
        """Reopen the database connection if the file has been deleted/replaced."""
        if not self.db_path.exists():
            self._log("DB file missing – reopening connection")
            if self.conn:
                try:
                    self.conn.close()
                except Exception:
                    pass
            self.conn = None
            self._init_db()

    def index_source(self, source_name: str, force_reindex: bool = False) -> Dict:
        """
        Index all files from a single data source.

        Args:
            source_name:    key in DATA_SOURCES
            force_reindex:  if True, re-index every file regardless of hash

        Returns:
            dict with indexed_count, skipped_count, error_count, total
        """
        self._ensure_connection()
        if source_name not in self.DATA_SOURCES:
            raise ValueError(f"Unknown source: {source_name!r}")

        source_path = Path(self.DATA_SOURCES[source_name])
        if not source_path.exists():
            logger.warning("Source path does not exist: %s", source_path)
            return {"indexed_count": 0, "skipped_count": 0, "error_count": 0, "total": 0}

        self._log(f"Indexing {source_name} from {source_path}")

        files = [
            p for p in (source_path.glob("*.*") if source_path.is_dir() else [source_path])
            if p.suffix.lower() in self.TEXT_EXTENSIONS
        ]

        indexed_count = skipped_count = error_count = 0

        with self._lock:
            for filepath in files:
                if filepath.is_dir():
                    continue
                try:
                    stat = filepath.stat()
                    file_mtime = stat.st_mtime
                    file_hash = self._get_file_hash(filepath)

                    if not force_reindex:
                        row = self.conn.execute(
                            "SELECT file_hash FROM file_metadata WHERE filepath = ?",
                            (str(filepath),),
                        ).fetchone()
                        if row and row["file_hash"] == file_hash:
                            skipped_count += 1
                            continue

                    content = self._extract_content(filepath)
                    if not content:
                        error_count += 1
                        continue

                    date = self._parse_date_from_filename(filepath.name)
                    metadata = json.dumps({
                        "file_size":  stat.st_size,
                        "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    })

                    # Remove old FTS entry
                    self.conn.execute(
                        "DELETE FROM documents WHERE filepath = ?", (str(filepath),)
                    )
                    # Insert new
                    self.conn.execute(
                        """INSERT INTO documents
                           (filename, filepath, file_type, date, content, metadata)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (filepath.name, str(filepath), source_name, date, content, metadata),
                    )
                    # Update tracking
                    self.conn.execute(
                        """INSERT OR REPLACE INTO file_metadata
                           (filepath, file_hash, file_mtime, indexed_at, file_type)
                           VALUES (?, ?, ?, ?, ?)""",
                        (str(filepath), file_hash, file_mtime,
                         datetime.now().isoformat(), source_name),
                    )
                    indexed_count += 1

                    if indexed_count % 100 == 0:
                        self.conn.commit()

                except Exception as e:
                    error_count += 1
                    logger.error("Error indexing %s: %s", filepath, e)

            self.conn.commit()

            # Refresh stats
            total = self.conn.execute(
                "SELECT COUNT(*) as n FROM documents WHERE file_type = ?",
                (source_name,),
            ).fetchone()["n"]

            self.conn.execute(
                """INSERT OR REPLACE INTO index_stats (file_type, total_files, last_updated)
                   VALUES (?, ?, ?)""",
                (source_name, total, datetime.now().isoformat()),
            )
            self.conn.commit()

        summary = {
            "indexed_count":  indexed_count,
            "skipped_count":  skipped_count,
            "error_count":    error_count,
            "total":          total,
        }
        self._log(f"Done {source_name}: {summary}")
        return summary

    def index_all(self, force_reindex: bool = False) -> Dict[str, Dict]:
        """Index every configured data source. Returns per-source summaries."""
        results: Dict[str, Dict] = {}
        for source_name in self.DATA_SOURCES:
            try:
                results[source_name] = self.index_source(
                    source_name, force_reindex=force_reindex
                )
            except Exception as e:
                logger.error("Failed to index %s: %s", source_name, e)
                results[source_name] = {"error": str(e)}
        return results

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search(
        self,
        query: str,
        file_types: Optional[List[str]] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict]:
        """
        Full-text search with optional filters.

        Args:
            query:      FTS5 query string (Porter-stemmed, unicode61)
            file_types: restrict to these source types, e.g. ['sessions', 'notes']
            date_from:  ISO date lower bound (YYYY-MM-DD)
            date_to:    ISO date upper bound (YYYY-MM-DD)
            limit:      maximum rows to return

        Returns:
            List of result dicts with filename, filepath, file_type, date,
            snippet, metadata keys.
        """
        where_clauses: List[str] = []
        params: List = []

        if file_types:
            placeholders = ",".join("?" * len(file_types))
            where_clauses.append(f"file_type IN ({placeholders})")
            params.extend(file_types)

        if date_from:
            where_clauses.append("date >= ?")
            params.append(date_from)

        if date_to:
            where_clauses.append("date <= ?")
            params.append(date_to)

        where_sql = (" AND " + " AND ".join(where_clauses)) if where_clauses else ""

        sql = f"""
            SELECT
                filename,
                filepath,
                file_type,
                date,
                snippet(documents, 4, '<mark>', '</mark>', '...', 64) AS snippet,
                metadata
            FROM documents
            WHERE documents MATCH ?{where_sql}
            ORDER BY rank
            LIMIT ?
        """

        params.insert(0, query)
        params.append(limit)

        try:
            with self._lock:
                cursor = self.conn.execute(sql, params)
                results = []
                for row in cursor:
                    results.append({
                        "filename":  row["filename"],
                        "filepath":  row["filepath"],
                        "file_type": row["file_type"],
                        "date":      row["date"],
                        "snippet":   row["snippet"],
                        "metadata":  json.loads(row["metadata"]) if row["metadata"] else {},
                    })
            return results
        except sqlite3.OperationalError as e:
            # FTS5 throws OperationalError on bad query syntax
            logger.warning("Keyword search error (bad query?): %s", e)
            return []

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def get_stats(self) -> Dict[str, Dict]:
        with self._lock:
            cursor = self.conn.execute("SELECT * FROM index_stats")
            stats: Dict[str, Dict] = {}
            for row in cursor:
                stats[row["file_type"]] = {
                    "total_files":  row["total_files"],
                    "last_updated": row["last_updated"],
                }
        return stats

    def refresh_stats(self) -> None:
        """Recalculate statistics from actual database contents."""
        with self._lock:
            for source_name in self.DATA_SOURCES:
                total = self.conn.execute(
                    "SELECT COUNT(*) as n FROM documents WHERE file_type = ?",
                    (source_name,),
                ).fetchone()["n"]
                if total > 0:
                    self.conn.execute(
                        """INSERT OR REPLACE INTO index_stats
                           (file_type, total_files, last_updated)
                           VALUES (?, ?, ?)""",
                        (source_name, total, datetime.now().isoformat()),
                    )
            self.conn.commit()
        self._log("Stats refreshed")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        if self.conn:
            self.conn.close()
            self.conn = None
            self._log("DB connection closed")
