/* 椿沐智库 · 文档查看：正文渲染、回到顶部、粘贴上传、图片 Markdown 插入、侧栏收起 */

/* ==================== 查看文档 ==================== */
        async function openDocView(id, options = {}) {
            // 手动同步后强制重新拉取当前正文，即使索引里的时间戳没有变化
            const skipCache = !!options.skipCache;
            currentDocId = id;
            previousDocId = id;
            isEditing = false;
            localStorage.setItem(LAST_DOC_KEY, id);
            const doc = docs.find(d => d.id === id);
            if (!doc) return;

            const renderToken = ++docViewRenderToken;
            const viewScrollEl = document.getElementById('viewScrollContainer');
            if (viewScrollEl) viewScrollEl.scrollTop = 0;

            // 先立即显示文章框架，不再等待正文/图片，避免整屏加载遮罩
            const mainPanel = document.getElementById('mainPanel');
            mainPanel.classList.remove('hidden');
            document.getElementById('emptyState').classList.add('hidden');
            document.getElementById('editPanel').classList.add('hidden');
            document.getElementById('viewPanel').classList.remove('hidden');

            document.getElementById('viewTitle').textContent = doc.title;
            document.getElementById('viewCategoryText').textContent = doc.category || '通用';
            const viewDateEl = document.getElementById('viewDate');
            viewDateEl.innerHTML = '<i class="ri-time-line mr-1"></i>';
            viewDateEl.appendChild(document.createTextNode(`修改于: ${doc.updatedAt || '未知'}`));

            document.getElementById('viewCodeText').textContent = doc.code || 'CM-0000';
            const codeBtn = document.getElementById('viewCodeBtn');
            const handleCodeCopy = (e) => {
                if (e) e.preventDefault();
                navigator.clipboard.writeText(doc.code || '').then(() => {
                    showToast(`已复制知识编码: ${doc.code}`, 'success');
                }).catch(() => { showToast(`已复制知识编码: ${doc.code}`, 'success'); });
                codeBtn.blur();
                codeBtn.classList.remove('active');
            };
            // 仅绑定 click：移动端浏览器会在 touchend 后补发 click，同时绑定会导致复制两次
            codeBtn.onclick = handleCodeCopy;

            const tagsContainer = document.getElementById('viewTags');
            tagsContainer.innerHTML = '';
            (doc.tags || []).forEach(t => {
                const tagEl = document.createElement('span');
                // 与时间、编码保持同一种纯文字样式，不加背景框
                tagEl.className = 'whitespace-nowrap text-[13px] text-slate-400';
                tagEl.textContent = `# ${t}`;
                tagsContainer.appendChild(tagEl);
            });

            // 附件等正文加载完整后再显示，避免附件先于正文出现
            document.getElementById('viewAttachments').innerHTML = '';
            renderDocList();

            // 正文区域先转圈，等正文和图片都加载完整后再一次性显示
            const viewContentEl = document.getElementById('viewContent');
            viewContentEl.classList.remove('doc-content-enter');
            viewContentEl.innerHTML = '';
            showLoading('正在加载文章...');

            let content = skipCache ? undefined : docContentCache.get(id);
            if (!skipCache && content !== undefined && docContentStamp.get(id) !== String(doc.updatedAt || '')) {
                content = undefined;
            }
            let loadError = false;
            try {
                if (content === undefined) {
                    try { content = await fetchDocContent(id, doc.updatedAt, skipCache); }
                    catch (e) {
                        loadError = true;
                        content = '';
                        showToast('正文加载失败：' + (e.message || '未知错误'), 'error');
                    }
                }
                // 用户可能已经切到别的文档，旧请求结果直接丢弃
                if (renderToken !== docViewRenderToken || currentDocId !== id) return;
                if (loadError) {
                    viewContentEl.innerHTML = '<div class="doc-loading-error">正文加载失败，请检查网络后重试</div>';
                } else {
                    const tempDiv = document.createElement('div');
                    // 等图片也加载完（或失败/超时）再显示，保证用户看到的是完整文档
                    await renderMarkdownInto(tempDiv, content || '', { awaitImages: true });
                    if (renderToken !== docViewRenderToken || currentDocId !== id) return;
                    viewContentEl.replaceChildren(...Array.from(tempDiv.childNodes));
                    viewContentEl.classList.add('doc-content-enter');
                }
                renderViewAttachments();
            } catch (e) {
                console.warn('正文渲染失败', e);
                viewContentEl.innerHTML = '<div class="doc-loading-error">正文渲染失败，请稍后重试</div>';
                renderViewAttachments();
                showToast('正文渲染失败', 'error');
            } finally {
                if (renderToken === docViewRenderToken && (currentDocId === id || !currentDocId)) hideLoading();
            }

            if (viewScrollEl) viewScrollEl.scrollTop = 0;
            checkBackToTopBtnVisibility();
        }

        // 同步完成后：刷新当前打开的文档，或恢复上次打开的文档（不打断编辑）
        async function maybeRestoreDocView() {
            if (isEditing) return;
            const targetId = currentDocId || localStorage.getItem(LAST_DOC_KEY);
            if (!targetId) return;

            // 进入页面时若存在紧急通知，优先停留在“全部条目”列表，不自动打开上次文档
            if (!currentDocId && docs.some(d => d && d.urgent)) return;

            if (!docs.some(d => d.id === targetId)) {
                localStorage.removeItem(LAST_DOC_KEY);
                if (currentDocId) {
                    currentDocId = null;
                    previousDocId = null;
                    document.getElementById('viewPanel').classList.add('hidden');
                    document.getElementById('editPanel').classList.add('hidden');
                    if (window.innerWidth < 768) document.getElementById('mainPanel').classList.add('hidden');
                    else document.getElementById('emptyState').classList.remove('hidden');
                    renderDocList();
                }
                return;
            }
            await openDocView(targetId, { skipCache: forceReloadDocOnSync });
        }

        function setupGlobalBackToTop() {
            const btn = document.getElementById('backToTopBtn');
            const viewScroll = document.getElementById('viewScrollContainer');
            const editScroll = document.getElementById('editScrollContainer');

            window.checkBackToTopBtnVisibility = function() {
                const mainPanel = document.getElementById('mainPanel');
                const viewPanel = document.getElementById('viewPanel');
                const editPanel = document.getElementById('editPanel');

                if (mainPanel.classList.contains('hidden')) {
                    btn.classList.add('hidden');
                    return;
                }

                const viewVisible = !viewPanel.classList.contains('hidden');
                const editVisible = !editPanel.classList.contains('hidden');
                if (!viewVisible && !editVisible) {
                    btn.classList.add('hidden');
                    return;
                }

                let currentScrollTop = 0;
                if (viewVisible) currentScrollTop = viewScroll.scrollTop;
                else if (editVisible) currentScrollTop = editScroll.scrollTop;

                if (currentScrollTop > 200) btn.classList.remove('hidden');
                else btn.classList.add('hidden');
            };

            viewScroll.addEventListener('scroll', checkBackToTopBtnVisibility);
            editScroll.addEventListener('scroll', checkBackToTopBtnVisibility);

            btn.onclick = () => {
                if (!document.getElementById('viewPanel').classList.contains('hidden')) {
                    viewScroll.scrollTo({ top: 0, behavior: 'smooth' });
                } else if (!document.getElementById('editPanel').classList.contains('hidden')) {
                    editScroll.scrollTo({ top: 0, behavior: 'smooth' });
                }
                btn.blur();
            };
        }
