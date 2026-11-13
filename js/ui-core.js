/* 椿沐智库 · 基础 UI：确认弹窗、加载态、焦点恢复、本地缓存、列表/分类/标签渲染、预览切换 */

/* ==================== 附件工具 ==================== */
        function getAttachmentType(file) {
            const name = (file.name || '').toLowerCase();
            const mime = (file.type || '').toLowerCase();
            if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|svg)$/.test(name)) return 'image';
            if (/\.(xlsx?|csv|numbers|ods)$/.test(name)) return 'table';
            if (/\.(docx?|pages|rtf|odt)$/.test(name)) return 'word';
            if (/\.(pptx?|key|odp)$/.test(name)) return 'ppt';
            if (/\.pdf$/.test(name)) return 'pdf';
            if (/\.(zip|rar|7z|tar|gz|tgz)$/.test(name)) return 'archive';
            return 'other';
        }
        function getAttachIcon(type) {
            const map = { table:'ri-file-excel-2-line text-emerald-600',word:'ri-file-word-line text-blue-600',ppt:'ri-file-ppt-line text-orange-600',pdf:'ri-file-pdf-line text-red-600',archive:'ri-file-zip-line text-purple-600',image:'ri-image-line text-pink-600',other:'ri-file-line text-slate-600' };
            return map[type] || map.other;
        }
        function getAttachIconBg(type) {
            const map = { table:'bg-emerald-50',word:'bg-blue-50',ppt:'bg-orange-50',pdf:'bg-red-50',archive:'bg-purple-50',image:'bg-pink-50',other:'bg-slate-100' };
            return map[type] || map.other;
        }
        function formatSize(bytes) {
            const n = Number(bytes) || 0;
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
            return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        }
        function sanitizeFileName(name) {
            return (name || 'file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100);
        }
        function fileToBase64(file, onProgress) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onprogress = (e) => {
                    if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
                };
                reader.onload = () => {
                    const result = reader.result || '';
                    const idx = result.indexOf(',');
                    resolve(idx >= 0 ? result.slice(idx + 1) : '');
                };
                reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
                reader.readAsDataURL(file);
            });
        }

        /* ==================== 确认弹窗 ==================== */
        let confirmResolve = null;
        function showConfirm(options = {}) {
            const { title = '确认操作', desc = '', okText = '确定', cancelText = '取消', type = 'danger' } = options;
            return new Promise((resolve) => {
                confirmResolve = resolve;
                const modal = document.getElementById('confirmModal');
                const iconWrap = document.getElementById('confirmIconWrap');
                const icon = document.getElementById('confirmIcon');
                const okBtn = document.getElementById('confirmOkBtn');
                const cancelBtn = document.getElementById('confirmCancelBtn');
                document.getElementById('confirmTitle').textContent = title;
                document.getElementById('confirmDesc').textContent = desc;
                okBtn.textContent = okText;
                cancelBtn.textContent = cancelText;
                if (type === 'danger') {
                    iconWrap.className = 'w-14 h-14 rounded-full bg-red-50 flex items-center justify-center';
                    icon.className = 'ri-delete-bin-line text-2xl text-red-500';
                    okBtn.className = 'flex-1 py-2.5 text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 active:bg-red-600 rounded-xl shadow-sm transition';
                } else {
                    iconWrap.className = 'w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center';
                    icon.className = 'ri-error-warning-line text-2xl text-amber-500';
                    okBtn.className = 'flex-1 py-2.5 text-[13px] font-medium text-white bg-brand-600 hover:bg-brand-700 active:bg-brand-700 rounded-xl shadow-sm transition';
                }
                modal.classList.remove('hidden');
                setTimeout(() => { try { okBtn.focus(); } catch (e) {} }, 0);
            });
        }
        function closeConfirm(result) {
            const modal = document.getElementById('confirmModal');
            if (!modal || modal.classList.contains('hidden')) return;
            modal.classList.add('hidden');
            if (confirmResolve) {
                const r = confirmResolve;
                confirmResolve = null;
                r(result);
            }
        }
        function setupConfirmModal() {
            const modal = document.getElementById('confirmModal');
            const okBtn = document.getElementById('confirmOkBtn');
            const cancelBtn = document.getElementById('confirmCancelBtn');
            const overlay = document.getElementById('confirmModalOverlay');
            okBtn.addEventListener('click', () => closeConfirm(true));
            cancelBtn.addEventListener('click', () => closeConfirm(false));
            overlay.addEventListener('click', () => closeConfirm(false));
            document.addEventListener('keydown', (e) => {
                if (!modal.classList.contains('hidden')) {
                    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
                    else if (e.key === 'Enter') { e.preventDefault(); closeConfirm(true); }
                }
            });
        }

        /* ==================== 加载显隐 ==================== */
        function setLoadingMode(mode) {
            const overlay = document.getElementById('loadingOverlay');
            const decor = document.getElementById('loadingDecor');
            if (mode === 'auth') {
                overlay.classList.remove('bg-slate-900/60', 'backdrop-blur-sm');
                overlay.classList.add('bg-slate-950');
                decor.classList.remove('hidden');
            } else {
                overlay.classList.remove('bg-slate-950');
                overlay.classList.add('bg-slate-900/60', 'backdrop-blur-sm');
                decor.classList.add('hidden');
            }
        }
        function showLoading(text) {
            setLoadingMode('app');
            const overlay = document.getElementById('loadingOverlay');
            updateLoadingText(text || DEFAULT_LOADING_TEXT);
            setLoadingProgress(null);
            overlay.classList.remove('hidden');
        }
        function updateLoadingText(text) {
            const loadingText = document.getElementById('loadingText');
            if (loadingText) loadingText.textContent = text || DEFAULT_LOADING_TEXT;
        }
        // percent 传 null 收起进度条；stageText 显示当前阶段（如“正在上传 42%”）
        function setLoadingProgress(percent, stageText) {
            const wrap = document.getElementById('loadingProgressWrap');
            const bar = document.getElementById('loadingProgressBar');
            const stage = document.getElementById('loadingProgressStage');
            const pctEl = document.getElementById('loadingProgressPercent');
            if (!wrap || !bar) return;
            if (percent === null || percent === undefined) {
                wrap.classList.add('hidden');
                bar.style.width = '0%';
                if (pctEl) pctEl.textContent = '0%';
                return;
            }
            const p = Math.max(0, Math.min(100, Number(percent) || 0));
            wrap.classList.remove('hidden');
            bar.style.width = p.toFixed(1) + '%';
            if (stage) stage.textContent = stageText || '正在处理...';
            if (pctEl) pctEl.textContent = Math.round(p) + '%';
        }
        function hideLoading() {
            const overlay = document.getElementById('loadingOverlay');
            updateLoadingText(DEFAULT_LOADING_TEXT);
            setLoadingProgress(null);
            overlay.classList.add('hidden');
        }
        function setLoginButtonLoading(loading) {
            const btn = document.getElementById('authSubmitBtn');
            const spinner = document.getElementById('loginSpinner');
            const arrow = document.getElementById('loginArrow');
            if (!btn) return;
            btn.disabled = loading;
            if (spinner) spinner.classList.toggle('hidden', !loading);
            if (arrow) arrow.classList.toggle('hidden', loading);
        }
        function showAuth() {
            const el = document.getElementById('authOverlay');
            el.classList.remove('hidden');
            const tokInput = document.getElementById('authTokInput');
            const tokIcon = document.getElementById('toggleTokenIcon');
            if (tokInput) tokInput.type = 'password';
            if (tokIcon) tokIcon.className = 'ri-eye-line text-base';
            collapseAdvancedOptions();
            setLoginButtonLoading(false);
        }
        function hideAuth() { document.getElementById('authOverlay').classList.add('hidden'); }

        function showApp() {
            document.getElementById('appShell').classList.remove('hidden');
            requestAnimationFrame(() => {
                if (virtualList.container) renderVirtualItems();
                if (typeof window.checkBackToTopBtnVisibility === 'function') {
                    window.checkBackToTopBtnVisibility();
                }
                // WebView 刷新后窗口焦点可能仍在丢失状态，显示应用后主动恢复一次
                regainWindowFocus();
            });
        }
        function hideApp() { document.getElementById('appShell').classList.add('hidden'); }

        function collapseAdvancedOptions() {
            const adv = document.getElementById('advancedOptions');
            const chevron = document.getElementById('advancedChevron');
            if (adv) adv.classList.remove('is-open');
            if (chevron) chevron.classList.remove('is-open');
        }
        function setupAdvancedToggle() {
            const btn = document.getElementById('toggleAdvancedBtn');
            const adv = document.getElementById('advancedOptions');
            const chevron = document.getElementById('advancedChevron');
            btn.addEventListener('click', () => {
                const isOpen = adv.classList.toggle('is-open');
                chevron.classList.toggle('is-open', isOpen);
            });
        }
        function fillAdvancedOptions() {
            document.getElementById('authRepoInput').value = githubConfig.repo || 'XiandeShen/Xiande-kb';
            document.getElementById('authPathInput').value = githubConfig.path || 'kb_docs.json';
        }

        let toastTimer = null;
        function showToast(msg, type = 'success') {
            const toast = document.getElementById('toast');
            const toastText = document.getElementById('toastText');
            const toastIcon = document.getElementById('toastIcon');
            toastText.textContent = msg;
            toastIcon.className = type === 'error' ? 'ri-error-warning-line text-rose-400 text-sm' : 'ri-checkbox-circle-line text-emerald-400 text-sm';
            toast.classList.remove('translate-y-12', 'opacity-0', 'pointer-events-none');
            toast.classList.add('translate-y-0', 'opacity-100');
            if (toastTimer) clearTimeout(toastTimer);
            // 错误信息通常更长，多留一点阅读时间
            toastTimer = setTimeout(() => {
                toast.classList.remove('translate-y-0', 'opacity-100');
                toast.classList.add('translate-y-12', 'opacity-0', 'pointer-events-none');
            }, type === 'error' ? 4000 : 2000);
        }

        /* ==================== 移动端 WebView 焦点恢复 ==================== */
        // Via 等基于 WebView 的浏览器刷新后，窗口本身可能没有获得焦点，
        // 表现为页面第一下点不动、输入框不弹键盘，点一下页面/浏览器按钮才恢复。
        // 页面侧无法调用原生的 requestFocus，但可以在加载完成、切回前台时主动争取焦点，
        // 并清掉浏览器恢复到隐藏容器里的焦点（如已隐藏的登录框），通常一次即可恢复交互。
        function regainWindowFocus() {
            try { window.focus(); } catch (e) {}
            const active = document.activeElement;
            if (!active || active === document.body || active === document.documentElement) {
                // 让 WebView 至少有一个 DOM 节点持有焦点，部分内核会据此把窗口重新激活
                try {
                    document.body.tabIndex = -1;
                    document.body.focus({ preventScroll: true });
                } catch (e) {}
                return;
            }
            const tag = active.tagName;
            const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            // offsetParent 为 null 说明元素在隐藏容器内（fixed 元素除外，这里只针对输入控件）
            const inHiddenBox = isField && active.offsetParent === null;
            if (!isField || inHiddenBox) {
                try { active.blur(); } catch (e) {}
                try {
                    document.body.tabIndex = -1;
                    document.body.focus({ preventScroll: true });
                } catch (e) {}
            }
        }
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) regainWindowFocus();
        });
        window.addEventListener('pageshow', () => {
            regainWindowFocus();
        });
        document.addEventListener('touchstart', function onFirstTouch() {
            document.removeEventListener('touchstart', onFirstTouch);
            regainWindowFocus();
        }, { passive: true });
        document.addEventListener('pointerdown', function onFirstPointer() {
            document.removeEventListener('pointerdown', onFirstPointer);
            if (!document.hasFocus()) regainWindowFocus();
        }, { capture: true, passive: true });
        // 个别 WebView 刷新后的第一次点击只用于“唤醒”页面，点击事件到了但输入框没拿到焦点。
        // 在 click（用户手势）里补一次 focus，键盘即可正常弹出。
        document.addEventListener('click', (e) => {
            const el = e.target && e.target.closest ? e.target.closest('input, textarea') : null;
            if (!el || el.disabled || el.readOnly) return;
            if (document.activeElement === el) return;
            setTimeout(() => {
                if (document.activeElement === el) return;
                try { el.focus({ preventScroll: true }); } catch (err) { try { el.focus(); } catch (e2) {} }
            }, 0);
        });

        /* ==================== 本地缓存 ==================== */
        async function loadLocalDocs() {
            let rawDocs = [];
            try {
                const cached = await idbGet('kb_docs_index');
                if (Array.isArray(cached)) rawDocs = cached;
            } catch (e) { console.warn('IndexedDB 读取失败', e); }
            rawDocs.forEach(d => {
                if (!d.code || !d.code.startsWith('CM-')) d.code = generateDocCode();
                if (!Array.isArray(d.attachments)) d.attachments = [];
                if (typeof d.summary !== 'string') d.summary = '';
                if (d.hasContent === undefined) d.hasContent = true;
            });
            docs = rawDocs;
        }

        function saveLocalDocs() {
            renderCategoryList();
            renderTagList();
            renderDocList();
            idbSet('kb_docs_index', docs).catch(e => console.warn('IndexedDB 写入失败', e));
        }

        function generateDocCode() { return 'CM-' + Math.floor(1000 + Math.random() * 9000); }

        /* ==================== 渲染（移动端深色 / PC 浅灰侧边栏） ==================== */
        function renderCategoryList() {
            const categories = {};
            docs.forEach(d => {
                const cat = d.category || '通用';
                categories[cat] = (categories[cat] || 0) + 1;
            });
            // 当前选中的分类已被删除/改名时，回退到“全部条目”，避免列表永远为空
            if (activeCategory !== 'ALL' && !categories[activeCategory]) {
                activeCategory = 'ALL';
                activeTag = null;
            }
            document.getElementById('allCount').textContent = docs.length;

            const allNavBtn = document.getElementById('allDocsNavBtn');
            const allCountEl = document.getElementById('allCount');
            const isAllActive = (activeCategory === 'ALL' && !activeTag);

            if (isAllActive) {
                allNavBtn.className = 'nav-filter-btn active w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[14px] font-medium bg-brand-500/20 text-brand-200 ring-1 ring-inset ring-brand-500/30 transition lg:bg-brand-50 lg:text-brand-700 lg:ring-brand-200 lg:shadow-sm';
                if (allCountEl) allCountEl.className = 'text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums bg-brand-500 text-white';
            } else {
                allNavBtn.className = 'nav-filter-btn w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[14px] font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white transition lg:text-slate-700 lg:hover:bg-white/70 lg:hover:text-slate-900';
                if (allCountEl) allCountEl.className = 'text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums bg-slate-700/70 text-slate-300 lg:bg-white/80 lg:text-slate-600 lg:ring-1 lg:ring-inset lg:ring-slate-300/70';
            }

            const catListEl = document.getElementById('categoryList');
            catListEl.innerHTML = '';
            allNavBtn.onclick = () => {
                activeCategory = 'ALL'; activeTag = null;
                if (window.innerWidth < 768) { currentDocId = null; document.getElementById('mainPanel').classList.add('hidden'); }
                renderCategoryList(); renderTagList(); renderDocList();
                if (virtualList.container) virtualList.container.scrollTop = 0;
                const sidebarScroll = document.getElementById('sidebarScrollContainer');
                if (sidebarScroll) sidebarScroll.scrollTop = 0;
                closeMobileSidebar();
            };

            Object.entries(categories).forEach(([cat, count]) => {
                const btn = document.createElement('button');
                const isSelected = (activeCategory === cat && !activeTag);
                btn.className = `w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-[14px] font-medium transition ${
                    isSelected
                        ? 'bg-brand-500/20 text-brand-200 ring-1 ring-inset ring-brand-500/30 lg:bg-brand-50 lg:text-brand-700 lg:ring-brand-200 lg:shadow-sm'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white lg:text-slate-700 lg:hover:bg-white/70 lg:hover:text-slate-900'
                }`;
                btn.innerHTML = `
                    <span class="truncate min-w-0">${escapeHtml(cat)}</span>
                    <span class="flex-shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${
                        isSelected
                            ? 'bg-brand-500 text-white'
                            : 'bg-slate-700/70 text-slate-300 lg:bg-white/80 lg:text-slate-600 lg:ring-1 lg:ring-inset lg:ring-slate-300/70'
                    }">${count}</span>
                `;
                btn.onclick = () => {
                    activeCategory = cat; activeTag = null;
                    if (window.innerWidth < 768) { currentDocId = null; document.getElementById('mainPanel').classList.add('hidden'); }
                    renderCategoryList(); renderTagList(); renderDocList();
                    if (virtualList.container) virtualList.container.scrollTop = 0;
                    const sidebarScroll = document.getElementById('sidebarScrollContainer');
                    if (sidebarScroll) sidebarScroll.scrollTop = 0;
                    closeMobileSidebar();
                };
                catListEl.appendChild(btn);
            });
        }

        function renderTagList() {
            const tags = new Set();
            docs.forEach(d => (d.tags || []).forEach(t => tags.add(t)));
            const tagListEl = document.getElementById('tagList');
            tagListEl.innerHTML = '';
            tags.forEach(t => {
                const badge = document.createElement('span');
                const isSelected = (activeTag === t);
                badge.className = `inline-flex items-center px-2.5 py-1 text-[12px] font-medium rounded-md cursor-pointer transition ${
                    isSelected
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'bg-slate-700 text-slate-200 ring-1 ring-inset ring-slate-600 hover:bg-slate-600 hover:text-white lg:bg-white lg:text-slate-700 lg:ring-slate-300 lg:hover:bg-slate-100 lg:hover:text-slate-900'
                }`;
                badge.textContent = `# ${t}`;
                badge.onclick = () => {
                    activeTag = activeTag === t ? null : t;
                    if (activeTag) activeCategory = 'ALL';
                    if (window.innerWidth < 768) { currentDocId = null; document.getElementById('mainPanel').classList.add('hidden'); }
                    renderCategoryList(); renderTagList(); renderDocList();
                    if (virtualList.container) virtualList.container.scrollTop = 0;
                    const sidebarScroll = document.getElementById('sidebarScrollContainer');
                    if (sidebarScroll) sidebarScroll.scrollTop = 0;
                    closeMobileSidebar();
                };
                tagListEl.appendChild(badge);
            });
        }

        function renderDocList() {
            const query = (searchQuery || '').toLowerCase();
            const filtered = docs.filter(d => {
                const title = (d.title || '').toLowerCase();
                const summary = (d.summary || '').toLowerCase();
                const code = (d.code || '').toLowerCase();
                const matchSearch = !query || title.includes(query) || summary.includes(query) || code.includes(query) || (d.tags && d.tags.some(t => t.toLowerCase().includes(query)));
                const matchCat = activeCategory === 'ALL' || (d.category || '通用') === activeCategory;
                const matchTag = !activeTag || (d.tags && d.tags.includes(activeTag));
                return matchSearch && matchCat && matchTag;
            });
            // 紧急通知置顶
            filtered.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
            const listTitleEl = document.getElementById('listTitle');
            if (searchQuery) listTitleEl.textContent = `搜索: "${searchQuery}"`;
            else if (activeTag) listTitleEl.textContent = `# ${activeTag}`;
            else if (activeCategory !== 'ALL') listTitleEl.textContent = activeCategory;
            else listTitleEl.textContent = '所有条目';
            document.getElementById('docCountText').textContent = `${filtered.length} 个文档`;
            renderVirtualList(filtered);

            if (typeof window.checkBackToTopBtnVisibility === 'function') {
                window.checkBackToTopBtnVisibility();
            } else {
                if (document.getElementById('mainPanel').classList.contains('hidden')) {
                    const btn = document.getElementById('backToTopBtn');
                    if (btn) btn.classList.add('hidden');
                }
            }
        }

        function performSearch() {
            searchQuery = (document.getElementById('searchInput').value || '').trim();
            // 编辑中不要因为搜索而把编辑面板收起来，避免未保存内容“凭空消失”
            if (window.innerWidth < 768 && !isEditing) {
                currentDocId = null;
                previousDocId = null;
                document.getElementById('mainPanel').classList.add('hidden');
            }
            renderDocList();
            if (virtualList.container) virtualList.container.scrollTop = 0;
        }

        function renderEditAttachments() {
            const container = document.getElementById('editAttachmentsList');
            if (!container) return;
            if (!editAttachments.length) {
                container.innerHTML = '<div class="sm:col-span-2 text-[12px] text-slate-400 py-1 px-1">暂无附件，可点击上方“上传附件”添加</div>';
                return;
            }
            container.innerHTML = editAttachments.map((att, i) => `
                <div class="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div class="flex items-center space-x-2.5 min-w-0 flex-1">
                        <div class="w-8 h-8 rounded-lg ${getAttachIconBg(att.type)} flex items-center justify-center flex-shrink-0">
                            <i class="${getAttachIcon(att.type)} text-base"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="text-[13px] font-medium text-slate-700 truncate" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</div>
                            <div class="text-[11px] text-slate-400">${formatSize(att.size)}</div>
                        </div>
                    </div>
                    <button type="button" data-att-index="${i}" class="delete-att-btn w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition flex-shrink-0 ml-2">
                        <i class="ri-close-line text-sm"></i>
                    </button>
                </div>
            `).join('');
            container.querySelectorAll('.delete-att-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-att-index'), 10);
                    deleteEditAttachment(idx);
                });
            });
        }

        /* ==================== 编辑/预览切换 ==================== */
        function setPreviewMode(on) {
            const textarea = document.getElementById('editContentInput');
            const preview = document.getElementById('editPreview');
            const btnText = document.getElementById('togglePreviewText');
            const icon = document.getElementById('togglePreviewIcon');
            const tipEl = document.getElementById('uploadStatusTip');
            if (!textarea || !preview) return;
            isPreviewMode = !!on;
            if (isPreviewMode) {
                textarea.classList.add('hidden');
                preview.classList.remove('hidden');
                if (btnText) btnText.textContent = '编辑';
                if (icon) icon.className = 'ri-edit-line';
                if (tipEl) tipEl.textContent = 'Markdown 预览';
                renderMarkdownInto(preview, textarea.value).catch(e => console.warn('预览渲染失败', e));
            } else {
                preview.classList.add('hidden');
                preview.innerHTML = '';
                textarea.classList.remove('hidden');
                if (btnText) btnText.textContent = '预览';
                if (icon) icon.className = 'ri-eye-line';
                if (tipEl) tipEl.textContent = 'Markdown 源码（支持粘贴截图）';
            }
        }

        function renderViewAttachments() {
            const container = document.getElementById('viewAttachments');
            const doc = docs.find(d => d.id === currentDocId);
            const atts = (doc && doc.attachments) || [];
            if (!atts.length) { container.innerHTML = ''; return; }
            container.innerHTML = `
                <div class="mt-10 pt-6 border-t border-slate-200">
                    <h3 class="text-[15px] font-bold text-slate-800 mb-4 flex items-center space-x-2">
                        <i class="ri-attachment-2 text-base text-slate-500"></i>
                        <span>附件</span>
                        <span class="text-[11px] font-normal text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">${atts.length}</span>
                    </h3>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        ${atts.map((att, i) => `
                            <button type="button" data-att-index="${i}" class="download-att-btn flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-brand-300 hover:bg-brand-50/50 active:scale-[0.99] transition text-left group">
                                <div class="flex items-center space-x-3 min-w-0 flex-1">
                                    <div class="w-9 h-9 rounded-lg ${getAttachIconBg(att.type)} flex items-center justify-center flex-shrink-0">
                                        <i class="${getAttachIcon(att.type)} text-lg"></i>
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="text-[13px] font-medium text-slate-700 truncate" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</div>
                                        <div class="text-[11px] text-slate-400 mt-0.5">${formatSize(att.size)}</div>
                                    </div>
                                </div>
                                <i class="ri-download-line text-slate-400 group-hover:text-brand-600 transition flex-shrink-0 ml-2"></i>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
            container.querySelectorAll('.download-att-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-att-index'), 10);
                    downloadAttachment(idx);
                });
            });
        }
