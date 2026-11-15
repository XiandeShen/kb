/* 椿沐智库 · 输入法诊断浮层（临时工具，定位完成后可删）
 *
 * 开启方式：
 *   · 浏览器：地址栏加 ?diag=1 后回车
 *   · App：由 native-bridge.js 自动开启
 *
 * 它会记录每次触摸/聚焦/输入事件的先后顺序，以及当时的焦点元素，
 * 用来判断"键盘弹了却打不了字"是焦点跑到别处，还是事件根本没派发。
 */
(function () {
    'use strict';

    function enabled() {
        try {
            if (/[?&]diag=1/.test(location.search)) return true;
            if (window.__KB_DIAG__) return true;
            if (localStorage.getItem('kb_diag') === '1') return true;
        } catch (e) {}
        return false;
    }
    if (!enabled()) return;

    var t0 = Date.now();
    var logs = [];
    var lastPoint = { x: 0, y: 0 };

    function idOf(el) {
        if (!el) return 'null';
        if (el === document.body) return 'body';
        if (el === document.documentElement) return 'html';
        var id = el.id ? '#' + el.id : '';
        var cls = (typeof el.className === 'string' && el.className)
            ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : '';
        return (el.tagName || '?').toLowerCase() + id + cls;
    }

    function push(line) {
        var ms = String(Date.now() - t0);
        logs.push(ms.padStart(5, ' ') + 'ms  ' + line);
        if (logs.length > 7) logs.shift();
        render();
    }

    function hitTest() {
        try {
            var el = document.elementFromPoint(lastPoint.x, lastPoint.y);
            return idOf(el);
        } catch (e) { return 'err'; }
    }

    var box = null;
    function ensureBox() {
        if (box) return box;
        box = document.createElement('div');
        box.id = '__kb_diag_box';
        box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;' +
            'background:rgba(0,0,0,.86);color:#0f0;font:11px/1.5 ui-monospace,Consolas,monospace;' +
            'padding:6px 8px;white-space:pre;overflow:hidden;pointer-events:none;'
            + 'border-top:1px solid #0f0;';
        document.body.appendChild(box);
        return box;
    }

    function render() {
        var el = ensureBox();
        var vv = window.visualViewport || {};
        var head = 'active=' + idOf(document.activeElement) +
            '  hit=' + hitTest() +
            '  vvH=' + Math.round(vv.height || 0) +
            '  ih=' + window.innerHeight +
            '  hasFocus=' + (document.hasFocus() ? 1 : 0);
        el.textContent = head + '\n' + logs.join('\n');
    }

    function on(type) {
        return function (e) {
            if (e && typeof e.clientX === 'number' && (e.clientX || e.clientY)) {
                lastPoint.x = e.clientX;
                lastPoint.y = e.clientY;
            }
            var t = e && e.target ? idOf(e.target) : '-';
            var extra = '';
            if (type === 'keydown' && e) extra = ' key=' + e.key;
            if (type === 'input' && e && e.target) extra = ' len=' + (e.target.value || '').length;
            push(type + ' -> ' + t + extra);
        };
    }

    ['pointerdown', 'pointerup', 'click', 'focus', 'blur', 'input', 'keydown'].forEach(function (type) {
        document.addEventListener(type, on(type), true);
    });

    window.addEventListener('resize', render);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', render);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }

    // 清空：三指轻触（便于重复测试）
    document.addEventListener('touchstart', function (e) {
        if (e.touches && e.touches.length >= 3) {
            logs.length = 0;
            t0 = Date.now();
            push('--- cleared ---');
        }
    }, { passive: true });
})();
