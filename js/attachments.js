/* 椿沐智库 · 附件：图片压缩上传、分片上传、删除/下载、编辑会话清理 */

/* ==================== 附件上传/删除/下载 ==================== */
        function uploadImageAsJson(file) {
            return new Promise((resolve) => {
                if (!githubConfig.token || !githubConfig.repo) {
                    showToast('请先绑定 GitHub Token！', 'error');
                    resolve();
                    return;
                }
                const tipEl = document.getElementById('uploadStatusTip');
                if (tipEl) tipEl.textContent = '正在压缩图片并打包为独立 JSON 上传...';
                const sessionId = editSessionId;
                const reader = new FileReader();
                reader.onload = function(event) {
                    const img = new Image();
                    img.onload = async function() {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        const maxWidth = 1200;
                        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const base64DataUrl = canvas.toDataURL('image/webp', 0.7);
                        const payload = { data: base64DataUrl };
                        const contentEncoded = utf8ToBase64(JSON.stringify(payload));
                        const filename = `images/img_${Date.now()}_${Math.floor(Math.random() * 1000)}.json`;
                        const apiPath = encodeRepoPath(filename);
                        try {
                            const res = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                                method: 'PUT',
                                headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ message: `kb: upload image json ${filename}`, content: contentEncoded })
                            });
                            if (res.ok) {
                                if (sessionId !== editSessionId) {
                                    // 编辑已取消/已保存：这是迟到的上传结果，立即清理，避免留下孤儿文件
                                    await deleteGithubFileByPath(filename);
                                    if (tipEl) tipEl.textContent = 'Markdown 源码（支持粘贴截图）';
                                    resolve();
                                    return;
                                }
                                pendingUploads.push({ path: filename, name: filename, type: 'image' });
                                // 立即写入图片缓存，预览/查看时无需再等网络
                                imageJsonCache.set(filename, base64DataUrl);
                                insertImageMarkdown(document.getElementById('editContentInput'), filename);
                                if (isPreviewMode) setPreviewMode(true);
                                else if (tipEl) tipEl.textContent = 'Markdown 源码（图片已上传并插入）';
                                showToast('图片上传成功', 'success');
                            } else { showToast('图片上传失败', 'error'); }
                        } catch (err) { showToast('网络异常，图片上传失败', 'error'); }
                        resolve();
                    };
                    img.onerror = () => resolve();
                    img.src = event.target.result;
                };
                reader.onerror = () => resolve();
                reader.readAsDataURL(file);
            });
        }

        async function uploadGenericAttachment(file, currentIdx = 1, total = 1) {
            if (!githubConfig.token || !githubConfig.repo) { showToast('请先绑定 GitHub Token！', 'error'); return; }
            if (file.size > MAX_ATTACHMENT_SIZE) { showToast(`「${file.name}」超过 20MB，无法上传`, 'error'); return; }
            const type = getAttachmentType(file);
            const folder = ATTACHMENT_FOLDERS[type] || '其他';
            const safeName = sanitizeFileName(file.name);
            const stamp = Date.now();
            const sessionId = editSessionId;
            const fileLabel = total > 1 ? `「${file.name}」（${currentIdx}/${total}）` : `「${file.name}」`;
            const sizeLabel = formatSize(file.size);
            const message = `kb: upload attachment ${file.name}`;
            const isAuthFailure = (err) => /\((401|403|404)\)/.test(err.message || '') || /bad credentials/i.test(err.message || '');
            const cleanupPaths = async (paths) => { if (paths.length) await Promise.allSettled(paths.map(p => deleteGithubFileByPath(p))); };

            showLoading('正在读取文件...');
            try {
                let path = '';
                let parts = null;

                if (file.size > CHUNKED_UPLOAD_THRESHOLD) {
                    // 大文件分片上传：每片约 1.5MB，避免单次请求体过大被网络/网关中断
                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    parts = [];
                    try {
                        for (let i = 0; i < totalChunks; i++) {
                            if (sessionId !== editSessionId) break;
                            const start = i * CHUNK_SIZE;
                            const end = Math.min(file.size, start + CHUNK_SIZE);
                            const chunk = file.slice(start, end);
                            updateLoadingText(`正在读取第 ${i + 1}/${totalChunks} 段...`);
                            const chunkBase64 = await fileToBase64(chunk, (frac) => {
                                setLoadingProgress(((i + frac) / totalChunks) * 10, `正在读取第 ${i + 1}/${totalChunks} 段…`);
                            });
                            const partPath = `attachments/${folder}/${stamp}_${safeName}.part${i + 1}`;
                            updateLoadingText(`正在上传第 ${i + 1}/${totalChunks} 段...`);
                            await uploadAttachmentViaContents(partPath, chunkBase64, `${message} (part ${i + 1})`, (frac) => {
                                setLoadingProgress(10 + ((i + frac) / totalChunks) * 80, `正在上传第 ${i + 1}/${totalChunks} 段…`);
                            });
                            parts.push({ path: partPath, size: end - start });
                            pendingUploads.push({ name: file.name, path: partPath, size: end - start, type });
                        }
                    } catch (chunkErr) {
                        // 分片中途失败：清掉已经传上去的部分，避免留下半截文件
                        const uploaded = parts.map(p => p.path);
                        pendingUploads = pendingUploads.filter(u => !uploaded.includes(u.path));
                        parts = [];
                        await cleanupPaths(uploaded);
                        throw chunkErr;
                    }

                    if (sessionId !== editSessionId || !parts.length) {
                        const uploaded = parts.map(p => p.path);
                        pendingUploads = pendingUploads.filter(u => !uploaded.includes(u.path));
                        await cleanupPaths(uploaded);
                        return;
                    }
                    path = parts[0].path;
                } else {
                    path = `attachments/${folder}/${stamp}_${safeName}`;
                    updateLoadingText('正在读取文件...');
                    setLoadingProgress(0, '准备读取文件...');
                    const base64 = await fileToBase64(file, (frac) => {
                        setLoadingProgress(frac * 10, `正在读取文件 ${sizeLabel}…`);
                    });

                    updateLoadingText('正在上传附件...');
                    setLoadingProgress(10, `正在上传文件 ${sizeLabel}…`);
                    const onUploadProgress = (frac) => setLoadingProgress(10 + frac * 80, `正在上传文件 ${sizeLabel}…`);

                    if (file.size <= CONTENTS_UPLOAD_LIMIT) {
                        // 10MB 以内默认走 Contents API 单请求；若不是权限问题，再用 Git Data API 补一次
                        try {
                            await uploadAttachmentViaContents(path, base64, message, onUploadProgress);
                        } catch (contentsErr) {
                            if (isAuthFailure(contentsErr)) throw contentsErr;
                            console.warn('Contents API 上传失败，改用 Git Data API 重试', contentsErr);
                            updateLoadingText('正在重试上传...');
                            setLoadingProgress(10, `正在重试上传 ${sizeLabel}…`);
                            try {
                                await uploadAttachmentViaGitData(path, base64, message,
                                    (frac) => setLoadingProgress(10 + frac * 80, `正在重试上传 ${sizeLabel}…`),
                                    () => {
                                        updateLoadingText('正在写入仓库...');
                                        setLoadingProgress(90, '正在写入仓库…');
                                    });
                            } catch (gitErr) {
                                throw new Error(`${contentsErr.message}；改用 Git Data API 重试仍失败：${gitErr.message}`);
                            }
                        }
                    } else {
                        try {
                            await uploadAttachmentViaGitData(path, base64, message, onUploadProgress, () => {
                                updateLoadingText('正在写入仓库...');
                                setLoadingProgress(90, '正在写入仓库…');
                            });
                        } catch (gitErr) {
                            if (isAuthFailure(gitErr)) throw gitErr;
                            // Git Data 的多步提交失败时，退回 Contents API 再试一次
                            console.warn('Git Data API 上传失败，改用 Contents API 重试', gitErr);
                            updateLoadingText('正在重试上传...');
                            setLoadingProgress(10, `正在重试上传 ${sizeLabel}…`);
                            try {
                                await uploadAttachmentViaContents(path, base64, message,
                                    (frac) => setLoadingProgress(10 + frac * 80, `正在重试上传 ${sizeLabel}…`));
                            } catch (contentsErr) {
                                throw new Error(`${gitErr.message}；改用 Contents API 重试仍失败：${contentsErr.message}`);
                            }
                        }
                    }

                    if (sessionId !== editSessionId) {
                        // 编辑已取消/已保存：这是迟到的上传结果，立即清理，避免留下孤儿文件
                        await deleteGithubFileByPath(path);
                        return;
                    }
                    pendingUploads.push({ name: file.name, path, size: file.size, type });
                }

                updateLoadingText('正在写入仓库...');
                setLoadingProgress(96, '即将完成…');
                const record = { name: file.name, path, size: file.size, type, uploadedAt: new Date().toLocaleString() };
                if (parts) record.parts = parts;
                editAttachments.push(record);
                renderEditAttachments();
                setLoadingProgress(100, '上传完成');
                showToast(`${fileLabel}上传成功`, 'success');
            } catch (e) {
                let msg = e.message || '未知错误';
                const authError = /\(401\)/i.test(msg) || /bad credentials/i.test(msg);
                if (authError) {
                    msg += '。访问令牌无效或已过期，请在仓库配置里重新填写 Token';
                } else if (/\(403\)/i.test(msg)) {
                    msg += '。请确认 Token 对仓库拥有 Contents 读写权限';
                } else if (file.size >= 5 * 1024 * 1024) {
                    msg += '。该文件较大，若反复失败可尝试压缩到更小或更换网络';
                }
                showToast(`${fileLabel}上传失败：${msg}`, 'error');
            }
            finally { hideLoading(); }
        }

        async function handleAttachmentUpload(files) {
            if (!files || !files.length) return;
            const imageFiles = [];
            const otherFiles = [];
            for (const file of files) {
                if (getAttachmentType(file) === 'image') imageFiles.push(file);
                else otherFiles.push(file);
            }
            for (const file of imageFiles) await uploadImageAsJson(file);
            for (let i = 0; i < otherFiles.length; i++) await uploadGenericAttachment(otherFiles[i], i + 1, otherFiles.length);
        }

        // 单文件附件返回 [path]；分片附件返回所有分片路径
        function getAttachmentPaths(att) {
            if (!att) return [];
            if (Array.isArray(att.parts) && att.parts.length) {
                return att.parts.map(p => p && p.path).filter(Boolean);
            }
            return att.path ? [att.path] : [];
        }

        async function deleteEditAttachment(index) {
            const att = editAttachments[index];
            if (!att) return;
            const attPaths = getAttachmentPaths(att);
            const isPendingUpload = attPaths.some(p => pendingUploads.some(u => u.path === p));
            const ok = await showConfirm({
                title: '删除附件',
                desc: isPendingUpload
                    ? `确定要删除附件「${att.name}」吗？该文件会立即从 GitHub 中清理。`
                    : `确定要从当前编辑中移除附件「${att.name}」吗？保存后才会从 GitHub 中清理，取消编辑则保留原文件。`,
                okText: '确定删除', cancelText: '取消', type: 'danger'
            });
            if (!ok) return;
            editAttachments.splice(index, 1);
            renderEditAttachments();
            if (isPendingUpload) {
                // 本次编辑刚上传的附件：立即删除，避免取消编辑后残留在仓库
                pendingUploads = pendingUploads.filter(u => !attPaths.includes(u.path));
                showLoading('正在删除附件...');
                try { await Promise.allSettled(attPaths.map(p => deleteGithubFileByPath(p))); } finally { hideLoading(); }
                showToast('附件已删除', 'success');
            } else {
                // 原有附件：先从编辑列表移除，保存时才真正删除；取消编辑不会破坏已有文件
                pendingDeletedAttachments.push(att);
                showToast('已移除，保存后生效', 'success');
            }
        }

        async function downloadAttachment(index) {
            const doc = docs.find(d => d.id === currentDocId);
            if (!doc || !doc.attachments || !doc.attachments[index]) return;
            const att = doc.attachments[index];
            await prepareAndDownload(att.name, async () => {
                const mime = guessMimeByName(att.name);
                const paths = getAttachmentPaths(att);
                if (!paths.length) throw new Error('附件不存在');

                const partSizes = (att.parts && att.parts.length)
                    ? att.parts.map(p => Number(p.size) || 0)
                    : [Number(att.size) || 0];
                const totalBytes = partSizes.reduce((sum, n) => sum + n, 0) || (Number(att.size) || 0);

                setLoadingProgress(0, paths.length > 1 ? `准备下载（共 ${paths.length} 段）…` : '准备下载…');
                const blobs = [];
                let doneBytes = 0;
                for (let i = 0; i < paths.length; i++) {
                    const partLabel = paths.length > 1 ? `正在下载 ${i + 1}/${paths.length} 段…` : '正在下载文件…';
                    updateLoadingText(partLabel);
                    const blob = await fetchGithubFileRawWithProgress(paths[i], (frac) => {
                        const loaded = doneBytes + frac * (partSizes[i] || 0);
                        const pct = totalBytes > 0
                            ? (loaded / totalBytes) * 100
                            : ((i + frac) / paths.length) * 100;
                        setLoadingProgress(pct, partLabel);
                    });
                    blobs.push(blob);
                    doneBytes += blob.size;
                }
                setLoadingProgress(100, '下载完成');
                return new Blob(blobs, { type: mime });
            });
        }

        async function deleteGithubFileByPath(path) {
            if (!githubConfig.token || !githubConfig.repo || !path) return false;
            try {
                const apiPath = encodeRepoPath(path);
                const getRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                    headers: { 'Authorization': `Bearer ${githubConfig.token}` }
                });
                if (!getRes.ok) return false;
                const fileData = await getRes.json();
                const delRes = await fetch(`https://api.github.com/repos/${githubConfig.repo}/contents/${apiPath}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${githubConfig.token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: `kb: cleanup ${path}`, sha: fileData.sha })
                });
                return delRes.ok;
            } catch (e) { return false; }
        }

        async function deleteGithubAttachments(attachments) {
            if (!githubConfig.token || !githubConfig.repo || !attachments || !attachments.length) return;
            const paths = [];
            attachments.forEach(att => paths.push(...getAttachmentPaths(att)));
            await Promise.allSettled(paths.map(p => deleteGithubFileByPath(p)));
        }

        /* ==================== 编辑会话：未保存上传的追踪与清理 ==================== */
        function beginEditSession() {
            editSessionId += 1;
            pendingUploads = [];
            pendingDeletedAttachments = [];
            return editSessionId;
        }

        // 作废当前编辑会话，并清理其中已上传但尚未保存的文件
        async function discardEditSessionUploads(showTip = false) {
            const abandoned = pendingUploads.slice();
            abandoned.forEach(u => imageJsonCache.delete(u.path));
            beginEditSession();
            if (!abandoned.length) return;
            showLoading('正在清理未保存的上传文件...');
            try {
                await Promise.allSettled(abandoned.map(u => deleteGithubFileByPath(u.path)));
                if (showTip) showToast('已清理未保存的图片与附件', 'success');
            } finally { hideLoading(); }
        }
