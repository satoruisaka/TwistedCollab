"""
faiss_indexer.py - Single-stage FAISS index builder and updater

Replaces the old dual-index (HNSW main + Flat delta) approach with a
single flat IndexFlatIP (inner product = cosine similarity for L2-normalised
embeddings) per source, with incremental update via file-hash tracking.

Sources:
    reference_papers, my_papers, sessions, web_cache
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import json
import hashlib
import pickle
from datetime import datetime
import logging

import numpy as np

try:
    import faiss
except ImportError:
    faiss = None
    logging.warning("FAISS not installed. Run: pip install faiss-gpu")

from utils.embedder import Embedder
import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Simple chunker (inline, no external dependency)
# ---------------------------------------------------------------------------

class SimpleChunker:
    """Token-based overlapping chunker for plain text."""

    def __init__(self, chunk_size: int = 500, overlap: int = 100):
        import tiktoken
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.encoding = tiktoken.get_encoding("cl100k_base")

    def chunk_text(self, text: str, doc_id: str) -> List[Dict]:
        tokens = self.encoding.encode(text)
        chunks: List[Dict] = []
        step = max(1, self.chunk_size - self.overlap)
        for i in range(0, len(tokens), step):
            chunk_tokens = tokens[i: i + self.chunk_size]
            chunk_text = self.encoding.decode(chunk_tokens)
            if chunk_text.strip():
                chunks.append({
                    "chunk_id": f"{doc_id}_chunk_{len(chunks)}",
                    "parent_id": doc_id,
                    "text": chunk_text,
                    "tokens": len(chunk_tokens),
                    "position": len(chunks),
                })
        return chunks


# ---------------------------------------------------------------------------
# FAISSIndexer
# ---------------------------------------------------------------------------

class FAISSIndexer:
    """
    Single-stage FAISS indexer.

    One flat IndexFlatIP per source.  Incrementally updates by tracking
    per-file MD5 hashes so only changed / new files are re-embedded.
    """

    # Map source name → data directory (driven by config)
    DATA_SOURCES: Dict[str, Path] = {
        "reference_papers": config.SOURCE_REFERENCE_DIR,
        "my_papers":        config.SOURCE_AUTHORED_DIR,
        "sessions":         config.SESSIONS_DIR,
        "web_cache":        config.WEB_CACHE_DIR,
        "notes":            config.SOURCE_NOTES_DIR,
        "user_uploads":     config.SOURCE_USER_UPLOADS_DIR,
        "news_articles":    config.SOURCE_NEWS_ARTICLES_DIR,
        "twistednews":      config.SOURCE_TWISTEDNEWS_DIR,
        "skills":           config.SOURCE_SKILLS_DIR,
        "debates":          config.SOURCE_DEBATES_DIR,
        "pics":             config.SOURCE_PICS_DIR,
        "dreams":           config.SOURCE_DREAMS_DIR,
    }

    def __init__(
        self,
        index_dir: Optional[Path] = None,
        embedder: Optional[Embedder] = None,
        chunk_size: int = config.CHILD_CHUNK_SIZE,
        overlap: int = config.CHUNK_OVERLAP,
        verbose: bool = False,
    ):
        self.index_dir = Path(index_dir) if index_dir else config.FAISS_DIR
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.verbose = verbose

        self._embedder = embedder       # None = lazy-load on first use
        self.chunker = SimpleChunker(chunk_size=chunk_size, overlap=overlap)

        # In-memory state
        self.indices: Dict[str, Any] = {}           # source -> FAISS index
        self.metadata: Dict[str, List[Dict]] = {}   # source -> list of chunk metadata

        self._load_all_indices()

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------

    def _log(self, msg: str) -> None:
        if self.verbose:
            logger.info("[FAISSIndexer] %s", msg)
        else:
            logger.debug("[FAISSIndexer] %s", msg)

    # ------------------------------------------------------------------
    # Embedder (lazy)
    # ------------------------------------------------------------------

    @property
    def embedder(self) -> Embedder:
        if self._embedder is None:
            self._embedder = Embedder()
        return self._embedder

    def unload_embedder(self) -> None:
        if self._embedder is not None:
            self._embedder.unload_from_gpu()

    def is_embedder_loaded(self) -> bool:
        return self._embedder is not None and hasattr(self._embedder, "model")

    # ------------------------------------------------------------------
    # File path helpers
    # ------------------------------------------------------------------

    def _index_path(self, source: str) -> Path:
        return self.index_dir / f"{source}.index"

    def _metadata_path(self, source: str) -> Path:
        return self.index_dir / f"{source}.metadata"

    def _stats_path(self, source: str) -> Path:
        return self.index_dir / f"{source}.stats"

    # ------------------------------------------------------------------
    # Load / save
    # ------------------------------------------------------------------

    def _load_all_indices(self) -> None:
        if faiss is None:
            return
        for source in self.DATA_SOURCES:
            ip = self._index_path(source)
            mp = self._metadata_path(source)
            if ip.exists() and mp.exists():
                try:
                    index = faiss.read_index(str(ip))
                    with open(mp, "rb") as f:
                        loaded_meta = pickle.load(f)
                    # Guard against legacy FAISSBuilder format (dict instead of List[Dict])
                    if not isinstance(loaded_meta, list):
                        self._log(
                            f"Skipping {source}: legacy metadata format detected "
                            f"(got {type(loaded_meta).__name__}, expected list). "
                            f"Run build_index() to rebuild with the current format."
                        )
                        continue
                    self.indices[source] = index
                    self.metadata[source] = loaded_meta
                    self._log(f"Loaded {source}: {self.indices[source].ntotal} vectors")
                except Exception as e:
                    self._log(f"Could not load {source}: {e}")

    def _save_index(self, source: str) -> None:
        if faiss is None:
            return
        faiss.write_index(self.indices[source], str(self._index_path(source)))
        with open(self._metadata_path(source), "wb") as f:
            pickle.dump(self.metadata[source], f)
        stats = {
            "total_chunks": self.indices[source].ntotal,
            "total_docs": len(set(m["parent_id"] for m in self.metadata[source])),
            "last_updated": datetime.now().isoformat(),
        }
        self._stats_path(source).write_text(json.dumps(stats, indent=2))
        self._log(
            f"Saved {source}: {stats['total_chunks']} chunks, {stats['total_docs']} docs"
        )

    # ------------------------------------------------------------------
    # Content extraction and chunking
    # ------------------------------------------------------------------

    @staticmethod
    def _get_file_hash(filepath: Path) -> str:
        hasher = hashlib.md5()
        with open(filepath, "rb") as f:
            hasher.update(f.read())
        return hasher.hexdigest()

    @staticmethod
    def _extract_text(filepath: Path) -> str:
        try:
            if filepath.suffix == ".json":
                with open(filepath, "r", encoding="utf-8") as f:
                    return json.dumps(json.load(f))
            else:
                return filepath.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            logger.warning("Could not read %s: %s", filepath, e)
            return ""

    def _process_file(
        self, filepath: Path, source_type: str
    ) -> List[Tuple[np.ndarray, Dict]]:
        """Chunk + embed one file. Returns [(embedding, metadata), ...]."""
        text = self._extract_text(filepath)
        if not text.strip():
            return []

        doc_id = filepath.stem
        chunks = self.chunker.chunk_text(text, doc_id)
        if not chunks:
            return []

        texts = [c["text"] for c in chunks]
        embeddings = self.embedder.embed_batch(texts, show_progress=False)

        file_hash = self._get_file_hash(filepath)
        results = []
        for chunk, emb in zip(chunks, embeddings):
            meta = {
                **chunk,
                "source_file": str(filepath),
                "source_type": source_type,
                "file_hash": file_hash,
                "indexed_at": datetime.now().isoformat(),
            }
            results.append((emb, meta))
        return results

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_index(self, source_name: str, force_rebuild: bool = False) -> Dict:
        """
        Build or incrementally update the FAISS index for source_name.

        Args:
            source_name:   one of DATA_SOURCES keys
            force_rebuild: if True, wipe existing index and start fresh

        Returns:
            stats dict for the source
        """
        if faiss is None:
            raise RuntimeError("FAISS is not installed.")
        if source_name not in self.DATA_SOURCES:
            raise ValueError(f"Unknown source: {source_name!r}")

        source_path = Path(self.DATA_SOURCES[source_name])
        if not source_path.exists():
            raise FileNotFoundError(f"Source path not found: {source_path}")

        self._log(f"build_index({source_name}, force={force_rebuild})")

        # Gather candidate files
        exts = {".md", ".json", ".txt"}
        files = [p for p in source_path.rglob("*") if p.is_file() and p.suffix in exts]
        self._log(f"{len(files)} candidate files")

        # Force rebuild: clear in-memory state
        if force_rebuild:
            self.indices.pop(source_name, None)
            self.metadata.pop(source_name, None)

        # Build a map of already-indexed file → hash
        existing_hashes: Dict[str, str] = {}
        if source_name in self.metadata:
            for m in self.metadata[source_name]:
                existing_hashes[m["source_file"]] = m.get("file_hash", "")

        # Identify files that are new or changed
        to_process: List[Path] = []
        for fp in files:
            try:
                current_hash = self._get_file_hash(fp)
            except Exception:
                continue
            if existing_hashes.get(str(fp)) != current_hash:
                to_process.append(fp)

        self._log(f"{len(to_process)} files to (re)index")

        if not to_process:
            self._log("Index is up to date.")
            return self.get_stats().get(source_name, {})

        # Remove stale chunks (belonging to changed files) and rebuild kept portion
        if source_name in self.metadata:
            changed_files = {str(fp) for fp in to_process}
            kept_meta = [
                m for m in self.metadata[source_name]
                if m["source_file"] not in changed_files
            ]
            if len(kept_meta) < len(self.metadata[source_name]):
                # Rebuild index from kept chunks to purge stale vectors
                self._log("Purging stale vectors and rebuilding base index...")
                if kept_meta:
                    kept_texts = [m["text"] for m in kept_meta]
                    kept_embs = self.embedder.embed_batch(kept_texts, show_progress=True)
                    dim = kept_embs.shape[1]
                    new_idx = faiss.IndexFlatIP(dim)
                    new_idx.add(kept_embs.astype("float32"))
                    self.indices[source_name] = new_idx
                else:
                    self.indices.pop(source_name, None)
                self.metadata[source_name] = kept_meta

        # Embed and add new / changed files
        all_embeddings: List[np.ndarray] = []
        all_meta: List[Dict] = []

        from tqdm import tqdm
        for fp in tqdm(to_process, desc=f"Indexing {source_name}", disable=not self.verbose):
            try:
                for emb, meta in self._process_file(fp, source_name):
                    all_embeddings.append(emb)
                    all_meta.append(meta)
            except Exception as e:
                logger.warning("Error processing %s: %s", fp, e)

        if not all_embeddings:
            self._log("No new embeddings generated.")
            return self.get_stats().get(source_name, {})

        embs_array = np.vstack(all_embeddings).astype("float32")

        if source_name not in self.indices:
            dim = embs_array.shape[1]
            self.indices[source_name] = faiss.IndexFlatIP(dim)
            self.metadata[source_name] = []

        self.indices[source_name].add(embs_array)
        self.metadata[source_name].extend(all_meta)

        # Free GPU memory
        if config.UNLOAD_EMBEDDER_AFTER_USE:
            self.unload_embedder()
            self._embedder = None

        self._save_index(source_name)
        stats = self.get_stats().get(source_name, {})
        self._log(f"Done: {stats}")
        return stats

    def search(
        self,
        query: str,
        source_names: List[str],
        top_k: int = 10,
    ) -> List[Dict]:
        """
        Search one or more FAISS indices.

        Returns results sorted by cosine similarity (highest first).
        """
        if faiss is None:
            return []

        query_emb = self.embedder.embed_single(query)
        if config.UNLOAD_EMBEDDER_AFTER_USE:
            self.unload_embedder()
            self._embedder = None

        query_vec = np.array([query_emb]).astype("float32")

        all_results: List[Dict] = []
        for source in source_names:
            if source not in self.indices:
                self._log(f"No index for {source!r}, skipping")
                continue
            index = self.indices[source]
            n = min(top_k, index.ntotal)
            if n == 0:
                continue
            scores, idxs = index.search(query_vec, n)
            meta_list = self.metadata[source]
            for score, idx in zip(scores[0], idxs[0]):
                if idx < 0 or idx >= len(meta_list):
                    continue
                m = meta_list[int(idx)]
                all_results.append({
                    "score":       float(score),
                    "source":      source,
                    "chunk_id":    m["chunk_id"],
                    "parent_id":   m["parent_id"],
                    "text":        m["text"],
                    "tokens":      m.get("tokens", 0),
                    "source_file": m.get("source_file", ""),
                    "source_type": m.get("source_type", source),
                    "indexed_at":  m.get("indexed_at", ""),
                })

        all_results.sort(key=lambda x: x["score"], reverse=True)
        return all_results[:top_k]

    def get_stats(self) -> Dict[str, Dict]:
        """Return per-source statistics dict."""
        stats: Dict[str, Dict] = {}
        for source in self.DATA_SOURCES:
            sp = self._stats_path(source)
            if sp.exists():
                try:
                    loaded = json.loads(sp.read_text())
                    stats[source] = {
                        "exists":       True,
                        "chunks":       loaded.get("total_chunks", 0),
                        "docs":         loaded.get("total_docs", 0),
                        "last_updated": loaded.get("last_updated"),
                    }
                except Exception:
                    stats[source] = {"exists": False, "chunks": 0, "docs": 0, "last_updated": None}
            else:
                stats[source] = {"exists": False, "chunks": 0, "docs": 0, "last_updated": None}
            # Override with live in-memory counts
            if source in self.indices:
                stats[source]["exists"] = True
                stats[source]["chunks"] = self.indices[source].ntotal
                stats[source]["docs"] = len(
                    set(m["parent_id"] for m in self.metadata.get(source, []))
                )
        return stats

    def refresh(self) -> None:
        """Reload all indices from disk."""
        self._log("Refreshing all indices...")
        self.indices.clear()
        self.metadata.clear()
        self._load_all_indices()
