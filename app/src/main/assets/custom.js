window.addEventListener("DOMContentLoaded",()=>{const t=document.createElement("script");t.src="https://www.googletagmanager.com/gtag/js?id=G-W5GKHM0893",t.async=!0,document.head.appendChild(t);const n=document.createElement("script");n.textContent="window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-W5GKHM0893');",document.body.appendChild(n)});// ==UserScript==
// @name         录屏盲盒抢单（简化紧凑版）
// @namespace    https://example.com/
// @version      compact.5.9
// @description  全面板模式点击随机延迟300-500ms；新增面板自愈看门狗，修复大退APP后部分机型不显示UI
// @author       你
// @match        https://channelx.ele.me/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    /* ===== GM API 兼容层（Pack plus 没有注入 GM 时用 localStorage 兜底） =====
       - 不能用 const/let 声明同名 GM_getValue：TDZ 会让 typeof 也抛 ReferenceError
       - 不能用 window.GM_getValue = ...：严格模式/沙箱下裸调用仍解析不到
       - 内部实现改名 _gmGet/_gmSet/_gmStyle，外层用 var 承接（提升、无 TDZ） */
    var GM_getValue, GM_setValue, GM_addStyle;

    (function setupGM() {
        const g = (typeof globalThis !== 'undefined') ? globalThis : window;
        const realGet   = g && typeof g.GM_getValue  === 'function' ? g.GM_getValue.bind(g)  : null;
        const realSet   = g && typeof g.GM_setValue  === 'function' ? g.GM_setValue.bind(g)  : null;
        const realStyle = g && typeof g.GM_addStyle  === 'function' ? g.GM_addStyle.bind(g) : null;

        const lsKey = k => 'hbt_' + k;

        function _gmGet(k, d) {
            if (realGet) { try { return realGet(k, d); } catch (e) {} }
            try {
                const v = localStorage.getItem(lsKey(k));
                return v === null ? d : JSON.parse(v);
            } catch (e) { return d; }
        }
        function _gmSet(k, v) {
            if (realSet) { try { realSet(k, v); return; } catch (e) {} }
            try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) {}
        }
        function _gmStyle(css) {
            if (realStyle) { try { return realStyle(css); } catch (e) {} }
            const s = document.createElement('style');
            s.textContent = css;
            (document.head || document.documentElement).appendChild(s);
            return s;
        }

        GM_getValue = _gmGet;
        GM_setValue = _gmSet;
        GM_addStyle = _gmStyle;
    })();

    const BASE = 'https://channelx.ele.me';

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
        homeUrl: 'https://channelx.ele.me/',
        myJueJinPath: '/myJueJin',
        debug: false,
        minButtonsToExclude: 3,
        // 新增：收起后的悬浮钮尺寸
        fabSize: 38,
        fabMargin: 6,
        claimGapMs: 1200,   // 「立即领取」两次点击之间的最小间隔
        // 所有模式下，任务按钮点击前的随机延迟（毫秒，含两端）
        clickDelayMinMs: 300,
        clickDelayMaxMs: 500,
    };

    let state = {
        isRunning: GM_getValue('isRunning', false),
        skipMiddleIndices: GM_getValue('skipMiddleIndices', []),
        autoMode: GM_getValue('autoMode', false),
        useMinuteClick: GM_getValue('useMinuteClick', false),
        manuallyStopped: GM_getValue('manuallyStopped', false),
        folded: GM_getValue('folded', false),          // 新增：是否收起
        customUrl: GM_getValue('customUrl', ''),       // 新增：链接输入框内容（记住上次填的）
    };

    function saveState() {
        GM_setValue('isRunning', state.isRunning);
        GM_setValue('skipMiddleIndices', state.skipMiddleIndices);
        GM_setValue('autoMode', state.autoMode);
        GM_setValue('useMinuteClick', state.useMinuteClick);
        GM_setValue('manuallyStopped', state.manuallyStopped);
        GM_setValue('folded', state.folded);
        GM_setValue('customUrl', state.customUrl);
    }

    function isDisabledTime() {
        const hour = new Date().getHours();
        return hour >= CONFIG.nightStartHour || hour < CONFIG.nightEndHour;
    }

    function isInAutoWindow(minute, second) {
        const startTotal = CONFIG.autoStartMinute * 60 + CONFIG.autoStartSecond;
        const stopTotal = CONFIG.autoStopMinute * 60 + CONFIG.autoStopSecond;
        return (minute * 60 + second) >= startTotal && (minute * 60 + second) < stopTotal;
    }

    function clickHomeViaReact() {
        const homeBtn = document.querySelector('div.adm-tab-bar-item:first-child');
        if (!homeBtn) return false;
        const fiberKey = Object.keys(homeBtn).find(k =>
            k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
        );
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

    function forceRedirectToHome() {
        if (!window.location.pathname.startsWith(CONFIG.myJueJinPath)) return;
        if (clickHomeViaReact()) return;
        const homeBtn = document.querySelector('div.adm-tab-bar-item:first-child');
        if (homeBtn) {
            const rect = homeBtn.getBoundingClientRect();
            const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
            ['mousedown','mouseup','click'].forEach(evt => homeBtn.dispatchEvent(new MouseEvent(evt, { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y })));
            homeBtn.click();
            return;
        }
        window.location.href = CONFIG.homeUrl;
    }

    let observer = null, claimObserver = null;
    let checkTimer = null;
    let pageReady = false;
    let uiRefreshInterval = null;
    let confirmTimer = null;
    let autoTimer = null;
    let minuteClickTimer = null;
    let retryTimer = null;
    let homeCheckTimer = null;
    let lastClaimAt = 0;   // 上次「立即领取」点击时间戳
    let clickPending = false;   // 已有一个延迟点击在排队（所有模式共用）

    /* ===== 新增：链接输入框 —— 把输入内容规范成可跳转的站内网址 =====
       支持三种写法：
         /myJueJin?id=1        → https://channelx.ele.me/myJueJin?id=1
         myJueJin              → https://channelx.ele.me/myJueJin
         https://channelx.ele.me/xxx（或任意完整网址）→ 原样使用
       只做「手动跳转一次」，不做地址锁定/守护；跳过去之后浏览器自己记住 */
    function normalizeTarget(input) {
        let v = String(input || '').trim();
        if (!v) return '';
        if (/^https?:\/\//i.test(v)) return v;              // 已经是完整网址
        v = v.replace(/^https?:\/\/[^/]+/i, '');            // 万一带了协议+域名，只取路径
        v = v.replace(/^channelx\.ele\.me(?=\/|$)/i, '');   // 不带协议直接粘域名，也只取路径
        if (v && !v.startsWith('/')) v = '/' + v;
        return BASE + (v || '/');
    }

    /* ===== 新增：页面刷新按钮（真正 reload 整个页面，区别于 ⟳ 只重扫列表） ===== */
    function manualReloadPage() {
        if (CONFIG.debug) console.log('[紧凑版] 手动刷新页面');
        try { window.location.reload(); }
        catch (e) { window.location.href = CONFIG.homeUrl; }
    }

    function goCustomUrl() {
        const input = document.getElementById('custom-url');
        if (!input) return;
        const raw = input.value.trim();
        if (!raw) {
            updateStatus('请先输入地址', '#e67e22');
            return;
        }
        const target = normalizeTarget(raw);
        state.customUrl = raw;
        saveState();                                     // 记住，下次打开自动填回
        updateStatus('跳转中…', '#f39c12');
        if (CONFIG.debug) console.log('[紧凑版] 跳转到：', target);
        window.location.href = target;
    }

    /* ===== 新增：收起后的悬浮钮 ===== */
    function clamp(v, min, max) {
        if (max < min) max = min;   // 极端窄屏/未布局完时避免算出负坐标，把悬浮钮推到屏幕外
        return v < min ? min : (v > max ? max : v);
    }

    function createFab() {
        if (document.getElementById('hbt-fab')) return;
        if (!document.body) { setTimeout(createFab, 200); return; }

        const fab = document.createElement('div');
        fab.id = 'hbt-fab';
        fab.innerHTML = '<span id="hbt-fab-txt">' + (state.isRunning ? '▶' : '⚙') + '</span>';
        fab.title = '点击展开面板（可拖动）';
        document.body.appendChild(fab);
        fab.onclick = () => { if (!fabMoved) unfoldPanel(); };

        const SIZE = CONFIG.fabSize, M = CONFIG.fabMargin;
        function defaultPos() { return { x: M, y: Math.round(window.innerHeight / 2 - SIZE / 2) }; }
        function readPos() {
            const p = GM_getValue('fabPos', null);
            if (!p || typeof p.x !== 'number') return defaultPos();
            return p;
        }
        function paint(p) {
            fab.style.left = clamp(p.x, M, window.innerWidth - SIZE - M) + 'px';
            fab.style.top = clamp(p.y, M, window.innerHeight - SIZE - M) + 'px';
        }
        let cur = readPos();
        paint(cur);

        let fabDragging = false, fabMoved = false, sx = 0, sy = 0, ox = 0, oy = 0;
        const pt = e => (e.touches && e.touches[0])
            ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
            : { x: e.clientX, y: e.clientY };

        function down(e) {
            const p = pt(e);
            fabDragging = true; fabMoved = false; sx = p.x; sy = p.y;
            ox = p.x - fab.offsetLeft; oy = p.y - fab.offsetTop;
        }
        function move(e) {
            if (!fabDragging) return;
            const p = pt(e);
            if (Math.abs(p.x - sx) > 4 || Math.abs(p.y - sy) > 4) fabMoved = true;
            if (!fabMoved) return;
            cur = { x: p.x - ox, y: p.y - oy };
            paint(cur);
            if (e.cancelable) e.preventDefault();
        }
        function up() {
            if (!fabDragging) return;
            fabDragging = false;
            if (fabMoved) GM_setValue('fabPos', { x: fab.offsetLeft, y: fab.offsetTop });
        }

        fab.addEventListener('mousedown', down);
        fab.addEventListener('touchstart', down, { passive: true });
        document.addEventListener('mousemove', move);
        document.addEventListener('touchmove', move, { passive: true });
        document.addEventListener('mouseup', up);
        document.addEventListener('touchend', up);
        fab.addEventListener('dragstart', e => e.preventDefault());
        fab.addEventListener('contextmenu', e => e.preventDefault());
    }

    /* ===== 新增：面板看门狗 =====
       大退 APP 重开、WebView 恢复页面、站点 SPA 重渲染都可能把面板节点清掉，
       原版没有任何重建机制，丢了就永远不显示。这里每 2 秒检查一次，丢了就补回来。 */
    let panelWatchdog = null;
    function startPanelWatchdog() {
        if (panelWatchdog) return;
        panelWatchdog = setInterval(() => {
            if (document.getElementById('task-panel') || document.getElementById('hbt-fab')) return;
            if (!document.body) return;
            if (CONFIG.debug) console.log('[紧凑版] 面板/悬浮钮丢失，重建');
            if (state.folded) createFab(); else createPanel();
        }, 2000);
    }

    /* ===== 新增：收起 / 展开（只切形态，不停止脚本） ===== */
    function foldPanel() {
        if (uiRefreshInterval) { clearInterval(uiRefreshInterval); uiRefreshInterval = null; }
        const p = document.getElementById('task-panel');
        if (p) p.remove();
        state.folded = true;
        saveState();
        createFab();
    }

    function unfoldPanel() {
        const f = document.getElementById('hbt-fab');
        if (f) f.remove();
        state.folded = false;
        saveState();
        createPanel();
        // 收起期间引擎一直在跑，展开后把观察者接回来
        if (state.isRunning && !isDisabledTime()) {
            startHomeCheck();
            if (pageReady) { startDOMObserver(); startClaimListener(); }
            else startEngine();
        }
    }

    function getCandidateButtons() {
        const allBtns = document.querySelectorAll(CONFIG.buttonSelector);
        const matchBtns = [];
        allBtns.forEach(btn => {
            if (btn.textContent.trim().includes(CONFIG.taskName)) matchBtns.push(btn);
        });

        if (matchBtns.length <= CONFIG.minButtonsToExclude) {
            return matchBtns;
        }
        return matchBtns.slice(1);
    }

    function createPanel() {
        // 部分机型 WebView 注入很早，此时 body 还没建好，直接 appendChild 会报错且再无重试
        if (!document.body) { setTimeout(createPanel, 200); return; }
        const old = document.getElementById('task-panel');
        if (old) old.remove();
        const oldFab = document.getElementById('hbt-fab');
        if (oldFab) oldFab.remove();

        const panel = document.createElement('div');
        panel.id = 'task-panel';
        panel.innerHTML = `
            <div class="panel-body">
                <div class="top-row">
                    <button id="btn-fold" class="fold-btn" title="收起面板">▾</button>
                    <button id="btn-toggle" class="btn primary">${state.isRunning ? '⏹ 停止' : '▶ 启动'}</button>
                </div>
                <div class="url-row">
                    <input id="custom-url" type="text" placeholder="输入路径或完整网址" value="${String(state.customUrl || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">
                    <button id="btn-go-url" class="btn small" title="跳转到这个地址">GO</button>
                </div>
                <div class="section-header">
                    <span>任务列表</span>
                    <span class="hbtns">
                        <button id="btn-refresh-list" class="btn small" title="重新扫描任务">⟳</button>
                        <button id="btn-reload-page" class="btn small" title="刷新当前页面">↻ 刷新</button>
                    </span>
                </div>
                <div id="middle-task-list" class="task-row"></div>
                <label class="toggle-row">
                    <input type="checkbox" id="chk-minute-click" ${state.useMinuteClick ? 'checked' : ''}>
                    <span>⏱ 每分钟点一次</span>
                </label>
                <div class="status-text" id="status-text">${state.isRunning ? '等待按钮…' : '已停止'}</div>
                <div class="auto-info" id="auto-info">✋ 手动模式</div>
            </div>
        `;
        document.body.appendChild(panel);

        // ▾ 收起：只换形态，不停机、不刷新
        document.getElementById('btn-fold').onclick = foldPanel;

        // 链接输入框：点 GO 或按回车跳转
        const urlInput = document.getElementById('custom-url');
        document.getElementById('btn-go-url').onclick = goCustomUrl;
        urlInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                goCustomUrl();
            }
        };

        document.getElementById('btn-toggle').onclick = toggleRunning;
        document.getElementById('btn-refresh-list').onclick = refreshMiddleTaskList;
        document.getElementById('btn-reload-page').onclick = manualReloadPage;
        document.getElementById('chk-minute-click').onchange = (e) => {
            state.useMinuteClick = e.target.checked;
            saveState();
            if (state.isRunning) {
                stopMinuteClick();
                if (state.useMinuteClick) {
                    startMinuteClick();
                    stopMainLoop();
                } else {
                    startMainLoop();
                }
            }
        };

        refreshMiddleTaskList();
        if (uiRefreshInterval) clearInterval(uiRefreshInterval);
        uiRefreshInterval = setInterval(refreshMiddleTaskList, 2000);

        startAutoTimer();
        updateAutoInfo();
        startHomeCheck();
        forceRedirectToHome();
    }

    function startHomeCheck() {
        if (homeCheckTimer) clearInterval(homeCheckTimer);
        homeCheckTimer = setInterval(() => {
            if (!state.isRunning) return;
            forceRedirectToHome();
        }, 1000);
    }
    function stopHomeCheck() {
        if (homeCheckTimer) { clearInterval(homeCheckTimer); homeCheckTimer = null; }
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
        } else {
            state.manuallyStopped = false;
            state.autoMode = false;
            state.isRunning = true;
            saveState();
            updateToggleButton();
            updateAutoInfo();
            startEngine();
        }
    }

    function startAutoTimer() {
        if (autoTimer) clearInterval(autoTimer);
        autoTimer = setInterval(checkAutoTime, 2000);
        checkAutoTime();
    }

    function checkAutoTime() {
        const now = new Date();
        const minute = now.getMinutes();
        const second = now.getSeconds();
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
            updateAutoInfo();
            startEngine();
        }

        if (!inWindow && state.isRunning && state.autoMode) {
            state.autoMode = false;
            state.isRunning = false;
            saveState();
            stopEngine();
            updateToggleButton();
            updateAutoInfo();
            updateStatus('已停止', '#e67e22');
            refreshMiddleTaskList();
        }
        updateAutoInfo();
    }

    function updateAutoInfo() {
        const el = document.getElementById('auto-info');
        if (!el) return;
        if (isDisabledTime()) {
            el.textContent = '🌙 休息时间';
            el.style.color = '#e67e22';
            return;
        }
        if (state.manuallyStopped) {
            el.textContent = '⏸️ 手动停止';
            el.style.color = '#e67e22';
            return;
        }
        if (state.isRunning && state.autoMode) {
            el.textContent = '🤖 自动运行中';
            el.style.color = '#27ae60';
        } else if (state.isRunning) {
            el.textContent = '✋ 手动运行中';
            el.style.color = '#888';
        } else {
            el.textContent = '⏸️ 已停止';
            el.style.color = '#888';
        }
    }

    function stopAndUpdateUI(reason = '已停止') {
        state.isRunning = false;
        state.autoMode = false;
        state.manuallyStopped = true;
        saveState();
        updateToggleButton();
        stopEngine();
        updateStatus(reason, '#27ae60');
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
            html += `<label class="task-item"><input type="checkbox" data-idx="${idx}" ${checked?'checked':''}><span>${idx+1}.${status}</span></label>`;
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

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function hasAnyButton() {
        return getCandidateButtons().length > 0;
    }

    function startMinuteClick() {
        stopMinuteClick();
        minuteClickTimer = setInterval(forceClick, 60000);  // 原 30 秒 → 翻倍为 60 秒
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
        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width/2, y = rect.top + rect.height/2;
        const fire = () => {
            ['mousedown','mouseup','click'].forEach(evt => {
                target.dispatchEvent(new MouseEvent(evt, { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y }));
            });
        };

        // 所有模式（自动窗口 / 手动启动 / 每分钟）：点任务按钮前都随机等 300-500ms
        if (clickPending) return;                  // 已有一次在排队，不重复排
        clickPending = true;
        const span = CONFIG.clickDelayMaxMs - CONFIG.clickDelayMinMs + 1;
        const delay = CONFIG.clickDelayMinMs + Math.floor(Math.random() * span);
        setTimeout(() => {
            clickPending = false;
            if (state.isRunning) fire();
        }, delay);
    }

    function startEngine() {
        stopEngine();
        if (!state.isRunning) return;
        pageReady = false;
        updateStatus('等待按钮…', '#f39c12');
        if (state.useMinuteClick) startMinuteClick();
        startHomeCheck();
        waitForReady();
    }

    function waitForReady() {
        if (!state.isRunning) return;
        forceRedirectToHome();
        if (hasAnyButton()) {
            if (!confirmTimer) {
                confirmTimer = setTimeout(() => {
                    if (!state.isRunning) return;
                    if (hasAnyButton()) {
                        pageReady = true;
                        updateStatus('运行中', '#27ae60');
                        if (!state.useMinuteClick) loop();
                        startDOMObserver();
                        startClaimListener();
                    } else {
                        confirmTimer = null;
                        waitForReady();
                    }
                }, 600);
            }
        } else {
            if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
            checkTimer = setTimeout(waitForReady, 400);
        }
    }

    function stopEngine() {
        if (observer) { observer.disconnect(); observer = null; }
        if (claimObserver) { claimObserver.disconnect(); claimObserver = null; }
        if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
        if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        stopMinuteClick();
        stopHomeCheck();
        clickPending = false;
        pageReady = false;
    }

    function startClaimListener() {
        if (claimObserver) claimObserver.disconnect();
        claimObserver = new MutationObserver(() => {
            const btn = findClaimBtn();
            if (!btn) return;
            const now = Date.now();
            if (now - lastClaimAt < CONFIG.claimGapMs) return;
            lastClaimAt = now;
            simulateClick(btn);
            forceRedirectToHome();
            updateStatus('✅ 已领', '#27ae60');
        });
        claimObserver.observe(document.body, { childList: true, subtree: true });
    }

    function findClaimBtn() {
        const all = document.querySelectorAll('button, a, span, div');
        for (const el of all) {
            if (el.textContent.trim() === CONFIG.claimText && isVisible(el)) return el;
        }
        return null;
    }

    function simulateClick(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width/2, y = rect.top + rect.height/2;
        ['mousedown','mouseup','click'].forEach(evt => {
            el.dispatchEvent(new MouseEvent(evt, { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y }));
        });
    }

    function loop() {
        if (!state.isRunning || !pageReady) return;
        if (state.useMinuteClick) return;
        forceRedirectToHome();
        forceClick();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(loop, 1200);
    }

    function startDOMObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver(() => {
            if (!state.isRunning) return;
            clearTimeout(checkTimer);
            checkTimer = setTimeout(() => {
                refreshMiddleTaskList();
                if (!state.useMinuteClick) loop();
            }, 1200);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function log(...args) {
        if (CONFIG.debug) console.log('[紧凑版]', ...args);
    }

    GM_addStyle(`
        #task-panel{position:fixed;left:6px;top:6px;z-index:99999;width:175px;background:#fff;border-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,0.12);font-size:11px;overflow:hidden;border:1px solid #e0e0e0;font-family:system-ui,-apple-system,sans-serif;}
        .panel-body{padding:6px 8px;}
        .top-row{display:flex;align-items:center;gap:4px;margin-bottom:6px;}
        .top-row .btn.primary{flex:1;margin-bottom:0;font-size:11px;padding:5px 0;}
        .fold-btn{background:none;border:none;color:#999;font-size:14px;cursor:pointer;padding:0 3px;line-height:1;flex-shrink:0;}
        .fold-btn:hover{color:#27ae60;}
        .url-row{display:flex;gap:4px;margin-bottom:6px;}
        .url-row input{flex:1;min-width:0;font-size:10px;padding:3px 4px;border:1px solid #ccc;border-radius:4px;}
        .url-row input:focus{outline:none;border-color:#27ae60;}
        .btn{display:block;width:100%;padding:5px 0;border:1px solid #d0d0d0;border-radius:4px;background:#fff;font-size:11px;cursor:pointer;margin-bottom:6px;}
        .btn.primary{background:#27ae60;border-color:#27ae60;color:#fff;font-weight:600;}
        .btn.small{width:auto;padding:1px 6px;margin-bottom:0;font-size:10px;}
        .section-header{display:flex;justify-content:space-between;align-items:center;gap:3px;margin-bottom:3px;font-weight:600;color:#555;font-size:10px;}
        .section-header .hbtns{display:flex;gap:3px;}
        .task-row{display:flex;flex-wrap:wrap;gap:3px 6px;margin-bottom:6px;}
        .task-item{display:inline-flex;align-items:center;font-size:10px;cursor:pointer;}
        .task-item input{margin-right:2px;transform:scale(0.9);}
        .toggle-row{display:flex;align-items:center;justify-content:center;gap:3px;font-size:10px;margin-bottom:6px;cursor:pointer;}
        .status-text{text-align:center;color:#888;font-size:9px;margin-bottom:2px;}
        .auto-info{text-align:center;font-size:9px;font-weight:600;}
        .empty-tasks{color:#bbb;text-align:center;font-size:10px;width:100%;padding:2px 0;}
        #hbt-fab{position:fixed;left:6px;top:50%;z-index:99999;width:38px;height:38px;border-radius:50%;
            background:rgba(39,174,96,0.85);color:#fff;display:flex;align-items:center;justify-content:center;
            box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;user-select:none;-webkit-user-select:none;
            -webkit-tap-highlight-color:transparent;font-size:15px;font-weight:600;touch-action:none;
            font-family:system-ui,-apple-system,sans-serif;transition:transform .15s,background .2s;}
        #hbt-fab:hover{filter:brightness(1.08);}
        #hbt-fab:active{transform:scale(0.92);}
        #hbt-fab-txt{line-height:1;pointer-events:none;}
    `);

    /* ===== 启动入口（原版两处重复逻辑合并，行为等价；额外支持收起形态） ===== */
    let booted = false;
    function boot() {
        if (booted) return;          // 多个触发源都命中时只跑一次，避免重复起定时器
        booted = true;
        if (state.folded) {
            createFab();
            startAutoTimer();
            updateAutoInfo();
            startHomeCheck();
            forceRedirectToHome();
            if (state.isRunning && !isDisabledTime()) startEngine();
            else if (state.isRunning) stopAndUpdateUI('休息时间');
        } else {
            createPanel();
            if (state.isRunning && !isDisabledTime()) startEngine();
            else if (state.isRunning) stopAndUpdateUI('休息时间');
        }
        startPanelWatchdog();       // 之后任何时候面板丢了都会自动补回来
    }

    if (document.readyState === 'complete') {
        boot();
    } else {
        window.addEventListener('load', boot, { once: true });
        // 部分机型 WebView 的 load 不一定按预期触发，3 秒后兜底再试一次
        setTimeout(boot, 3000);
    }
})();
