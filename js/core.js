/* 椿沐智库 · 核心：LRU 缓存、全局状态、常量、Markdown 渲染、IndexedDB、虚拟列表、通用工具 */

/* ==================== 内存缓存（LRU，防止无上限增长） ==================== */
        class SimpleLRU {
            constructor(limit) { this.limit = limit; this.map = new Map(); }
            get(key) {
                if (!this.map.has(key)) return undefined;
                const value = this.map.get(key);
                this.map.delete(key);
                this.map.set(key, value);
                return value;
            }
            has(key) { return this.map.has(key); }
            set(key, value) {
                if (this.map.has(key)) this.map.delete(key);
                this.map.set(key, value);
                while (this.map.size > this.limit) {
                    const oldest = this.map.keys().next().value;
                    this.map.delete(oldest);
                }
            }
            delete(key) { this.map.delete(key); }
            clear() { this.map.clear(); }
        }

        let docs = [];
        // 正文缓存最多保留 25 篇；图片 JSON（base64）最多保留 30 张
        const docContentCache = new SimpleLRU(25);
        // 正文缓存对应的索引更新时间：索引变了就强制重新拉取正文，避免同步后仍显示旧内容
        const docContentStamp = new Map();
        const imageJsonCache = new SimpleLRU(30);
        let currentDocId = null;
        let previousDocId = null;
        // 手动刷新期间置为 true：同步完成后强制重新拉取当前正文
        let forceReloadDocOnSync = false;
        let activeCategory = 'ALL';
        let activeTag = null;
        let searchQuery = '';
        // 本次进入页面是否已按紧急通知切回“全部条目”
        let urgentDefaultApplied = false;
        let isEditing = false;
        let isLoggingIn = false;
        let isManualSyncing = false;
        let githubConfig = { token: '', repo: 'XiandeShen/Xiande-kb', path: 'kb_docs.json', sha: '' };
        let editAttachments = [];
        // 本次编辑会话中已上传到 GitHub、但尚未保存的文件（取消时需清理）
        let pendingUploads = [];
        // 本次编辑会话中移除的原有附件（保存时才真正删除，取消则保留）
        let pendingDeletedAttachments = [];
        // 编辑会话标识：取消/保存后递增，用于丢弃迟到的上传结果，避免产生孤儿文件
        let editSessionId = 0;
        let isPreviewMode = false;
        let isSavingDoc = false;
        let searchDebounceTimer = null;
        // Git Data API 使用的默认分支缓存（切换仓库时重置）
        let repoDefaultBranch = '';

        const DEFAULT_LOADING_TEXT = '正在加载知识库...';
        // 记住最后打开的文档，刷新后自动恢复
        const LAST_DOC_KEY = 'kb_last_doc_id';
        const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
        // 10MB 以内优先走 Contents API（单请求）；更大的文件走 Git Data API
        const CONTENTS_UPLOAD_LIMIT = 10 * 1024 * 1024;
        // 超过 2MB 的附件按 1.5MB 分片上传，规避单次请求体过大导致的网络中断
        const CHUNKED_UPLOAD_THRESHOLD = 2 * 1024 * 1024;
        const CHUNK_SIZE = 1.5 * 1024 * 1024;
        const DOWNLOAD_REVOKE_DELAY = 60000;
        const DOCS_FOLDER = 'docs';
        const ATTACHMENT_FOLDERS = { table: '表格', word: 'Word', ppt: 'PPT', pdf: 'PDF', archive: '压缩包', other: '其他' };

        /* ==================== 列表卡片辅助 ==================== */
        // 今天/昨天优先，其次当年只显示 MM-DD，更省空间也更易读
        function formatDocDate(value) {
            if (!value) return '';
            const raw = String(value);
            const m = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
            if (!m) return raw.split(' ')[0];
            const now = new Date();
            const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diffDays = Math.round((today - target) / 86400000);
            if (diffDays === 0) return '今天';
            if (diffDays === 1) return '昨天';
            if (target.getFullYear() === now.getFullYear()) return `${Number(m[2])}-${Number(m[3])}`;
            return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
        }

        function escapeHtml(str) {
            return String(str == null ? '' : str)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        /* ==================== UTF-8 Base64（替代 unescape 方案） ==================== */
        function utf8ToBase64(str) {
            const bytes = new TextEncoder().encode(str);
            let binary = '';
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            }
            return btoa(binary);
        }

        function base64ToUtf8(b64) {
            const binary = atob(String(b64 || '').replace(/\s/g, ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder().decode(bytes);
        }

        /* ==================== Markdown 安全渲染 ==================== */
        // 优先使用 DOMPurify；CDN 未加载时退回到基于惰性文档的保守清洗
        function sanitizeHtml(html) {
            if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
                return window.DOMPurify.sanitize(html, {
                    USE_PROFILES: { html: true },
                    ADD_ATTR: ['target', 'rel']
                });
            }
            const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
            parsed.querySelectorAll('script,iframe,frame,object,embed,link,style,meta,form,base').forEach(n => n.remove());
            parsed.querySelectorAll('*').forEach(el => {
                for (const attr of Array.from(el.attributes)) {
                    const name = attr.name.toLowerCase();
                    const value = (attr.value || '').trim();
                    if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
                    if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') &&
                        /^(javascript|vbscript|data:text\/html)/i.test(value)) {
                        el.removeAttribute(attr.name);
                    }
                }
            });
            return parsed.body.innerHTML;
        }

        // 图片加载：先在骨架屏里等待数据，拿到后再赋 src，避免浏览器渲染原生“破图”占位
        async function loadImageIntoFrame(img, src, frame) {
            frame.classList.remove('is-error', 'is-ready');
            frame.classList.add('is-loading');
            frame.onclick = null;

            let dataUrl = imageJsonCache.get(src) || null;
            if (!dataUrl) {
                try { dataUrl = await fetchImageJsonFromGithub(src); } catch (e) { dataUrl = null; }
            }
            if (!dataUrl) {
                img.removeAttribute('src');
                frame.classList.remove('is-loading');
                frame.classList.add('is-error');
                frame.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    loadImageIntoFrame(img, src, frame);
                };
                return false;
            }
            imageJsonCache.set(src, dataUrl);

            const loaded = await new Promise((resolve) => {
                const finish = (ok) => { img.onload = null; img.onerror = null; resolve(ok); };
                img.onload = () => finish(true);
                img.onerror = () => finish(false);
                img.src = dataUrl;
                if (img.complete && img.naturalWidth > 0) finish(true);
            });

            if (!loaded) {
                img.removeAttribute('src');
                frame.classList.remove('is-loading');
                frame.classList.add('is-error');
                frame.onclick = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    imageJsonCache.delete(src);
                    loadImageIntoFrame(img, src, frame);
                };
                return false;
            }
            frame.classList.remove('is-loading');
            frame.classList.add('is-ready');
            img.onclick = () => openGalleryFromImage(img);
            return true;
        }

        async function renderMarkdownInto(container, content) {
            // 先在离屏节点里解析并挂好加载态，再整体搬进页面：
            // 这样浏览器始终看不到 "images/*.json" 这种无效 src，不会出现原生破图
            const staging = document.createElement('div');
            staging.innerHTML = sanitizeHtml(marked.parse(content || ''));
            const tasks = [];
            staging.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || '';
                if (!src.startsWith('images/') || !src.endsWith('.json')) return;

                const frame = document.createElement('span');
                frame.className = 'md-img-frame is-loading';
                const spinner = document.createElement('span');
                spinner.className = 'md-img-spinner';
                const errBox = document.createElement('span');
                errBox.className = 'md-img-error';
                errBox.innerHTML = '<i class="ri-image-2-line"></i><span>图片加载失败，点击重试</span>';
                frame.appendChild(spinner);
                frame.appendChild(errBox);

                // 关键：先把无效的 json 路径从 src 上摘掉，浏览器就不会画破图
                img.removeAttribute('src');
                img.classList.add('md-img');

                const parent = img.parentNode;
                if (!parent) return;
                parent.insertBefore(frame, img);
                frame.appendChild(img);
                tasks.push(loadImageIntoFrame(img, src, frame));
            });
            await Promise.all(tasks);

            // 外部图片（非 images/*.json）保持原有行为
            staging.querySelectorAll('img:not(.md-img)').forEach(imgEl => {
                imgEl.onclick = () => openGalleryFromImage(imgEl);
            });

            container.replaceChildren(...Array.from(staging.childNodes));
        }

        function clearAllCaches() {
            docContentCache.clear();
            docContentStamp.clear();
            imageJsonCache.clear();
        }

        /* ==================== 搜索框 placeholder 自适应 ==================== */
        function updateSearchPlaceholder() {
            const input = document.getElementById('searchInput');
            if (!input) return;
            input.placeholder = window.innerWidth < 640 ? '搜索…' : '搜索标题、摘要、编码或标签...';
        }

        /* ==================== IndexedDB ==================== */
        const IDB_NAME = 'chunmu_kb';
        const IDB_VERSION = 1;
        const IDB_STORE = 'cache';
        let _idbPromise = null;

        function openIDB() {
            if (_idbPromise) return _idbPromise;
            _idbPromise = new Promise((resolve, reject) => {
                if (!('indexedDB' in window)) { reject(new Error('当前浏览器不支持 IndexedDB')); return; }
                const req = indexedDB.open(IDB_NAME, IDB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            return _idbPromise;
        }

        async function idbGet(key) {
            try {
                const db = await openIDB();
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(IDB_STORE, 'readonly');
                    const store = tx.objectStore(IDB_STORE);
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            } catch (e) { console.warn('IndexedDB 读取失败', e); return undefined; }
        }

        async function idbSet(key, value) {
            const db = await openIDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const req = store.put(value, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }

        async function idbDel(key) {
            try {
                const db = await openIDB();
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(IDB_STORE, 'readwrite');
                    const store = tx.objectStore(IDB_STORE);
                    const req = store.delete(key);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            } catch (e) { console.warn('IndexedDB 删除失败', e); }
        }

        /* ==================== 虚拟列表（节点池复用） ==================== */
        // 行高固定为 116px（标题 + 两行摘要 + 元信息行，均为定高），
        // 虚拟列表的定位、spacer 高度与回收计算全部依赖这个常量
        const virtualList = { container: null, spacer: null, items: [], itemHeight: 116, buffer: 10, rafPending: false, nodes: new Map() };

        function initVirtualList() {
            const container = document.getElementById('docList');
            if (!container) return;
            container.innerHTML = '';
            container.style.position = 'relative';
            container.style.overflowY = 'auto';
            container.style.overflowX = 'hidden';
            container.style.background = '#f5f7fa';
            const spacer = document.createElement('div');
            spacer.style.position = 'relative';
            spacer.style.width = '100%';
            spacer.style.height = '0px';
            container.appendChild(spacer);
            virtualList.container = container;
            virtualList.spacer = spacer;
            virtualList.nodes.clear();
            container.addEventListener('scroll', () => {
                if (virtualList.rafPending) return;
                virtualList.rafPending = true;
                requestAnimationFrame(() => {
                    virtualList.rafPending = false;
                    renderVirtualItems();
                });
            }, { passive: true });
            container.addEventListener('touchend', () => {
                if (virtualList.rafPending) return;
                virtualList.rafPending = true;
                requestAnimationFrame(() => {
                    virtualList.rafPending = false;
                    renderVirtualItems();
                });
            }, { passive: true });
            window.addEventListener('resize', () => renderVirtualItems());
        }

        function createDocListItem(d) {
            const wrapper = document.createElement('div');
            const isSelected = currentDocId === d.id;
            wrapper.style.cssText = `position:absolute; left:0; right:0; height:${virtualList.itemHeight}px; padding:6px 10px; box-sizing:border-box;`;
            wrapper.dataset.docId = d.id;

            const catName = d.category || '通用';
            const attCount = (d.attachments || []).length;
            const dateStr = formatDocDate(d.updatedAt);

            const summaryText = escapeHtml((d.summary || '').replace(/[#*`!]/g, '').trim());
            const summaryHtml = summaryText || '<span class="text-slate-300">暂无摘要</span>';

            wrapper.innerHTML = `
                <div class="doc-card relative h-full rounded-[14px] overflow-hidden cursor-pointer ${isSelected ? 'is-selected' : ''}">
                    ${isSelected ? '<span class="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full bg-brand-500"></span>' : ''}
                    <div class="h-full flex flex-col justify-center px-3.5">
                        <div class="flex items-center justify-between gap-2">
                            <h4 class="flex-1 min-w-0 text-[14.5px] font-semibold leading-[20px] tracking-[-0.01em] truncate ${isSelected ? 'text-brand-700' : 'text-slate-800'}">${escapeHtml(d.title || '无标题')}</h4>
                            <span class="flex-shrink-0 text-[11px] leading-none tabular-nums ${isSelected ? 'text-brand-400' : 'text-slate-400'}">${dateStr}</span>
                        </div>
                        <p class="mt-1.5 text-[12.5px] leading-[18px] text-slate-500 line-clamp-2 h-[36px] overflow-hidden">${summaryHtml}</p>
                        <div class="mt-2 h-[18px] flex items-center gap-1.5 overflow-hidden">
                            <span class="inline-block px-2 py-[1px] rounded-md bg-slate-100 text-slate-600 text-[12px] font-medium leading-[16px] truncate max-w-[120px] flex-shrink">${escapeHtml(catName)}</span>
                            ${d.code ? `<span class="inline-block px-2 py-[1px] rounded-md bg-slate-100 text-slate-500 text-[12px] font-mono leading-[16px] tracking-tight flex-shrink-0">${escapeHtml(d.code)}</span>` : ''}
                            ${d.urgent ? '<span class="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-md bg-red-50 text-red-600 text-[12px] font-medium leading-[16px] flex-shrink-0"><i class="ri-alarm-warning-line text-[12px]"></i>紧急</span>' : ''}
                            <span class="flex-1"></span>
                            ${attCount > 0 ? `<span class="inline-flex items-center gap-0.5 text-[12px] text-slate-400 leading-none flex-shrink-0"><i class="ri-attachment-2 text-[13px]"></i>${attCount}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
            wrapper.onclick = async () => {
                // 编辑中直接切换文档等同于放弃编辑：先清理本次会话未保存的上传
                if (isEditing) {
                    await discardEditSessionUploads(true);
                    editAttachments = [];
                    isEditing = false;
                }
                openDocView(d.id);
            };
            return wrapper;
        }

        function renderVirtualItems() {
            const { container, spacer, items, itemHeight, buffer, nodes } = virtualList;
            if (!container || !spacer) return;
            const totalHeight = items.length * itemHeight;
            spacer.style.height = totalHeight + 'px';

            if (items.length === 0) {
                nodes.forEach(node => { try { if (node.parentNode) node.parentNode.removeChild(node); } catch (e) {} });
                nodes.clear();
                if (!spacer.querySelector('[data-virtual-empty]')) {
                    const empty = document.createElement('div');
                    empty.setAttribute('data-virtual-empty', '1');
                    empty.className = 'flex flex-col items-center justify-center py-20 px-6 text-center';
                    empty.innerHTML = `<i class="ri-inbox-line text-3xl text-slate-300 mb-2.5"></i><p class="text-[13px] text-slate-400">${searchQuery ? '没有匹配的条目' : '暂无条目'}</p>`;
                    spacer.appendChild(empty);
                }
                return;
            }

            const emptyEl = spacer.querySelector('[data-virtual-empty]');
            if (emptyEl) emptyEl.remove();

            const scrollTop = container.scrollTop;
            const viewportHeight = container.clientHeight || Math.max(600, window.innerHeight);
            const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
            const endIndex = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / itemHeight) + buffer);

            nodes.forEach((node, index) => {
                if (index < startIndex || index >= endIndex) {
                    try { if (node.parentNode) node.parentNode.removeChild(node); } catch (e) {}
                    nodes.delete(index);
                }
            });

            let fragment = null;
            for (let i = startIndex; i < endIndex; i++) {
                if (nodes.has(i)) continue;
                const d = items[i];
                const el = createDocListItem(d);
                el.style.position = 'absolute';
                el.style.top = (i * itemHeight) + 'px';
                el.style.left = '0';
                el.style.right = '0';
                nodes.set(i, el);
                if (!fragment) fragment = document.createDocumentFragment();
                fragment.appendChild(el);
            }
            if (fragment) spacer.appendChild(fragment);
        }

        function renderVirtualList(list) {
            virtualList.items = list || [];
            if (virtualList.spacer) virtualList.spacer.innerHTML = '';
            virtualList.nodes.clear();
            renderVirtualItems();
        }

        /* ==================== 工具 ==================== */
        function encodeRepoPath(path) { return path.split('/').map(encodeURIComponent).join('/'); }

        function makeSummary(content, maxLen = 150) {
            if (!content) return '';
            let text = content
                .replace(/!\[.*?\]\(.*?\)/g, '')
                .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                .replace(/```[\s\S]*?```/g, '')
                .replace(/`([^`]*)`/g, '$1')
                .replace(/^#{1,6}\s+/gm, '')
                .replace(/[*_~]/g, '')
                .replace(/^>\s?/gm, '')
                .replace(/^[-*+]\s+/gm, '')
                .replace(/^\d+\.\s+/gm, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (text.length > maxLen) text = text.slice(0, maxLen) + '...';
            return text;
        }

        function dataURLtoBlob(dataUrl) {
            const parts = dataUrl.split(',');
            const header = parts[0] || '';
            const base64 = parts[1] || '';
            const mimeMatch = header.match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const binary = atob(base64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], { type: mime });
        }

        function convertDataUrlToBlobType(dataUrl, targetMime) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width;
                        canvas.height = img.naturalHeight || img.height;
                        const ctx = canvas.getContext('2d');
                        if (targetMime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob((blob) => {
                            if (blob && blob.size > 0) resolve(blob);
                            else reject(new Error('图片转换失败'));
                        }, targetMime, targetMime === 'image/jpeg' ? 0.92 : undefined);
                    } catch (e) { reject(new Error('图片转换失败')); }
                };
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = dataUrl;
            });
        }

        function triggerBlobDownload(filename, blob) {
            if (!blob || blob.size === 0) throw new Error('文件内容为空');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {}
                try { URL.revokeObjectURL(url); } catch (e) {}
            }, DOWNLOAD_REVOKE_DELAY);
        }

        async function prepareAndDownload(filename, getBlob) {
            showLoading('正在准备下载...', { transparent: true });
            try {
                const blob = await getBlob();
                if (!blob || blob.size === 0) throw new Error('文件内容为空');
                triggerBlobDownload(filename, blob);
                hideLoading();
                showToast('下载已开始，请到浏览器下载列表查看', 'success');
            } catch (e) {
                hideLoading();
                showToast('下载失败：' + (e.message || '未知错误'), 'error');
            }
        }

        function guessMimeByName(name) {
            const ext = (name.split('.').pop() || '').toLowerCase();
            const map = { pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',csv:'text/csv',txt:'text/plain',md:'text/markdown',json:'application/json',zip:'application/zip',rar:'application/vnd.rar','7z':'application/x-7z-compressed',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml' };
            return map[ext] || 'application/octet-stream';
        }
