"""
retrieval_manager.py - Unified Search Manager (single-stage FAISS)

Wraps FAISSIndexer (semantic) and KeywordIndexer (full-text) behind a
single unified_search() interface that is fully compatible with server.py.

Replaces the old dual-index (HNSW main + Flat delta / FAISSBuilder) approach
with the single flat IndexFlatIP approach implemented in faiss_indexer.py.

Architecture:
1. unified_search(query, scope, k)  →  FAISSIndexer.search()
2. keyword_search(query, scope, k)  →  KeywordIndexer.search()
3. build_faiss_index(source, force)  →  FAISSIndexer.build_index()
4. build_keyword_index(source, force)→  KeywordIndexer.index_source()
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, asdict
import numpy as np
from datetime import datetime

from faiss_indexer import FAISSIndexer
from keyword_indexer import KeywordIndexer


@dataclass
class RetrievalResult:
    """Unified retrieval result across all indices."""
    chunk_id: str
    parent_id: str
    parent_text: str
    child_text: str
    score: float  # Normalized 0-1
    source: str  # 'reference_papers', 'my_papers', 'sessions', 'web_cache'
    doc_id: str
    filename: str
    metadata: Dict
    
    def to_dict(self) -> Dict:
        """Convert to JSON-serializable dict."""
        return asdict(self)


@dataclass
class SearchScope:
    """Defines which indices to search."""
    reference_papers: bool = False
    my_papers: bool = False
    sessions: bool = False
    web_cache: bool = False
    notes: bool = False
    user_uploads: bool = False
    news_articles: bool = False
    twistednews: bool = False
    
    def get_active_indices(self) -> List[str]:
        """Return list of index names where flag is True."""
        return [name for name, enabled in asdict(self).items() if enabled]


class RetrievalManager:
    """
    Unified search manager.

    Owns a FAISSIndexer (single-stage semantic search) and a KeywordIndexer
    (SQLite FTS5 full-text search).  Exposes the same public surface that
    server.py expects so no changes to calling code are required.
    """

    def __init__(
        self,
        data_dir: str = "data",
        embedder=None,          # accepted for API compatibility; passed to FAISSIndexer
        verbose: bool = False,
    ):
        self.verbose = verbose

        # Single-stage FAISS indexer (replaces old FAISSBuilder dual-index)
        self.faiss = FAISSIndexer(embedder=embedder, verbose=verbose)

        # Full-text keyword indexer
        self.keyword = KeywordIndexer(verbose=verbose)

        self._log("RetrievalManager initialised (single-stage FAISSIndexer)")
    
    def _log(self, message: str) -> None:
        if self.verbose:
            print(f"[RetrievalManager] {message}")

    # ------------------------------------------------------------------
    # Embedder pass-throughs (server.py calls these directly)
    # ------------------------------------------------------------------

    def unload_embedder(self) -> None:
        """Unload embedding model from GPU to free memory."""
        self.faiss.unload_embedder()

    def reload_embedder(self) -> None:
        """Re-enable embedder (it lazy-loads on next use automatically)."""
        _ = self.faiss.embedder   # triggers lazy load

    def is_embedder_loaded(self) -> bool:
        return self.faiss.is_embedder_loaded()
    
    
    def unified_search(
        self,
        query: str,
        scope: Optional[SearchScope] = None,
        k: int = 10,
        filters: Optional[Dict] = None,
    ) -> List[RetrievalResult]:
        """
        Semantic search via FAISSIndexer across selected sources.

        Args:
            query:  Natural-language query text
            scope:  Which sources to search (SearchScope flags)
            k:      Maximum results to return
            filters: Optional dict with 'min_score', 'source_files' keys

        Returns:
            List of RetrievalResult sorted by cosine similarity (highest first)
        """
        if scope is None:
            scope = SearchScope()

        active_indices = scope.get_active_indices()
        if not active_indices:
            self._log("No indices selected in scope")
            return []

        self._log(f"unified_search: {active_indices}  q='{query[:60]}'")

        raw = self.faiss.search(query=query, source_names=active_indices, top_k=k)

        if not raw:
            self._log("No results")
            return []

        seen: Set[str] = set()
        results: List[RetrievalResult] = []
        for r in raw:
            cid = r["chunk_id"]
            if cid in seen:
                continue
            seen.add(cid)
            results.append(RetrievalResult(
                chunk_id=cid,
                parent_id=r["parent_id"],
                parent_text="",
                child_text=r["text"],
                score=r["score"],
                source=r["source"],
                doc_id=r["parent_id"],
                filename=Path(r.get("source_file", "")).name,
                metadata={
                    "source_file": r.get("source_file", ""),
                    "source_type": r.get("source_type", ""),
                    "indexed_at":  r.get("indexed_at", ""),
                },
            ))

        if filters:
            results = self._apply_filters(results, filters)

        results.sort(key=lambda x: x.score, reverse=True)
        results = results[:k]
        self._log(f"Returning {len(results)} results")
        return results
    

    def semantic_search(
        self,
        query: str,
        scope: Optional[SearchScope] = None,
        k: int = 10,
        filters: Optional[Dict] = None,
    ) -> List[RetrievalResult]:
        """
        Semantic search via FAISSIndexer across selected sources.

        Args:
            query:  Natural-language query text
            scope:  Which sources to search (SearchScope flags)
            k:      Maximum results to return
            filters: Optional dict with 'min_score', 'source_files' keys

        Returns:
            List of RetrievalResult sorted by cosine similarity (highest first)
        """
        if scope is None:
            scope = SearchScope()

        active_indices = scope.get_active_indices()
        if not active_indices:
            self._log("No indices selected in scope")
            return []

        self._log(f"semantic_search: {active_indices}  q='{query[:60]}'")

        raw = self.faiss.search(query=query, source_names=active_indices, top_k=k)

        if not raw:
            self._log("No results")
            return []

        seen: Set[str] = set()
        results: List[RetrievalResult] = []
        for r in raw:
            cid = r["chunk_id"]
            if cid in seen:
                continue
            seen.add(cid)
            results.append(RetrievalResult(
                chunk_id=cid,
                parent_id=r["parent_id"],
                parent_text="",
                child_text=r["text"],
                score=r["score"],
                source=r["source"],
                doc_id=r["parent_id"],
                filename=Path(r.get("source_file", "")).name,
                metadata={
                    "source_file": r.get("source_file", ""),
                    "source_type": r.get("source_type", ""),
                    "indexed_at":  r.get("indexed_at", ""),
                },
            ))

        if filters:
            results = self._apply_filters(results, filters)

        results.sort(key=lambda x: x.score, reverse=True)
        results = results[:k]
        self._log(f"Returning {len(results)} results")
        return results

    def keyword_search(
        self,
        query: str,
        scope: Optional[SearchScope] = None,
        k: int = 20,
    ) -> List[Dict]:
        """
        Full-text keyword search via KeywordIndexer.

        Returns raw result dicts (filename, filepath, file_type, date,
        snippet, metadata) – suitable for display or augmenting LLM context.
        """
        if scope is None:
            scope = SearchScope()
        active = scope.get_active_indices() or None
        return self.keyword.search(query=query, file_types=active, limit=k)

    # ------------------------------------------------------------------
    # Index build helpers (called by server.py /api/update-* endpoints)
    # ------------------------------------------------------------------

    def build_faiss_index(
        self, source_name: str, force_rebuild: bool = False
    ) -> Dict:
        """Build / update the FAISS index for source_name."""
        return self.faiss.build_index(source_name, force_rebuild=force_rebuild)

    def build_keyword_index(
        self, source_name: str, force_reindex: bool = False
    ) -> Dict:
        """Build / update the keyword FTS5 index for source_name."""
        return self.keyword.index_source(source_name, force_reindex=force_reindex)

    def build_all_keyword_indices(self, force_reindex: bool = False) -> Dict:
        return self.keyword.index_all(force_reindex=force_reindex)

    # ------------------------------------------------------------------
    # Stats / refresh
    # ------------------------------------------------------------------

    def get_index_stats(self) -> Dict[str, Dict]:
        """Return per-source FAISS index statistics (used by /api/health)."""
        return self.faiss.get_stats()

    def refresh_indices(self) -> None:
        """Reload all FAISS indices from disk."""
        self.faiss.refresh()
        self._log("All indices refreshed")

    # ------------------------------------------------------------------
    # Filters (internal)
    # ------------------------------------------------------------------

    def _apply_filters(
        self,
        results: List[RetrievalResult],
        filters: Dict,
    ) -> List[RetrievalResult]:
        filtered = results
        if "min_score" in filters:
            filtered = [r for r in filtered if r.score >= filters["min_score"]]
        if "source_files" in filters:
            allowed = set(filters["source_files"])
            filtered = [r for r in filtered if r.filename in allowed]
        return filtered
