# TwistedCollab

> **Local-first AI research assistant** — semantic search, keyword search, RAG-powered chat, Markdown notes, and rhetorical distortion via TwistedPair. Fully self-contained; no cloud dependencies.

Created: February 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Key Improvements Over MRA](#key-improvements-over-mra)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Configuration](#configuration)
7. [Starting the Server](#starting-the-server)
8. [User Interface](#user-interface)
9. [Search System](#search-system)
10. [RAG Pipeline](#rag-pipeline)
11. [TwistedPair Distortion](#twistedpair-distortion)
12. [Web Search](#web-search)
13. [Index Management](#index-management)
14. [Session Management](#session-management)
15. [API Reference](#api-reference)
16. [Data Directory Layout](#data-directory-layout)
17. [Module Reference](#module-reference)
18. [Environment Variables](#environment-variables)

---

## Overview

TwistedCollab is a local-first AI research assistant built on FastAPI + Ollama. It provides a full-featured web UI for:

- **RAG-augmented chat** — answers grounded in your own document collections
- **Semantic search** — vector similarity via FAISS (`IndexFlatIP`, cosine similarity)
- **Keyword search** — full-text search via SQLite FTS5 (Porter stemming)
- **Live web search** — Brave API with DuckDuckGo fallback and automatic caching
- **Rhetorical distortion** — TwistedPair integration for six modes of perspective reframing
- **Markdown notes** — built-in editor with live preview, saved to server
- **Session history** — every conversation auto-saved, searchable, and indexable

---

## Key Improvements Over MRA

| Feature | MRA | TwistedCollab |
|---|---|---|
| Index architecture | Dual-index (HNSW main + Flat delta) | Single-stage `IndexFlatIP` — simpler, faster, no merge overhead |
| Search modes | Semantic only | **Semantic / Keyword / Both** (user-selectable, segmented UI) |
| Data sources | 4 (reference papers, my papers, sessions, web cache) | **9** — adds Notes, User Uploads, News Articles, TwistedNews |
| Keyword index | None | SQLite FTS5, incrementally updated, per-source |
| UI | Functional | Tabbed layout, collapsible sidebar, dark/light theme, segmented controls |
| Notes | None | Full Markdown editor with split-pane live preview, server save, download |
| Distortion | Off by default | Per-session, 6 modes × 5 tones × gain 1–10, ensemble mode |
| Streaming | No | **SSE token streaming** for all chat responses |
| Auto-indexing | Manual | Sessions and web cache auto-indexed on save |
| File upload | None | Upload PDF/TXT/CSV/MD into `user_uploads` source |
| Collab | None | Placeholder for **upcoming agentic workflow** |

---

## Architecture

```
Browser (index.html + app.js)
        │  SSE / REST
        ▼
  server.py  (FastAPI)
  ├── ChatManager           ← session lifecycle, prompt assembly
  ├── RetrievalManager
  │   ├── FAISSIndexer      ← semantic search (IndexFlatIP per source)
  │   └── KeywordIndexer    ← FTS5 full-text search (SQLite)
  ├── WebSearchClient       ← Brave API + DDG fallback + caching
  ├── OllamaClient          ← LLM generation via Ollama REST API
  └── TwistedPairClient     ← rhetorical distortion via TwistedPair V4

External services (local):
  Ollama       localhost:11434   (LLM inference)
  TwistedPair  localhost:8001    (text distortion)
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.10+ | Tested on 3.10 |
| CUDA GPU | Required for FAISS embedding (`BAAI/bge-large-en-v1.5`) |
| [Ollama](https://ollama.com) | Running on `localhost:11434` |
| TwistedPair V4 | Running on `localhost:8001` (optional — distortion only) |
| Brave Search API key | Optional — falls back to DuckDuckGo |

---

## Installation

```bash
cd TwistedCollab
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy and fill in the environment file:

```bash
cp .env.example .env
# Set BRAVE_API_KEY, OLLAMA_URL, TWISTEDPAIR_URL if non-default
```

---

## Configuration

All settings live in `config.py` and can be overridden via environment variables or `.env`.

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `TWISTEDPAIR_URL` | `http://localhost:8001` | TwistedPair server URL |
| `BRAVE_API_KEY` | *(from .env)* | Brave Search API key |
| `DEFAULT_MODEL` | `ministral-3:14b` | Default Ollama model |
| `NUM_CTX` | `128000` | LLM context window (tokens) |
| `DEFAULT_OUTPUT_TOKENS` | `8000` | Default response token limit |
| `OLLAMA_KEEP_ALIVE` | `3m` | How long to hold model in GPU memory |
| `EMBEDDING_MODEL` | `BAAI/bge-large-en-v1.5` | Sentence embedding model |
| `EMBEDDING_DIM` | `1024` | Embedding vector dimension |
| `UNLOAD_EMBEDDER_AFTER_USE` | `True` | Free GPU after embedding queries |
| `CHILD_CHUNK_SIZE` | `500` | Tokens per chunk for FAISS indexing |
| `CHUNK_OVERLAP` | `100` | Overlap between consecutive chunks |

---

## Starting the Server

```bash
# 1. Ensure Ollama is running
ollama serve

# 2. (Optional) Start TwistedPair
cd ../TwistedPair/V2
uvicorn server:app --host 0.0.0.0 --port 8001

# 3. Start TwistedCollab
cd TwistedCollab
source .venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Open **http://localhost:8000** in a browser.

---

## User Interface

### Search Tab

The primary workspace. Three-column layout:

**Left: Collapsible Sidebar**
- **Data Source** — checkboxes to select which collections feed retrieval:
  - Live Web, Web Cache, References, My Papers, Notes, Sessions, Uploads, News Articles, TwistedNews
- **Search Mode** — segmented button control (fits the 200 px sidebar):
  - `Semantic` — FAISS vector similarity (default)
  - `Keyword` — SQLite FTS5 full-text
  - `Both` — merged results, semantic first
- **Upload File** — add PDF/TXT/CSV/MD to the user_uploads collection
- **Update Index** — trigger FAISS or keyword re-indexing on demand
- **LLM Settings** *(collapsible)* — model, temperature, top-p, top-k, max tokens, context window, retrieval top-k
- **Distortion** *(inside LLM Settings)* — Mode, Tone, Gain slider, Ensemble mode, Conversation context toggle

**Center: Chat**
- Query textarea — `Send` (Ctrl+Enter), `Clear`, `New Chat`
- Token-streaming responses via Server-Sent Events
- Each exchange collapsible; shows question, streamed answer, retrieved source citations

**Right: Quick Notes**
- Mini scratchpad always visible alongside chat for jotting during research

### Notes Tab

Full Markdown editor:
- **Three view modes**: Edit / Split (side-by-side preview) / Preview — toolbar or `Ctrl+E`
- **File operations**: New, Open (server-side file browser), Save (`Ctrl+S`), Download (`Ctrl+Shift+S`), Close
- **Auto-save** every 30 seconds when unsaved changes are present
- Files saved to `data/markdown/notes/` and indexed as the Notes search source
- Unsaved-change indicator (● in filename bar), live character count

### Sessions Tab

- Reverse-chronological list of all past conversations
- Click any session to resume it (full message history restored)
- Live filter box to search session titles and previews
- Sessions stored as JSON + Markdown in `data/sessions/`

### Collab Tab (Coming Soon)

Placeholder for the **Agentic Workflow** feature. Planned capabilities:
- Multi-agent orchestration within TwistedCollab
- Agent-to-agent collaboration with role assignment
- Structured research pipelines with human-in-the-loop checkpoints
- TwistedPair integration for perspective diversification across agents

---

## Search System

### Semantic Search (FAISS)

Implemented in `faiss_indexer.py` (`FAISSIndexer`).

- One `IndexFlatIP` (inner product = cosine similarity on L2-normalised vectors) per source
- Embedder: `BAAI/bge-large-en-v1.5` (1024-dim), GPU-accelerated, unloaded after use
- Incremental updates via MD5 file-hash tracking — only new/changed files re-embedded
- Metadata stored as pickle list of chunk dicts

Chunking: `SimpleChunker` — tiktoken `cl100k_base`, 500-token chunks, 100-token overlap.

### Keyword Search (SQLite FTS5)

Implemented in `keyword_indexer.py` (`KeywordIndexer`).

- SQLite FTS5 with Porter stemmer and unicode61 tokenizer
- Per-source indexing matching the FAISS source set
- Incremental updates via MD5 file-hash tracking
- Returns highlighted snippets with `<mark>` tags (stripped before LLM context assembly)
- Thread-safe via `threading.Lock`

### Search Mode Selector

The segmented button group in the sidebar controls retrieval for both chat RAG and direct `/api/search` calls:

| Mode | Behaviour |
|---|---|
| `Semantic` | FAISS cosine similarity only (default) |
| `Keyword` | SQLite FTS5 only |
| `Both` | Semantic results first, keyword results appended |

---

## RAG Pipeline

When a message is sent with at least one data source checked:

1. **Retrieval** — `RetrievalManager` runs the selected search mode across checked sources
2. **Context assembly** — top-k results → `ContextItem` objects (snippet ≤ 300 chars)
3. **Web search** (if enabled) — live results appended to context
4. **Uploaded documents** — full content prepended if files were uploaded in the session
5. **Prompt construction** — `ChatManager` builds system prompt with all context + conversation history
6. **Streaming generation** — `OllamaClient.chat_stream()` streams tokens via SSE
7. **Distortion** (if enabled) — full response passed through `TwistedPairClient.distort()` before display
8. **Session save** — exchange auto-saved to JSON; session auto-indexed on close

---

## TwistedPair Distortion

TwistedPair is a separate local REST service for rhetorical reframing. Configured per-session in LLM Settings.

**6 Modes:**

| Mode | Effect |
|---|---|
| Off | No distortion (default) |
| Echo-er | Amplifies positives, affirming framing |
| Invert-er | Negates signals, challenges assumptions |
| What-if-er | Explores counterfactuals and alternatives |
| So-what-er | Demands implications and consequences |
| Cucumb-er | Cool academic / analytical register |
| Archiv-er | Historical context and precedent |

**5 Tones:** Neutral · Technical · Primal · Poetic · Satirical

**Gain:** 1–10 (distortion intensity)

**Ensemble Mode:** All 6 modes applied simultaneously; responses returned as a structured set.

---

## Web Search

`WebSearchClient` in `web_search.py`:

1. **Primary**: Brave Search API (`BRAVE_API_KEY` required)
2. **Fallback**: DuckDuckGo via `ddgs` (no key required)
3. Each result URL fetched, BeautifulSoup-parsed, truncated to `WEB_FETCH_MAX_CHARS`
4. Results cached to `data/web_cache/` as JSON + Markdown
5. Cache auto-indexed into FAISS and keyword indices for future retrieval

---

## Index Management

### From the UI (sidebar)

- **Keyword Index** button → `POST /api/update-keyword-index`
- **FAISS Index** button → `POST /api/update-faiss-index`

Both accept `sources` (list, defaults to all) and `force` (full rebuild flag).

### Command Line

```bash
python build_runtime_indices.py          # Build all FAISS indices
python MRA_v3_4_verify_index.py          # Verify index integrity
```

### Auto-Indexing (config.py)

| Flag | Default | Effect |
|---|---|---|
| `AUTO_INDEX_SESSIONS` | `True` | Index session when closed |
| `AUTO_INDEX_WEB_CACHE` | `True` | Index web result after caching |
| `AUTO_INDEX_PAPERS` | `False` | Papers require explicit rebuild |

---

## Session Management

Each session is identified by a UUID:

```
data/sessions/
├── session_<uuid>_<timestamp>.json   ← full conversation + metadata
└── session_<uuid>_<timestamp>.md     ← Markdown summary for search indexing
```

Sessions are resumable from the Sessions tab. Closed sessions are auto-indexed so their content becomes searchable in future conversations.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/chat/message/stream` | Streaming SSE chat with RAG |
| POST | `/api/chat/end-session` | Close and save session |
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/{id}` | Get session details |
| POST | `/api/search` | Direct search (semantic/keyword/both) |
| POST | `/api/web-search` | Live web search |
| POST | `/api/distort` | Direct TwistedPair distortion |
| POST | `/api/update-faiss-index` | Build/update FAISS indices |
| POST | `/api/update-keyword-index` | Build/update FTS5 indices |
| POST | `/api/upload` | Upload file to user_uploads |
| GET | `/api/notes` | List saved notes |
| GET | `/api/notes/{filename}` | Load a note |
| PUT | `/api/notes/{filename}` | Save a note |
| GET | `/api/health` | Health — Ollama, TwistedPair, embedder, GPU |

### Key Chat Request Fields

```json
{
  "session_id": "new",
  "message": "...",
  "use_rag": true,
  "search_mode": "semantic",
  "search_scope": {
    "reference_papers": true,
    "my_papers": false,
    "sessions": false,
    "web_cache": false
  },
  "use_web_search": false,
  "model": "ministral-3:14b",
  "temperature": 0.7,
  "max_tokens": 8000,
  "num_ctx": 128000,
  "top_k_retrieval": 20,
  "use_distortion": false,
  "distortion_mode": "cucumb_er",
  "distortion_tone": "neutral",
  "distortion_gain": 5
}
```

---

## Data Directory Layout

```
TwistedCollab/
├── data/
│   ├── markdown/
│   │   ├── reference_papers/   ← converted PDFs from MyReferences
│   │   ├── my_papers/          ← converted PDFs from MyAuthoredPapers
│   │   ├── notes/              ← saved Markdown notes
│   │   ├── user_uploads/       ← files uploaded via UI
│   │   ├── news_articles/      ← news from NewsAgent
│   │   └── twistednews/        ← rhetorical news from TwistedNews
│   ├── sessions/               ← chat session JSON + MD files
│   └── web_cache/              ← cached web search results
├── faiss_indices/
│   ├── <source>.index          ← FAISS IndexFlatIP (one per source)
│   ├── <source>.metadata       ← chunk metadata (pickle list)
│   └── <source>.stats          ← JSON stats (chunks, docs, last_updated)
├── data/keyword_index.db       ← SQLite FTS5 database
├── static/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── models/                     ← reserved for local model files
```

---

## Module Reference

| File | Role |
|---|---|
| `server.py` | FastAPI app, all REST endpoints, request/response models |
| `chat_manager.py` | Session lifecycle, message history, prompt construction |
| `retrieval_manager.py` | Unified interface to FAISS + keyword search |
| `faiss_indexer.py` | Single-stage FAISS builder, searcher, incremental updater |
| `keyword_indexer.py` | SQLite FTS5 builder and searcher |
| `ollama_client.py` | Ollama REST API wrapper (generate, chat, stream, health) |
| `twistedpair_client.py` | TwistedPair V4 REST client (distort, is_healthy) |
| `web_search.py` | Brave + DDG search, URL fetch, result caching |
| `auto_indexer.py` | Automatic indexing of sessions and web cache at runtime |
| `build_runtime_indices.py` | CLI script to build all indices from scratch |
| `config.py` | All configuration constants and directory setup |
| `errors.py` | Shared exception types and retry decorator |
| `utils/embedder.py` | `BAAI/bge-large-en-v1.5` embedding wrapper |

---

## Environment Variables

| Variable | Description |
|---|---|
| `OLLAMA_URL` | Ollama server (default: `http://localhost:11434`) |
| `TWISTEDPAIR_URL` | TwistedPair server (default: `http://localhost:8001`) |
| `BRAVE_API_KEY` | Brave Search API key |
| `OLLAMA_KEEP_ALIVE` | GPU keep-alive duration (default: `3m`) |
| `LOG_LEVEL` | Logging level (default: `INFO`) |

---

## License

MIT License

## Created and last update

February 22, 2026
