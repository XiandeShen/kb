/* 椿沐智库 · 事件绑定：搜索、新建/编辑/保存/删除、仓库配置、侧栏、快捷键 */

/* ==================== 事件 ==================== */
        function setupEventListeners() {
            const searchInput = document.getElementById('searchInput');
            const clearSearchBtn = document.getElementById('clearSearchBtn');
            const headerEl = document.querySelector('header');
            const searchWrap = document.getElementById('searchWrap');
            const mobileSearchBtn = document.getElementById('mobileSearchBtn');
            const mobileSearchBackBtn = document.getElementById('mobileSearchBackBtn');

            const openMobileSearch = () => {
                if (!searchWrap) return;
                headerEl.classList.add('mobile-search-open');
                // 保留/恢复当前搜索词，避免收起后丢失
                if (searchQuery && !searchInput.value) searchInput.value = searchQuery;
                clearSearchBtn.classList.toggle('hidden', !searchInput.value);
                // 必须在点击手势内同步聚焦，否则 iOS/部分 WebView 不会弹出键盘
                try { searchInput.focus({ preventScroll: true }); } catch (e) { searchInput.focus(); }
                requestAnimationFrame(() => {
                    if (document.activeElement !== searchInput) {
                        try { searchInput.focus({ preventScroll: true }); } catch (e) {}
                    }
                });
            };
            const closeMobileSearch = (clear = false) => {
                headerEl.classList.remove('mobile-search-open');
                searchInput.blur();
                if (clear) {
                    // 退出搜索即恢复完整列表，避免搜索框隐藏后还残留筛选状态
                    clearTimeout(searchDebounceTimer);
                    searchInput.value = '';
                    clearSearchBtn.classList.add('hidden');
                    if (searchQuery) {
                        searchQuery = '';
                        renderDocList();
                        if (virtualList.container) virtualList.container.scrollTop = 0;
                    }
                }
            };
            if (mobileSearchBtn) {
                mobileSearchBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openMobileSearch();
                });
            }
            if (mobileSearchBackBtn) {
                mobileSearchBackBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeMobileSearch(true);
                });
            }
            // 点击搜索框外的区域（如列表卡片）时自动收起移动端搜索
            document.addEventListener('click', (e) => {
                if (!headerEl.classList.contains('mobile-search-open')) return;
                if (searchWrap && searchWrap.contains(e.target)) return;
                closeMobileSearch(true);
            });
            window.addEventListener('resize', () => {
                if (window.innerWidth >= 640) closeMobileSearch(false);
            });

            let searchComposing = false;
            const syncClearSearchBtn = () => {
                clearSearchBtn.classList.toggle('hidden', !searchInput.value);
            };
            const scheduleSearch = (delay = 150) => {
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(() => performSearch(), delay);
            };

            searchInput.addEventListener('input', (e) => {
                syncClearSearchBtn();
                // 输入法组词期间先不检索，等 compositionend 再触发
                if (searchComposing || (e && e.isComposing)) return;
                scheduleSearch();
            });
            // PC 端部分输入法在组词结束后不会再补发可用的 input 事件，这里兜底
            searchInput.addEventListener('compositionstart', () => { searchComposing = true; });
            searchInput.addEventListener('compositionend', () => {
                searchComposing = false;
                syncClearSearchBtn();
                scheduleSearch(30);
            });
            // 极少数浏览器/输入法组合下 input 不触发，keyup 再兜一层
            searchInput.addEventListener('keyup', (e) => {
                if (searchComposing || e.isComposing) return;
                if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') return;
                if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                    syncClearSearchBtn();
                    scheduleSearch();
                }
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    clearTimeout(searchDebounceTimer);
                    performSearch();
                } else if (e.key === 'Escape' && headerEl.classList.contains('mobile-search-open')) {
                    e.preventDefault();
                    closeMobileSearch(true);
                }
            });
            clearSearchBtn.onclick = () => {
                clearTimeout(searchDebounceTimer);
                searchInput.value = '';
                clearSearchBtn.classList.add('hidden');
                searchQuery = '';
                renderDocList();
                if (virtualList.container) virtualList.container.scrollTop = 0;
                searchInput.focus();
            };

            const syncRefreshBtn = document.getElementById('syncRefreshBtn');
            if (syncRefreshBtn) {
                syncRefreshBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); manualSyncRefresh(); });
            }
            // 移动端/已安装 PWA 没有浏览器刷新按钮，用顶栏图标手动同步
            const mobileRefreshBtn = document.getElementById('mobileRefreshBtn');
            if (mobileRefreshBtn) {
                mobileRefreshBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); manualSyncRefresh(); });
            }

            const togglePreviewBtn = document.getElementById('togglePreviewBtn');
            if (togglePreviewBtn) togglePreviewBtn.onclick = () => setPreviewMode(!isPreviewMode);

            document.getElementById('newDocBtn').onclick = async () => {
                // 若当前正处于编辑中，先作废该会话并清理已上传但未保存的文件，避免遗留孤儿文件
                if (isEditing) await discardEditSessionUploads(true);
                else beginEditSession();
                previousDocId = currentDocId || null;
                currentDocId = null;
                isEditing = true;
                editAttachments = [];
                renderDocList();
                if (virtualList.container) virtualList.container.scrollTop = 0;
                const mainPanel = document.getElementById('mainPanel');
                mainPanel.classList.remove('hidden');
                document.getElementById('emptyState').classList.add('hidden');
                document.getElementById('viewPanel').classList.add('hidden');
                document.getElementById('editPanel').classList.remove('hidden');
                document.getElementById('editorModeTitle').textContent = '新建知识条目';
                document.getElementById('editTitleInput').value = '';
                document.getElementById('editCategoryInput').value = activeCategory !== 'ALL' ? activeCategory : '通用';
                document.getElementById('editTagsInput').value = '';
                document.getElementById('editUrgentInput').checked = false;
                document.getElementById('editContentInput').value = '';
                renderEditAttachments();
                setPreviewMode(false);
                closeMobileSidebar();
                checkBackToTopBtnVisibility();
            };

            document.getElementById('editDocBtn').onclick = async () => {
                const doc = docs.find(d => d.id === currentDocId);
                if (!doc) return;
                beginEditSession();
                isEditing = true;
                editAttachments = (doc.attachments || []).map(a => ({...a}));
                // 编辑面板优先使用已缓存的正文，避免每次点击编辑都重新请求 GitHub
                let content = docContentCache.get(currentDocId);
                if (content === undefined) {
                    try { content = await fetchDocContent(currentDocId, doc.updatedAt); } catch (e) { content = ''; }
                }
                document.getElementById('viewPanel').classList.add('hidden');
                document.getElementById('editPanel').classList.remove('hidden');
                document.getElementById('editorModeTitle').textContent = '编辑文章';
                document.getElementById('editTitleInput').value = doc.title || '';
                document.getElementById('editCategoryInput').value = doc.category || '通用';
                document.getElementById('editTagsInput').value = (doc.tags || []).join(' ');
                document.getElementById('editUrgentInput').checked = !!doc.urgent;
                document.getElementById('editContentInput').value = content;
                renderEditAttachments();
                setPreviewMode(false);
                checkBackToTopBtnVisibility();
            };

            const handleCancelEdit = async () => {
                // 取消 = 放弃本次编辑：删除本次会话已上传但未保存的图片/附件，
                // 并作废仍在进行中的上传（迟到结果会自动清理），已保存的内容不受影响
                await discardEditSessionUploads(true);
                editAttachments = [];
                isEditing = false;
                setPreviewMode(false);
                if (previousDocId && docs.some(d => d.id === previousDocId)) {
                    openDocView(previousDocId);
                } else {
                    currentDocId = null;
                    document.getElementById('editPanel').classList.add('hidden');
                    document.getElementById('viewPanel').classList.add('hidden');
                    if (window.innerWidth < 768) document.getElementById('mainPanel').classList.add('hidden');
                    else document.getElementById('emptyState').classList.remove('hidden');
                    renderDocList();
                    if (virtualList.container) virtualList.container.scrollTop = 0;
                }
                checkBackToTopBtnVisibility();
            };
            document.getElementById('cancelEditBtn').onclick = handleCancelEdit;
            document.getElementById('desktopCancelEditBtn').onclick = handleCancelEdit;

            document.getElementById('backToListBtn').onclick = () => {
                currentDocId = null;
                previousDocId = null;
                localStorage.removeItem(LAST_DOC_KEY);
                document.getElementById('mainPanel').classList.add('hidden');
                renderDocList();
                if (virtualList.container) virtualList.container.scrollTop = 0;
                checkBackToTopBtnVisibility();
            };

            document.getElementById('saveDocBtn').onclick = async () => {
                if (isSavingDoc) return;
                const title = document.getElementById('editTitleInput').value.trim() || '未命名文章';
                const category = document.getElementById('editCategoryInput').value.trim() || '通用';
                const tagsStr = document.getElementById('editTagsInput').value.trim();
                const tags = tagsStr ? tagsStr.split(/[,，\s]+/).filter(Boolean) : [];
                const urgent = document.getElementById('editUrgentInput').checked;
                const content = document.getElementById('editContentInput').value;
                const now = new Date().toLocaleString();

                let docId = currentDocId;
                const isNewDoc = !docId;
                // 注意：先完成远端写入，成功后才更新本地状态，避免“本地已保存、远端失败”的假成功
                let contentUploaded = false;
                if (!docId) docId = 'doc-' + Date.now();

                isSavingDoc = true;
                showLoading('正在保存并同步...');
                try {
                    const existingDoc = !isNewDoc ? docs.find(d => d.id === docId) : null;

                    updateLoadingText('正在保存正文...');
                    await uploadDocContent(docId, content, { title, updatedAt: now });
                    contentUploaded = true;

                    const indexEntry = {
                        id: docId,
                        code: (existingDoc && existingDoc.code) || generateDocCode(),
                        title, category, tags, updatedAt: now,
                        summary: makeSummary(content),
                        attachments: editAttachments.slice(),
                        hasContent: true,
                        urgent
                    };
                    const nextDocs = docs.slice();
                    const idx = nextDocs.findIndex(d => d.id === docId);
                    if (idx >= 0) nextDocs[idx] = indexEntry;
                    else nextDocs.unshift(indexEntry);

                    updateLoadingText('正在同步索引...');
                    await uploadMainIndex(nextDocs);

                    // 远端全部成功后再落地本地状态
                    docs = nextDocs;
                    docContentCache.set(docId, content);
                    docContentStamp.set(docId, now);
                    currentDocId = docId;
                    previousDocId = docId;
                    saveLocalDocs();

                    // 保存成功后再真正清理：编辑中移除的旧附件，以及上传后未被正文引用的图片
                    const removedAttachments = pendingDeletedAttachments.slice();
                    const uploadedThisSession = pendingUploads.slice();
                    beginEditSession();
                    if (removedAttachments.length) {
                        updateLoadingText('正在清理已移除的附件...');
                        await deleteGithubAttachments(removedAttachments);
                    }
                    const orphanImages = uploadedThisSession.filter(u => u.type === 'image' && !content.includes(u.path));
                    if (orphanImages.length) {
                        updateLoadingText('正在清理未引用的图片...');
                        await Promise.allSettled(orphanImages.map(u => deleteGithubFileByPath(u.path)));
                    }

                    editAttachments = [];
                    setPreviewMode(false);
                    await openDocView(docId, { skipOverlay: true });
                    showToast('保存成功并已同步', 'success');
                } catch (err) {
                    // 新建文档正文已上传但索引失败时，清理这次产生的正文文件，避免遗留孤儿
                    if (isNewDoc && contentUploaded) {
                        try { await deleteDocContentFile(docId); } catch (e) {}
                        docContentCache.delete(docId);
                        docContentStamp.delete(docId);
                    }
                    showToast('保存失败，请重试', 'error');
                } finally { isSavingDoc = false; hideLoading(); }
            };

            document.getElementById('deleteDocBtn').onclick = async () => {
                const ok = await showConfirm({
                    title: '删除知识条目',
                    desc: '确定要删除这篇知识条目吗？关联的正文、独立图片 JSON 和附件会同步从 GitHub 中清理，此操作不可撤销。',
                    okText: '确定删除', cancelText: '取消', type: 'danger'
                });
                if (!ok) return;
                const docToDelete = docs.find(d => d.id === currentDocId);
                const docIdToDelete = currentDocId;
                if (!docToDelete || !docIdToDelete) return;
                showLoading('正在删除并同步...');
                let indexUpdated = false;
                try {
                    // 1. 先读取正文（只读），用于稍后清理内嵌图片
                    let content = '';
                    try { content = await fetchDocContent(docIdToDelete, docToDelete.updatedAt, true); } catch (e) { content = ''; }
                    const attachmentsToDelete = (docToDelete.attachments || [])
                        .filter(a => a && getAttachmentPaths(a).length > 0);

                    // 2. 先更新远端索引，让列表不再引用这篇文档；
                    //    失败时直接退出，不删除任何文件，远端与本地都保持原样
                    updateLoadingText('正在更新索引...');
                    const nextDocs = docs.filter(d => d.id !== docIdToDelete);
                    await uploadMainIndex(nextDocs);
                    indexUpdated = true;

                    // 3. 索引成功后才落地本地状态
                    docs = nextDocs;
                    docContentCache.delete(docIdToDelete);
                    docContentStamp.delete(docIdToDelete);
                    currentDocId = null;
                    previousDocId = null;
                    localStorage.removeItem(LAST_DOC_KEY);
                    beginEditSession();
                    editAttachments = [];
                    setPreviewMode(false);
                    saveLocalDocs();

                    // 4. 最后清理文件。即使清理失败也只会留下孤儿文件，
                    //    不会再出现“索引里有、正文 404”的不一致状态
                    updateLoadingText('正在清理关联文件...');
                    await Promise.allSettled([
                        deleteGithubImageJsonsInContent(content),
                        deleteGithubAttachments(attachmentsToDelete),
                        deleteDocContentFile(docIdToDelete)
                    ]);

                    document.getElementById('viewPanel').classList.add('hidden');
                    document.getElementById('editPanel').classList.add('hidden');
                    if (window.innerWidth < 768) document.getElementById('mainPanel').classList.add('hidden');
                    else document.getElementById('emptyState').classList.remove('hidden');
                    if (virtualList.container) virtualList.container.scrollTop = 0;
                    checkBackToTopBtnVisibility();
                    showToast('删除成功', 'success');
                } catch (err) {
                    if (indexUpdated) {
                        // 索引已更新，文档已从列表移除，只是文件清理出现异常
                        showToast('文档已删除，但部分关联文件清理失败，可稍后在 GitHub 中手动清理', 'error');
                    } else {
                        // 索引未更新：没有删除任何文件，也没有改动本地列表
                        showToast('删除失败，文档未删除，请检查网络或 Token 后重试', 'error');
                    }
                }
                finally { hideLoading(); }
            };

            const githubBtn = document.getElementById('githubConfigBtn');
            const githubDropdown = document.getElementById('githubDropdown');
            githubBtn.onclick = (e) => { e.stopPropagation(); githubDropdown.classList.toggle('hidden'); };
            document.addEventListener('click', (e) => {
                if (!githubBtn.contains(e.target) && !githubDropdown.contains(e.target)) githubDropdown.classList.add('hidden');
            });
            document.getElementById('menuConfigBtn').onclick = () => openGithubConfigModal();
            const installAppBtn = document.getElementById('installAppBtn');
            if (installAppBtn) {
                installAppBtn.onclick = async () => {
                    githubDropdown.classList.add('hidden');
                    if (!deferredInstallPrompt) {
                        showToast('请使用 Chrome，并通过 HTTPS 地址访问；然后在浏览器菜单中选择“安装应用/添加到主屏幕”', 'error');
                        return;
                    }
                    deferredInstallPrompt.prompt();
                    try { await deferredInstallPrompt.userChoice; } catch (e) {}
                    deferredInstallPrompt = null;
                    installAppBtn.classList.add('hidden');
                };
            }
            document.getElementById('menuResetBtn').onclick = () => handleResetBinding();
            document.getElementById('closeModalBtn').onclick = () => { document.getElementById('githubModal').classList.add('hidden'); };
            document.getElementById('verifyTokenBtn').onclick = () => verifyGithubToken();
            document.getElementById('ghTokenInput').addEventListener('input', () => {
                document.getElementById('verifyTokenStatus').classList.add('hidden');
            });
            document.getElementById('saveGithubConfigBtn').onclick = () => {
                githubConfig.token = normalizeToken(document.getElementById('ghTokenInput').value);
                githubConfig.repo = document.getElementById('ghRepoInput').value.trim() || 'XiandeShen/Xiande-kb';
                githubConfig.path = document.getElementById('ghPathInput').value.trim() || 'kb_docs.json';
                githubConfig.sha = '';
                repoDefaultBranch = '';
                localStorage.setItem('kb_gh_config', JSON.stringify(githubConfig));
                document.getElementById('githubModal').classList.add('hidden');
                showLoading(DEFAULT_LOADING_TEXT);
                pullFromGithub();
                showToast('GitHub 配置已保存', 'success');
            };

            const sidebar = document.getElementById('sidebar');
            const sidebarScroll = document.getElementById('sidebarScrollContainer');
            const overlay = document.getElementById('sidebarOverlay');
            document.getElementById('mobileMenuBtn').onclick = () => {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
                if (sidebarScroll) sidebarScroll.scrollTop = 0;
            };
            overlay.onclick = () => closeMobileSidebar();

            // 编辑快捷键：Ctrl/Cmd+S 保存，Esc 退出编辑
            document.addEventListener('keydown', (e) => {
                const editVisible = !document.getElementById('editPanel').classList.contains('hidden');
                const confirmVisible = !document.getElementById('confirmModal').classList.contains('hidden');
                const imageVisible = !document.getElementById('imageModal').classList.contains('hidden');
                const ghModalVisible = !document.getElementById('githubModal').classList.contains('hidden');

                if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
                    if (editVisible) {
                        e.preventDefault();
                        document.getElementById('saveDocBtn').click();
                    }
                    return;
                }

                if (e.key === 'Escape') {
                    if (confirmVisible || imageVisible) return; // 这些弹层已有各自的 Esc 处理
                    if (ghModalVisible) {
                        document.getElementById('githubModal').classList.add('hidden');
                        return;
                    }
                    if (editVisible) {
                        e.preventDefault();
                        document.getElementById('desktopCancelEditBtn').click();
                    }
                }
            });
        }
