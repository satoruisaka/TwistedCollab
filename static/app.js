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
            twistednews: false
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
                const prev = modelSelect.value || state.settings.model;
                modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
                modelSelect.value = models.includes(prev) ? prev : models[0];
                state.settings.model = modelSelect.value;
            } else {
                modelSelect.innerHTML = '<option value="">No models available</option>';
                modelSelect.disabled = true;
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

    // Build search_scope for the server — maps new 9-key scope to the 4 BackendScope keys
    // Additional scopes (notes, user_uploads etc.) will be ignored by server gracefully
    const requestData = {
        session_id: state.currentSessionId || 'new',
        message: queryText,
        use_rag: Object.values(state.settings.searchScope).some(Boolean),
        use_web_search: state.settings.useWebSearch,
        use_distortion: useDistortion,
        use_ensemble_distortion: useDistortion && state.settings.useEnsemble,
        include_conversation_context: state.settings.includeConversationContext,
        search_scope: {
            reference_papers: state.settings.searchScope.reference_papers,
            my_papers:         state.settings.searchScope.my_papers,
            sessions:          state.settings.searchScope.sessions,
            web_cache:         state.settings.searchScope.web_cache
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

