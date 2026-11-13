/* 椿沐智库 Service Worker
 * 目的：满足 Chrome/Edge 的 PWA 安装条件，并让应用外壳在弱网/离线时仍能打开。
 * 策略：
 *  - 页面导航：网络优先，失败时回退到缓存的 index.html
 *  - 同源静态资源（CSS/JS/图标/manifest）：网络优先并回写缓存，保证更新及时、离线也能用
 *  - 第三方库已本地化到 vendor/，不再依赖 CDN
 *  - GitHub API 一律不缓存（带鉴权、必须实时）
 */
const CACHE_VERSION = 'v6';
const SHELL_CACHE = 'chunmu-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'chunmu-runtime-' + CACHE_VERSION;
const SHELL_FILES = [
    './',
    './index.html',
    './manifest.json',
    './css/base.css',
    './css/components.css',
    './css/viewer.css',
    './css/editor.css',
    './js/tailwind-config.js',
    './js/core.js',
    './js/github.js',
    './js/ui-core.js',
    './js/attachments.js',
    './js/doc-view.js',
    './js/viewer.js',
    './js/events.js',
    './js/auth-sync.js',
    './js/pwa.js',
    './vendor/tailwind.js',
    './vendor/marked.min.js',
    './vendor/purify.min.js',
    './vendor/remixicon/remixicon.css',
    './vendor/remixicon/remixicon.woff2',
    './vendor/remixicon/remixicon.woff',
    './vendor/remixicon/remixicon.ttf',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-32.png'
];
const CDN_HOSTS = new Set([
    'cdn.tailwindcss.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
]);

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.hostname === 'api.github.com') return;

    if (req.mode === 'navigate') {
        event.respondWith(networkFirstPage(req));
        return;
    }
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirstAsset(req));
        return;
    }
    if (CDN_HOSTS.has(url.hostname)) {
        event.respondWith(staleWhileRevalidate(req));
    }
});

async function networkFirstPage(req) {
    try {
        const res = await fetch(req);
        if (res && res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('./index.html', res.clone()).catch(() => {});
        }
        return res;
    } catch (e) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        if (cached) return cached;
        return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<title>椿沐智库</title><body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;'
            + 'align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">'
            + '<div><h2>当前处于离线状态</h2><p>请连接网络后刷新页面。</p></div></body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

async function networkFirstAsset(req) {
    try {
        const res = await fetch(req);
        if (res && res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(req, res.clone()).catch(() => {});
        }
        return res;
    } catch (e) {
        // 页面里的 CSS/JS 带 ?v= 版本号，离线时按忽略查询参数匹配安装时缓存的同名文件
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}

async function staleWhileRevalidate(req) {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
    }).catch(() => null);
    if (cached) return cached;
    const res = await network;
    return res || new Response('', { status: 504, statusText: 'Offline' });
}
