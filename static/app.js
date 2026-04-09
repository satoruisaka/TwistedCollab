// app.js — TwistedCollab2 frontend

// ===========================================================================
// State
// ===========================================================================
const state = {
    currentSessionId: null,
    messages: [],
    uploadedDocuments: [],
    notepad: {
        currentFile: 'Untitled.md',
        content: '',
        unsavedChanges: false,
        previewMode: 'edit',   // 'edit' | 'split' | 'preview'
    },
    theme: 'dark',
    settings: {
        model: '',
        temperature: 0.7,
        topP: 0.9,
        topKGen: 40,
        maxTokens: 8000,
        contextWindow: 128000,
        topK: 20,
        searchScope: {
            live_web: false,
            web_cache: false,
            reference_papers: false,
            my_papers: false,
            notes: false,
            sessions: false,
            user_uploads: false,
            news_articles: false,
            twistednews: false,
            skills: false,
            debates: false,
            pics: false,
            dreams: false
        },
        useWebSearch: false,
        searchMode: 'semantic',
        // Distortion: enabled when mode !== 'off'
        distortionMode: 'off',
        distortionTone: 'neutral',
        distortionGain: 5,
        useEnsemble: false,
        includeConversationContext: true
    }
};

let currentExchange = null;
let _defaultsApplied = false;  // apply server defaults only on first health check

const API_BASE = window.location.origin;

// Configure marked.js
if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
}

// ===========================================================================
// Init
// ===========================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    initNavTabs();
    initSidebar();
    initEventListeners();
    checkServiceStatus();
    loadSessions();
    initNotepad();
    initCollab();
    initUtility();
    initFileManager();

    // Welcome exchange toggle
    const welcomeHeader = document.querySelector('#welcome-exchange .exchange-header');
    if (welcomeHeader) {
        welcomeHeader.addEventListener('click', () => toggleExchange('welcome-exchange'));
    }
});

// ===========================================================================
// Theme (dark / light) — pattern from TwistedDebate v4
// ===========================================================================
function loadTheme() {
    const saved = localStorage.getItem('twistedcollab-theme');
    if (saved) state.theme = saved;
    applyTheme();
}

function applyTheme() {
    const icon = document.querySelector('.theme-icon');
    if (state.theme === 'light') {
        document.body.classList.add('light-theme');
        if (icon) icon.textContent = '☀️';
    } else {
        document.body.classList.remove('light-theme');
        if (icon) icon.textContent = '🌙';
    }
}

function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    localStorage.setItem('twistedcollab-theme', state.theme);
}

// ===========================================================================
// Navigation Tabs
// ===========================================================================
function initNavTabs() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => switchNavTab(btn.dataset.tab));
    });
}

function switchNavTab(tabName) {
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `${tabName}-tab`);
    });
}

// ===========================================================================
// Sidebar collapse (Search tab)
// ===========================================================================
function initSidebar() {
    const btn = document.getElementById('collapse-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const layout = document.querySelector('#search-tab .layout');
        const collapsed = sidebar.classList.toggle('collapsed');
        layout.classList.toggle('sidebar-collapsed', collapsed);
        btn.textContent = collapsed ? '▶' : '◀';
    });
}

// ===========================================================================
// Help Modal
// ===========================================================================
function showHelp() {
    document.getElementById('help-modal').style.display = 'flex';
}
function hideHelp() {
    document.getElementById('help-modal').style.display = 'none';
}

// ===========================================================================
// Event Listeners
// ===========================================================================
function initEventListeners() {
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // Help modal
    document.getElementById('help-btn').addEventListener('click', showHelp);
    document.getElementById('close-help').addEventListener('click', hideHelp);
    document.getElementById('help-modal').addEventListener('click', e => {
        if (e.target.id === 'help-modal') hideHelp();
    });

    // Query
    document.getElementById('send-query-btn').addEventListener('click', () => {
        const q = document.getElementById('query-input').value.trim();
        if (q) sendMessage(q);
    });
    document.getElementById('query-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); document.getElementById('send-query-btn').click(); }
    });
    document.getElementById('clear-query-btn').addEventListener('click', () => {
        document.getElementById('query-input').value = '';
        document.getElementById('query-input').focus();
    });
    document.getElementById('new-chat-btn').addEventListener('click', createNewSession);

    // Data source checkboxes — live_web also drives useWebSearch
    document.querySelectorAll('[name="scope"]').forEach(cb => {
        cb.addEventListener('change', e => {
            state.settings.searchScope[e.target.value] = e.target.checked;
            if (e.target.value === 'live_web') {
                state.settings.useWebSearch = e.target.checked;
            }
        });
    });

    // Search mode segmented buttons
    document.querySelectorAll('#search-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#search-mode-group .seg-btn').forEach(b => b.classList.remove('seg-btn-active'));
            btn.classList.add('seg-btn-active');
            state.settings.searchMode = btn.dataset.value;
        });
    });

    // LLM Settings sliders
    const sliderMap = [
        ['temperature',    'temp-value',           v => state.settings.temperature    = parseFloat(v)],
        ['top-p',          'top-p-value',          v => state.settings.topP            = parseFloat(v)],
        ['top-k-gen',      'top-k-gen-value',      v => state.settings.topKGen         = parseInt(v)],
        ['max-tokens',     'max-tokens-value',     v => state.settings.maxTokens       = parseInt(v)],
        ['context-window', 'context-window-value', v => state.settings.contextWindow   = parseInt(v)],
        ['top-k',          'top-k-value',          v => state.settings.topK            = parseInt(v)],
        ['distortion-gain','gain-value',           v => state.settings.distortionGain  = parseInt(v)],
    ];
    sliderMap.forEach(([sliderId, displayId, setter]) => {
        const el = document.getElementById(sliderId);
        if (!el) return;
        el.addEventListener('input', e => {
            setter(e.target.value);
            document.getElementById(displayId).textContent = e.target.value;
        });
    });

    document.getElementById('model-select').addEventListener('change', e => {
        state.settings.model = e.target.value;
    });

    // Distortion selects
    document.getElementById('distortion-mode').addEventListener('change', e => {
        state.settings.distortionMode = e.target.value;
    });
    document.getElementById('distortion-tone').addEventListener('change', e => {
        state.settings.distortionTone = e.target.value;
    });
    document.getElementById('ensemble-mode').addEventListener('change', e => {
        state.settings.useEnsemble = e.target.checked;
    });
    document.getElementById('conversation-context').addEventListener('change', e => {
        state.settings.includeConversationContext = e.target.checked;
    });

    // File upload
    document.getElementById('upload-btn').addEventListener('click', () => {
        document.getElementById('file-upload-input').click();
    });
    document.getElementById('file-upload-input').addEventListener('change', handleFileUpload);

    // Sessions tab — new session button
    document.getElementById('new-session-btn').addEventListener('click', createNewSession);

    // Sessions search filter
    document.getElementById('sessions-search-input').addEventListener('input', e => {
        filterSessionsList(e.target.value.toLowerCase());
    });

    // Notes tab preview mode buttons
    document.querySelectorAll('.preview-btn').forEach(btn => {
        btn.addEventListener('click', () => setPreviewMode(btn.dataset.mode));
    });

    // Index update buttons
    document.getElementById('update-keyword-index-btn').addEventListener('click', () => updateIndex('keyword'));
    document.getElementById('update-faiss-index-btn').addEventListener('click', () => updateIndex('faiss'));

    // Keyboard shortcuts
    document.addEventListener('keydown', handleGlobalShortcuts);
}

// ===========================================================================
// Service Status
// ===========================================================================
async function checkServiceStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/health`);
        const data = await res.json();

        // Ollama
        const ollamaDot = document.getElementById('ollama-status');
        const modelSelect = document.getElementById('model-select');
        if (data.services?.ollama?.status === 'online') {
            ollamaDot.classList.remove('offline');
            const models = data.services.ollama.models || [];
            if (models.length) {
                modelSelect.disabled = false;
                const defaultModel = data.services.ollama.default_model || '';
                const prev = modelSelect.value || state.settings.model;
                modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
                modelSelect.value = models.includes(prev) ? prev : (models.includes(defaultModel) ? defaultModel : models[0]);
                state.settings.model = modelSelect.value;
            } else {
                modelSelect.innerHTML = '<option value="">No models available</option>';
                modelSelect.disabled = true;
            }
            // Apply server-side defaults once on first load
            if (!_defaultsApplied && data.services.ollama.default_settings) {
                const ds = data.services.ollama.default_settings;
                const sync = (id, displayId, val) => {
                    const el = document.getElementById(id);
                    if (el && val !== undefined) el.value = val;
                    const disp = document.getElementById(displayId);
                    if (disp && val !== undefined) disp.textContent = val;
                };
                if (ds.temperature  !== undefined) { state.settings.temperature  = ds.temperature;   sync('temperature',    'temp-value',           ds.temperature); }
                if (ds.top_p        !== undefined) { state.settings.topP         = ds.top_p;          sync('top-p',          'top-p-value',          ds.top_p); }
                if (ds.top_k        !== undefined) { state.settings.topKGen      = ds.top_k;          sync('top-k-gen',      'top-k-gen-value',      ds.top_k); }
                if (ds.max_tokens   !== undefined) { state.settings.maxTokens    = ds.max_tokens;     sync('max-tokens',     'max-tokens-value',     ds.max_tokens); }
                if (ds.context_window !== undefined) { state.settings.contextWindow = ds.context_window; sync('context-window', 'context-window-value', ds.context_window); }
                _defaultsApplied = true;
            }
        } else {
            ollamaDot.classList.add('offline');
            modelSelect.disabled = true;
        }

        // TwistedPair — new ID matches index_collab.html
        const tpDot = document.getElementById('twistedpair-status');
        if (data.services?.twistedpair?.status === 'online') {
            tpDot.classList.remove('offline');
        } else {
            tpDot.classList.add('offline');
        }

    } catch (e) {
        console.error('Health check failed:', e);
        document.querySelectorAll('.status-dot').forEach(d => d.classList.add('offline'));
        document.getElementById('model-select').disabled = true;
    }
    setTimeout(checkServiceStatus, 60000);
}

// ===========================================================================
// Send Message / Streaming
// ===========================================================================
async function sendMessage(queryText) {
    if (!queryText) return;

    const sendBtn = document.getElementById('send-query-btn');
    sendBtn.disabled = true;

    collapseAllExchanges();
    startNewExchange();
    addMessage('user', queryText);

    const streamingId = addStreamingMessage();

    // Determine if distortion is active (mode is not 'off')
    const useDistortion = state.settings.distortionMode !== 'off';

    // Build search_scope for the server — all FAISS/keyword scope keys (live_web excluded; it maps to use_web_search)
    const requestData = {
        session_id: state.currentSessionId || 'new',
        message: queryText,
        use_rag: Object.entries(state.settings.searchScope).some(([k, v]) => k !== 'live_web' && v),
        use_web_search: state.settings.useWebSearch,
        use_distortion: useDistortion,
        use_ensemble_distortion: useDistortion && state.settings.useEnsemble,
        include_conversation_context: state.settings.includeConversationContext,
        search_scope: {
            reference_papers: state.settings.searchScope.reference_papers,
            my_papers:         state.settings.searchScope.my_papers,
            sessions:          state.settings.searchScope.sessions,
            web_cache:         state.settings.searchScope.web_cache,
            notes:             state.settings.searchScope.notes,
            user_uploads:      state.settings.searchScope.user_uploads,
            news_articles:     state.settings.searchScope.news_articles,
            twistednews:       state.settings.searchScope.twistednews,
            skills:            state.settings.searchScope.skills,
            debates:           state.settings.searchScope.debates,
            pics:              state.settings.searchScope.pics,
            dreams:            state.settings.searchScope.dreams,
        },
        model: state.settings.model,
        temperature: state.settings.temperature,
        top_p: state.settings.topP,
        top_k: state.settings.topKGen,
        max_tokens: state.settings.maxTokens,
        num_ctx: state.settings.contextWindow,
        top_k_retrieval: state.settings.topK,
        search_mode: state.settings.searchMode,
        distortion_mode: useDistortion ? state.settings.distortionMode : 'cucumb_er',
        distortion_tone: state.settings.distortionTone,
        distortion_gain: state.settings.distortionGain
    };

    if (state.uploadedDocuments.length > 0) {
        requestData.uploaded_context = state.uploadedDocuments.map(d => ({
            filename: d.filename, content: d.content
        }));
        console.log(`📄 Including ${state.uploadedDocuments.length} uploaded document(s) in request:`, 
            state.uploadedDocuments.map(d => d.filename));
    }

    try {
        const res = await fetch(`${API_BASE}/api/chat/message/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let contextData = null;
        let tokenCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const ev = JSON.parse(line.slice(6));
                    if (ev.type === 'session_id') {
                        state.currentSessionId = ev.session_id;
                    } else if (ev.type === 'context') {
                        contextData = ev.context;
                    } else if (ev.type === 'token') {
                        tokenCount++;
                        appendToStreamingMessage(streamingId, ev.content);
                    } else if (ev.type === 'ensemble') {
                        displayEnsembleOutputs(ev.outputs);
                    } else if (ev.type === 'distortion') {
                        replaceStreamingMessageContent(streamingId, ev.content);
                    } else if (ev.type === 'done') {
                        finalizeStreamingMessage(streamingId, contextData);
                        loadSessions();
                    } else if (ev.type === 'error') {
                        throw new Error(ev.message);
                    }
                } catch (pe) {
                    console.error('SSE parse error:', pe, line);
                }
            }
        }
    } catch (err) {
        console.error('sendMessage error:', err);
        removeMessage(streamingId);
        addMessage('assistant', `❌ Error: ${err.message}`, true);
    } finally {
        sendBtn.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------
function addStreamingMessage() {
    const target = currentExchange
        ? currentExchange.querySelector('.exchange-content')
        : document.getElementById('chat-messages');

    const id = `msg-assistant-${Date.now()}-${Math.random().toString(36).substr(2,7)}`;
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.id = id;
    div.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content streaming"><span class="streaming-cursor">▋</span></div>
    `;
    target.appendChild(div);
    document.getElementById('chat-messages').scrollTop = 9999;
    return id;
}

function appendToStreamingMessage(id, token) {
    const el = document.getElementById(id);
    if (!el) return;
    const content = el.querySelector('.message-content');
    const cursor = content.querySelector('.streaming-cursor');
    if (cursor) {
        content.insertBefore(document.createTextNode(token), cursor);
    } else {
        content.appendChild(document.createTextNode(token));
    }
    document.getElementById('chat-messages').scrollTop = 9999;
}

function replaceStreamingMessageContent(id, newContent) {
    const el = document.getElementById(id);
    if (!el) return;
    const content = el.querySelector('.message-content');
    const cursor = content.querySelector('.streaming-cursor');
    content.innerHTML = '';
    content.appendChild(document.createTextNode(newContent));
    if (cursor) content.appendChild(cursor);
}

function finalizeStreamingMessage(id, contextData) {
    const el = document.getElementById(id);
    if (!el) return;
    const content = el.querySelector('.message-content');
    const cursor = content.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();
    content.classList.remove('streaming');

    const text = content.textContent.trim();
    if (!text) {
        content.textContent = '⚠️ No response received.';
        return;
    }
    el.setAttribute('data-markdown', text);
    if (typeof marked !== 'undefined') content.innerHTML = marked.parse(text);
    addCopyButton(el, content, text);

    if (contextData?.length) {
        const srcDiv = document.createElement('div');
        srcDiv.className = 'message-sources';
        srcDiv.innerHTML = '<strong>Sources:</strong><br>';
        contextData.forEach((src, i) => {
            const score = typeof src.score === 'number' ? src.score.toFixed(2) : 'N/A';
            const label = src.title || src.source || `Source ${i+1}`;
            let tag;
            if (src.url) {
                tag = document.createElement('a');
                tag.href = src.url; tag.target = '_blank';
                tag.className = 'source-tag web-source-link';
            } else {
                tag = document.createElement('span');
                tag.className = 'source-tag';
            }
            tag.textContent = `${label} (${score})`;
            srcDiv.appendChild(tag);
            if (src.snippet) {
                const sn = document.createElement('div');
                sn.className = 'source-snippet';
                sn.textContent = src.snippet;
                srcDiv.appendChild(sn);
            }
        });
        content.appendChild(srcDiv);
    }
    const ts = document.createElement('div');
    ts.className = 'message-timestamp';
    ts.textContent = new Date().toLocaleTimeString();
    content.appendChild(ts);
    document.getElementById('chat-messages').scrollTop = 9999;
}

function removeMessage(id) {
    document.getElementById(id)?.remove();
}

// ===========================================================================
// Exchange Management
// ===========================================================================
function startNewExchange() {
    const container = document.getElementById('chat-messages');
    const ex = document.createElement('div');
    ex.className = 'exchange-container';
    ex.id = `exchange-${Date.now()}`;
    ex.innerHTML = `
        <div class="exchange-header">
            <span class="exchange-summary">Loading...</span>
            <span class="exchange-toggle">▼</span>
        </div>
        <div class="exchange-content"></div>
    `;
    ex.querySelector('.exchange-header').addEventListener('click', () => toggleExchange(ex.id));
    container.appendChild(ex);
    currentExchange = ex;
    container.scrollTop = 9999;
}

function collapseAllExchanges() {
    document.querySelectorAll('#chat-messages .exchange-container').forEach(ex => {
        ex.classList.add('collapsed');
    });
}

function toggleExchange(id) {
    document.getElementById(id)?.classList.toggle('collapsed');
}

function updateExchangeHeader(msg) {
    if (!currentExchange) return;
    const preview = msg.length > 65 ? msg.substring(0, 65) + '…' : msg;
    currentExchange.querySelector('.exchange-summary').textContent = `💬 ${preview}`;
}

// ===========================================================================
// Add Message (user / assistant / system)
// ===========================================================================
function addMessage(role, content, isHtml = false, sources = null) {
    const container = document.getElementById('chat-messages');
    const target = currentExchange ? currentExchange.querySelector('.exchange-content') : container;

    if (role === 'user' && !isHtml) updateExchangeHeader(content);

    const id = `msg-${Date.now()}`;
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.id = id;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const body = document.createElement('div');
    body.className = 'message-content';

    if (isHtml) {
        body.innerHTML = content;
    } else if (role === 'assistant') {
        div.setAttribute('data-markdown', content);
        if (typeof marked !== 'undefined') body.innerHTML = marked.parse(content);
        else body.textContent = content;
        addCopyButton(div, body, content);
    } else {
        body.textContent = content;
    }

    if (sources?.length) {
        const srcDiv = document.createElement('div');
        srcDiv.className = 'message-sources';
        srcDiv.innerHTML = '<strong>Sources:</strong><br>';
        sources.forEach((src, i) => {
            const score = typeof src.score === 'number' ? src.score.toFixed(2) : 'N/A';
            const label = src.title || src.source || `Source ${i+1}`;
            let tag;
            if (src.url) {
                tag = document.createElement('a');
                tag.href = src.url; tag.target = '_blank';
                tag.className = 'source-tag web-source-link';
            } else {
                tag = document.createElement('span');
                tag.className = 'source-tag';
            }
            tag.textContent = `${label} (${score})`;
            srcDiv.appendChild(tag);
            if (src.snippet) {
                const sn = document.createElement('div');
                sn.className = 'source-snippet'; sn.textContent = src.snippet;
                srcDiv.appendChild(sn);
            }
        });
        body.appendChild(srcDiv);
    }

    const ts = document.createElement('div');
    ts.className = 'message-timestamp';
    ts.textContent = new Date().toLocaleTimeString();
    body.appendChild(ts);

    div.appendChild(avatar);
    div.appendChild(body);
    target.appendChild(div);
    container.scrollTop = 9999;
    return id;
}

// ===========================================================================
// Ensemble
// ===========================================================================
function displayEnsembleOutputs(outputs) {
    const container = document.getElementById('chat-messages');
    const target = currentExchange ? currentExchange.querySelector('.exchange-content') : container;
    const modeLabels = {
        'invert_er':'🔄 Inverter','so_what_er':'❓ So-What-er',
        'echo_er':'📣 Echo-er','what_if_er':'💡 What-If-er',
        'cucumb_er':'🥒 Cucumber','archiv_er':'📚 Archiver'
    };
    const wrap = document.createElement('div');
    wrap.className = 'ensemble-outputs';
    wrap.innerHTML = '<h3 style="margin:0 0 0.75rem;font-size:0.95rem;">🎸 Ensemble — All 6 Perspectives</h3>';
    outputs.forEach((out, i) => {
        const det = document.createElement('details');
        det.className = 'ensemble-perspective';
        det.open = i === 0;
        det.innerHTML = `
            <summary>${modeLabels[out.mode] || out.mode}</summary>
            <div class="ensemble-content">${out.response}</div>
        `;
        wrap.appendChild(det);
    });
    target.appendChild(wrap);
    container.scrollTop = 9999;
}

// ===========================================================================
// Copy button
// ===========================================================================
function addCopyButton(msgDiv, contentDiv, markdown) {
    const btn = document.createElement('button');
    btn.className = 'copy-markdown-btn';
    btn.innerHTML = '📋 Copy Markdown';
    btn.addEventListener('click', async e => {
        e.stopPropagation();
        const text = markdown || msgDiv.getAttribute('data-markdown') || '';
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
            }
            btn.innerHTML = '✅ Copied!'; btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = '📋 Copy Markdown'; btn.classList.remove('copied'); }, 2000);
        } catch (err) {
            btn.innerHTML = '❌ Failed';
            setTimeout(() => { btn.innerHTML = '📋 Copy Markdown'; }, 2000);
        }
    });
    contentDiv.insertBefore(btn, contentDiv.firstChild);
}

// ===========================================================================
// File Upload
// ===========================================================================
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const statusDiv = document.getElementById('upload-status');
    const validExts = ['.pdf','.txt','.csv','.md','.markdown'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) {
        statusDiv.innerHTML = `<span style="color:var(--danger)">❌ Unsupported type</span>`;
        event.target.value = '';
        return;
    }
    statusDiv.innerHTML = `<span style="color:var(--text-muted)">⏳ Uploading…</span>`;
    try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed');
        const data = await res.json();
        statusDiv.innerHTML = `<span style="color:var(--success)">✅ ${data.filename}</span>`;
        state.uploadedDocuments.push({
            filename: data.filename, content: data.markdown_content,
            token_count: data.token_count, uploaded_at: new Date().toISOString()
        });
        console.log(`📁 Uploaded document added to state: ${data.filename} (${data.token_count} tokens)`);
        console.log(`📚 Total uploaded documents in state: ${state.uploadedDocuments.length}`);
        addUploadedDocToChat(data);
        setTimeout(() => { statusDiv.innerHTML = ''; event.target.value = ''; }, 3000);
    } catch (err) {
        statusDiv.innerHTML = `<span style="color:var(--danger)">❌ ${err.message}</span>`;
        event.target.value = '';
    }
}

function addUploadedDocToChat(data) {
    const container = document.getElementById('chat-messages');
    const id = `exchange-upload-${Date.now()}`;
    const ex = document.createElement('div');
    ex.className = 'exchange-container'; ex.id = id;
    ex.innerHTML = `
        <div class="exchange-header">
            <span class="exchange-summary">📄 Uploaded: ${data.filename}</span>
            <span class="exchange-toggle">▼</span>
        </div>
        <div class="exchange-content">
            <div class="message system">
                <div class="message-avatar">📤</div>
                <div class="message-content">
                    <p><strong>Document ready for Q&A:</strong> ${data.filename}</p>
                    <p style="font-size:0.8rem;margin-top:0.3rem">Tokens: ${data.token_count?.toLocaleString()}</p>
                </div>
            </div>
        </div>
    `;
    ex.querySelector('.exchange-header').addEventListener('click', () => toggleExchange(id));
    container.appendChild(ex);
    container.scrollTop = 9999;
}

// ===========================================================================
// Sessions
// ===========================================================================
async function loadSessions() {
    try {
        const res = await fetch(`${API_BASE}/api/sessions`);
        const data = await res.json();
        const sessions = data.sessions || [];
        renderSessionList(sessions);
    } catch (err) {
        console.error('loadSessions error:', err);
    }
}

function renderSessionList(sessions) {
    const list = document.getElementById('session-list');
    list.innerHTML = '';

    // Current session
    const cur = document.createElement('div');
    cur.className = 'session-item active';
    cur.innerHTML = `
        <div class="session-header">
            <span class="session-title">Current Session</span>
            <span class="session-time">Active</span>
        </div>
        <div class="session-preview">${state.messages.length} messages</div>
    `;
    list.appendChild(cur);

    // Past sessions
    sessions.forEach(s => {
        const title = s.title || 'Untitled Session';
        const item = document.createElement('div');
        item.className = 'session-item';
        item.title = title;
        item.innerHTML = `
            <div class="session-header">
                <span class="session-title">${title}</span>
                <span class="session-time">${formatRelativeDate(s.created_at)}</span>
            </div>
            <div class="session-preview">${s.message_count} message${s.message_count === 1 ? '' : 's'}</div>
        `;
        item.addEventListener('click', () => loadSession(s.session_id));
        list.appendChild(item);
    });
}

function filterSessionsList(query) {
    document.querySelectorAll('#session-list .session-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!query || text.includes(query)) ? '' : 'none';
    });
}

async function loadSession(sessionId) {
    try {
        const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
        const data = await res.json();
        state.currentSessionId = sessionId;
        state.messages = data.messages || [];
        currentExchange = null;

        const container = document.getElementById('chat-messages');
        container.innerHTML = '';

        for (let i = 0; i < data.messages.length; i++) {
            const msg = data.messages[i];
            if (msg.role === 'user') {
                startNewExchange();
                addMessage('user', msg.content);
                if (i + 1 < data.messages.length && data.messages[i+1].role === 'assistant') {
                    i++;
                    addMessage('assistant', data.messages[i].content, false, data.messages[i].metadata?.sources);
                }
                if (currentExchange && i < data.messages.length - 2) {
                    currentExchange.classList.add('collapsed');
                }
            }
        }
        // Switch to Search tab so chat is visible
        switchNavTab('search');
    } catch (err) {
        console.error('loadSession error:', err);
    }
}

function createNewSession() {
    state.currentSessionId = null;
    state.messages = [];
    currentExchange = null;

    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    const ex = document.createElement('div');
    ex.className = 'exchange-container';
    ex.id = 'welcome-exchange';
    ex.innerHTML = `
        <div class="exchange-header">
            <span class="exchange-summary">💬 Welcome to TwistedCollab</span>
            <span class="exchange-toggle">▼</span>
        </div>
        <div class="exchange-content">
            <div class="message assistant">
                <div class="message-avatar">🤖</div>
                <div class="message-content">
                    <p>New session started. Select data sources and enter your query.</p>
                </div>
            </div>
        </div>
    `;
    ex.querySelector('.exchange-header').addEventListener('click', () => toggleExchange('welcome-exchange'));
    container.appendChild(ex);

    // Switch to Search tab
    switchNavTab('search');
}

// ===========================================================================
// Notes Tab (full editor)
// ===========================================================================
function initNotepad() {
    const editor = document.getElementById('notepad-editor');
    if (!editor) return;

    document.getElementById('notepad-new').addEventListener('click', newNotepad);
    document.getElementById('notepad-open').addEventListener('click', openNotepad);
    document.getElementById('notepad-save').addEventListener('click', saveNotepad);
    document.getElementById('notepad-download').addEventListener('click', downloadNotepad);
    document.getElementById('notepad-close').addEventListener('click', closeNotepad);

    editor.addEventListener('input', () => {
        state.notepad.content = editor.value;
        if (!state.notepad.unsavedChanges) {
            state.notepad.unsavedChanges = true;
            updateUnsavedIndicator();
        }
        updateCharCount();
        if (state.notepad.previewMode === 'split' || state.notepad.previewMode === 'preview') {
            renderMarkdownPreview();
        }
    });

    updateCharCount();
    setPreviewMode('edit');

    window.addEventListener('beforeunload', e => {
        if (state.notepad.unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    });
}

function setPreviewMode(mode) {
    state.notepad.previewMode = mode;
    const editorPane = document.getElementById('editor-pane');
    const previewPane = document.getElementById('preview-pane');
    const container = document.getElementById('notes-editor-container');

    // Reset
    editorPane.classList.remove('active');
    previewPane.classList.remove('active');
    container.style.flexDirection = 'row';

    if (mode === 'edit') {
        editorPane.classList.add('active');
    } else if (mode === 'preview') {
        previewPane.classList.add('active');
        renderMarkdownPreview();
    } else { // split
        editorPane.classList.add('active');
        previewPane.classList.add('active');
        renderMarkdownPreview();
    }

    // Update toolbar button active state
    document.querySelectorAll('.preview-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

function renderMarkdownPreview() {
    const editor = document.getElementById('notepad-editor');
    const preview = document.getElementById('markdown-preview');
    if (!preview || !editor) return;
    if (typeof marked !== 'undefined') {
        preview.innerHTML = marked.parse(editor.value || '');
    } else {
        preview.textContent = editor.value;
    }
}

function updateCharCount() {
    const editor = document.getElementById('notepad-editor');
    const el = document.getElementById('char-count');
    if (editor && el) el.textContent = `${editor.value.length.toLocaleString()} chars`;
}

function updateUnsavedIndicator() {
    const el = document.getElementById('unsaved-indicator');
    if (el) el.style.display = state.notepad.unsavedChanges ? 'inline' : 'none';
}

function updateFilenameDisplay() {
    const el = document.getElementById('filename-display');
    if (el) el.textContent = state.notepad.currentFile;
}

async function newNotepad() {
    if (state.notepad.unsavedChanges && !confirm('Unsaved changes. Create new file?')) return;
    state.notepad.currentFile = 'Untitled.md';
    state.notepad.content = '';
    state.notepad.unsavedChanges = false;
    document.getElementById('notepad-editor').value = '';
    updateFilenameDisplay(); updateUnsavedIndicator(); updateCharCount();
}

async function openNotepad() {
    try {
        const res = await fetch(`${API_BASE}/api/notepad/list`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!data.count) { alert('No markdown files found. Save a file first.'); return; }
        showFilePickerModal(data.files);
    } catch (err) { alert('Failed to list files: ' + err.message); }
}

function showFilePickerModal(files) {
    const modal = document.getElementById('file-modal');
    const list = document.getElementById('file-list');
    list.innerHTML = files.map(f => `
        <div class="file-item" data-filename="${f.filename}">
            <div class="file-name">📄 ${f.filename}</div>
            <div class="file-meta">${formatFileSize(f.size)} · ${formatDate(f.modified)}</div>
        </div>
    `).join('');
    list.querySelectorAll('.file-item').forEach(item => {
        item.addEventListener('click', () => {
            loadNotepadFile(item.dataset.filename);
            closeFilePickerModal();
        });
    });
    document.getElementById('file-count-display').textContent = `${files.length} file${files.length === 1 ? '' : 's'}`;
    modal.style.display = 'flex';
    document.getElementById('file-modal-close').onclick = closeFilePickerModal;
    modal.onclick = e => { if (e.target === modal) closeFilePickerModal(); };
}

function closeFilePickerModal() {
    document.getElementById('file-modal').style.display = 'none';
}

async function loadNotepadFile(filename) {
    try {
        const res = await fetch(`${API_BASE}/api/notepad/open`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (data.success) {
            state.notepad.currentFile = filename;
            state.notepad.content = data.content;
            state.notepad.unsavedChanges = false;
            document.getElementById('notepad-editor').value = data.content;
            updateFilenameDisplay(); updateUnsavedIndicator(); updateCharCount();
            if (state.notepad.previewMode !== 'edit') renderMarkdownPreview();
        } else { alert('Failed to open: ' + data.message); }
    } catch (err) { alert('Failed to open: ' + err.message); }
}

async function saveNotepad() {
    let filename = state.notepad.currentFile;
    if (filename === 'Untitled.md') {
        filename = prompt('Filename (without .md):', 'notes');
        if (!filename) return;
        if (!filename.endsWith('.md')) filename += '.md';
    }
    try {
        const editor = document.getElementById('notepad-editor');
        const res = await fetch(`${API_BASE}/api/notepad/save`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, content: editor.value })
        });
        const data = await res.json();
        if (data.success) {
            state.notepad.currentFile = data.filename;
            state.notepad.unsavedChanges = false;
            updateFilenameDisplay(); updateUnsavedIndicator();
            const btn = document.getElementById('notepad-save');
            const orig = btn.textContent;
            btn.textContent = '✅ Saved!'; btn.style.background = 'var(--success)';
            setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
        } else { alert('Save failed: ' + data.message); }
    } catch (err) { alert('Save failed: ' + err.message); }
}

function downloadNotepad() {
    let filename = state.notepad.currentFile;
    if (filename === 'Untitled.md') {
        filename = prompt('Filename (without .md):', 'notes');
        if (!filename) return;
        if (!filename.endsWith('.md')) filename += '.md';
    }
    const editor = document.getElementById('notepad-editor');
    const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    const btn = document.getElementById('notepad-download');
    const orig = btn.textContent;
    btn.textContent = '✅ Downloaded!'; btn.style.background = 'var(--success)';
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
}

function closeNotepad() {
    if (state.notepad.unsavedChanges && !confirm('Unsaved changes. Close anyway?')) return;
    newNotepad();
}

// ===========================================================================
// Keyboard Shortcuts
// ===========================================================================
function handleGlobalShortcuts(e) {
    // Ctrl+Shift+S — download
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault(); downloadNotepad(); return;
    }
    // Only apply note shortcuts when Notes tab is active
    const notesActive = document.getElementById('notes-tab')?.classList.contains('active');
    if (e.ctrlKey && e.key === 's' && notesActive) { e.preventDefault(); saveNotepad(); return; }
    if (e.ctrlKey && e.key === 'n' && notesActive) { e.preventDefault(); newNotepad(); return; }
    if (e.ctrlKey && e.key === 'o' && notesActive) { e.preventDefault(); openNotepad(); return; }
    if (e.ctrlKey && e.key === 'e' && notesActive) {
        e.preventDefault();
        const modes = ['edit','split','preview'];
        const next = modes[(modes.indexOf(state.notepad.previewMode) + 1) % 3];
        setPreviewMode(next);
    }
}

// ===========================================================================
// Index Update
// ===========================================================================
async function updateIndex(type) {
    const statusDiv = document.getElementById('index-status');
    const kwBtn  = document.getElementById('update-keyword-index-btn');
    const faissBtn = document.getElementById('update-faiss-index-btn');

    // Disable both buttons while running
    kwBtn.disabled = true;
    faissBtn.disabled = true;
    statusDiv.innerHTML = `<span style="color:var(--text-muted)">⏳ Updating ${type === 'faiss' ? 'FAISS' : 'Keyword'} index…</span>`;

    const endpoint = type === 'faiss' ? '/api/update-faiss-index' : '/api/update-keyword-index';

    try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources: null, force: false }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const count = data.sources_updated?.length ?? '?';
        statusDiv.innerHTML = `<span style="color:var(--success)">✅ ${type === 'faiss' ? 'FAISS' : 'Keyword'} index updated (${count} sources)</span>`;
        setTimeout(() => { statusDiv.innerHTML = ''; }, 5000);

    } catch (err) {
        console.error(`updateIndex(${type}) error:`, err);
        statusDiv.innerHTML = `<span style="color:var(--danger)">❌ ${err.message}</span>`;
    } finally {
        kwBtn.disabled = false;
        faissBtn.disabled = false;
    }
}

// ===========================================================================
// Helpers
// ===========================================================================
function formatRelativeDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diffMs = Date.now() - d;
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const dy = Math.floor(h / 24);
    if (dy < 7) return `${dy}d ago`;
    return d.toLocaleDateString();
}

function formatDate(iso) { return formatRelativeDate(iso); }

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1048576).toFixed(1)} MB`;
}

// ===========================================================================
// COLLAB TAB — Agent Skill Runner
// ===========================================================================

// Persistent collab state survives tab switches
const collabState = {
    skills: [],               // loaded from /api/skills/list
    selectedSkill: null,      // full skill definition object
    running: false,           // single-run guard
    jobs: [],                 // recent job summaries
    lastResult: null,         // keeps report visible on tab switch
};

// ---------------------------------------------------------
// Init: called from DOMContentLoaded
// ---------------------------------------------------------
function initCollab() {
    document.getElementById('collab-run-btn').addEventListener('click', runCollabSkill);
    document.getElementById('collab-history-refresh').addEventListener('click', loadCollabHistory);
    loadCollabSkills();
    loadCollabHistory();
}

// ---------------------------------------------------------
// Load skills from server
// ---------------------------------------------------------
async function loadCollabSkills() {
    const listEl = document.getElementById('collab-skill-list');
    try {
        const res = await fetch(`${API_BASE}/api/skills/list`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        collabState.skills = data.skills || [];
        renderSkillList();
    } catch (err) {
        listEl.innerHTML = `<div class="collab-empty" style="color:var(--danger)">❌ ${err.message}</div>`;
    }
}

function renderSkillList() {
    const listEl = document.getElementById('collab-skill-list');
    if (!collabState.skills.length) {
        listEl.innerHTML = '<div class="collab-empty">No skills found.</div>';
        return;
    }
    listEl.innerHTML = '';
    collabState.skills.forEach(skill => {
        const card = document.createElement('div');
        card.className = 'collab-skill-card';
        card.dataset.name = skill.name;
        const steps = skill.workflow_pattern || 'sequential';
        card.innerHTML = `
            <div class="collab-skill-name">📋 ${skill.name.replace(/_/g, ' ')}</div>
            <div class="collab-skill-desc">${skill.description}</div>
            <div class="collab-skill-meta">v${skill.version} · ${steps} · ${(skill.agents||[]).length} agents</div>
        `;
        card.addEventListener('click', () => selectSkill(skill));
        listEl.appendChild(card);
    });
    // Re-select previously selected skill if any
    if (collabState.selectedSkill) {
        selectSkill(collabState.selectedSkill, /*restoreOnly*/true);
    }
}

// ---------------------------------------------------------
// Select a skill → render parameter form
// ---------------------------------------------------------
function selectSkill(skill, restoreOnly = false) {
    collabState.selectedSkill = skill;

    // Highlight selected card
    document.querySelectorAll('.collab-skill-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.name === skill.name);
    });

    // Build parameter form
    const paramsSection = document.getElementById('collab-params-section');
    const runSection    = document.getElementById('collab-run-section');
    const formEl        = document.getElementById('collab-params-form');

    formEl.innerHTML = '';
    const params = skill.parameters || {};
    Object.entries(params).forEach(([key, spec]) => {
        const row = document.createElement('div');
        row.className = 'collab-param-row';

        const label = document.createElement('label');
        label.className = 'collab-param-label';
        label.htmlFor = `collab-param-${key}`;
        label.innerHTML = `
            ${key}${spec.required ? '<span class="collab-param-required">*</span>' : ''}
        `;
        row.appendChild(label);

        const input = buildParamInput(key, spec);
        row.appendChild(input);

        if (spec.description) {
            const hint = document.createElement('div');
            hint.className = 'collab-param-hint';
            hint.textContent = spec.description;
            row.appendChild(hint);
        }
        formEl.appendChild(row);
    });

    paramsSection.style.display = Object.keys(params).length ? '' : 'none';
    runSection.style.display = '';
    setupParamReactivity(params);
}

// ---------------------------------------------------------
// Param reactivity: linked_to → dynamic file-select
// When a param has linked_to: X, fetch /api/markdown/list?source_dir=VALUE
// whenever X changes, and repopulate this param's <select>.
// Also toggles visibility of textarea params (source_text) vs file selects.
// ---------------------------------------------------------
function setupParamReactivity(params) {
    Object.entries(params).forEach(([key, spec]) => {
        if (!spec.linked_to) return;

        const sourceEl  = document.getElementById(`collab-param-${spec.linked_to}`);
        const targetEl  = document.getElementById(`collab-param-${key}`);
        const targetRow = targetEl?.closest('.collab-param-row');

        // Text-type params (textareas) that should show only when source type = 'text'
        const textKeys = Object.entries(params)
            .filter(([, s]) => s.type === 'text')
            .map(([k]) => k);

        async function updateFileSelect(dirValue) {
            // Show/hide textarea vs file select
            textKeys.forEach(k => {
                const row = document.getElementById(`collab-param-${k}`)?.closest('.collab-param-row');
                if (row) row.style.display = dirValue === 'text' ? '' : 'none';
            });
            if (targetRow) targetRow.style.display = dirValue === 'text' ? 'none' : '';
            if (!dirValue || dirValue === 'text') return;

            // Fetch filenames for the chosen directory
            try {
                const res = await fetch(`${API_BASE}/api/markdown/list?source_dir=${encodeURIComponent(dirValue)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const files = data.files || [];
                targetEl.innerHTML = '';
                const ph = document.createElement('option');
                ph.value = '';
                ph.textContent = files.length ? '— select a file —' : '(no files found)';
                targetEl.appendChild(ph);
                files.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f; opt.textContent = f;
                    targetEl.appendChild(opt);
                });
            } catch (e) {
                console.error('Failed to fetch file list:', e);
                if (targetEl) targetEl.innerHTML = '<option value="">— error loading files —</option>';
            }
        }

        if (sourceEl) {
            sourceEl.addEventListener('change', e => updateFileSelect(e.target.value));
            updateFileSelect(sourceEl.value);   // populate on initial render
        }
    });
}

function buildParamInput(key, spec) {
    const id = `collab-param-${key}`;

    // Text type → multiline textarea (e.g. paste text for commentary)
    if (spec.type === 'text') {
        const ta = document.createElement('textarea');
        ta.className = 'collab-param-textarea';
        ta.id = id;
        ta.rows = 5;
        ta.placeholder = spec.required ? 'Required' : 'Optional — paste text here';
        if (spec.default) ta.value = spec.default;
        return ta;
    }

    // Str with linked_to → file-select populated dynamically by setupParamReactivity
    if (spec.linked_to) {
        const sel = document.createElement('select');
        sel.className = 'collab-param-select';
        sel.id = id;
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = '— select source type first —';
        sel.appendChild(ph);
        return sel;
    }

    // Dict type → render a checkbox group where each key is a toggle
    if (spec.type === 'dict' && spec.default && typeof spec.default === 'object') {
        const group = document.createElement('div');
        group.className = 'collab-param-checkgroup';
        group.id = id;
        Object.entries(spec.default).forEach(([scopeKey, defaultVal]) => {
            const cbId = `${id}-${scopeKey}`;
            const label = document.createElement('label');
            label.className = 'collab-param-check-label';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = cbId;
            cb.dataset.scopeKey = scopeKey;
            cb.checked = !!defaultVal;
            label.appendChild(cb);
            label.appendChild(document.createTextNode(scopeKey.replace(/_/g, ' ')));
            group.appendChild(label);
        });
        return group;
    }

    if (spec.allowed_values && spec.allowed_values.length) {
        const sel = document.createElement('select');
        sel.className = 'collab-param-select';
        sel.id = id;
        spec.allowed_values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v;
            sel.appendChild(opt);
        });
        if (spec.default !== null && spec.default !== undefined) sel.value = spec.default;
        return sel;
    }

    const input = document.createElement('input');
    input.className = 'collab-param-input';
    input.id = id;

    if (spec.type === 'int') {
        input.type = 'number';
        input.step = '1';
        if (spec.min_value !== null && spec.min_value !== undefined) input.min = spec.min_value;
        if (spec.max_value !== null && spec.max_value !== undefined) input.max = spec.max_value;
    } else {
        input.type = 'text';
    }

    if (spec.default !== null && spec.default !== undefined && spec.type !== 'dict') {
        input.value = spec.default;
    }
    input.placeholder = spec.required ? `Required` : `Optional`;
    return input;
}

// ---------------------------------------------------------
// Collect param values from form
// ---------------------------------------------------------
function collectParams(skill) {
    const params = {};
    const spec = skill.parameters || {};
    Object.entries(spec).forEach(([key, s]) => {
        // dict type: read from checkbox group (no .value property)
        if (s.type === 'dict') {
            const group = document.getElementById(`collab-param-${key}`);
            if (group) {
                const result = {};
                group.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    result[cb.dataset.scopeKey] = cb.checked;
                });
                params[key] = result;
            } else if (s.default != null) {
                params[key] = s.default;
            }
            return;
        }
        const el = document.getElementById(`collab-param-${key}`);
        if (!el) return;
        const val = el.value.trim();
        if (s.type === 'int') {
            params[key] = val !== '' ? parseInt(val, 10) : (s.default ?? 0);
        } else {
            // 'str', 'text' (textarea), and linked_to selects all use .value
            if (val !== '') params[key] = val;
        }
    });
    return params;
}

// ---------------------------------------------------------
// Run skill via SSE stream
// ---------------------------------------------------------
async function runCollabSkill() {
    if (collabState.running) return;
    const skill = collabState.selectedSkill;
    if (!skill) return;

    const params = collectParams(skill);

    // Validate required params
    const missing = Object.entries(skill.parameters || {})
        .filter(([k, s]) => s.required && (params[k] === undefined || params[k] === ''))
        .map(([k]) => k);
    if (missing.length) {
        alert(`Missing required parameter(s): ${missing.join(', ')}`);
        return;
    }

    collabState.running = true;

    // UI: disable run button, show pulsing tab dot
    const runBtn = document.getElementById('collab-run-btn');
    runBtn.disabled = true;

    const collabTabBtn = document.querySelector('.nav-tab[data-tab="collab"]');
    if (collabTabBtn && !collabTabBtn.querySelector('.collab-running-dot')) {
        const dot = document.createElement('span');
        dot.className = 'collab-running-dot';
        collabTabBtn.appendChild(dot);
    }

    // Show result panel; build step indicators
    const steps = (skill.workflow?.steps || skill.agents || []);
    showResultPanel(skill, steps);

    // Add a placeholder job entry
    const tempJob = { job_id: null, skill_name: skill.name, status: 'running', started_at: new Date().toISOString() };
    collabState.jobs.unshift(tempJob);
    renderJobList();

    try {
        const res = await fetch(`${API_BASE}/api/skills/run/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skill_name: skill.name, params, session_id: state.currentSessionId || null })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const ev = JSON.parse(line.slice(6));
                    handleCollabEvent(ev, tempJob, steps);
                } catch (pe) {
                    console.error('Collab SSE parse error:', pe);
                }
            }
        }
    } catch (err) {
        showCollabError(err.message);
        tempJob.status = 'failed';
        renderJobList();
    } finally {
        collabState.running = false;
        runBtn.disabled = false;
        // Remove pulsing tab dot
        document.querySelector('.nav-tab[data-tab="collab"] .collab-running-dot')?.remove();
    }
}

// ---------------------------------------------------------
// SSE event handler
// ---------------------------------------------------------
function handleCollabEvent(ev, job, stepDefs) {
    if (ev.type === 'step_start') {
        setStepState(ev.step, 'running', ev.agent);
        showCollabStatus(`Step ${ev.step}/${ev.total}: ${ev.agent.replace(/_/g, ' ')} — ${ev.action.replace(/_/g, ' ')}…`);
    } else if (ev.type === 'step_complete') {
        setStepState(ev.step, 'done', ev.agent);
    } else if (ev.type === 'done') {
        hideCollabStatus();
        job.status = 'completed';
        job.result = ev.result;
        collabState.lastResult = ev;
        renderCollabResult(ev.result);
        renderJobList();
        loadCollabHistory(); // refresh history panel after new result saved
    } else if (ev.type === 'error') {
        showCollabError(ev.error || 'Unknown error');
        job.status = 'failed';
        renderJobList();
    }
}

// ---------------------------------------------------------
// UI helpers
// ---------------------------------------------------------
function showResultPanel(skill, steps) {
    document.getElementById('collab-empty-state').style.display = 'none';
    const panel = document.getElementById('collab-result-panel');
    panel.style.display = 'flex';

    document.getElementById('collab-result-title').textContent =
        skill.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    document.getElementById('collab-copy-btn').style.display = 'none';

    // Build step indicators
    const bar = document.getElementById('collab-progress-bar');
    bar.innerHTML = '';
    const stepList = Array.isArray(steps) && steps.length && steps[0].step
        ? steps                     // workflow steps from YAML
        : skill.agents || [];       // fallback: agent list

    stepList.forEach((s, i) => {
        const label = s.agent || s.role || `Step ${i+1}`;
        const span = document.createElement('span');
        span.className = 'collab-step';
        span.id = `collab-step-${i+1}`;
        span.innerHTML = `<span class="collab-step-icon">○</span><span>${label.replace(/_/g,' ')}</span>`;
        bar.appendChild(span);
        if (i < stepList.length - 1) {
            const sep = document.createElement('span');
            sep.className = 'collab-step-sep';
            sep.textContent = '→';
            bar.appendChild(sep);
        }
    });

    // Hide all output areas
    document.getElementById('collab-report').style.display = 'none';
    document.getElementById('collab-sources').style.display = 'none';
    document.getElementById('collab-error').style.display = 'none';
}

function setStepState(stepNum, state, agentRole) {
    const el = document.getElementById(`collab-step-${stepNum}`);
    if (!el) return;
    el.className = `collab-step ${state}`;
    const icon = el.querySelector('.collab-step-icon');
    if (icon) {
        if (state === 'running') icon.innerHTML = '<span class="collab-spinner"></span>';
        else if (state === 'done') icon.textContent = '✓';
        else if (state === 'error') icon.textContent = '✗';
    }
}

function showCollabStatus(msg) {
    const el = document.getElementById('collab-status-msg');
    el.style.display = 'flex';
    el.innerHTML = `<span class="collab-spinner"></span><span>${msg}</span>`;
}
function hideCollabStatus() {
    document.getElementById('collab-status-msg').style.display = 'none';
}

function renderCollabResult(result) {
    if (!result) return;

    // Normalise result shape — different skills return different keys
    // literature_review:  result.report  +  result.sources[{index, filename, relevance_score}]
    // literature_discovery: result.sources[{rank, title, url, annotation, relevance_score}]
    const reportText = result.report
        || result.final_report?.report
        || result.result?.report
        || '';

    const sources = result.sources
        || result.final_report?.sources
        || result.result?.sources
        || [];

    const reportEl = document.getElementById('collab-report');
    const copyBtn  = document.getElementById('collab-copy-btn');

    if (reportText) {
        reportEl.innerHTML = typeof marked !== 'undefined'
            ? marked.parse(reportText)
            : reportText.replace(/\n/g, '<br>');
        reportEl.style.display = '';
        if (collabState.lastResult) collabState.lastResult._reportText = reportText;
        copyBtn.style.display = '';
        copyBtn.onclick = () => copyToClipboard(reportText, copyBtn);
    }

    if (sources.length) {
        const srcEl = document.getElementById('collab-sources');
        srcEl.innerHTML = `<div class="collab-sources-title">Sources (${sources.length})</div>`;

        sources.forEach(s => {
            const item = document.createElement('div');
            item.className = 'collab-source-item';

            // Discovery skill: has rank + url + annotation
            if (s.url) {
                const score = s.relevance_score != null ? `rel: ${Number(s.relevance_score).toFixed(1)}` : '';
                const rankLabel = s.rank != null ? `[${s.rank}]` : '';
                item.innerHTML = `
                    <span class="collab-source-index">${rankLabel}</span>
                    <span class="collab-source-name">
                        <a href="${s.url}" target="_blank" rel="noopener" title="${s.url}">${s.title || s.url}</a>
                        ${s.annotation ? `<div class="collab-source-annotation">${s.annotation}</div>` : ''}
                    </span>
                    <span class="collab-source-score">${score}</span>
                `;
            } else {
                // Review skill: has index + filename + relevance_score
                item.innerHTML = `
                    <span class="collab-source-index">[${s.index ?? ''}]</span>
                    <span class="collab-source-name" title="${s.filename || ''}">${s.filename || ''}</span>
                    <span class="collab-source-score">rel: ${(s.relevance_score||0).toFixed(1)}</span>
                `;
            }
            srcEl.appendChild(item);
        });
        srcEl.style.display = '';

        // For discovery skill with no report, show copy button for the source list
        if (!reportText) {
            const sourceText = sources.map(s =>
                `${s.rank != null ? s.rank + '. ' : ''}${s.title || s.url}\n${s.url || ''}\n${s.annotation || ''}`
            ).join('\n\n');
            copyBtn.style.display = '';
            copyBtn.onclick = () => copyToClipboard(sourceText, copyBtn);
        }
    }
}

function showCollabError(msg) {
    hideCollabStatus();
    const el = document.getElementById('collab-error');
    el.innerHTML = `❌ <strong>Skill failed:</strong> ${msg}`;
    el.style.display = '';
}

function renderJobList() {
    const listEl = document.getElementById('collab-job-list');
    const recent = collabState.jobs.slice(0, 5);
    if (!recent.length) {
        listEl.innerHTML = '<div class="collab-empty">No jobs yet.</div>';
        return;
    }
    listEl.innerHTML = '';
    recent.forEach(job => {
        const item = document.createElement('div');
        item.className = 'collab-job-item';
        item.title = job.skill_name;
        const elapsed = job.started_at
            ? formatRelativeDate(job.started_at)
            : '';
        item.innerHTML = `
            <span class="collab-job-badge ${job.status}"></span>
            <span class="collab-job-text">${job.skill_name.replace(/_/g,' ')}</span>
            <span class="collab-job-time">${elapsed}</span>
        `;
        // Click completed job → restore its report
        if (job.status === 'completed' && job.result) {
            item.addEventListener('click', () => {
                const skill = collabState.skills.find(s => s.name === job.skill_name);
                if (skill) showResultPanel(skill, skill.agents || []);
                renderCollabResult(job.result);
            });
        }
        listEl.appendChild(item);
    });
}

// ---------------------------------------------------------
// Saved results history panel
// ---------------------------------------------------------
async function loadCollabHistory() {
    const listEl = document.getElementById('collab-history-list');
    try {
        const res = await fetch(`${API_BASE}/api/skills/results`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderCollabHistory(data.results || []);
    } catch (err) {
        listEl.innerHTML = `<div class="collab-empty" style="color:var(--danger)">❌ ${err.message}</div>`;
    }
}

function renderCollabHistory(results) {
    const listEl = document.getElementById('collab-history-list');
    if (!results.length) {
        listEl.innerHTML = '<div class="collab-empty">No saved results yet.</div>';
        return;
    }
    listEl.innerHTML = '';
    results.forEach(r => {
        const item = document.createElement('div');
        item.className = 'collab-history-item';
        item.dataset.filename = r.filename;

        const skillLabel = (r.skill || 'skill').replace(/_/g, ' ');
        const dateLabel = r.modified ? formatRelativeDate(r.modified) : '';
        item.innerHTML = `
            <div class="collab-history-skill">${skillLabel}</div>
            <div class="collab-history-topic" title="${r.topic}">${r.topic || r.filename}</div>
            <div class="collab-history-date">${dateLabel}</div>
            <button class="collab-history-delete" title="Delete">✕</button>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('collab-history-delete')) return;
            loadHistoryResult(r, item);
        });

        item.querySelector('.collab-history-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${r.topic || r.filename}"?`)) return;
            try {
                await fetch(`${API_BASE}/api/skills/results/${encodeURIComponent(r.filename)}`, { method: 'DELETE' });
                item.remove();
                if (!listEl.querySelector('.collab-history-item')) {
                    listEl.innerHTML = '<div class="collab-empty">No saved results yet.</div>';
                }
            } catch (err) {
                alert(`Delete failed: ${err.message}`);
            }
        });

        listEl.appendChild(item);
    });
}

async function loadHistoryResult(record, itemEl) {
    // Mark active
    document.querySelectorAll('.collab-history-item').forEach(el => el.classList.remove('active'));
    itemEl.classList.add('active');

    try {
        const res = await fetch(`${API_BASE}/api/skills/results/${encodeURIComponent(record.filename)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Show result panel with the stored markdown
        document.getElementById('collab-empty-state').style.display = 'none';
        const panel = document.getElementById('collab-result-panel');
        panel.style.display = 'flex';
        document.getElementById('collab-progress-bar').innerHTML = '';
        document.getElementById('collab-status-msg').style.display = 'none';
        document.getElementById('collab-sources').style.display = 'none';
        document.getElementById('collab-error').style.display = 'none';

        const title = (record.skill || 'Result').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        document.getElementById('collab-result-title').textContent =
            `${title}${record.topic ? ' — ' + record.topic : ''}`;

        const reportEl = document.getElementById('collab-report');
        reportEl.innerHTML = typeof marked !== 'undefined'
            ? marked.parse(data.content)
            : data.content.replace(/\n/g, '<br>');
        reportEl.style.display = '';

        const copyBtn = document.getElementById('collab-copy-btn');
        copyBtn.style.display = '';
        copyBtn.onclick = () => copyToClipboard(data.content, copyBtn);
    } catch (err) {
        showCollabError(`Could not load result: ${err.message}`);
    }
}

function copyToClipboard(text, btn) {
    const orig = btn.innerHTML;
    try {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                btn.innerHTML = '✅ Copied!'; btn.classList.add('copied');
                setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
            });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            btn.innerHTML = '✅ Copied!'; btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
        }
    } catch { btn.innerHTML = '❌ Failed'; setTimeout(() => { btn.innerHTML = orig; }, 2000); }
}

// ===========================================================================
// Utility Tab
// ===========================================================================
const UTILITY_CARD_META = {
    twistedcore:   { icon: '🧠', name: 'TwistedCore',   desc: 'Cross-app memory broker & activity dashboard' },
    twistedpic:    { icon: '🎨', name: 'TwistedPic',    desc: 'AI image generator with rhetorical distortion' },
    twisteddebate: { icon: '⚔️',  name: 'TwistedDebate', desc: 'Structured AI debate engine' },
    twisteddream:  { icon: '🌙', name: 'TwistedDream',  desc: 'Storybook generator with SDXL images' },
    twistedvoice:  { icon: '🎙️', name: 'TwistedVoice',  desc: 'Voice-driven RAG assistant' },
    twisteddraw:   { icon: '✏️',  name: 'TwistedDraw',  desc: 'AI-powered Excalidraw drawing tool' }
};

// Per-card runtime state: 'probing' | 'idle' | 'starting' | 'running' | 'error'
const _utilityCardState = {};

async function initUtility() {
    const grid = document.getElementById('utility-grid');
    if (!grid) return;

    let urls;
    try {
        const res = await fetch(`${API_BASE}/api/utility-urls`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        urls = await res.json();
    } catch (err) {
        grid.innerHTML = `<div class="utility-loading">⚠️ Could not load service URLs: ${err.message}</div>`;
        return;
    }

    grid.innerHTML = '';
    const services = ['twistedcore', 'twistedpic', 'twisteddebate', 'twisteddream', 'twistedvoice', 'twisteddraw'];
    for (const key of services) {
        const meta = UTILITY_CARD_META[key] || { icon: '🔧', name: key, desc: '' };
        const url  = urls[key];
        const card = document.createElement('div');
        card.className = 'utility-card';
        card.id = `utility-card-${key}`;

        if (url) {
            card.innerHTML = `
                <div class="utility-card-header">
                    <span class="utility-status-dot utility-status-probing" id="utility-dot-${key}" title="Checking..."></span>
                </div>
                <div class="utility-card-icon">${meta.icon}</div>
                <div class="utility-card-name">${meta.name}</div>
                <div class="utility-card-desc">${meta.desc}</div>
                <button class="utility-card-btn" id="utility-btn-${key}" disabled>Launch</button>
                <div class="utility-card-msg" id="utility-msg-${key}"></div>
            `;
            grid.appendChild(card);
            _initUtilityCard(key, url);
        } else {
            card.innerHTML = `
                <div class="utility-card-icon">${meta.icon}</div>
                <div class="utility-card-name">${meta.name}</div>
                <div class="utility-card-desc">${meta.desc}</div>
                <span class="utility-card-btn disabled">Coming Soon</span>
            `;
            grid.appendChild(card);
        }
    }
}

function _initUtilityCard(key, url) {
    _utilityCardState[key] = 'probing';
    _utilitySetDot(key, 'probing');
    _utilityCheckStatus(key).then(status => {
        const running = status === 'running';
        _utilityCardState[key] = running ? 'running' : 'idle';
        _utilitySetDot(key, running ? 'running' : 'stopped');
        const btn = document.getElementById(`utility-btn-${key}`);
        if (btn) {
            btn.disabled = false;
            btn.onclick = () => _launchUtilityService(key, url);
        }
    });
}

async function _utilityCheckStatus(key) {
    try {
        const res = await fetch(`${API_BASE}/api/utility/status/${key}`);
        if (!res.ok) return 'stopped';
        const data = await res.json();
        return data.status;
    } catch { return 'stopped'; }
}

function _utilitySetDot(key, state) {
    const dot = document.getElementById(`utility-dot-${key}`);
    if (!dot) return;
    dot.className = `utility-status-dot utility-status-${state}`;
    const labels = { running: 'Running', stopped: 'Stopped', probing: 'Checking…',
                     starting: 'Starting…', error: 'Error', unavailable: 'Unavailable' };
    dot.title = labels[state] || state;
}

function _utilitySetMsg(key, msg) {
    const el = document.getElementById(`utility-msg-${key}`);
    if (el) el.textContent = msg;
}

async function _launchUtilityService(key, url) {
    if (_utilityCardState[key] === 'starting') return;
    const btn = document.getElementById(`utility-btn-${key}`);
    if (!btn) return;

    _utilitySetMsg(key, '');
    btn.disabled = true;

    // Open a blank tab immediately in the click handler to avoid popup blockers.
    // We navigate it to the real URL once the service is confirmed running.
    const newTab = window.open('', '_blank');

    let data;
    try {
        const res = await fetch(`${API_BASE}/api/utility/launch/${key}`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        _utilitySetDot(key, 'error');
        btn.disabled = false;
        _utilitySetMsg(key, `⚠️ Error: ${err.message}`);
        if (newTab && !newTab.closed) newTab.close();
        return;
    }

    if (data.status === 'running') {
        _utilityCardState[key] = 'running';
        _utilitySetDot(key, 'running');
        btn.disabled = false;
        if (newTab && !newTab.closed) newTab.location = url;
        else window.open(url, '_blank');
        return;
    }

    if (data.status === 'starting') {
        _utilityCardState[key] = 'starting';
        _utilitySetDot(key, 'starting');
        btn.textContent = 'Starting…';
        _utilitySetMsg(key, 'Service is starting, please wait…');

        const deadline = Date.now() + 120000; // 2-minute timeout
        while (Date.now() < deadline) {
            await _utilitySleep(3000);
            const status = await _utilityCheckStatus(key);
            if (status === 'running') {
                _utilityCardState[key] = 'running';
                _utilitySetDot(key, 'running');
                btn.textContent = 'Launch';
                btn.disabled = false;
                _utilitySetMsg(key, '');
                if (newTab && !newTab.closed) newTab.location = url;
                else window.open(url, '_blank');
                return;
            }
            if (status === 'error') {
                _utilityCardState[key] = 'idle';
                _utilitySetDot(key, 'stopped');
                btn.textContent = 'Launch';
                btn.disabled = false;
                _utilitySetMsg(key, '⚠️ Launch failed. Ensure Ollama & TwistedPair are running.');
                if (newTab && !newTab.closed) newTab.close();
                return;
            }
        }
        // Timeout reached
        _utilityCardState[key] = 'idle';
        _utilitySetDot(key, 'stopped');
        btn.textContent = 'Launch';
        btn.disabled = false;
        _utilitySetMsg(key, '⚠️ Timed out waiting for service to start.');
        if (newTab && !newTab.closed) newTab.close();
    }
}

function _utilitySleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===========================================================================
// File Manager (Utility Tab)
// ===========================================================================

let _fmCurrentPath = '';

async function initFileManager() {
    document.getElementById('fm-select-all').addEventListener('click', () => {
        document.querySelectorAll('.fm-file-check').forEach(cb => cb.checked = true);
        _fmUpdateDownloadBtn();
    });
    document.getElementById('fm-deselect-all').addEventListener('click', () => {
        document.querySelectorAll('.fm-file-check').forEach(cb => cb.checked = false);
        _fmUpdateDownloadBtn();
    });
    document.getElementById('fm-check-all').addEventListener('change', function () {
        document.querySelectorAll('.fm-file-check').forEach(cb => cb.checked = this.checked);
        _fmUpdateDownloadBtn();
    });
    document.getElementById('fm-download-zip').addEventListener('click', _fmDownloadSelected);
    await _fmLoadPath('');
}

async function _fmLoadPath(path) {
    _fmCurrentPath = path;
    const tbody = document.getElementById('fm-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="fm-loading">Loading…</td></tr>';

    let data;
    try {
        const res = await fetch(`${API_BASE}/api/files/list?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="fm-loading">⚠️ ${_escHtml(err.message)}</td></tr>`;
        return;
    }

    // Render breadcrumb
    const bc = document.getElementById('fm-breadcrumb');
    bc.innerHTML = data.breadcrumb.map((seg, i) => {
        const isLast = i === data.breadcrumb.length - 1;
        if (isLast) return `<span class="fm-bc-item fm-bc-active">${_escHtml(seg.name)}</span>`;
        return `<span class="fm-bc-item fm-bc-link" data-path="${_escAttr(seg.path)}">${_escHtml(seg.name)}</span><span class="fm-bc-sep">›</span>`;
    }).join('');
    bc.querySelectorAll('.fm-bc-link').forEach(el =>
        el.addEventListener('click', () => _fmLoadPath(el.dataset.path))
    );

    // Render table rows
    if (data.entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="fm-loading">Empty directory</td></tr>';
        document.getElementById('fm-check-all').checked = false;
        _fmUpdateDownloadBtn();
        return;
    }

    tbody.innerHTML = data.entries.map(e => {
        if (e.type === 'dir') {
            return `<tr class="fm-row-dir">
                <td><span class="fm-dir-icon">📁</span></td>
                <td colspan="3"><span class="fm-dir-link" data-path="${_escAttr(e.path)}">${_escHtml(e.name)}</span></td>
                <td></td>
            </tr>`;
        }
        const sizeStr = e.size != null ? _fmFormatSize(e.size) : '';
        const dlUrl = `${API_BASE}/api/files/download?path=${encodeURIComponent(e.path)}`;
        return `<tr class="fm-row-file">
            <td><input type="checkbox" class="fm-file-check" data-path="${_escAttr(e.path)}"></td>
            <td class="fm-cell-name"><span class="fm-file-icon">${_fmFileIcon(e.name)}</span>${_escHtml(e.name)}</td>
            <td class="fm-cell-size">${sizeStr}</td>
            <td class="fm-cell-date">${_escHtml(e.modified)}</td>
            <td class="fm-cell-action"><a class="fm-dl-btn" href="${dlUrl}" download="${_escAttr(e.name)}" title="Download">⬇</a></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.fm-dir-link').forEach(el =>
        el.addEventListener('click', () => _fmLoadPath(el.dataset.path))
    );
    tbody.querySelectorAll('.fm-file-check').forEach(cb =>
        cb.addEventListener('change', _fmUpdateDownloadBtn)
    );
    document.getElementById('fm-check-all').checked = false;
    _fmUpdateDownloadBtn();

    const fileCount = data.entries.filter(e => e.type === 'file').length;
    const dirCount  = data.entries.filter(e => e.type === 'dir').length;
    document.getElementById('fm-status').textContent =
        `${fileCount} file(s)${dirCount ? ', ' + dirCount + ' folder(s)' : ''}`;
}

function _fmUpdateDownloadBtn() {
    const selected = document.querySelectorAll('.fm-file-check:checked').length;
    const btn = document.getElementById('fm-download-zip');
    btn.disabled = selected === 0;
    btn.textContent = selected > 1
        ? `⬇ Download Selected (${selected})`
        : '⬇ Download Selected';
}

async function _fmDownloadSelected() {
    const paths = Array.from(document.querySelectorAll('.fm-file-check:checked')).map(cb => cb.dataset.path);
    if (paths.length === 0) return;

    // Single file: direct link
    if (paths.length === 1) {
        const a = document.createElement('a');
        a.href = `${API_BASE}/api/files/download?path=${encodeURIComponent(paths[0])}`;
        a.download = paths[0].split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
    }

    // Multiple files: ZIP
    const btn = document.getElementById('fm-download-zip');
    const orig = btn.textContent;
    btn.textContent = '⏳ Zipping…';
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/api/files/download-zip`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twistedcollab_files_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
        document.getElementById('fm-status').textContent = `⚠️ Download failed: ${err.message}`;
    } finally {
        btn.textContent = orig;
        _fmUpdateDownloadBtn();
    }
}

function _fmFormatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function _fmFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = { md: '📄', json: '📋', txt: '📄', pdf: '📕', db: '🗄️', csv: '📊', zip: '🗜️', faiss: '🔍' };
    return icons[ext] || '📄';
}

function _escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _escAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

