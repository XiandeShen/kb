/* 椿沐智库 · 登录与同步：Token 配置、校验、拉取/推送、启动入口 */

/* ==================== 登录 & 同步 ==================== */
        // 去掉粘贴时常见的空白、零宽字符、引号，以及误带上的 "Bearer "/"token " 前缀
        function normalizeToken(raw) {
            let s = String(raw || '').trim();
            s = s.replace(/^['"“”]+|['"“”]+$/g, '');
            s = s.replace(/^(?:Bearer|token)\s+/i, '');
            s = s.replace(/[\s​-‍﻿]/g, '');
            return s;
        }

        function loadGithubConfig() {
            const saved = localStorage.getItem('kb_gh_config');
            if (saved) {
                try { githubConfig = JSON.parse(saved); }
                catch (e) { githubConfig = { token: '', repo: 'XiandeShen/Xiande-kb', path: 'kb_docs.json', sha: '' }; }
                githubConfig.token = normalizeToken(githubConfig.token);
                if (!githubConfig.repo) githubConfig.repo = 'XiandeShen/Xiande-kb';
                if (!githubConfig.path) githubConfig.path = 'kb_docs.json';
            }
        }

        function openGithubConfigModal() {
            document.getElementById('githubDropdown').classList.add('hidden');
            document.getElementById('ghTokenInput').value = githubConfig.token;
            document.getElementById('ghRepoInput').value = githubConfig.repo || 'XiandeShen/Xiande-kb';
            document.getElementById('ghPathInput').value = githubConfig.path || 'kb_docs.json';
            const statusEl = document.getElementById('verifyTokenStatus');
            if (statusEl) statusEl.classList.add('hidden');
            document.getElementById('githubModal').classList.remove('hidden');
        }

        // 用输入框里的 Token 实测「有效性 + 仓库写权限」，避免保存后才发现失败
        async function verifyGithubToken() {
            const statusEl = document.getElementById('verifyTokenStatus');
            const token = normalizeToken(document.getElementById('ghTokenInput').value);
            const repo = document.getElementById('ghRepoInput').value.trim() || githubConfig.repo;
            const showStatus = (text, ok) => {
                statusEl.textContent = text;
                statusEl.className = `mt-1.5 text-[12px] leading-relaxed ${ok ? 'text-emerald-600' : 'text-red-500'}`;
            };
            if (!token) { showStatus('请先填写 Token。', false); return; }
            if (!repo || !/^[^\/]+\/[^\/]+$/.test(repo)) { showStatus('仓库路径格式应为 Owner/Repo。', false); return; }
            showStatus('正在验证 Token…', true);
            try {
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
                });
                if (userRes.status === 401) {
                    showStatus('Token 无效或已过期（401 Bad credentials），请重新生成。', false);
                    return;
                }
                if (!userRes.ok) {
                    showStatus(await githubErrorText(userRes, 'Token 验证失败'), false);
                    return;
                }
                const user = await userRes.json();

                const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' }
                });
                if (repoRes.status === 404) {
                    showStatus(`Token 有效（${user.login}），但无法访问仓库 ${repo}；请检查仓库名，或把该仓库加入 Token 的 Repository access。`, false);
                    return;
                }
                if (!repoRes.ok) {
                    showStatus(await githubErrorText(repoRes, '读取仓库失败'), false);
                    return;
                }
                const repoData = await repoRes.json();
                const canWrite = !!(repoData.permissions && repoData.permissions.push);
                if (canWrite) {
                    showStatus(`验证通过：Token 属于 ${user.login}，对 ${repoData.full_name} 有写权限，可以上传。`, true);
                } else {
                    showStatus(`Token 有效（${user.login}），但对 ${repoData.full_name} 没有写权限；请把 Contents 设为 Read and write 后重新生成 Token。`, false);
                }
            } catch (e) {
                showStatus('验证失败：' + (e.message || '网络异常'), false);
            }
        }

        function updateSyncStatus(type, msg) {
            const dot = document.getElementById('syncDot');
            const text = document.getElementById('syncText');
            const refreshIcon = document.getElementById('syncRefreshIcon');
            if (!dot || !text) return;
            if (type === 'success') {
                dot.className = 'w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0';
                text.textContent = msg || '已同步';
                if (refreshIcon) refreshIcon.classList.remove('animate-spin');
            } else if (type === 'loading') {
                dot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0';
                text.textContent = msg || '同步中';
                if (refreshIcon) refreshIcon.classList.add('animate-spin');
            } else {
                dot.className = 'w-2 h-2 rounded-full bg-red-500 flex-shrink-0';
                text.textContent = msg || '同步失败';
                if (refreshIcon) refreshIcon.classList.remove('animate-spin');
            }
        }

        function manualSyncRefresh() {
            if (isManualSyncing) return;
            if (!githubConfig.token || !githubConfig.repo) { showToast('请先配置访问令牌', 'error'); return; }
            isManualSyncing = true;
            const mobileBtn = document.getElementById('mobileRefreshBtn');
            const mobileIcon = document.getElementById('mobileRefreshIcon');
            if (mobileBtn) mobileBtn.classList.add('opacity-50', 'pointer-events-none');
            if (mobileIcon) mobileIcon.classList.add('animate-spin');
            pullFromGithub()
                .then((ok) => {
                    // 失败时 pullFromGithub 已给出错误提示，这里只在成功时提示同步完成
                    if (ok) showToast('同步完成', 'success');
                })
                .catch(() => {})
                .finally(() => {
                    isManualSyncing = false;
                    if (mobileBtn) mobileBtn.classList.remove('opacity-50', 'pointer-events-none');
                    if (mobileIcon) mobileIcon.classList.remove('animate-spin');
                });
        }

        async function handleResetBinding() {
            const ok = await showConfirm({
                title: '解除绑定并重置',
                desc: '确定要解除 GitHub 绑定并重置吗？本地的知识缓存也会被清空，需要重新输入访问令牌。',
                okText: '确定重置', cancelText: '再想想', type: 'normal'
            });
            if (!ok) return;
            localStorage.removeItem('kb_gh_config');
            await idbDel('kb_docs_index');
            docs = [];
            clearAllCaches();
            currentDocId = null;
            previousDocId = null;
            localStorage.removeItem(LAST_DOC_KEY);
            beginEditSession();
            editAttachments = [];
            searchQuery = '';
            repoDefaultBranch = '';
            githubConfig = { token: '', repo: 'XiandeShen/Xiande-kb', path: 'kb_docs.json', sha: '' };
            document.getElementById('authTokInput').value = '';
            document.getElementById('searchInput').value = '';
            document.getElementById('githubDropdown').classList.add('hidden');
            hideLoading();
            hideApp();
            fillAdvancedOptions();
            showAuth();
            renderCategoryList();
            renderTagList();
            renderDocList();
        }

        window.onload = async function() {
            loadGithubConfig();
            setupConfirmModal();
            setupAdvancedToggle();
            setupEventListeners();
            setupImageHandling();
            setupImageViewerModal();
            setupGlobalBackToTop();
            initVirtualList();
            updateSearchPlaceholder();
            window.addEventListener('resize', updateSearchPlaceholder);
            // Via 等 WebView 可能在 load 之后才把窗口焦点还给页面，多次尝试更稳
            [0, 250, 900].forEach((ms) => setTimeout(regainWindowFocus, ms));

            if (!githubConfig.token) {
                hideApp();
                document.getElementById('loadingOverlay').classList.add('hidden');
                fillAdvancedOptions();
                showAuth();
                // 登录页同样需要窗口焦点，否则 Via 刷新后第一次点 Token 输入框可能无反应
                setTimeout(regainWindowFocus, 0);
                return;
            }

            hideAuth();
            setLoadingMode('auth');
            document.getElementById('loadingOverlay').classList.remove('hidden');
            updateLoadingText(DEFAULT_LOADING_TEXT);

            await loadLocalDocs();
            renderCategoryList();
            renderTagList();
            renderDocList();

            pullFromGithub();
            setTimeout(regainWindowFocus, 0);
        };

        document.getElementById('toggleTokenVisibility').addEventListener('click', () => {
            const input = document.getElementById('authTokInput');
            const icon = document.getElementById('toggleTokenIcon');
            if (input.type === 'password') { input.type = 'text'; icon.className = 'ri-eye-off-line text-base'; }
            else { input.type = 'password'; icon.className = 'ri-eye-line text-base'; }
        });

        document.getElementById('authForm').addEventListener('submit', (e) => {
            e.preventDefault();
            if (isLoggingIn) return;
            const token = normalizeToken(document.getElementById('authTokInput').value);
            if (!token) { showToast('请输入访问令牌', 'error'); return; }
            const repoInput = document.getElementById('authRepoInput').value.trim();
            const pathInput = document.getElementById('authPathInput').value.trim();
            githubConfig.token = token;
            githubConfig.repo = repoInput || githubConfig.repo || 'XiandeShen/Xiande-kb';
            githubConfig.path = pathInput || githubConfig.path || 'kb_docs.json';
            githubConfig.sha = '';
            repoDefaultBranch = '';
            localStorage.setItem('kb_gh_config', JSON.stringify(githubConfig));
            isLoggingIn = true;
            setLoginButtonLoading(true);
            pullFromGithub();
        });

        async function pullFromGithub() {
            if (!githubConfig.token || !githubConfig.repo) {
                if (isLoggingIn) { isLoggingIn = false; setLoginButtonLoading(false); }
                else { hideLoading(); hideApp(); fillAdvancedOptions(); showAuth(); }
                return false;
            }
            updateSyncStatus('loading', '同步中');

            try {
                let sha, text;
                try {
                    const result = await fetchGithubJSONWithMeta(githubConfig.path);
                    sha = result.sha;
                    text = result.text;
                } catch (metaErr) {
                    if (metaErr.status === 404) {
                        setLoadingMode('auth');
                        showLoading('正在初始化知识库...');
                        docs = [];
                        clearAllCaches();
                        try {
                            await uploadMainIndex([]);
                        } catch (initErr) {
                            // 空索引初始化失败（常见于 Token 无写权限），给出明确提示并退回登录页
                            console.warn('初始化空索引失败', initErr);
                            updateSyncStatus('error', '初始化失败');
                            showToast('空索引初始化失败：请确认 Token 拥有该仓库的写入权限', 'error');
                            hideLoading();
                            if (isLoggingIn) { isLoggingIn = false; setLoginButtonLoading(false); }
                            hideApp();
                            fillAdvancedOptions();
                            showAuth();
                            return false;
                        }
                        hideLoading();
                        hideAuth();
                        showApp();
                        saveLocalDocs();
                        if (isLoggingIn) { isLoggingIn = false; setLoginButtonLoading(false); }
                        return true;
                    }
                    throw metaErr;
                }

                githubConfig.sha = sha;
                // 重新同步后本地缓存可能已过期，清空正文与图片缓存
                clearAllCaches();
                let rawDocs = JSON.parse(text) || [];
                rawDocs.forEach(d => {
                    if (!d.code || !d.code.startsWith('CM-')) d.code = generateDocCode();
                    if (!Array.isArray(d.attachments)) d.attachments = [];
                    if (typeof d.summary !== 'string') d.summary = '';
                    if (d.hasContent === undefined) d.hasContent = true;
                });
                docs = rawDocs;
                // 进入页面时如有紧急通知，默认回到“全部条目”，确保通知卡片可见
                if (!urgentDefaultApplied && docs.some(d => d && d.urgent)) {
                    urgentDefaultApplied = true;
                    activeCategory = 'ALL';
                    activeTag = null;
                    if (virtualList.container) virtualList.container.scrollTop = 0;
                }
                hideLoading();
                hideAuth();
                showApp();
                saveLocalDocs();
                updateSyncStatus('success', '已同步');
                renderCategoryList();
                renderTagList();
                renderDocList();
                if (isLoggingIn) { isLoggingIn = false; setLoginButtonLoading(false); }
                // 刷新/同步后自动恢复或刷新当前文档，无需再次点击列表
                await maybeRestoreDocView();
                return true;
            } catch (e) {
                const status = e.status;
                if (status === 401 || status === 403) {
                    docs = [];
                    clearAllCaches();
                    await idbDel('kb_docs_index');
                    renderCategoryList();
                    renderTagList();
                    renderDocList();
                    updateSyncStatus('error', 'Token 错误');
                    showToast('访问令牌认证失败，请重新输入', 'error');
                    hideLoading();
                    if (isLoggingIn) { isLoggingIn = false; setLoginButtonLoading(false); }
                    else { hideApp(); fillAdvancedOptions(); showAuth(); }
                } else {
                    updateSyncStatus('error', '网络异常');
                    hideLoading();
                    if (isLoggingIn) { isLoggingIn = false; setLoginButtonLoading(false); }
                    else { hideApp(); fillAdvancedOptions(); showAuth(); }
                }
                return false;
            }
        }
