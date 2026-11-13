/* 椿沐智库 · 图片查看器：双击/捏合缩放、拖拽、滑动换图、缩略图、全屏查看 */

/* ==================== 图片查看器 ==================== */
        let currentModalImgSrc = '';
        // 当前文档内的图片集合，支持查看器内左右切换
        let galleryImages = [];
        let galleryIndex = 0;
        let currentScale = 1;
        let minScale = 1;
        let maxScale = 4;
        let imgTranslateX = 0;
        let imgTranslateY = 0;
        let isDraggingImg = false;
        let startDragX = 0, startDragY = 0;
        let initialPinchDistance = null;
        let initialPinchScale = 1;
        // 移动端左右滑动换图
        let swipeOffsetX = 0;
        let swipeIntent = null; // null | 'swipe' | 'pan'
        // 关闭查看器后短暂屏蔽点击，避免 touchend 的合成 click 落到下方的文档图片上
        let suppressGalleryOpenUntil = 0;
        // 单击关闭 / 双击缩放：用定时器区分，避免单击立即关闭导致双击失效
        let viewerTapTimer = null;
        let viewerLastTapAt = 0;
        let viewerLastTapX = 0;
        let viewerLastTapY = 0;
        let viewerTransformTimer = null;

        // 用多个来源取最小值同步真实可视高度：旧内核（小米/Via）不支持 100dvh 时，
        // 也不会把浏览器底部工具栏算进页面高度
        function syncAppViewportHeight() {
            const candidates = [window.innerHeight, document.documentElement.clientHeight];
            const vv = window.visualViewport;
            // 页面被双指缩放时 visualViewport.height 会变小，此时不参与计算
            if (vv && (vv.scale || 1) <= 1.05 && vv.height) candidates.push(vv.height);
            const heights = candidates.filter((n) => n > 0);
            const h = Math.round(heights.length ? Math.min(...heights) : 0);
            if (h > 0) document.documentElement.style.setProperty('--app-vh', h + 'px');
        }
        syncAppViewportHeight();
        window.addEventListener('resize', syncAppViewportHeight);
        window.addEventListener('orientationchange', () => setTimeout(syncAppViewportHeight, 120));
        if (window.visualViewport) window.visualViewport.addEventListener('resize', syncAppViewportHeight);

        // 图片可用的真实区域（扣除 padding 与底部缩略图安全区）
        function getViewerMetrics() {
            const container = document.getElementById('imageContainer');
            if (!container) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            const cs = window.getComputedStyle(container);
            const padL = parseFloat(cs.paddingLeft) || 0;
            const padR = parseFloat(cs.paddingRight) || 0;
            const padT = parseFloat(cs.paddingTop) || 0;
            const padB = parseFloat(cs.paddingBottom) || 0;
            const rect = container.getBoundingClientRect();
            return {
                left: rect.left + padL,
                top: rect.top + padT,
                width: Math.max(1, container.clientWidth - padL - padR),
                height: Math.max(1, container.clientHeight - padT - padB)
            };
        }

        function updateImageTransform() {
            const imgView = document.getElementById('modalImageView');
            if (!imgView) return;
            imgView.style.transform = `translate3d(${imgTranslateX + swipeOffsetX}px, ${imgTranslateY}px, 0px) scale(${currentScale})`;
        }

        // duration > 0 用过渡动画，0 表示跟手（拖拽/捏合时不能有延迟）
        function applyImageTransform(duration = 0) {
            const imgView = document.getElementById('modalImageView');
            if (!imgView) return;
            if (viewerTransformTimer) { clearTimeout(viewerTransformTimer); viewerTransformTimer = null; }
            if (duration > 0) {
                imgView.style.transition = `transform ${duration}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
                viewerTransformTimer = setTimeout(() => {
                    viewerTransformTimer = null;
                    imgView.style.transition = '';
                }, duration + 60);
            } else {
                imgView.style.transition = 'none';
            }
            updateImageTransform();
        }

        // 边界限制：图片比可视区小就强制居中，不再保留 ±100px 的“余量”，避免缩小后跑偏
        function clampTranslation() {
            const imgView = document.getElementById('modalImageView');
            if (!imgView || !imgView.naturalWidth) return;
            const m = getViewerMetrics();
            const renderedW = imgView.naturalWidth * currentScale;
            const renderedH = imgView.naturalHeight * currentScale;
            const maxTransX = Math.max(0, (renderedW - m.width) / 2);
            const maxTransY = Math.max(0, (renderedH - m.height) / 2);
            imgTranslateX = Math.min(Math.max(imgTranslateX, -maxTransX), maxTransX);
            imgTranslateY = Math.min(Math.max(imgTranslateY, -maxTransY), maxTransY);
        }

        // 以屏幕坐标 (clientX, clientY) 为锚点缩放，手指/鼠标下的那个像素位置保持不动
        function zoomAtPoint(clientX, clientY, targetScale, duration = 240) {
            const imgView = document.getElementById('modalImageView');
            if (!imgView || !imgView.naturalWidth) return;
            const target = Math.min(maxScale, Math.max(minScale, targetScale));
            if (Math.abs(target - currentScale) < 0.005) return;
            const rect = imgView.getBoundingClientRect();
            // rect 中心 = 未平移时的中心 + 平移量，反推出缩放原点
            const centerX = rect.left + rect.width / 2 - imgTranslateX;
            const centerY = rect.top + rect.height / 2 - imgTranslateY;
            const ratio = target / currentScale;
            imgTranslateX = (1 - ratio) * (clientX - centerX) + ratio * imgTranslateX;
            imgTranslateY = (1 - ratio) * (clientY - centerY) + ratio * imgTranslateY;
            currentScale = target;
            clampTranslation();
            applyImageTransform(duration);
        }

        function snapToFit(duration = 240) {
            currentScale = minScale;
            imgTranslateX = 0;
            imgTranslateY = 0;
            swipeOffsetX = 0;
            clampTranslation();
            applyImageTransform(duration);
        }

        // 双击：未放大时放大到 2 倍（至少 1.2 倍），已放大时回到适配大小并居中
        function toggleZoomAt(clientX, clientY) {
            if (currentScale > minScale * 1.06) {
                snapToFit(240);
                return;
            }
            const target = Math.min(maxScale, Math.max(minScale * 2, 1.2));
            zoomAtPoint(clientX, clientY, target, 240);
        }

        function resetViewerState() {
            if (viewerTapTimer) { clearTimeout(viewerTapTimer); viewerTapTimer = null; }
            if (viewerTransformTimer) { clearTimeout(viewerTransformTimer); viewerTransformTimer = null; }
            viewerLastTapAt = 0;
            currentScale = 1;
            minScale = 1;
            imgTranslateX = 0;
            imgTranslateY = 0;
            swipeOffsetX = 0;
            isDraggingImg = false;
            initialPinchDistance = null;
            swipeIntent = null;
            const imgView = document.getElementById('modalImageView');
            if (imgView) {
                if (imgView.getAnimations) imgView.getAnimations().forEach(a => a.cancel());
                imgView.style.transition = '';
                imgView.style.opacity = '';
                imgView.style.transform = '';
                imgView.removeAttribute('src');
            }
        }

        // 浏览器地址栏收起/展开或横竖屏切换后，重新适配图片，避免按旧视口尺寸计算导致偏位
        let viewerResizeTimer = null;
        function refitViewerOnResize() {
            const modal = document.getElementById('imageModal');
            if (!modal || modal.classList.contains('hidden')) return;
            const imgView = document.getElementById('modalImageView');
            if (!imgView || !imgView.naturalWidth) return;
            const m = getViewerMetrics();
            const galleryMode = galleryImages.length > 1;
            const availW = m.width * (galleryMode ? 0.98 : 0.96);
            const availH = m.height * (galleryMode ? 0.98 : 0.96);
            const newMin = Math.min(availW / imgView.naturalWidth, availH / imgView.naturalHeight, 1) || 1;
            const wasAtFit = Math.abs(currentScale - minScale) < 0.02;
            minScale = newMin;
            maxScale = Math.max(minScale * 4, 2.5);
            if (wasAtFit) {
                currentScale = minScale;
                imgTranslateX = 0;
                imgTranslateY = 0;
            } else {
                currentScale = Math.max(minScale, Math.min(currentScale, maxScale));
                clampTranslation();
            }
            applyImageTransform(0);
        }
        window.addEventListener('resize', () => {
            if (viewerResizeTimer) clearTimeout(viewerResizeTimer);
            viewerResizeTimer = setTimeout(refitViewerOnResize, 120);
        });
        window.addEventListener('orientationchange', () => setTimeout(refitViewerOnResize, 220));

        function setupImageViewerModal() {
            const modal = document.getElementById('imageModal');
            const closeBtn = document.getElementById('closeImageModalBtn');
            const downloadBtn = document.getElementById('downloadImageBtn');
            const container = document.getElementById('imageContainer');
            const imgView = document.getElementById('modalImageView');
            const closeModal = () => {
                modal.classList.add('hidden');
                resetViewerState();
            };
            closeBtn.onclick = closeModal;
            document.getElementById('prevImageBtn').onclick = (e) => {
                e.stopPropagation();
                showGalleryImage(galleryIndex - 1);
            };
            document.getElementById('nextImageBtn').onclick = (e) => {
                e.stopPropagation();
                showGalleryImage(galleryIndex + 1);
            };
            document.addEventListener('keydown', (e) => {
                if (modal.classList.contains('hidden')) return;
                if (e.key === 'Escape') { closeModal(); return; }
                if (galleryImages.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    showGalleryImage(galleryIndex + (e.key === 'ArrowRight' ? 1 : -1));
                }
            });

            // ===== 单击关闭 / 双击缩放的判定 =====
            const TAP_MOVE_THRESHOLD = 10;   // 位移超过 10px 视为拖拽
            const TAP_TIME_THRESHOLD = 600;  // 按住超过 600ms 不算单击
            const DOUBLE_TAP_DELAY = 300;    // 两次点按在此时间内视为双击
            let pointerDownX = 0, pointerDownY = 0, pointerDownTime = 0;
            let pointerMoved = false;
            let pinchActive = false;

            const beginPointer = (x, y) => {
                pointerDownX = x;
                pointerDownY = y;
                pointerDownTime = Date.now();
                pointerMoved = false;
            };
            const movedBeyondThreshold = (x, y) => {
                return Math.hypot(x - pointerDownX, y - pointerDownY) > TAP_MOVE_THRESHOLD;
            };
            const isTap = (x, y) => {
                if (modal.classList.contains('hidden')) return false;
                if (pointerMoved) return false;
                if (movedBeyondThreshold(x, y)) return false;
                if (Date.now() - pointerDownTime > TAP_TIME_THRESHOLD) return false;
                return true;
            };
            const cancelPendingClose = () => {
                if (viewerTapTimer) { clearTimeout(viewerTapTimer); viewerTapTimer = null; }
            };
            // 双击：第一次点按先挂起关闭；第二次点按在 300ms 内且位置接近时改为缩放
            const registerTap = (x, y) => {
                const now = Date.now();
                if (viewerLastTapAt && now - viewerLastTapAt <= DOUBLE_TAP_DELAY
                    && Math.hypot(x - viewerLastTapX, y - viewerLastTapY) <= 40) {
                    cancelPendingClose();
                    viewerLastTapAt = 0;
                    toggleZoomAt(x, y);
                    return;
                }
                viewerLastTapAt = now;
                viewerLastTapX = x;
                viewerLastTapY = y;
                cancelPendingClose();
                viewerTapTimer = setTimeout(() => {
                    viewerTapTimer = null;
                    viewerLastTapAt = 0;
                    if (modal.classList.contains('hidden')) return;
                    suppressGalleryOpenUntil = Date.now() + 450;
                    closeModal();
                }, DOUBLE_TAP_DELAY);
            };

            // ===== 桌面端：滚轮以鼠标位置为中心缩放 =====
            container.addEventListener('wheel', (e) => {
                e.preventDefault();
                cancelPendingClose();
                viewerLastTapAt = 0;
                const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
                zoomAtPoint(e.clientX, e.clientY, currentScale * factor, 0);
            }, { passive: false });

            // ===== 桌面端：按下 / 拖拽 / 抬起 =====
            container.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                cancelPendingClose();
                isDraggingImg = true;
                startDragX = e.clientX - imgTranslateX;
                startDragY = e.clientY - imgTranslateY;
                beginPointer(e.clientX, e.clientY);
                imgView.style.transition = 'none';
            });
            window.addEventListener('mousemove', (e) => {
                if (!isDraggingImg) return;
                imgTranslateX = e.clientX - startDragX;
                imgTranslateY = e.clientY - startDragY;
                if (movedBeyondThreshold(e.clientX, e.clientY)) { pointerMoved = true; viewerLastTapAt = 0; }
                clampTranslation();
                updateImageTransform();
            });
            window.addEventListener('mouseup', (e) => {
                if (!isDraggingImg) return;
                isDraggingImg = false;
                if (isTap(e.clientX, e.clientY)) registerTap(e.clientX, e.clientY);
            });

            // ===== 移动端：单指拖拽 / 双指缩放 =====
            container.addEventListener('touchstart', (e) => {
                // 第一次点按后还在等待双击，此时按下第二根手指/第二次触摸先取消关闭
                cancelPendingClose();
                if (e.touches.length === 1) {
                    isDraggingImg = true;
                    swipeOffsetX = 0;
                    swipeIntent = null;
                    // 若上一次滑入动画尚未结束，先取消，避免手势冲突
                    if (imgView.getAnimations) imgView.getAnimations().forEach(a => a.cancel());
                    imgView.style.transition = 'none';
                    startDragX = e.touches[0].clientX - imgTranslateX;
                    startDragY = e.touches[0].clientY - imgTranslateY;
                    beginPointer(e.touches[0].clientX, e.touches[0].clientY);
                    pinchActive = false;
                } else if (e.touches.length === 2) {
                    isDraggingImg = false;
                    pointerMoved = true;
                    pinchActive = true;
                    viewerLastTapAt = 0;
                    swipeOffsetX = 0;
                    swipeIntent = null;
                    imgView.style.transition = 'none';
                    initialPinchDistance = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                    initialPinchScale = currentScale;
                }
            }, { passive: true });

            container.addEventListener('touchmove', (e) => {
                if (isDraggingImg && e.touches.length === 1) {
                    const t = e.touches[0];
                    const dx = t.clientX - pointerDownX;
                    const dy = t.clientY - pointerDownY;
                    if (!swipeIntent && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                        const canSwipe = window.innerWidth < 768
                            && galleryImages.length > 1
                            && currentScale <= minScale * 1.01;
                        swipeIntent = (canSwipe && Math.abs(dx) > Math.abs(dy) * 1.15) ? 'swipe' : 'pan';
                    }
                    if (swipeIntent === 'swipe') {
                        // 未放大时横向拖动 = 换图，跟手移动
                        swipeOffsetX = dx;
                        pointerMoved = true;
                        viewerLastTapAt = 0;
                        updateImageTransform();
                        return;
                    }
                    imgTranslateX = t.clientX - startDragX;
                    imgTranslateY = t.clientY - startDragY;
                    if (movedBeyondThreshold(t.clientX, t.clientY)) { pointerMoved = true; viewerLastTapAt = 0; }
                    clampTranslation();
                    updateImageTransform();
                } else if (e.touches.length === 2 && initialPinchDistance) {
                    const dist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                    );
                    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    let newScale = initialPinchScale * (dist / initialPinchDistance);
                    if (newScale < minScale) newScale = minScale;
                    if (newScale > maxScale) newScale = maxScale;
                    if (Math.abs(newScale - currentScale) > 0.0005) {
                        // 以双指中点为锚点缩放，图片不会从手指下“溜走”
                        const rect = imgView.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2 - imgTranslateX;
                        const centerY = rect.top + rect.height / 2 - imgTranslateY;
                        const ratio = newScale / currentScale;
                        imgTranslateX = (1 - ratio) * (midX - centerX) + ratio * imgTranslateX;
                        imgTranslateY = (1 - ratio) * (midY - centerY) + ratio * imgTranslateY;
                        currentScale = newScale;
                        clampTranslation();
                        updateImageTransform();
                    }
                }
            }, { passive: true });

            container.addEventListener('touchend', (e) => {
                if (e.touches.length === 0) {
                    const wasDragging = isDraggingImg;
                    isDraggingImg = false;
                    if (pinchActive) {
                        // 双指缩放结束：回到适配大小或接近适配大小时，自动回中，避免“缩小后跑偏”
                        pinchActive = false;
                        initialPinchDistance = null;
                        viewerLastTapAt = 0;
                        swipeIntent = null;
                        if (currentScale <= minScale * 1.02) snapToFit(220);
                        else { clampTranslation(); applyImageTransform(200); }
                        return;
                    }
                    if (wasDragging && e.changedTouches && e.changedTouches[0]) {
                        const t = e.changedTouches[0];
                        if (swipeIntent === 'swipe') {
                            const dx = swipeOffsetX;
                            const elapsed = Date.now() - pointerDownTime;
                            const shouldSwitch = Math.abs(dx) > 56 || (Math.abs(dx) > 30 && elapsed < 260);
                            if (shouldSwitch && galleryImages.length > 1) {
                                animateGallerySwipeOut(dx < 0 ? 1 : -1);
                            } else {
                                springBackGallerySwipe();
                            }
                        } else if (isTap(t.clientX, t.clientY)) {
                            // 阻止 touchend 之后浏览器补发的 click 穿透到文档图片
                            if (e.cancelable) e.preventDefault();
                            registerTap(t.clientX, t.clientY);
                        }
                    }
                    swipeIntent = null;
                }
                if (e.touches.length < 2) initialPinchDistance = null;
            });

            // ===== 下载图片 =====
            downloadBtn.onclick = () => {
                if (!currentModalImgSrc) { showToast('图片未加载', 'error'); return; }
                const src = currentModalImgSrc;
                let srcExt = 'jpg';
                if (src.startsWith('data:image/png')) srcExt = 'png';
                else if (src.startsWith('data:image/webp')) srcExt = 'webp';
                else if (src.startsWith('data:image/gif')) srcExt = 'gif';
                else if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) srcExt = 'jpg';
                else if (src.startsWith('data:image/')) {
                    const m = src.match(/^data:image\/([a-zA-Z0-9.+-]+)/);
                    if (m) { srcExt = m[1].toLowerCase(); if (srcExt === 'jpeg') srcExt = 'jpg'; }
                }
                const targetExt = srcExt === 'webp' ? 'png' : srcExt;
                const filename = `knowledge_image_${Date.now()}.${targetExt}`;

                prepareAndDownload(filename, async () => {
                    let sourceUrl = src;
                    if (!src.startsWith('data:')) {
                        const resp = await fetch(src);
                        if (!resp.ok) throw new Error('获取图片失败');
                        const blob = await resp.blob();
                        if (!blob || blob.size === 0) throw new Error('图片内容为空');
                        sourceUrl = await new Promise((res, rej) => {
                            const r = new FileReader();
                            r.onload = () => res(r.result);
                            r.onerror = () => rej(new Error('图片读取失败'));
                            r.readAsDataURL(blob);
                        });
                    }
                    if (srcExt === 'webp') return await convertDataUrlToBlobType(sourceUrl, 'image/png');
                    return dataURLtoBlob(sourceUrl);
                });
            };
        }
        // 从正文里的某张图打开查看器，并把同文档的全部图片一起带上
        function openGalleryFromImage(imgEl) {
            if (Date.now() < suppressGalleryOpenUntil) return;
            const scope = imgEl.closest('.markdown-body') || document.getElementById('viewContent') || document.getElementById('editPreview');
            let imgs = scope ? Array.from(scope.querySelectorAll('img')) : [imgEl];
            imgs = imgs.filter(el => {
                const src = el.getAttribute('src');
                return src && !el.closest('.md-img-frame.is-error');
            });
            const srcs = imgs.map(el => el.getAttribute('src'));
            let index = imgs.indexOf(imgEl);
            if (index < 0) index = Math.max(0, srcs.indexOf(imgEl.getAttribute('src')));
            openImageViewerModal(imgEl.getAttribute('src'), srcs, index);
        }

        function openImageViewerModal(src, images, index) {
            galleryImages = (Array.isArray(images) && images.length) ? images.slice() : [src];
            let idx = Number.isInteger(index) ? index : galleryImages.indexOf(src);
            if (idx < 0 || idx >= galleryImages.length) idx = 0;
            // 关闭输入法/键盘，避免键盘把可视区压矮，导致查看器只占半屏
            const active = document.activeElement;
            if (active && active !== document.body && typeof active.blur === 'function') {
                try { active.blur(); } catch (e) {}
            }
            // 打开前重新同步视口高度，保证查看器占满真实可视区
            syncAppViewportHeight();
            renderGalleryThumbs();
            showGalleryImage(idx);
            setTimeout(() => {
                syncAppViewportHeight();
                refitViewerOnResize();
            }, 260);
        }

        // 移动端滑动切图：旧图滑出
        function animateGallerySwipeOut(dir) {
            const imgView = document.getElementById('modalImageView');
            const startX = swipeOffsetX;
            const exitX = (dir > 0 ? -1 : 1) * window.innerWidth * 0.55;
            if (imgView.animate) {
                imgView.animate([
                    { transform: `translate3d(${startX}px, ${imgTranslateY}px, 0px) scale(${currentScale})`, opacity: 1 },
                    { transform: `translate3d(${exitX}px, ${imgTranslateY}px, 0px) scale(${currentScale})`, opacity: 0.15 }
                ], { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
            }
            setTimeout(() => showGalleryImage(galleryIndex + dir, dir), 150);
        }

        // 移动端滑动未达阈值：回弹
        function springBackGallerySwipe() {
            const imgView = document.getElementById('modalImageView');
            const from = swipeOffsetX;
            swipeOffsetX = 0;
            imgView.style.transition = 'none';
            updateImageTransform();
            if (imgView.animate) {
                imgView.animate([
                    { transform: `translate3d(${from}px, ${imgTranslateY}px, 0px) scale(${currentScale})` },
                    { transform: `translate3d(0px, ${imgTranslateY}px, 0px) scale(${currentScale})` }
                ], { duration: 200, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' });
            }
        }

        function showGalleryImage(index, slideFrom = 0) {
            if (!galleryImages.length) return;
            galleryIndex = (index + galleryImages.length) % galleryImages.length;
            const src = galleryImages[galleryIndex];
            currentModalImgSrc = src;

            const modal = document.getElementById('imageModal');
            const imgView = document.getElementById('modalImageView');
            const slideSwitch = !!slideFrom;

            if (viewerTapTimer) { clearTimeout(viewerTapTimer); viewerTapTimer = null; }
            if (viewerTransformTimer) { clearTimeout(viewerTransformTimer); viewerTransformTimer = null; }
            viewerLastTapAt = 0;
            if (imgView.getAnimations) imgView.getAnimations().forEach(a => a.cancel());
            // 先显示再测量：隐藏状态下 getBoundingClientRect 为 0，会导致适配比例算错
            modal.classList.remove('hidden');
            if (slideSwitch) {
                // 滑动切图：旧图立即隐藏，避免回弹闪烁，新图由滑入动画接管
                imgView.style.transition = 'none';
                imgView.style.opacity = '0';
                imgView.classList.remove('opacity-0');
            } else {
                imgView.classList.add('opacity-0');
            }
            imgTranslateX = 0;
            imgTranslateY = 0;
            swipeOffsetX = 0;
            swipeIntent = null;
            isDraggingImg = false;

            const fit = () => {
                const m = getViewerMetrics();
                const galleryMode = galleryImages.length > 1;
                // metrics 已扣除底部缩略图安全区，这里再留一点边距
                const availW = m.width * (galleryMode ? 0.98 : 0.96);
                const availH = m.height * (galleryMode ? 0.98 : 0.96);
                const natW = imgView.naturalWidth || 800;
                const natH = imgView.naturalHeight || 600;
                minScale = Math.min(availW / natW, availH / natH, 1.0) || 1;
                currentScale = minScale;
                // 允许放大到 4 倍适配尺寸；小图至少可以放大到 2.5 倍
                maxScale = Math.max(minScale * 4, 2.5);
                imgView.style.width = natW + 'px';
                imgView.style.height = natH + 'px';
                imgView.style.transition = 'none';
                updateImageTransform();
                if (slideSwitch) {
                    imgView.style.transition = '';
                    imgView.style.opacity = '';
                } else {
                    imgView.classList.remove('opacity-0');
                }
                if (slideFrom && imgView.animate) {
                    // 新图从手势方向滑入，和滑动动作衔接
                    const offset = slideFrom * Math.min(window.innerWidth * 0.42, 320);
                    imgView.animate([
                        { transform: `translate3d(${offset}px, 0px, 0px) scale(${currentScale})`, opacity: 0.35 },
                        { transform: `translate3d(0px, 0px, 0px) scale(${currentScale})`, opacity: 1 }
                    ], { duration: 260, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' });
                }
            };
            imgView.onload = fit;
            imgView.onerror = () => {
                if (slideSwitch) { imgView.style.transition = ''; imgView.style.opacity = ''; }
                imgView.classList.remove('opacity-0');
            };
            imgView.src = src;
            if (imgView.complete && imgView.naturalWidth > 0) fit();

            const counter = document.getElementById('galleryCounter');
            if (counter) counter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
            updateGalleryThumbsActive();
        }

        function renderGalleryThumbs() {
            const thumbs = document.getElementById('galleryThumbs');
            const prevBtn = document.getElementById('prevImageBtn');
            const nextBtn = document.getElementById('nextImageBtn');
            const counter = document.getElementById('galleryCounter');
            const multiple = galleryImages.length > 1;

            const modal = document.getElementById('imageModal');
            if (modal) modal.classList.toggle('has-gallery', multiple);
            if (counter) {
                counter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
                counter.classList.toggle('hidden', !multiple);
            }
            if (prevBtn) prevBtn.classList.toggle('hidden', !multiple);
            if (nextBtn) nextBtn.classList.toggle('hidden', !multiple);
            if (!thumbs) return;
            thumbs.classList.toggle('hidden', !multiple);
            thumbs.innerHTML = '';
            if (!multiple) return;

            galleryImages.forEach((src, i) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'gallery-thumb';
                btn.dataset.index = String(i);
                btn.setAttribute('aria-label', `查看第 ${i + 1} 张图片`);
                const thumbImg = document.createElement('img');
                thumbImg.src = src;
                thumbImg.alt = '';
                btn.appendChild(thumbImg);
                btn.onclick = (e) => { e.stopPropagation(); showGalleryImage(i); };
                thumbs.appendChild(btn);
            });
            updateGalleryThumbsActive();
        }

        function updateGalleryThumbsActive() {
            const thumbs = document.getElementById('galleryThumbs');
            if (!thumbs) return;
            thumbs.querySelectorAll('.gallery-thumb').forEach((btn) => {
                btn.classList.toggle('is-active', Number(btn.dataset.index) === galleryIndex);
            });
        }

        function setupImageHandling() {
            const textarea = document.getElementById('editContentInput');
            const fileInput = document.getElementById('attachmentUploadInput');
            textarea.addEventListener('paste', function(e) {
                const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                for (let item of items) {
                    if (item.type.indexOf('image') === 0) { e.preventDefault(); uploadImageAsJson(item.getAsFile()); }
                }
            });
            fileInput.addEventListener('change', async function(e) {
                const files = e.target.files;
                if (files && files.length) await handleAttachmentUpload(files);
                fileInput.value = '';
            });
        }

        async function deleteGithubImageJsonsInContent(content) {
            if (!githubConfig.token || !githubConfig.repo || !content) return;
            const regex = /images\/img_\d+(?:_\d+)?\.json/g;
            const matches = content.match(regex);
            if (!matches) return;
            const uniquePaths = [...new Set(matches)];
            uniquePaths.forEach(p => imageJsonCache.delete(p));
            await Promise.allSettled(uniquePaths.map(jsonPath => deleteGithubFileByPath(jsonPath)));
        }

        // 插入图片 Markdown：只在前后确实需要时补一个换行，
        // 空编辑区或行首/行尾已有换行时不额外加，避免出现上下各一条空白行
        function insertImageMarkdown(textarea, filename) {
            if (!textarea) return;
            const value = textarea.value;
            const start = textarea.selectionStart ?? value.length;
            const end = textarea.selectionEnd ?? value.length;
            const before = value.slice(0, start);
            const after = value.slice(end);
            const snippet = `![图片](${filename})`;
            const prefix = before.length && !before.endsWith('\n') ? '\n' : '';
            const suffix = after.length && !after.startsWith('\n') ? '\n' : '';
            const inserted = prefix + snippet + suffix;
            textarea.value = before + inserted + after;
            const caret = start + inserted.length;
            textarea.selectionStart = textarea.selectionEnd = caret;
        }

        function closeMobileSidebar() {
            if (window.innerWidth < 1024) {
                document.getElementById('sidebar').classList.add('-translate-x-full');
                document.getElementById('sidebarOverlay').classList.add('hidden');
            }
        }
