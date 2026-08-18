/**
 * LanClip — Client application
 * Vanilla JS, no build step, no framework.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────
const state = {
  page:        1,
  limit:       20,
  total:       0,
  query:       '',
  isLoading:   false,
  isSearching: false,
};

// ── DOM helpers ───────────────────────────────────────────────
const el  = (id)       => document.getElementById(id);
const qs  = (sel, ctx) => (ctx ?? document).querySelector(sel);

// ── Element refs ──────────────────────────────────────────────
const refs = {
  searchInput:    el('search-input'),
  searchClear:    el('search-clear'),
  clipInput:      el('clip-input'),
  saveBtn:        el('save-btn'),
  clipsList:      el('clips-list'),
  emptyState:     el('empty-state'),
  noResults:      el('no-results'),
  loadMoreWrap:   el('load-more-wrap'),
  loadMoreBtn:    el('load-more-btn'),
  refreshBtn:     el('refresh-btn'),
  refreshIcon:    el('refresh-icon'),
  composerStats:  el('composer-stats'),
  statsBadge:     el('stats-badge'),
  clipsHeading:   el('clips-heading'),
  themeToggle:    el('theme-toggle'),
  modal:          el('modal'),
  modalBackdrop:  el('modal-backdrop'),
  modalContent:   el('modal-content'),
  modalLang:      el('modal-lang'),
  modalIp:        el('modal-ip'),
  modalTime:      el('modal-time'),
  modalSize:      el('modal-size'),
  modalCopyBtn:   el('modal-copy-btn'),
  modalDeleteBtn: el('modal-delete-btn'),
  modalCloseBtn:  el('modal-close-btn'),
  toastContainer: el('toast-container'),
  hljsLight:      el('hljs-light'),
  hljsDark:       el('hljs-dark'),
};

// Clip content for the open modal (stored to avoid re-fetch on copy)
let activeModalId      = null;
let activeModalContent = '';

// ── Theme ─────────────────────────────────────────────────────
const THEME_KEY = 'lanclip-theme';

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || 'auto';
}

function resolveIsDark(theme) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const dark = resolveIsDark(theme);
  refs.hljsLight.disabled = dark;
  refs.hljsDark.disabled  = !dark;
}

function cycleTheme() {
  const map = { light: 'dark', dark: 'auto', auto: 'light' };
  applyTheme(map[getStoredTheme()] || 'light');
}

// ── Formatting helpers ────────────────────────────────────────
function timeAgo(iso) {
  const secs = (Date.now() - new Date(iso)) / 1000;
  if (secs < 10)     return 'just now';
  if (secs < 60)     return `${Math.floor(secs)}s ago`;
  if (secs < 3600)   return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Language / syntax highlighting ────────────────────────────
const CODE_PATTERNS = [
  /^\s*#!\/usr\/bin\/(env )?/m,               // shebang
  /^\s*(def |class |import |from .+ import)/m, // Python
  /^\s*(function\s+\w|\bconst\b|\blet\b|\bvar\b|=>|async function)/m, // JS/TS
  /^\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)/im, // SQL
  /^\s*(<(!DOCTYPE|html|head|body|div|span|p |script|style)[^>]*>)/im, // HTML
  /^\s*(\{|\[)\s*$|^\s*"[\w-]+"\s*:/m,        // JSON
  /^\s*(FROM|RUN|CMD|ENV|EXPOSE|WORKDIR|COPY|ARG)\s/m, // Dockerfile
  /^\s*(server|location|upstream)\s*\{/m,      // nginx
  /^---\s*$/m,                                 // YAML
  /^\s*(\[\w+\]|[a-zA-Z_]+=)/m,               // INI/TOML
  /^\s*(\$|#)\s+\S/m,                          // shell commands
  /[{};]\s*$/m,                                // brace/semicolon endings
];

function looksLikeCode(text) {
  return CODE_PATTERNS.some((re) => re.test(text));
}

function highlightContent(text, language) {
  if (!window.hljs) return `<code>${escHtml(text)}</code>`;
  try {
    if (language) {
      const r = hljs.highlight(text, { language, ignoreIllegals: true });
      return `<code class="hljs language-${language}">${r.value}</code>`;
    }
    const langs = [
      'javascript','typescript','python','bash','shell','sql','json','yaml',
      'html','css','markdown','go','rust','java','kotlin','ruby','php','swift',
      'c','cpp','csharp','dockerfile','nginx','xml','toml','ini','makefile',
    ];
    const r = hljs.highlightAuto(text, langs);
    if (r.relevance > 4) {
      return `<code class="hljs language-${r.language}">${r.value}</code>`;
    }
  } catch { /* fall through */ }
  return `<code>${escHtml(text)}</code>`;
}

function detectLanguage(text) {
  if (!window.hljs || !looksLikeCode(text)) return null;
  try {
    const langs = [
      'javascript','typescript','python','bash','shell','sql','json','yaml',
      'html','css','go','rust','java','kotlin','ruby','php','swift',
      'c','cpp','csharp','dockerfile','nginx','xml','toml','ini',
    ];
    const r = hljs.highlightAuto(text, langs);
    return r.relevance > 4 ? (r.language ?? null) : null;
  } catch { return null; }
}

// ── Clipboard ─────────────────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-HTTPS or older browsers
    const ta = Object.assign(document.createElement('textarea'), {
      value: text,
      style: 'position:fixed;opacity:0',
    });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ── Toast ─────────────────────────────────────────────────────
function toast(message, type = 'default') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = message;
  refs.toastContainer.appendChild(div);
  setTimeout(() => {
    div.classList.add('is-leaving');
    div.addEventListener('transitionend', () => div.remove(), { once: true });
  }, 2800);
}

// ── API layer ─────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : res.text();
}

const API = {
  createClip: (content)     => api('POST',   '/api/clips',         { content }),
  listClips:  (page, limit) => api('GET',    `/api/clips?page=${page}&limit=${limit}`),
  getClip:    (id)           => api('GET',    `/api/clips/${id}`),
  deleteClip: (id)           => api('DELETE', `/api/clips/${id}`),
  search:     (q)            => api('GET',    `/api/clips/search?q=${encodeURIComponent(q)}`),
};

// ── Rendering ─────────────────────────────────────────────────
const ICONS = {
  copy:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  trash:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  expand: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
  pc:     `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  clock:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

/**
 * Build and return a clip card DOM element.
 * @param {Object} clip   - Clip metadata object (from list endpoint).
 * @param {string} [fullContent] - Full content if already available.
 */
function buildCard(clip, fullContent) {
  const content      = fullContent ?? clip.preview ?? '';
  const isCode       = looksLikeCode(content);
  const lang         = isCode ? detectLanguage(content) : null;
  const isTruncated  = !fullContent && (clip.lines > 10 || (clip.preview?.length ?? 0) >= 299);

  // ── Card root ──
  const card = document.createElement('article');
  card.className  = 'clip-card';
  card.dataset.id = clip.id;
  card.setAttribute('role', 'listitem');

  // ── Meta bar ──
  const meta = document.createElement('div');
  meta.className = 'card-meta';

  if (lang) {
    const badge = document.createElement('span');
    badge.className   = 'lang-badge';
    badge.textContent = lang;
    meta.appendChild(badge);
    meta.appendChild(dot());
  }

  meta.appendChild(chip(ICONS.pc, clip.source_ip || 'unknown'));
  meta.appendChild(dot());

  const timeChip = chip(ICONS.clock, timeAgo(clip.created_at));
  timeChip.title = new Date(clip.created_at).toLocaleString();
  meta.appendChild(timeChip);
  meta.appendChild(dot());

  const sizeStr = fmtSize(clip.size) + (clip.lines ? ` · ${clip.lines} ln` : '');
  meta.appendChild(chip(null, sizeStr));

  card.appendChild(meta);

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'card-body';

  if (isCode) {
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap' + (isTruncated ? ' is-collapsed' : '');
    const pre = document.createElement('pre');
    pre.innerHTML = highlightContent(content, lang);
    wrap.appendChild(pre);
    body.appendChild(wrap);
  } else {
    const textEl = document.createElement('div');
    textEl.className = 'text-wrap' + (isTruncated ? ' is-collapsed' : '');
    textEl.textContent = content;
    body.appendChild(textEl);
  }

  card.appendChild(body);

  // ── Footer ──
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const left  = document.createElement('div');
  left.className  = 'card-left';
  const right = document.createElement('div');
  right.className = 'card-right';

  // Expand / collapse toggle
  if (isTruncated) {
    const btnExpand = document.createElement('button');
    btnExpand.className = 'btn-expand';
    btnExpand.type = 'button';
    let expanded = false;
    const updateExpand = () => {
      if (expanded) {
        btnExpand.textContent = '↑ Collapse';
        const el = body.querySelector('.code-wrap, .text-wrap');
        el?.classList.remove('is-collapsed');
      } else {
        btnExpand.textContent = '↕ Expand';
        const el = body.querySelector('.code-wrap, .text-wrap');
        el?.classList.add('is-collapsed');
      }
    };
    updateExpand();
    btnExpand.addEventListener('click', () => {
      expanded = !expanded;
      updateExpand();
    });
    left.appendChild(btnExpand);
  }

  // Full-view button
  const btnFull = document.createElement('button');
  btnFull.className   = 'btn-fullview';
  btnFull.type        = 'button';
  btnFull.title       = 'Open full view';
  btnFull.innerHTML   = `${ICONS.expand} Full view`;
  btnFull.addEventListener('click', () => openModal(clip.id));
  left.appendChild(btnFull);

  // Copy button
  const btnCopy = makeCopyButton(clip.id, content);
  right.appendChild(btnCopy);

  // Delete button
  const btnDelete = document.createElement('button');
  btnDelete.className   = 'btn-delete';
  btnDelete.type        = 'button';
  btnDelete.title       = 'Delete clip';
  btnDelete.setAttribute('aria-label', 'Delete clip');
  btnDelete.innerHTML   = ICONS.trash;
  btnDelete.addEventListener('click', () => deleteCard(clip.id, card));
  right.appendChild(btnDelete);

  footer.appendChild(left);
  footer.appendChild(right);
  card.appendChild(footer);

  return card;
}

/** Create a copy button that fetches full content on click. */
function makeCopyButton(clipId, previewContent) {
  const btn = document.createElement('button');
  btn.className = 'btn-copy';
  btn.type      = 'button';
  btn.innerHTML = `${ICONS.copy} Copy`;

  btn.addEventListener('click', async () => {
    // Always get full content from server
    let text = previewContent;
    try {
      const clip = await API.getClip(clipId);
      text = clip.content;
    } catch { /* use preview as fallback */ }

    const ok = await copyToClipboard(text);
    if (ok) {
      btn.classList.add('is-copied');
      btn.innerHTML = `${ICONS.check} Copied!`;
      setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.innerHTML = `${ICONS.copy} Copy`;
      }, 2000);
    } else {
      toast('Copy failed — try manual select', 'error');
    }
  });

  return btn;
}

/** Small helpers for meta chips */
function dot() {
  const s = document.createElement('span');
  s.className = 'meta-dot';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function chip(iconHtml, text) {
  const s = document.createElement('span');
  s.className = 'meta-chip';
  if (iconHtml) s.innerHTML = iconHtml + ' ';
  s.appendChild(document.createTextNode(text));
  return s;
}

// ── Data loading ──────────────────────────────────────────────
async function loadClips(append = false) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (!append) {
    state.page = 1;
  }

  try {
    const data = await API.listClips(state.page, state.limit);
    state.total = data.total;

    if (!append) refs.clipsList.innerHTML = '';

    for (const clip of data.clips) {
      refs.clipsList.appendChild(buildCard(clip));
    }

    const hasMore = state.page < data.pages;
    refs.loadMoreWrap.classList.toggle('hidden', !hasMore);
    refs.emptyState.classList.toggle('hidden', data.total > 0);
    refs.noResults.classList.add('hidden');

    updateStatsBadge(data.total);
  } catch (err) {
    toast(`Failed to load clips: ${err.message}`, 'error');
    console.error(err);
  } finally {
    state.isLoading = false;
  }
}

async function runSearch(q) {
  if (state.isLoading) return;
  state.isLoading = true;

  refs.clipsHeading.textContent = `Results for "${q}"`;
  refs.clipsList.innerHTML = '';
  refs.loadMoreWrap.classList.add('hidden');
  refs.emptyState.classList.add('hidden');

  try {
    const data = await API.search(q);

    if (data.results.length === 0) {
      refs.noResults.classList.remove('hidden');
    } else {
      refs.noResults.classList.add('hidden');
      for (const clip of data.results) {
        refs.clipsList.appendChild(buildCard(clip));
      }
    }

    updateStatsBadge(data.total, true);
  } catch (err) {
    toast(`Search error: ${err.message}`, 'error');
  } finally {
    state.isLoading = false;
  }
}

function resetToList() {
  state.query       = '';
  state.isSearching = false;
  refs.clipsHeading.textContent = 'Recent clips';
  loadClips();
}

// ── Save ──────────────────────────────────────────────────────
async function saveClip() {
  const content = refs.clipInput.value.trim();
  if (!content) return;

  refs.saveBtn.disabled = true;
  refs.saveBtn.textContent = 'Saving…';

  try {
    await API.createClip(content);
    refs.clipInput.value = '';
    updateComposerStats('');
    toast('Clip saved ✓', 'success');

    // Clear search and reload
    refs.searchInput.value = '';
    refs.searchClear.classList.add('hidden');
    resetToList();
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  } finally {
    refs.saveBtn.disabled = !refs.clipInput.value.trim();
    refs.saveBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save`;
  }
}

// ── Delete ────────────────────────────────────────────────────
async function deleteCard(id, cardEl) {
  if (!confirm('Delete this clip?')) return;
  try {
    await API.deleteClip(id);
    cardEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    cardEl.style.opacity    = '0';
    cardEl.style.transform  = 'translateX(6px)';
    setTimeout(() => cardEl.remove(), 220);

    state.total = Math.max(0, state.total - 1);
    updateStatsBadge(state.total);

    if (refs.clipsList.children.length === 0 || refs.clipsList.children.length <= 1) {
      setTimeout(() => {
        if (refs.clipsList.children.length === 0) {
          if (state.isSearching) refs.noResults.classList.remove('hidden');
          else refs.emptyState.classList.remove('hidden');
        }
      }, 250);
    }

    toast('Clip deleted');
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'error');
  }
}

// ── Modal ─────────────────────────────────────────────────────
async function openModal(id) {
  try {
    const clip = await API.getClip(id);
    activeModalId      = id;
    activeModalContent = clip.content;

    const lang = detectLanguage(clip.content);

    if (lang) {
      refs.modalLang.textContent = lang;
      refs.modalLang.classList.remove('hidden');
    } else {
      refs.modalLang.classList.add('hidden');
    }

    refs.modalIp.innerHTML   = `${ICONS.pc} ${escHtml(clip.source_ip || 'unknown')}`;
    refs.modalTime.innerHTML  = `${ICONS.clock} ${timeAgo(clip.created_at)}`;
    refs.modalTime.title      = new Date(clip.created_at).toLocaleString();
    refs.modalSize.textContent = fmtSize(clip.size) + (clip.lines ? ` · ${clip.lines} lines` : '');

    refs.modalContent.innerHTML = highlightContent(clip.content, lang);

    refs.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    toast(`Could not open clip: ${err.message}`, 'error');
  }
}

function closeModal() {
  refs.modal.classList.add('hidden');
  document.body.style.overflow = '';
  activeModalId      = null;
  activeModalContent = '';
}

// ── Stats helpers ─────────────────────────────────────────────
function updateStatsBadge(count, isSearch = false) {
  if (isSearch) {
    refs.statsBadge.textContent = `${count} result${count !== 1 ? 's' : ''}`;
  } else {
    refs.statsBadge.textContent = count > 0 ? `${count} clip${count !== 1 ? 's' : ''}` : '';
  }
}

function updateComposerStats(text) {
  if (!text) { refs.composerStats.textContent = ''; return; }
  const lines = text.split('\n').length;
  const bytes = new TextEncoder().encode(text).length;
  refs.composerStats.textContent = `${lines} ln · ${fmtSize(bytes)}`;
}

// ── Events ────────────────────────────────────────────────────
function initEvents() {
  // Theme
  refs.themeToggle.addEventListener('click', cycleTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'auto') applyTheme('auto');
  });

  // Composer textarea
  refs.clipInput.addEventListener('input', () => {
    const v = refs.clipInput.value;
    refs.saveBtn.disabled = !v.trim();
    updateComposerStats(v);
  });

  refs.clipInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!refs.saveBtn.disabled) saveClip();
    }
  });

  refs.saveBtn.addEventListener('click', saveClip);

  // Search with debounce
  let searchTimer = 0;

  refs.searchInput.addEventListener('input', () => {
    const q = refs.searchInput.value.trim();
    refs.searchClear.classList.toggle('hidden', !q);

    clearTimeout(searchTimer);

    if (!q) {
      state.isSearching = false;
      resetToList();
      return;
    }

    searchTimer = setTimeout(() => {
      state.query       = q;
      state.isSearching = true;
      runSearch(q);
    }, 300);
  });

  refs.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      refs.searchInput.value = '';
      refs.searchInput.dispatchEvent(new Event('input'));
      refs.searchInput.blur();
    }
  });

  refs.searchClear.addEventListener('click', () => {
    refs.searchInput.value = '';
    refs.searchInput.dispatchEvent(new Event('input'));
    refs.searchInput.focus();
  });

  // Refresh
  refs.refreshBtn.addEventListener('click', () => {
    if (state.isSearching) return;
    refs.refreshIcon.style.transition = 'transform 0.4s ease';
    refs.refreshIcon.style.transform  = 'rotate(360deg)';
    setTimeout(() => {
      refs.refreshIcon.style.transition = '';
      refs.refreshIcon.style.transform  = '';
    }, 420);
    loadClips();
  });

  // Load more
  refs.loadMoreBtn.addEventListener('click', () => {
    state.page++;
    loadClips(true);
  });

  // Modal
  refs.modalCloseBtn.addEventListener('click',  closeModal);
  refs.modalBackdrop.addEventListener('click',  closeModal);

  refs.modalCopyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(activeModalContent);
    if (ok) {
      refs.modalCopyBtn.innerHTML = `${ICONS.check} Copied!`;
      setTimeout(() => {
        refs.modalCopyBtn.innerHTML = `${ICONS.copy} Copy`;
      }, 2000);
      toast('Copied to clipboard', 'success');
    }
  });

  refs.modalDeleteBtn.addEventListener('click', async () => {
    if (!activeModalId || !confirm('Delete this clip?')) return;
    try {
      await API.deleteClip(activeModalId);
      const card = refs.clipsList.querySelector(`[data-id="${activeModalId}"]`);
      if (card) {
        card.style.transition = 'opacity 0.2s ease';
        card.style.opacity    = '0';
        setTimeout(() => card.remove(), 220);
      }
      state.total = Math.max(0, state.total - 1);
      updateStatsBadge(state.total);
      closeModal();
      toast('Clip deleted');
      if (refs.clipsList.children.length === 0) {
        refs.emptyState.classList.remove('hidden');
      }
    } catch (err) {
      toast(`Delete failed: ${err.message}`, 'error');
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Close modal on Escape
    if (e.key === 'Escape' && !refs.modal.classList.contains('hidden')) {
      closeModal();
      return;
    }
    // Focus search on /
    if (e.key === '/' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      refs.searchInput.focus();
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────
function init() {
  applyTheme(getStoredTheme());
  initEvents();
  loadClips();
}

document.addEventListener('DOMContentLoaded', init);

// Inject real server URL into the empty-state curl example
document.addEventListener('DOMContentLoaded', () => {
  const codeEl = document.querySelector('.empty-code');
  if (codeEl) {
    codeEl.textContent = codeEl.textContent.replace(
      /http:\/\/<your-ip>:\d+/g,
      window.location.origin,
    );
  }
});
