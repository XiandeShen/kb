/* 椿沐智库 · PWA：Service Worker 注册、安装提示 */

/* ==================== PWA 安装支持 ==================== */
        // Chrome/小米等浏览器在 HTTPS（或 localhost）下才会注册 Service Worker，
        // 满足 manifest + 图标 + Service Worker 后即可从浏览器菜单“安装应用/添加到主屏幕”。
        let deferredInstallPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            // 拦截浏览器默认提示，改为在 GitHub 菜单里提供“安装到桌面”
            e.preventDefault();
            deferredInstallPrompt = e;
            const btn = document.getElementById('installAppBtn');
            if (btn) btn.classList.remove('hidden');
        });
        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            const btn = document.getElementById('installAppBtn');
            if (btn) btn.classList.add('hidden');
            showToast('已安装到桌面', 'success');
        });
        if ('serviceWorker' in navigator) {
            const swAllowed = location.protocol === 'https:'
                || location.hostname === 'localhost'
                || location.hostname === '127.0.0.1';
            if (swAllowed) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('./sw.js').catch((err) => {
                        console.warn('Service Worker 注册失败（不影响正常使用）', err);
                    });
                });
            }
        }
