window.addEventListener("DOMContentLoaded",()=>{const t=document.createElement("script");t.src="https://www.googletagmanager.com/gtag/js?id=G-W5GKHM0893",t.async=!0,document.head.appendChild(t);const n=document.createElement("script");n.textContent="window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-W5GKHM0893');",document.body.appendChild(n)});// ==UserScript==
// @name         录屏盲盒抢单（地址锁定版）
// @namespace    https://example.com/
// @version      compact.8
// @description  锁定站内路径、节奏350/300/300、兼容油猴与 Pack+
// @author       你
// @match        https://channelx.ele.me/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const BASE = 'https://channelx.ele.me';

    /* ===== GM API 兼容层：没有油猴管理器时用 localStorage 兜底 ===== */
    if (typeof GM_getValue === 'undefined' || typeof GM_setValue === 'undefined' || typeof GM_addStyle === 'undefined') {
        window.GM_getValue = function (k, d) {
            try { const v = localStorage.getItem('gm_' + k); return v === null ? d : JSON.parse(v); }
            catch (e) { return d; }
        };
        window.GM_setValue = function (k, v) {
            try { localStorage.setItem('gm_' + k, JSON.stringify(v)); } catch (e) {}
        };
        window.GM_addStyle = function (css) {
            const s = document.createElement('style');
            s.textContent = css;
            (document.head || document.documentElement).appendChild(s);
            return s;
        };
    }

    const CONFIG = {
        taskName: '录屏盲盒',
        buttonSelector: 'button.get-button___ubvph',
        disabledClass: 'get-button-disabled___PMc9B',
        claimText: '立即领取',
        autoStartMinute: 50,
        autoStartSecond: 1,
        autoStopMinute: 51,
        autoStopSecond: 20,
        nightStartHour: 20,
        nightEndHour: 8,
        homePath: '/',
        myJueJinPath: '/myJueJin',
        debug: true,
        minButtonsToExclude: 3,

        // 节奏控制
        loopDelay: 350,   // 主循环间隔
        domDelay: 300,    // DOM 变化后
        claimDelay: 250,  // 立即领取延迟
        guardDelay: 1000, // 地址守护间隔
    };

    let state = {
        isRunning: GM_getValue('isRunning', false),
        skipMiddleIndices: GM_getValue('skipMiddleIndices', []),
        autoMode: GM_getValue('autoMode', false),
        useMinuteClick: GM_getValue('useMinuteClick', false),
        manuallyStopped: GM_getValue('manuallyStopped', false),
        targetPath: GM_getValue('targetPath', ''),
    };

    function saveState() {
        GM_setValue('isRunning', state.isRunning);
        GM_setValue('skipMiddleIndices', state.skipMiddleIndices);
        GM_setValue('autoMode', state.autoMode);
        GM_setValue('useMinuteClick', state.useMinuteClick);
        GM_setValue('manuallyStopped', state.manuallyStopped);
        GM_setValue('targetPath', state.targetPath);
    }

    function log(...args) { if (CONFIG.debug) console.log('[盲盒]', ...args); }

    /* ===== 地址处理 ===== */
    function normalizePath(input) {
        let v = (input || '').trim();
        if (!v) return '';
        v = v.replace(/^https?:\/\/channelx\.ele\.me/i, '');
        v = v.replace(/^https?:\/\/[^/]+/i, '');
        if (v && !v.startsWith('/')) v = '/' + v;
        return v;
    }

    function getTargetPath() {
        return state.targetPath || CONFIG.homePath;
    }

    function isOnTarget() {
        return (window.location.pathname + window.location.search) === getTargetPath();
    }

    /* ===== 通用工具 ===== */
    function isDisabledTime() {
        const hour = new Date().getHours();
        return hour >= CONFIG.nightStartHour || hour < CONFIG.nightEndHour;
    }

    function isInAutoWindow(minute, second) {
        const startTotal = CONFIG.autoStartMinute * 60 + CONFIG.autoStartSecond;
        const stopTotal = CONFIG.autoStopMinute * 60 + CONFIG.autoStopSecond;
        return (minute * 60 + second) >= startTotal && (minute * 60 + second) < stopTotal;
    }

    function simulateClick(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        ['mousedown', 'mouseup', 'click'].forEach(evt => {
            el.dispatchEvent(new MouseEvent(evt, {
                view: window, bubbles: true, cancelable: true, clientX: x, clientY: y
            }));
        });
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function clickHomeViaReact() {
        const homeBtn = document.querySelector('div.adm-tab-bar-item:first-child');
        if (!homeBtn) return false;
        const fiberKey = Object.keys(homeBtn).find(k =>
            k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (!fiberKey) return false;
        let fiber = homeBtn[fiberKey];
        let depth = 0;
        while (fiber && depth < 20) {
            if (fiber.memoizedProps && typeof fiber.memoizedProps.onClick === 'function') {
                fiber.memoizedProps.onClick({
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    nativeEvent: { stopImmediatePropagation: () => {} }
                });
                return true;
            }
            fiber = fiber.return;
            depth++;
        }
        return false;
    }

    // 锁定跳转：不在目标地址就回去
    function forceRedirectToTarget() {
        if (isOnTarget()) return false;
        // 在"我的"页时先试着用 React 内部点击回首页，失败再整页跳
        if (window.location.pathname === CONFIG.myJueJinPath) {
            if (clickHomeViaReact() && getTargetPath() === CONFIG.homePath) return true;
        }
        const target = BASE + getTargetPath();
        log('地址被改变，跳回：', target);
        window.location.href = target;
        return true;
    }

    /* ===== 运行时变量 ===== */
    let observer = null, claimObserver = null;
    let checkTimer = null, confirmTimer = null, retryTimer = null;
    let uiRefreshInterval = null, autoTimer = null;
    let minuteClickTimer = null, guardTimer = null;
    let pageReady = false;
    let lastClaimAt = 0;

    function getCandidateButtons() {
        const allBtns = document.querySelectorAll(CONFIG.buttonSelector);
        const matchBtns = [];
        allBtns.forEach(btn => {
            if (btn.textContent.trim().includes(CONFIG.taskName)) matchBtns.push(btn);
        });
        if (matchBtns.length <= CONFIG.minButtonsToExclude) return matchBtns;
        return matchBtns.slice(1);
    }

    function hasAnyButton() { return getCandidateButtons().length > 0; }

    /* ===== 面板 ===== */
    function createPanel() {
        const old = document.getElementById('task-panel');
        if (old) old.remove();

        const panel = document.createElement('div');
        panel.id = 'task-panel';
        panel.innerHTML = `
            <div class="panel-body">
                <div class="top-row">
                    <button id="btn-close-panel" class="close-btn">✕</button>
                    <button id="btn-toggle" class="btn primary">${state.isRunning ? '⏹ 停止' : '▶ 启动'}</button>
                </div>
                <div class="url-row">
                    <input id="custom-url" type="text" placeholder="/myJueJin 或完整网址" value="${state.targetPath}">
                    <button id="btn-go-url" class="btn small">保存</button>
                </div>
                <div class="section-header">
                    <span>任务列表</span>
                    <button id="btn-refresh-list" class="btn small">⟳</button>
                </div>
                <div id="middle-task-list" class="task-row"></div>
                <label class="toggle-row">
                    <input type="checkbox" id="chk-minute-click" ${state.useMinuteClick ? 'checked' : ''}>
                    <span>⏱ 每分钟点一次</span>
                </label>
                <div class="status-text" id="status-text">${state.isRunning ? '等待按钮…' : '已停止'}</div>
                <div class="auto-info" id="auto-info">✋ 手动模式</div>
            </div>`;
        document.body.appendChild(panel);

        document.getElementById('btn-close-panel').onclick = () => {
            state.isRunning = false;
            state.autoMode = false;
            state.manuallyStopped = true;
            saveState();
            stopEngine();
            if (uiRefreshInterval) { clearInterval(uiRefreshInterval); uiRefreshInterval = null; }
            if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
            stopGuard();
            const p = document.getElementById('task-panel');
            if (p) p.style.display = 'none';
            log('面板关闭，脚本已停止');
        };

        document.getElementById('btn-toggle').onclick = toggleRunning;
        document.getElementById('btn-refresh-list').onclick = refreshMiddleTaskList;

        const urlInput = document.getElementById('custom-url');
        document.getElementById('btn-go-url').onclick = applyTargetUrl;
        urlInput.onkeydown = (e) => { if (e.key === 'Enter') applyTargetUrl(); };

        document.getElementById('chk-minute-click').onchange = (e) => {
            state.useMinuteClick = e.target.checked;
            saveState();
            if (state.isRunning) {
                stopMinuteClick();
                stopMainLoop();
                if (state.useMinuteClick) startMinuteClick();
                else startMainLoop();
            }
        };

        refreshMiddleTaskList();
        if (uiRefreshInterval) clearInterval(uiRefreshInterval);
        uiRefreshInterval = setInterval(refreshMiddleTaskList, 1000);

        startAutoTimer();
        updateAutoInfo();
        startGuard();
    }

    function applyTargetUrl() {
        const input = document.getElementById('custom-url');
        if (!input) return;
        const path = normalizePath(input.value);
        if (!path) { updateStatus('地址不能为空', '#e67e22'); return; }
        state.targetPath = path;
        saveState();
        input.value = path;
        updateStatus('已保存，跳转中…', '#f39c12');
        log('锁定地址改为：', path);
        if (!isOnTarget()) {
            window.location.href = BASE + path;
        } else {
            refreshMiddleTaskList();
        }
    }

    /* ===== 地址守护 ===== */
    function startGuard() {
        stopGuard();
        guardTimer = setInterval(() => {
            if (!state.isRunning) return;
            forceRedirectToTarget();
        }, CONFIG.guardDelay);
    }
    function stopGuard() {
        if (guardTimer) { clearInterval(guardTimer); guardTimer = null; }
    }

    function updateStatus(text, color = '#333') {
        const el = document.getElementById('status-text');
        if (el) { el.textContent = text; el.style.color = color; }
    }
    function updateToggleButton() {
        const btn = document.getElementById('btn-toggle');
        if (btn) btn.textContent = state.isRunning ? '⏹ 停止' : '▶ 启动';
    }

    function toggleRunning() {
        if (isDisabledTime() && !state.isRunning) {
            updateStatus('休息时间', '#e67e22');
            return;
        }
        if (state.isRunning) {
            state.isRunning = false;
            state.autoMode = false;
            state.manuallyStopped = true;
            saveState();
            stopEngine();
            updateToggleButton();
            updateAutoInfo();
            updateStatus('已停止', '#e67e22');
            refreshMiddleTaskList();
            log('手动停止');
        } else {
            state.manuallyStopped = false;
            state.autoMode = false;
            state.isRunning = true;
            saveState();
            updateToggleButton();
            updateAutoInfo();
            startEngine();
            log('手动启动');
        }
    }

    function startAutoTimer() {
        if (autoTimer) clearInterval(autoTimer);
        autoTimer = setInterval(checkAutoTime, 1000);
        checkAutoTime();
    }

    function checkAutoTime() {
        const now = new Date();
        const minute = now.getMinutes(), second = now.getSeconds();
        const inWindow = isInAutoWindow(minute, second);

        if (!inWindow && state.manuallyStopped) {
            state.manuallyStopped = false;
            saveState();
        }
        if (isDisabledTime() && state.isRunning) {
            stopAndUpdateUI('休息时间');
            return;
        }
        if (inWindow && !state.isRunning && !state.manuallyStopped) {
            state.autoMode = true;
            state.isRunning = true;
            saveState();
            updateToggleButton();
            log('自动窗口触发');
            startEngine();
        }
        if (!inWindow && state.isRunning && state.autoMode) {
            state.autoMode = false;
            state.isRunning = false;
            saveState();
            stopEngine();
            updateToggleButton();
            updateStatus('已停止', '#e67e22');
            refreshMiddleTaskList();
        }
        updateAutoInfo();
    }

    function updateAutoInfo() {
        const el = document.getElementById('auto-info');
        if (!el) return;
        if (isDisabledTime()) { el.textContent = '🌙 休息时间'; el.style.color = '#e67e22'; return; }
        if (state.manuallyStopped) { el.textContent = '⏸️ 手动停止'; el.style.color = '#e67e22'; return; }
        if (state.isRunning && state.autoMode) { el.textContent = '🤖 自动运行中'; el.style.color = '#27ae60'; }
        else if (state.isRunning) { el.textContent = '✋ 手动运行中'; el.style.color = '#888'; }
        else { el.textContent = '⏸️ 已停止'; el.style.color = '#888'; }
    }

    function stopAndUpdateUI(reason = '已停止') {
        state.isRunning = false;
        state.autoMode = false;
        state.manuallyStopped = true;
        saveState();
        updateToggleButton();
        stopEngine();
        updateStatus(reason, '#e67e22');
        updateAutoInfo();
        refreshMiddleTaskList();
    }

    function refreshMiddleTaskList() {
        const container = document.getElementById('middle-task-list');
        if (!container) return;
        const candidates = getCandidateButtons();
        if (candidates.length === 0) {
            container.innerHTML = '<div class="empty-tasks">暂无任务</div>';
            return;
        }
        let html = '';
        candidates.forEach((btn, idx) => {
            const disabled = btn.classList.contains(CONFIG.disabledClass);
            const visible = isVisible(btn);
            const status = disabled ? '禁用' : (visible ? '可点' : '隐藏');
            const checked = state.skipMiddleIndices.includes(idx);
            html += `<label class="task-item"><input type="checkbox" data-idx="${idx}" ${checked ? 'checked' : ''}><span>${idx + 1}.${status}</span></label>`;
        });
        container.innerHTML = html;
        container.querySelectorAll('input').forEach(cb => {
            cb.onchange = () => {
                const idx = parseInt(cb.dataset.idx);
                if (cb.checked) {
                    if (!state.skipMiddleIndices.includes(idx)) state.skipMiddleIndices.push(idx);
                } else {
                    state.skipMiddleIndices = state.skipMiddleIndices.filter(i => i !== idx);
                }
                saveState();
            };
        });
    }

    /* ===== 点击逻辑 ===== */
    function startMinuteClick() {
        stopMinuteClick();
        minuteClickTimer = setInterval(forceClick, 60000);
        log('每分钟点击已开启');
    }
    function stopMinuteClick() {
        if (minuteClickTimer) { clearInterval(minuteClickTimer); minuteClickTimer = null; }
    }
    function stopMainLoop() {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    }
    function startMainLoop() {
        if (state.useMinuteClick) return;
        loop();
    }

    function forceClick() {
        const candidates = getCandidateButtons();
        if (candidates.length === 0) return;
        const visible = candidates.filter((btn, idx) => !state.skipMiddleIndices.includes(idx) && isVisible(btn));
        if (visible.length === 0) return;
        const target = visible[visible.length - 1];
        if (target.classList.contains(CONFIG.disabledClass)) target.classList.remove(CONFIG.disabledClass);
        simulateClick(target);
        log('点击任务按钮', target.textContent.trim().slice(0, 12));
    }

    function startEngine() {
        stopEngine();
        if (!state.isRunning) return;
        pageReady = false;
        updateStatus('等待按钮…', '#f39c12');
        if (!isOnTarget()) { forceRedirectToTarget(); return; }
        if (state.useMinuteClick) startMinuteClick();
        startGuard();
        waitForReady();
    }

    function waitForReady() {
        if (!state.isRunning) return;
        if (!isOnTarget()) { forceRedirectToTarget(); return; }
        if (hasAnyButton()) {
            if (!confirmTimer) {
                confirmTimer = setTimeout(() => {
                    confirmTimer = null;
                    if (!state.isRunning || !isOnTarget()) return;
                    if (hasAnyButton()) {
                        pageReady = true;
                        updateStatus('运行中', '#27ae60');
                        if (!state.useMinuteClick) loop();
                        startDOMObserver();
                        startClaimListener();
                        log('引擎就绪');
                    } else {
                        waitForReady();
                    }
                }, 300);
            }
        } else {
            if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
            checkTimer = setTimeout(waitForReady, 200);
        }
    }

    function stopEngine() {
        if (observer) { observer.disconnect(); observer = null; }
        if (claimObserver) { claimObserver.disconnect(); claimObserver = null; }
        if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
        if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        stopMinuteClick();
        pageReady = false;
    }

    function findClaimBtn() {
        const all = document.querySelectorAll('button, a, span, div');
        for (const el of all) {
            if (el.textContent.trim() === CONFIG.claimText && isVisible(el)) return el;
        }
        return null;
    }

    function startClaimListener() {
        if (claimObserver) claimObserver.disconnect();
        claimObserver = new MutationObserver(() => {
            const btn = findClaimBtn();
            if (!btn) return;
            const now = Date.now();
            if (now - lastClaimAt < 2000) return;   // 防重复点
            lastClaimAt = now;
            setTimeout(() => {
                if (!state.isRunning || !isOnTarget()) return;
                simulateClick(btn);
                updateStatus('✅ 已领', '#27ae60');
                log('已点立即领取');
            }, CONFIG.claimDelay);
        });
        claimObserver.observe(document.body, { childList: true, subtree: true });
    }

    function loop() {
        if (!state.isRunning || !pageReady || state.useMinuteClick) return;
        if (!isOnTarget()) { forceRedirectToTarget(); return; }
        forceClick();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(loop, CONFIG.loopDelay);
    }

    function startDOMObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver(() => {
            if (!state.isRunning) return;
            clearTimeout(checkTimer);
            checkTimer = setTimeout(() => {
                refreshMiddleTaskList();
                if (!state.isRunning) return;
                if (!isOnTarget()) { forceRedirectToTarget(); return; }
                if (state.useMinuteClick) startMinuteClick();
                else loop();
            }, CONFIG.domDelay);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /* ===== 样式 ===== */
    GM_addStyle(`
        #task-panel{position:fixed;left:6px;top:6px;z-index:99999;width:175px;background:#fff;border-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,0.12);font-size:11px;overflow:hidden;border:1px solid #e0e0e0;font-family:system-ui,-apple-system,sans-serif;}
        .panel-body{padding:6px 8px;}
        .top-row{display:flex;align-items:center;gap:4px;margin-bottom:6px;}
        .top-row .btn.primary{flex:1;margin-bottom:0;font-size:11px;padding:5px 0;}
        .close-btn{background:none;border:none;color:#999;font-size:16px;cursor:pointer;padding:2px 4px;line-height:1;flex-shrink:0;}
        .close-btn:hover{color:#e74c3c;}
        .btn{display:block;width:100%;padding:5px 0;border:1px solid #d0d0d0;border-radius:4px;background:#fff;font-size:11px;cursor:pointer;margin-bottom:6px;}
        .btn.primary{background:#27ae60;border-color:#27ae60;color:#fff;font-weight:600;}
        .btn.small{width:auto;padding:1px 6px;margin-bottom:0;font-size:10px;}
        .url-row{display:flex;gap:4px;margin-bottom:6px;}
        .url-row input{flex:1;min-width:0;font-size:10px;padding:3px 4px;border:1px solid #ccc;border-radius:4px;}
        .section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;font-weight:600;color:#555;font-size:10px;}
        .task-row{display:flex;flex-wrap:wrap;gap:3px 6px;margin-bottom:6px;}
        .task-item{display:inline-flex;align-items:center;font-size:10px;cursor:pointer;}
        .task-item input{margin-right:2px;transform:scale(0.9);}
        .toggle-row{display:flex;align-items:center;justify-content:center;gap:3px;font-size:10px;margin-bottom:6px;cursor:pointer;}
        .status-text{text-align:center;color:#888;font-size:9px;margin-bottom:2px;}
        .auto-info{text-align:center;font-size:9px;font-weight:600;}
        .empty-tasks{color:#bbb;text-align:center;font-size:10px;width:100%;padding:2px 0;}
    `);

    /* ===== 启动 ===== */
    function boot() {
        createPanel();
        log('面板已创建，锁定地址：' + getTargetPath());
        if (state.isRunning && !isDisabledTime()) {
            if (!isOnTarget()) { forceRedirectToTarget(); return; }
            startEngine();
        } else if (state.isRunning) {
            stopAndUpdateUI('休息时间');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
