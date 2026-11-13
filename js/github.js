/* 椿沐智库 · GitHub 存储：API 封装、文件读写、正文与主索引 */

/* ==================== GitHub 文件读写 ==================== */
        async function githubApi(path, options = {}) {
            const headers = {
                'Authorization': `Bearer ${githubConfig.token}`,
                'Accept': 'application/vnd.github+json',
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(options.headers || {})
            };
            return fetch(`https://api.github.com${path}`, { ...options, headers });
        }

        // 把 GitHub 返回的 message 一并带出，失败时用户能知道具体原因
        async function githubErrorText(res, fallback) {
            let msg = `${fallback} (${res.status})`;
            try {
                const data = await res.json();
                if (data && data.message) msg += '：' + data.message;
            } catch (e) {}
            return msg;
        }

        async function getRepoDefaultBranch() {
            if (repoDefaultBranch) return repoDefaultBranch;
            const res = await githubApi(`/repos/${githubConfig.repo}`);
            if (!res.ok) throw new Error(await githubErrorText(res, '获取仓库信息失败'));
            const data = await res.json();
            repoDefaultBranch = data.default_branch || 'main';
            return repoDefaultBranch;
        }

        // 用 XHR 发送 JSON 请求，才能拿到真实的上传进度（fetch 不提供上传进度）
        function xhrJsonRequest(method, url, payload, onProgress, errorLabel) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open(method, url);
                xhr.setRequestHeader('Authorization', `Bearer ${githubConfig.token}`);
                xhr.setRequestHeader('Accept', 'application/vnd.github+json');
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.upload.onprogress = (e) => {
                    if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
                };
                xhr.onerror = () => reject(new Error(`${errorLabel || '请求'}失败：网络异常，上传中断`));
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
                        catch (e) { resolve({}); }
                    } else {
                        let msg = `${errorLabel || '请求'}失败 (${xhr.status})`;
                        try {
                            const j = JSON.parse(xhr.responseText);
                            if (j && j.message) msg += '：' + j.message;
                        } catch (e) {}
                        reject(new Error(msg));
                    }
                };
                xhr.send(JSON.stringify(payload));
            });
        }

        // 大附件走 Git Data API（blobs + trees + commits），避免 Contents API 的大小限制
        function createGithubBlobWithProgress(base64Content, onProgress) {
            return xhrJsonRequest('POST', `https://api.github.com/repos/${githubConfig.repo}/git/blobs`,
                { content: base64Content, encoding: 'base64' }, onProgress, '创建 blob ');
        }

        // 10MB 以内的附件直接走 Contents API：单次请求、链路更短，比多步 Git Data 更稳
        async function uploadAttachmentViaContents(path, base64Content, message, onProgress) {
            const apiPath = encodeRepoPath(path);
            const url = `https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`;
            let sha = '';
            try {
                const check = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Accept': 'application/vnd.github+json' }
                });
                if (check.ok) {
                    const data = await check.json();
                    sha = data.sha || '';
                }
            } catch (e) {}
            const payload = { message, content: base64Content };
            if (sha) payload.sha = sha;
            await xhrJsonRequest('PUT', url, payload, onProgress, '上传附件');
        }

        async function uploadAttachmentViaGitData(path, base64Content, message, onProgress = null, onStage = null) {
            if (!githubConfig.token || !githubConfig.repo) throw new Error('未配置仓库');
            const repo = githubConfig.repo;
            const branch = await getRepoDefaultBranch();
            const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');

            // 先传 blob，再读取分支头并提交：大文件上传耗时长，这样能降低提交时分支已变化的概率
            const blob = await createGithubBlobWithProgress(base64Content, onProgress);
            if (onStage) onStage('write');

            // 分支冲突时只重做 tree/commit/ref，不重复上传大文件
            for (let attempt = 0; attempt <= 2; attempt++) {
                const refRes = await githubApi(`/repos/${repo}/git/ref/heads/${encodedBranch}`);
                if (!refRes.ok) throw new Error(await githubErrorText(refRes, '获取分支引用失败'));
                const parentSha = (await refRes.json()).object.sha;

                const commitRes = await githubApi(`/repos/${repo}/git/commits/${parentSha}`);
                if (!commitRes.ok) throw new Error(await githubErrorText(commitRes, '获取父提交失败'));
                const parentCommit = await commitRes.json();

                const treeRes = await githubApi(`/repos/${repo}/git/trees`, {
                    method: 'POST',
                    body: JSON.stringify({
                        base_tree: parentCommit.tree.sha,
                        tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }]
                    })
                });
                if (!treeRes.ok) throw new Error(await githubErrorText(treeRes, '创建 tree 失败'));
                const tree = await treeRes.json();

                const newCommitRes = await githubApi(`/repos/${repo}/git/commits`, {
                    method: 'POST',
                    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] })
                });
                if (!newCommitRes.ok) throw new Error(await githubErrorText(newCommitRes, '创建提交失败'));
                const newCommit = await newCommitRes.json();

                const updateRes = await githubApi(`/repos/${repo}/git/refs/heads/${encodedBranch}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ sha: newCommit.sha, force: false })
                });
                if (updateRes.ok) return true;
                if ((updateRes.status === 409 || updateRes.status === 422) && attempt < 2) {
                    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
                    continue;
                }
                throw new Error(await githubErrorText(updateRes, '更新分支失败'));
            }
            throw new Error('更新分支失败：多次重试仍未成功');
        }

        // XHR 下载可以拿到 onprogress，用来显示真实的下载进度
        function fetchGithubFileRawWithProgress(path, onProgress) {
            return new Promise((resolve, reject) => {
                if (!githubConfig.token || !githubConfig.repo) { reject(new Error('未配置仓库')); return; }
                const apiPath = encodeRepoPath(path);
                const xhr = new XMLHttpRequest();
                xhr.open('GET', `https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`);
                xhr.setRequestHeader('Authorization', `Bearer ${githubConfig.token}`);
                xhr.setRequestHeader('Accept', 'application/vnd.github.v3.raw');
                xhr.responseType = 'blob';
                xhr.onprogress = (e) => {
                    if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
                };
                xhr.onerror = () => reject(new Error('网络异常，下载中断'));
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        const blob = xhr.response;
                        if (!blob || blob.size === 0) { reject(new Error('文件内容为空')); return; }
                        resolve(blob);
                        return;
                    }
                    const fallback = `获取文件失败 (${xhr.status})`;
                    const blob = xhr.response;
                    if (blob && typeof blob.text === 'function') {
                        blob.text().then(text => {
                            let msg = fallback;
                            try { const j = JSON.parse(text); if (j && j.message) msg += '：' + j.message; } catch (e) {}
                            reject(new Error(msg));
                        }).catch(() => reject(new Error(fallback)));
                    } else {
                        reject(new Error(fallback));
                    }
                };
                xhr.send();
            });
        }

        // 读取正文/索引时必须绕开浏览器和 GitHub CDN 的短时缓存，
        // 否则刚在别的设备保存后，这里可能拿到 60 秒内的旧文件。
        function githubContentsUrl(apiPath) {
            return `https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}?t=${Date.now()}`;
        }

        async function fetchGithubJSONWithMeta(path) {
            if (!githubConfig.token || !githubConfig.repo) throw new Error('未配置仓库');
            const apiPath = encodeRepoPath(path);
            const url = githubContentsUrl(apiPath);
            const metaRes = await fetch(url, {
                cache: 'no-store',
                headers: { 'Authorization': `Bearer ${githubConfig.token}` }
            });
            if (!metaRes.ok) {
                const err = new Error(`获取元数据失败 (${metaRes.status})`);
                err.status = metaRes.status;
                throw err;
            }
            const meta = await metaRes.json();
            const sha = meta.sha;
            let text;
            if (meta.content && meta.encoding === 'base64') {
                text = base64ToUtf8(meta.content);
            } else {
                const rawRes = await fetch(url, {
                    cache: 'no-store',
                    headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Accept': 'application/vnd.github.v3.raw' }
                });
                if (!rawRes.ok) throw new Error(`获取内容失败 (${rawRes.status})`);
                text = await rawRes.text();
            }
            return { sha, text };
        }

        async function fetchGithubJSONFile(path) {
            if (!githubConfig.token || !githubConfig.repo) throw new Error('未配置仓库');
            const apiPath = encodeRepoPath(path);
            const url = githubContentsUrl(apiPath);
            const metaRes = await fetch(url, {
                cache: 'no-store',
                headers: { 'Authorization': `Bearer ${githubConfig.token}` }
            });
            if (!metaRes.ok) throw new Error(`获取文件失败 (${metaRes.status})`);
            const meta = await metaRes.json();
            let text;
            if (meta.content && meta.encoding === 'base64') {
                text = base64ToUtf8(meta.content);
            } else {
                const rawRes = await fetch(url, {
                    cache: 'no-store',
                    headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Accept': 'application/vnd.github.v3.raw' }
                });
                if (!rawRes.ok) throw new Error(`获取内容失败 (${rawRes.status})`);
                text = await rawRes.text();
            }
            return JSON.parse(text);
        }

        async function fetchImageJsonFromGithub(path) {
            if (!githubConfig.token || !githubConfig.repo) return null;
            const apiPath = encodeRepoPath(path);
            try {
                const metaRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                    headers: { 'Authorization': `Bearer ${githubConfig.token}` }
                });
                if (!metaRes.ok) return null;
                const meta = await metaRes.json();
                let jsonStr = '';
                if (meta.content && meta.encoding === 'base64') {
                    jsonStr = base64ToUtf8(meta.content);
                } else {
                    const rawRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                        headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Accept': 'application/vnd.github.v3.raw' }
                    });
                    if (!rawRes.ok) return null;
                    jsonStr = await rawRes.text();
                }
                if (!jsonStr) return null;
                const obj = JSON.parse(jsonStr);
                return obj.data || null;
            } catch (e) { return null; }
        }

        /* ==================== 文档正文 ==================== */
        async function uploadDocContent(id, content, meta = {}, retryCount = 0) {
            if (!githubConfig.token || !githubConfig.repo) throw new Error('未配置仓库');
            const path = `${DOCS_FOLDER}/${id}.json`;
            const apiPath = encodeRepoPath(path);
            const payload = { id, title: meta.title || '', content, updatedAt: meta.updatedAt || new Date().toLocaleString() };
            const contentEncoded = utf8ToBase64(JSON.stringify(payload));
            let sha = '';
            try {
                const checkRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                    headers: { 'Authorization': `Bearer ${githubConfig.token}` }
                });
                if (checkRes.ok) { const checkData = await checkRes.json(); sha = checkData.sha; }
            } catch (e) {}
            const body = { message: `kb: update doc content ${id}`, content: contentEncoded };
            if (sha) body.sha = sha;
            const res = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) return true;
            if (res.status === 409 && retryCount < 1) {
                await new Promise(r => setTimeout(r, 300));
                return uploadDocContent(id, content, meta, retryCount + 1);
            }
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.message || '上传正文失败');
        }

        async function fetchDocContent(id, expectedUpdatedAt = null, force = false) {
            const expected = expectedUpdatedAt == null
                ? String((docs.find(d => d.id === id) || {}).updatedAt || '')
                : String(expectedUpdatedAt);
            const cached = docContentCache.get(id);
            // 索引里的更新时间变了，说明正文可能已被其他设备修改，旧缓存直接作废
            if (!force && cached !== undefined && docContentStamp.get(id) === expected) return cached;
            const obj = await fetchGithubJSONFile(`${DOCS_FOLDER}/${id}.json`);
            const content = obj.content || '';
            docContentCache.set(id, content);
            docContentStamp.set(id, expected);
            return content;
        }

        async function deleteDocContentFile(id) {
            if (!githubConfig.token || !githubConfig.repo) return;
            const apiPath = encodeRepoPath(`${DOCS_FOLDER}/${id}.json`);
            try {
                const getRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                    headers: { 'Authorization': `Bearer ${githubConfig.token}` }
                });
                if (getRes.ok) {
                    const fileData = await getRes.json();
                    await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: `kb: delete doc content ${id}`, sha: fileData.sha })
                    });
                }
            } catch (e) {}
        }

        /* ==================== 主索引 ==================== */
        async function uploadMainIndex(indexDocs) {
            if (!githubConfig.token || !githubConfig.repo) return;
            updateSyncStatus('loading', '同步中');
            try {
                if (!githubConfig.sha) {
                    try {
                        const apiPath = encodeRepoPath(githubConfig.path);
                        const checkRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                            headers: { 'Authorization': `Bearer ${githubConfig.token}` }
                        });
                        if (checkRes.ok) { const checkData = await checkRes.json(); githubConfig.sha = checkData.sha; }
                    } catch (ex) {}
                }
                const contentEncoded = utf8ToBase64(JSON.stringify(indexDocs, null, 2));
                const body = { message: `kb: update index ${new Date().toLocaleString()}`, content: contentEncoded };
                if (githubConfig.sha) body.sha = githubConfig.sha;
                const apiPath = encodeRepoPath(githubConfig.path);
                const res = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (res.ok) {
                    const data = await res.json();
                    githubConfig.sha = data.content.sha;
                    localStorage.setItem('kb_gh_config', JSON.stringify(githubConfig));
                    updateSyncStatus('success', '已同步');
                    return true;
                } else {
                    const errJson = await res.json().catch(() => ({}));
                    if (res.status === 409 && githubConfig.sha) {
                        githubConfig.sha = '';
                        return uploadMainIndex(indexDocs);
                    }
                    updateSyncStatus('error', errJson.message || '推送失败');
                    throw new Error(errJson.message || '上传索引失败');
                }
            } catch (e) {
                updateSyncStatus('error', '推送失败');
                throw e;
            }
        }
