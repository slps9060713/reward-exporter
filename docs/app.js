// Twitch API 設定
let APP_CLIENT_ID = localStorage.getItem('user_client_id') || ''; // 從 localStorage 讀取
const REDIRECT_URL = window.location.origin + window.location.pathname;
const SCOPE = 'channel:read:redemptions';

// 全局狀態
let currentToken = null;
let currentBroadcasterId = null;
let currentRewards = [];
let allTabs = [];
let currentWinnerNumber = null;
let revealStep = 0; // 0: 未開始, 1: 百位數, 2: 十位數, 3: 個位數

// 連續抽取模式
let continuousMode = false; // 是否啟用連續抽取模式
let drawnWinners = {}; // 記錄每個分頁已中獎的 ID {tabId: [winnerId1, winnerId2, ...]}
let skipShrinkMode = false; // 是否跳過縮圈（直接顯示結果）

// 音效系統
let audioContext = null;
let soundSettings = {
    enabled: true,
    volume: 0.7,
    theme: 'default'
};
let customSounds = {};
let spinLoopAudio = null;

// DOM 元素
const loginPage = document.getElementById('loginPage');
const mainPage = document.getElementById('mainPage');
const guestModeBtn = document.getElementById('guestModeBtn');
const twitchModeBtn = document.getElementById('twitchModeBtn');
const guestModeContent = document.getElementById('guestModeContent');
const twitchModeContent = document.getElementById('twitchModeContent');
const startGuestBtn = document.getElementById('startGuestBtn');
const clientIdInput = document.getElementById('clientIdInput');
const saveClientIdBtn = document.getElementById('saveClientIdBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userName = document.getElementById('userName');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const mainContent = document.getElementById('mainContent');
const retryBtn = document.getElementById('retryBtn');
const errorMessage = document.getElementById('errorMessage');
const rewardTabs = document.getElementById('rewardTabs');
const tabContent = document.getElementById('tabContent');
const resultOverlay = document.getElementById('resultOverlay');
const shrinkBtn = document.getElementById('shrinkBtn');
const closeOverlayBtn = document.getElementById('closeOverlayBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const soundEnabled = document.getElementById('soundEnabled');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const soundTheme = document.getElementById('soundTheme');
const customSoundSection = document.getElementById('customSoundSection');
const uploadSpin = document.getElementById('uploadSpin');
const uploadReveal = document.getElementById('uploadReveal');
const uploadWinner = document.getElementById('uploadWinner');

// 初始化
function init() {
    loadClientId();
    checkAuthToken();
    setupEventListeners();
    initSoundSystem();
    loadSoundSettings();
}

// 設置事件監聽器
function setupEventListeners() {
    // 模式切換
    guestModeBtn.addEventListener('click', switchToGuestMode);
    twitchModeBtn.addEventListener('click', switchToTwitchMode);
    startGuestBtn.addEventListener('click', handleStartGuest);
    saveClientIdBtn.addEventListener('click', handleSaveClientId);
    loginBtn.addEventListener('click', redirectToTwitchAuth);
    logoutBtn.addEventListener('click', handleLogout);
    retryBtn.addEventListener('click', loadRewards);
    shrinkBtn.addEventListener('click', handleShrink);
    closeOverlayBtn.addEventListener('click', closeResultOverlay);
    
    // 音效設定相關
    settingsBtn.addEventListener('click', () => settingsOverlay.style.display = 'flex');
    closeSettingsBtn.addEventListener('click', () => settingsOverlay.style.display = 'none');
    soundEnabled.addEventListener('change', updateSoundSettings);
    volumeSlider.addEventListener('input', updateVolume);
    soundTheme.addEventListener('change', updateSoundTheme);
    uploadSpin.addEventListener('change', (e) => handleFileUpload(e, 'spin'));
    uploadReveal.addEventListener('change', (e) => handleFileUpload(e, 'reveal'));
    uploadWinner.addEventListener('change', (e) => handleFileUpload(e, 'winner'));
}

// 切換到未登入模式
function switchToGuestMode() {
    guestModeBtn.classList.add('active');
    twitchModeBtn.classList.remove('active');
    guestModeContent.classList.add('active');
    twitchModeContent.classList.remove('active');
}

// 切換到 Twitch 模式
function switchToTwitchMode() {
    twitchModeBtn.classList.add('active');
    guestModeBtn.classList.remove('active');
    twitchModeContent.classList.add('active');
    guestModeContent.classList.remove('active');
}

// 載入已保存的 Client ID
function loadClientId() {
    const savedClientId = localStorage.getItem('user_client_id');
    if (savedClientId) {
        APP_CLIENT_ID = savedClientId;
        if (clientIdInput) {
            clientIdInput.value = savedClientId;
        }
        updateClientIdStatus(true);
    } else {
        updateClientIdStatus(false);
    }
    
    // 顯示當前網址供用戶註冊使用
    const redirectUrlDisplay = document.getElementById('redirectUrlDisplay');
    if (redirectUrlDisplay) {
        redirectUrlDisplay.textContent = REDIRECT_URL;
    }
}

// 更新 Client ID 狀態顯示
function updateClientIdStatus(hasClientId) {
    const statusElement = document.getElementById('clientIdStatus');
    if (statusElement) {
        if (hasClientId) {
            statusElement.innerHTML = '✅ Client ID 已設定';
            statusElement.style.color = 'var(--success-color)';
        } else {
            statusElement.innerHTML = '⚠️ 請先設定 Client ID';
            statusElement.style.color = '#ff9800';
        }
    }
    
    // 更新登入按鈕狀態
    if (loginBtn) {
        loginBtn.disabled = !hasClientId;
    }
}

// 儲存 Client ID
function handleSaveClientId() {
    const clientId = clientIdInput.value.trim();
    
    if (!clientId) {
        alert('❌ 請輸入 Client ID');
        return;
    }
    
    // 簡單驗證格式（Twitch Client ID 通常是 30 字元的英數字串）
    if (clientId.length < 20) {
        alert('❌ Client ID 格式似乎不正確\n\nTwitch Client ID 通常是 30 個字元的英數字串');
        return;
    }
    
    // 儲存到 localStorage
    localStorage.setItem('user_client_id', clientId);
    APP_CLIENT_ID = clientId;
    
    updateClientIdStatus(true);
    alert('✅ Client ID 已儲存！\n\n現在可以點擊「連接 Twitch 帳號」進行登入。');
}

// 開始未登入模式
function handleStartGuest() {
    currentToken = null;
    loginPage.classList.remove('active');
    mainPage.classList.add('active');
    userName.textContent = '未登入模式';
    createCustomTab();
}


// 檢查授權 Token
function checkAuthToken() {
    // 從 URL hash 中獲取 token
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const tokenFromHash = params.get('access_token');
    
    if (tokenFromHash) {
        currentToken = tokenFromHash;
        localStorage.setItem('twitch_token', tokenFromHash);
        window.history.replaceState(null, null, window.location.pathname);
        showMainPage();
        return;
    }
    
    // 從 localStorage 中獲取 token
    const savedToken = localStorage.getItem('twitch_token');
    if (savedToken) {
        currentToken = savedToken;
        showMainPage();
        return;
    }
    
    showLoginPage();
}

// 顯示登入頁面
function showLoginPage() {
    loginPage.classList.add('active');
    mainPage.classList.remove('active');
}

// 顯示主頁面
function showMainPage() {
    loginPage.classList.remove('active');
    mainPage.classList.add('active');
    loadRewards();
}


// 重定向到 Twitch 授權頁面
function redirectToTwitchAuth() {
    const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=token&client_id=${APP_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URL)}&scope=${SCOPE}`;
    window.location.href = authUrl;
}

// 登出
function handleLogout() {
    currentToken = null;
    currentBroadcasterId = null;
    currentRewards = [];
    allTabs = [];
    localStorage.removeItem('twitch_token');
    showLoginPage();
}

// 載入獎勵資料
async function loadRewards() {
    if (!currentToken) {
        createCustomTab();
        return;
    }
    
    showLoading();
    
    try {
        // 獲取用戶資訊
        const userInfo = await getUserInfo();
        if (!userInfo) {
            throw new Error('無法獲取用戶資訊');
        }
        
        userName.textContent = userInfo.display_name;
        currentBroadcasterId = userInfo.id;
        
        // 獲取獎勵列表
        const rewards = await getCustomRewards();
        
        currentRewards = rewards || [];
        
        // 創建分頁
        createTabs();
        showMainContent();
        
    } catch (error) {
        console.error('載入失敗:', error);
        showError(error.message);
    }
}

// 獲取用戶資訊
async function getUserInfo() {
    try {
        const response = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-Id': APP_CLIENT_ID,
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                handleLogout();
                throw new Error('授權已過期，請重新登入');
            }
            throw new Error('API 請求失敗');
        }
        
        const data = await response.json();
        return data.data[0];
    } catch (error) {
        throw error;
    }
}

// 獲取自訂獎勵
async function getCustomRewards() {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${currentBroadcasterId}&only_manageable_rewards=true`, {
            headers: {
                'Client-Id': APP_CLIENT_ID,
                'Authorization': `Bearer ${currentToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error('無法獲取獎勵列表');
        }
        
        const data = await response.json();
        return data.data;
    } catch (error) {
        throw error;
    }
}

// 獲取獎勵兌換記錄（只獲取未完成的）
async function getRedemptions(rewardId) {
    try {
        let allRedemptions = [];
        let cursor = null;
        const perPage = 50;
        const status = 'UNFULFILLED'; // 只獲取未完成的
        
        do {
            let url = `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${currentBroadcasterId}&reward_id=${rewardId}&status=${status}&first=${perPage}`;
            
            if (cursor) {
                url += `&after=${cursor}`;
            }
            
            const response = await fetch(url, {
                headers: {
                    'Client-Id': APP_CLIENT_ID,
                    'Authorization': `Bearer ${currentToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('無法獲取兌換記錄');
            }
            
            const data = await response.json();
            allRedemptions = allRedemptions.concat(data.data);
            
            cursor = data.pagination && data.pagination.cursor ? data.pagination.cursor : null;
            
            if (!cursor || data.data.length < perPage) {
                break;
            }
        } while (cursor);
        
        return allRedemptions;
    } catch (error) {
        throw error;
    }
}

// 創建分頁（不自動載入兌換記錄）
async function createTabs() {
    rewardTabs.innerHTML = '';
    tabContent.innerHTML = '';
    allTabs = [];
    
    if (!currentRewards || currentRewards.length === 0) {
        // 沒有獎勵，顯示自定義分頁
        createCustomTab();
        return;
    }
    
    // 為每個獎勵創建分頁（不載入兌換記錄）
    for (let i = 0; i < currentRewards.length; i++) {
        const reward = currentRewards[i];
        
        const tabData = {
            id: `reward-${i}`,
            rewardId: reward.id, // 保存 Twitch reward ID
            title: reward.title,
            participants: null, // 標記為未載入
            loaded: false
        };
        
        allTabs.push(tabData);
        createTabElements(tabData, i === 0);
    }
    
    // 加入自定義分頁
    createCustomTab();
}

// 載入特定獎勵的兌換記錄
async function loadRedemptionsForTab(tabId) {
    const tabData = allTabs.find(t => t.id === tabId);
    if (!tabData || tabData.loaded || tabData.isCustom) return;
    
    const panel = document.getElementById(`panel-${tabId}`);
    const loadBtn = panel.querySelector('.load-btn');
    const statusText = panel.querySelector('.load-status');
    
    if (loadBtn) loadBtn.disabled = true;
    if (statusText) statusText.textContent = '⏳ 載入中...';
    
    try {
        // 獲取兌換記錄
        const redemptions = await getRedemptions(tabData.rewardId);
        
        tabData.participants = redemptions.map((r, index) => ({
            id: String(index + 1).padStart(3, '0'),
            username: r.user_name
        }));
        tabData.loaded = true;
        
        // 重置此分頁的已中獎列表
        drawnWinners[tabId] = [];
        
        // 重新渲染該分頁
        const oldPanel = document.getElementById(`panel-${tabId}`);
        const newPanel = document.createElement('div');
        newPanel.className = 'tab-panel active';
        newPanel.id = `panel-${tabId}`;
        
        newPanel.innerHTML = `
            <div class="lottery-container">
                <div class="id-list-container">
                    <div class="winners-section" id="winners-section-${tabData.id}" style="display: none;">
                        <div class="id-list-header winner-header">✅ 已中獎</div>
                        <div class="id-list winners-list" id="winners-list-${tabData.id}"></div>
                    </div>
                    <div class="remaining-section">
                        <div class="id-list-header">參與名單 (${tabData.participants.length} 人)</div>
                        <div class="id-list" id="id-list-${tabData.id}"></div>
                    </div>
                </div>
                <div class="wheel-container">
                    <div class="wheel" id="wheel-${tabData.id}">
                        <div class="wheel-number">000</div>
                    </div>
                    <div class="wheel-controls">
                        <div class="continuous-mode-option">
                            <label class="checkbox-label">
                                <input type="checkbox" id="continuousMode-${tabData.id}" onchange="toggleContinuousMode('${tabData.id}', this.checked)">
                                <span>連續抽取（移除已中獎選項）</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="skipShrinkMode-${tabData.id}" onchange="toggleSkipShrinkMode(this.checked)">
                                <span>跳過縮圈（直接顯示結果）</span>
                            </label>
                        </div>
                        <div class="wheel-info">準備抽獎</div>
                        <button class="btn-primary" id="startBtn-${tabData.id}" onclick="startLottery('${tabData.id}')" ${tabData.participants.length === 0 ? 'disabled' : ''}>
                            ${tabData.participants.length === 0 ? '無參與者' : '啟動抽獎'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // 填充 ID 列表
        const idList = newPanel.querySelector(`#id-list-${tabData.id}`);
        tabData.participants.forEach(participant => {
            const item = document.createElement('div');
            item.className = 'id-item';
            item.dataset.id = participant.id;
            item.textContent = `${participant.id} - ${participant.username}`;
            idList.appendChild(item);
        });
        
        oldPanel.parentNode.replaceChild(newPanel, oldPanel);
        
    } catch (error) {
        console.error('載入失敗:', error);
        if (loadBtn) loadBtn.disabled = false;
        if (statusText) statusText.textContent = '❌ 載入失敗，請重試';
        alert('載入失敗：' + error.message);
    }
}

// 創建自定義分頁
function createCustomTab() {
    // 檢查是否已存在自定義分頁
    const existingCustomTab = allTabs.find(tab => tab.id === 'custom');
    if (existingCustomTab) {
        // 如果已存在，不重複創建
        return;
    }
    
    const isFirst = allTabs.length === 0;
    
    const customTab = {
        id: 'custom',
        title: '自定義',
        isCustom: true
    };
    
    allTabs.push(customTab);
    createTabElements(customTab, isFirst);
    
    if (isFirst) {
        showMainContent();
    }
}

// 創建分頁元素
function createTabElements(tabData, isActive = false) {
    // 創建分頁按鈕
    const tabBtn = document.createElement('button');
    tabBtn.className = `tab-btn ${isActive ? 'active' : ''}`;
    tabBtn.textContent = tabData.title;
    tabBtn.onclick = () => switchTab(tabData.id);
    rewardTabs.appendChild(tabBtn);
    
    // 創建分頁內容
    const panel = document.createElement('div');
    panel.className = `tab-panel ${isActive ? 'active' : ''}`;
    panel.id = `panel-${tabData.id}`;
    
    if (tabData.isCustom) {
        // 自定義模式
        panel.innerHTML = `
            <div class="custom-input-group">
                <label for="customMax">輸入最大號碼（001 到）：</label>
                <input type="number" id="customMax" min="1" max="999" value="100" />
                <div class="continuous-mode-option">
                    <label class="checkbox-label">
                        <input type="checkbox" id="continuousMode-${tabData.id}" onchange="toggleContinuousMode('${tabData.id}', this.checked)">
                        <span>連續抽取（移除已中獎選項）</span>
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="skipShrinkMode-${tabData.id}" onchange="toggleSkipShrinkMode(this.checked)">
                        <span>跳過縮圈（直接顯示結果）</span>
                    </label>
                </div>
                <button class="btn-secondary" onclick="updateCustomList()" style="margin-top: 1rem;">更新列表</button>
            </div>
            <div class="lottery-container">
                <div class="id-list-container">
                    <div class="winners-section" id="winners-section-${tabData.id}" style="display: none;">
                        <div class="id-list-header winner-header">✅ 已中獎</div>
                        <div class="id-list winners-list" id="winners-list-${tabData.id}"></div>
                    </div>
                    <div class="remaining-section">
                        <div class="id-list-header">參與名單</div>
                        <div class="id-list" id="id-list-${tabData.id}"></div>
                    </div>
                </div>
                <div class="wheel-container">
                    <div class="wheel" id="wheel-${tabData.id}">
                        <div class="wheel-number">000</div>
                    </div>
                    <div class="wheel-controls">
                        <div class="wheel-info">準備抽獎</div>
                        <button class="btn-primary" id="startBtn-${tabData.id}" onclick="startLottery('${tabData.id}')">
                            啟動抽獎
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // 初始化自定義列表
        setTimeout(() => updateCustomList(), 100);
    } else if (tabData.loaded && tabData.participants) {
        // 已載入的獎勵分頁
        panel.innerHTML = `
            <div class="lottery-container">
                <div class="id-list-container">
                    <div class="winners-section" id="winners-section-${tabData.id}" style="display: none;">
                        <div class="id-list-header winner-header">✅ 已中獎</div>
                        <div class="id-list winners-list" id="winners-list-${tabData.id}"></div>
                    </div>
                    <div class="remaining-section">
                        <div class="id-list-header">參與名單 (${tabData.participants.length} 人)</div>
                        <div class="id-list" id="id-list-${tabData.id}"></div>
                    </div>
                </div>
                <div class="wheel-container">
                    <div class="wheel" id="wheel-${tabData.id}">
                        <div class="wheel-number">000</div>
                    </div>
                    <div class="wheel-controls">
                        <div class="continuous-mode-option">
                            <label class="checkbox-label">
                                <input type="checkbox" id="continuousMode-${tabData.id}" onchange="toggleContinuousMode('${tabData.id}', this.checked)">
                                <span>連續抽取（移除已中獎選項）</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="skipShrinkMode-${tabData.id}" onchange="toggleSkipShrinkMode(this.checked)">
                                <span>跳過縮圈（直接顯示結果）</span>
                            </label>
                        </div>
                        <div class="wheel-info">準備抽獎</div>
                        <button class="btn-primary" id="startBtn-${tabData.id}" onclick="startLottery('${tabData.id}')" ${tabData.participants.length === 0 ? 'disabled' : ''}>
                            ${tabData.participants.length === 0 ? '無參與者' : '啟動抽獎'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // 填充 ID 列表
        const idList = panel.querySelector(`#id-list-${tabData.id}`);
        tabData.participants.forEach(participant => {
            const item = document.createElement('div');
            item.className = 'id-item';
            item.dataset.id = participant.id;
            item.textContent = `${participant.id} - ${participant.username}`;
            idList.appendChild(item);
        });
    } else {
        // 未載入的獎勵分頁 - 顯示載入按鈕
        panel.innerHTML = `
            <div class="load-redemptions-view">
                <div class="load-icon">📋</div>
                <h3>${tabData.title}</h3>
                <p class="load-description">此獎勵的兌換名單尚未載入</p>
                <div class="continuous-mode-option">
                    <label class="checkbox-label">
                        <input type="checkbox" id="continuousMode-${tabData.id}" onchange="toggleContinuousMode('${tabData.id}', this.checked)">
                        <span>連續抽取（移除已中獎選項）</span>
                    </label>
                </div>
                <p class="load-status"></p>
                <button class="btn-primary load-btn" onclick="loadRedemptionsForTab('${tabData.id}')">
                    📥 載入名單
                </button>
            </div>
        `;
    }
    
    tabContent.appendChild(panel);
}

// 更新自定義列表
function updateCustomList() {
    const maxInput = document.getElementById('customMax');
    const max = parseInt(maxInput.value) || 100;
    
    if (max < 1 || max > 999) {
        alert('請輸入 1 到 999 之間的數字');
        return;
    }
    
    const idList = document.getElementById('id-list-custom');
    const winnersList = document.getElementById('winners-list-custom');
    const winnersSection = document.getElementById('winners-section-custom');
    
    idList.innerHTML = '';
    
    // 重置此分頁的已中獎列表
    drawnWinners['custom'] = [];
    
    // 清空已中獎區域
    if (winnersList) {
        winnersList.innerHTML = '';
    }
    if (winnersSection) {
        winnersSection.style.display = 'none';
    }
    
    for (let i = 1; i <= max; i++) {
        const id = String(i).padStart(3, '0');
        const item = document.createElement('div');
        item.className = 'id-item';
        item.dataset.id = id;
        item.textContent = id;
        idList.appendChild(item);
    }
    
    // 重新檢查按鈕狀態
    checkAndUpdateLotteryButton('custom');
}

// 切換連續抽取模式
function toggleContinuousMode(tabId, checked) {
    continuousMode = checked;
    
    const winnersSection = document.getElementById(`winners-section-${tabId}`);
    const idList = document.getElementById(`id-list-${tabId}`);
    
    if (checked) {
        // 啟用連續模式
        // 清除當前分頁的淘汰標記
        if (idList) {
            const items = idList.querySelectorAll('.id-item.eliminated');
            items.forEach(item => {
                item.classList.remove('eliminated');
            });
        }
        
        // 如果有已中獎的，顯示已中獎區域
        if (winnersSection && drawnWinners[tabId] && drawnWinners[tabId].length > 0) {
            winnersSection.style.display = 'block';
        }
    } else {
        // 關閉連續模式 - 重新觸發更新/載入功能
        if (tabId === 'custom') {
            // 自定義模式：重新更新列表
            updateCustomList();
        } else {
            // Twitch 模式：重新載入名單
            reloadRedemptionsForTab(tabId);
        }
    }
}

// 切換跳過縮圈模式
function toggleSkipShrinkMode(checked) {
    skipShrinkMode = checked;
}

// 處理連續模式下的中獎項（跳過縮圈時使用）
function handleWinnerInContinuousMode(tabId, winnerNumber) {
    // 初始化已中獎列表
    if (!drawnWinners[tabId]) {
        drawnWinners[tabId] = [];
    }
    
    // 記錄中獎號碼
    if (!drawnWinners[tabId].includes(winnerNumber)) {
        drawnWinners[tabId].push(winnerNumber);
    }
    
    // 移動中獎項到已中獎列表
    const idList = document.getElementById(`id-list-${tabId}`);
    const winnersList = document.getElementById(`winners-list-${tabId}`);
    const winnersSection = document.getElementById(`winners-section-${tabId}`);
    
    if (idList && winnersList) {
        const winnerItem = idList.querySelector(`[data-id="${winnerNumber}"]`);
        if (winnerItem) {
            // 從未中獎列表移除
            winnerItem.remove();
            
            // 複製一份添加到已中獎列表
            const winnerCopy = winnerItem.cloneNode(true);
            winnerCopy.classList.remove('eliminated', 'winner');
            winnerCopy.classList.add('drawn');
            winnersList.appendChild(winnerCopy);
            
            // 顯示已中獎區域
            if (winnersSection) {
                winnersSection.style.display = 'block';
            }
        }
    }
    
    // 檢查並更新抽獎按鈕狀態
    checkAndUpdateLotteryButton(tabId);
}

// 重新載入 Twitch 獎勵名單（用於取消連續模式時重置）
async function reloadRedemptionsForTab(tabId) {
    const tabData = allTabs.find(t => t.id === tabId);
    if (!tabData || !tabData.loaded || tabData.isCustom) return;
    
    // 重置已中獎列表
    drawnWinners[tabId] = [];
    
    try {
        // 重新獲取兌換記錄
        const redemptions = await getRedemptions(tabData.rewardId);
        
        tabData.participants = redemptions.map((r, index) => ({
            id: String(index + 1).padStart(3, '0'),
            username: r.user_name
        }));
        
        // 更新 ID 列表
        const idList = document.getElementById(`id-list-${tabId}`);
        const winnersList = document.getElementById(`winners-list-${tabId}`);
        const winnersSection = document.getElementById(`winners-section-${tabId}`);
        
        if (idList) {
            idList.innerHTML = '';
            tabData.participants.forEach(participant => {
                const item = document.createElement('div');
                item.className = 'id-item';
                item.dataset.id = participant.id;
                item.textContent = `${participant.id} - ${participant.username}`;
                idList.appendChild(item);
            });
        }
        
        // 清空已中獎列表並隱藏
        if (winnersList) {
            winnersList.innerHTML = '';
        }
        if (winnersSection) {
            winnersSection.style.display = 'none';
        }
        
        // 重置按鈕狀態
        checkAndUpdateLotteryButton(tabId);
        
    } catch (error) {
        console.error('重新載入失敗:', error);
        alert('重新載入名單失敗：' + error.message);
    }
}

// 切換分頁
function switchTab(tabId) {
    // 更新按鈕狀態
    document.querySelectorAll('.tab-btn').forEach((btn, index) => {
        btn.classList.remove('active');
        if (allTabs[index].id === tabId) {
            btn.classList.add('active');
        }
    });
    
    // 更新面板顯示
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `panel-${tabId}`) {
            panel.classList.add('active');
        }
    });
}

// 開始抽獎
function startLottery(tabId) {
    const idList = document.getElementById(`id-list-${tabId}`);
    
    // 初始化此分頁的已中獎列表（如果不存在）
    if (!drawnWinners[tabId]) {
        drawnWinners[tabId] = [];
    }
    
    // 重置所有淘汰和中獎狀態，開始新一輪抽獎
    const allItems = idList.querySelectorAll('.id-item');
    allItems.forEach(item => {
        item.classList.remove('eliminated', 'winner');
    });
    
    // 獲取可用的參與者（連續模式下排除已中獎的）
    let items = Array.from(idList.querySelectorAll('.id-item'));
    
    if (continuousMode) {
        // 連續模式：過濾掉已中獎的
        items = items.filter(item => !drawnWinners[tabId].includes(item.dataset.id));
    }
    
    if (items.length === 0) {
        alert('沒有可抽獎的參與者');
        return;
    }
    
    const wheel = document.getElementById(`wheel-${tabId}`);
    const wheelNumber = wheel.querySelector('.wheel-number');
    const wheelInfo = wheel.parentElement.querySelector('.wheel-info');
    const startBtn = wheel.parentElement.querySelector('.btn-primary');
    
    // 禁用按鈕
    startBtn.disabled = true;
    wheel.classList.add('spinning');
    wheelInfo.textContent = '抽獎中...';
    
    // 🎵 播放啟動音效
    playSound('spin');
    
    // 隨機選擇一個號碼
    const randomIndex = Math.floor(Math.random() * items.length);
    const winner = items[randomIndex];
    const winnerNumber = winner.dataset.id;
    
    // 🎵 開始循環播放輪盤音效
    startSpinLoop();
    
    // 輪盤動畫
    let count = 0;
    const spinInterval = setInterval(() => {
        // 從實際的未淘汰項目中隨機選一個來顯示
        const randomDisplayIndex = Math.floor(Math.random() * items.length);
        const randomNum = items[randomDisplayIndex].dataset.id;
        wheelNumber.textContent = randomNum;
        count++;
        
        if (count > 50) {
            clearInterval(spinInterval);
            
            // 🎵 停止循環音效
            stopSpinLoop();
            
            wheel.classList.remove('spinning');
            
            // 🎵 播放停止音效
            playSound('stop');
            
            if (skipShrinkMode) {
                // 跳過縮圈模式：直接顯示結果
                wheelNumber.textContent = winnerNumber;
                
                // 🎵 播放中獎音效
                setTimeout(() => {
                    playSound('winner');
                }, 300);
                
                // 標記中獎者
                const winnerItem = idList.querySelector(`[data-id="${winnerNumber}"]`);
                if (winnerItem) {
                    winnerItem.classList.add('winner');
                }
                
                // 如果是連續模式，自動處理已中獎項
                if (continuousMode) {
                    setTimeout(() => {
                        handleWinnerInContinuousMode(tabId, winnerNumber);
                    }, 2000);
                }
                
                // 重新啟用按鈕
                startBtn.disabled = false;
                wheelInfo.textContent = '準備下次抽獎';
            } else {
                // 正常模式：顯示縮圈遮罩
                wheelNumber.textContent = '???';
                
                // 立即顯示結果遮罩（不延遲，避免洩漏結果）
                showResultOverlay(winnerNumber);
                
                // 稍後在遮罩中顯示完整號碼（可選）
                setTimeout(() => {
                    wheelNumber.textContent = winnerNumber;
                }, 1000);
                
                // 重新啟用按鈕
                startBtn.disabled = false;
                wheelInfo.textContent = '準備下次抽獎';
            }
        }
    }, 50);
    
    // 保存當前結果
    currentWinnerNumber = winnerNumber;
    revealStep = 0;
}

// 顯示結果遮罩
function showResultOverlay(number) {
    const digits = number.split('');
    
    document.getElementById('digit1').querySelector('.actual-digit').textContent = digits[0];
    document.getElementById('digit2').querySelector('.actual-digit').textContent = digits[1];
    document.getElementById('digit3').querySelector('.actual-digit').textContent = digits[2];
    
    // 重置為遮蓋狀態
    document.querySelectorAll('.digit').forEach(digit => {
        digit.classList.remove('revealed');
        digit.classList.add('covered');
    });
    
    // 隱藏並清空候選名單
    const leftCandidates = document.getElementById('leftCandidates');
    const rightCandidates = document.getElementById('rightCandidates');
    if (leftCandidates) {
        leftCandidates.style.display = 'none';
        leftCandidates.innerHTML = '';
    }
    if (rightCandidates) {
        rightCandidates.style.display = 'none';
        rightCandidates.innerHTML = '';
    }
    
    revealStep = 0;
    shrinkBtn.style.display = 'block';
    resultOverlay.style.display = 'flex';
}

// 縮圈功能
function handleShrink() {
    if (revealStep >= 3) {
        return;
    }
    
    revealStep++;
    
    // 🎵 播放揭示音效
    playSound('reveal');
    
    // 找到當前活躍的分頁
    const activePanel = document.querySelector('.tab-panel.active');
    const tabId = activePanel.id.replace('panel-', '');
    const idList = document.getElementById(`id-list-${tabId}`);
    
    // 公開對應位數
    const digitElement = document.getElementById(`digit${revealStep}`);
    digitElement.classList.remove('covered');
    digitElement.classList.add('revealed');
    
    // 淘汰不符合的 ID
    const revealedDigits = [];
    for (let i = 1; i <= revealStep; i++) {
        const digit = document.getElementById(`digit${i}`).querySelector('.actual-digit').textContent;
        revealedDigits.push(digit);
    }
    
    const items = idList.querySelectorAll('.id-item');
    items.forEach(item => {
        const id = item.dataset.id;
        let shouldEliminate = false;
        
        for (let i = 0; i < revealedDigits.length; i++) {
            if (id[i] !== revealedDigits[i]) {
                shouldEliminate = true;
                break;
            }
        }
        
        if (shouldEliminate && !item.classList.contains('eliminated')) {
            item.classList.add('eliminated');
        }
    });
    
    // 判斷是否為 Twitch 登入模式（非自定義模式）
    const isTwitchMode = tabId !== 'custom';
    
    // 當十位數揭示時，顯示候選名單（僅 Twitch 模式）
    if (revealStep === 2 && isTwitchMode) {
        showCandidatesList(revealedDigits, idList);
    }
    
    // 如果全部公開，標記中獎者並讓候選名單中的中獎ID發光
    if (revealStep === 3) {
        shrinkBtn.textContent = '抽獎完成';
        shrinkBtn.disabled = true;
        
        // 🎵 播放中獎音效
        setTimeout(() => {
            playSound('winner');
        }, 300);
        
        const winnerItem = idList.querySelector(`[data-id="${currentWinnerNumber}"]`);
        if (winnerItem) {
            winnerItem.classList.remove('eliminated');
            winnerItem.classList.add('winner');
        }
        
        // 讓候選名單中的中獎ID發光（僅 Twitch 模式）
        if (isTwitchMode) {
            highlightWinnerInCandidates(currentWinnerNumber);
        }
    }
}

// 顯示候選名單（十位數揭示後）
function showCandidatesList(revealedDigits, idList) {
    const leftCandidates = document.getElementById('leftCandidates');
    const rightCandidates = document.getElementById('rightCandidates');
    
    // 清空之前的內容
    leftCandidates.innerHTML = '';
    rightCandidates.innerHTML = '';
    
    // 獲取前兩位數字，生成 XX0 到 XX9 的範圍
    const prefix = revealedDigits.join('');
    const candidates = [];
    
    // 收集實際存在的候選者
    const items = idList.querySelectorAll('.id-item:not(.eliminated)');
    items.forEach(item => {
        const id = item.dataset.id;
        if (id.startsWith(prefix)) {
            const fullText = item.textContent.trim();
            const parts = fullText.split(' - ');
            const username = parts.length > 1 ? parts[1] : null; // 只有在有分隔符時才取用戶名
            
            candidates.push({
                id: id,
                username: username
            });
        }
    });
    
    // 限制最多顯示 10 個
    const displayCandidates = candidates.slice(0, 10);
    
    // 分配到左右兩側（左5右5，不足就先左再右）
    displayCandidates.forEach((candidate, index) => {
        const candidateItem = document.createElement('div');
        candidateItem.className = 'candidate-item';
        candidateItem.dataset.id = candidate.id;
        candidateItem.innerHTML = `
            <span class="candidate-id">${candidate.id}</span>
            ${candidate.username ? `<span class="candidate-name">${candidate.username}</span>` : ''}
        `;
        
        if (index < 5) {
            leftCandidates.appendChild(candidateItem);
        } else {
            rightCandidates.appendChild(candidateItem);
        }
    });
    
    // 顯示候選名單容器
    leftCandidates.style.display = 'flex';
    rightCandidates.style.display = 'flex';
}

// 讓候選名單中的中獎ID發光
function highlightWinnerInCandidates(winnerId) {
    const allCandidates = document.querySelectorAll('.candidate-item');
    allCandidates.forEach(candidate => {
        if (candidate.dataset.id === winnerId) {
            candidate.classList.add('winner-glow');
        }
    });
}

// 關閉結果遮罩
function closeResultOverlay() {
    // 在連續模式下，記錄已中獎的號碼
    if (continuousMode && currentWinnerNumber) {
        // 找到當前活躍的分頁
        const activePanel = document.querySelector('.tab-panel.active');
        const tabId = activePanel.id.replace('panel-', '');
        
        // 初始化已中獎列表（如果不存在）
        if (!drawnWinners[tabId]) {
            drawnWinners[tabId] = [];
        }
        
        // 記錄中獎號碼
        if (!drawnWinners[tabId].includes(currentWinnerNumber)) {
            drawnWinners[tabId].push(currentWinnerNumber);
        }
        
        // 移動中獎項到已中獎列表
        const idList = document.getElementById(`id-list-${tabId}`);
        const winnersList = document.getElementById(`winners-list-${tabId}`);
        const winnersSection = document.getElementById(`winners-section-${tabId}`);
        
        if (idList && winnersList) {
            const winnerItem = idList.querySelector(`[data-id="${currentWinnerNumber}"]`);
            if (winnerItem) {
                // 從未中獎列表移除
                winnerItem.remove();
                
                // 複製一份添加到已中獎列表
                const winnerCopy = winnerItem.cloneNode(true);
                winnerCopy.classList.remove('eliminated', 'winner');
                winnerCopy.classList.add('drawn');
                winnersList.appendChild(winnerCopy);
                
                // 顯示已中獎區域
                if (winnersSection) {
                    winnersSection.style.display = 'block';
                }
            }
        }
        
        // 檢查並更新抽獎按鈕狀態
        checkAndUpdateLotteryButton(tabId);
    }
    
    resultOverlay.style.display = 'none';
    shrinkBtn.textContent = '縮圈';
    shrinkBtn.disabled = false;
}

// 檢查並更新抽獎按鈕狀態
function checkAndUpdateLotteryButton(tabId) {
    const idList = document.getElementById(`id-list-${tabId}`);
    const startBtn = document.getElementById(`startBtn-${tabId}`);
    
    if (!idList || !startBtn) return;
    
    // 如果啟用連續模式
    if (continuousMode) {
        // 獲取所有參與者
        const allItems = Array.from(idList.querySelectorAll('.id-item'));
        
        // 初始化已中獎列表
        if (!drawnWinners[tabId]) {
            drawnWinners[tabId] = [];
        }
        
        // 計算剩餘可抽取的數量
        const remainingItems = allItems.filter(item => !drawnWinners[tabId].includes(item.dataset.id));
        
        if (remainingItems.length === 0) {
            // 全部抽完，停用按鈕
            startBtn.disabled = true;
            startBtn.textContent = '已全部抽完';
            
            const wheelInfo = document.querySelector(`#wheel-${tabId}`).parentElement.querySelector('.wheel-info');
            if (wheelInfo) {
                wheelInfo.textContent = '請重新產生列表或載入';
            }
        } else {
            // 還有可抽的，啟用按鈕
            startBtn.disabled = false;
            startBtn.textContent = '啟動抽獎';
            
            const wheelInfo = document.querySelector(`#wheel-${tabId}`).parentElement.querySelector('.wheel-info');
            if (wheelInfo) {
                wheelInfo.textContent = `準備下次抽獎`;
            }
        }
    }
}

// 顯示載入狀態
function showLoading() {
    loadingState.style.display = 'block';
    errorState.style.display = 'none';
    mainContent.style.display = 'none';
}

// 顯示錯誤狀態
function showError(message) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    mainContent.style.display = 'none';
    errorMessage.textContent = message;
}

// 顯示主要內容
function showMainContent() {
    loadingState.style.display = 'none';
    errorState.style.display = 'none';
    mainContent.style.display = 'block';
}

// ==================== 音效系統 ====================

// 初始化音效系統
function initSoundSystem() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.error('Web Audio API 不支援:', e);
    }
}

// 載入音效設定
function loadSoundSettings() {
    const saved = localStorage.getItem('soundSettings');
    if (saved) {
        soundSettings = JSON.parse(saved);
    }
    
    const savedCustom = localStorage.getItem('customSounds');
    if (savedCustom) {
        customSounds = JSON.parse(savedCustom);
    }
    
    // 更新 UI
    soundEnabled.checked = soundSettings.enabled;
    volumeSlider.value = soundSettings.volume * 100;
    volumeValue.textContent = Math.round(soundSettings.volume * 100) + '%';
    soundTheme.value = soundSettings.theme;
    customSoundSection.style.display = soundSettings.theme === 'custom' ? 'block' : 'none';
}

// 儲存音效設定
function saveSoundSettings() {
    localStorage.setItem('soundSettings', JSON.stringify(soundSettings));
}

// 更新音效設定
function updateSoundSettings() {
    soundSettings.enabled = soundEnabled.checked;
    saveSoundSettings();
}

// 更新音量
function updateVolume() {
    soundSettings.volume = volumeSlider.value / 100;
    volumeValue.textContent = volumeSlider.value + '%';
    saveSoundSettings();
}

// 更新音效主題
function updateSoundTheme() {
    soundSettings.theme = soundTheme.value;
    customSoundSection.style.display = soundSettings.theme === 'custom' ? 'block' : 'none';
    saveSoundSettings();
}

// 處理檔案上傳
function handleFileUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;
    
    // 檢查檔案大小（限制 500KB）
    if (file.size > 500 * 1024) {
        document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`).textContent = '檔案太大！';
        document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`).className = 'upload-status error';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        customSounds[type] = e.target.result;
        localStorage.setItem('customSounds', JSON.stringify(customSounds));
        document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`).textContent = '✓ 已上傳';
        document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`).className = 'upload-status';
    };
    reader.readAsDataURL(file);
}

// 清除自訂音效
function clearCustomSound(type) {
    delete customSounds[type];
    localStorage.setItem('customSounds', JSON.stringify(customSounds));
    document.getElementById(`upload${type.charAt(0).toUpperCase() + type.slice(1)}`).value = '';
    document.getElementById(`status${type.charAt(0).toUpperCase() + type.slice(1)}`).textContent = '';
}

// Web Audio API 生成音效
function generateBeep(frequency, duration, type = 'sine') {
    if (!audioContext || !soundSettings.enabled) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    
    gainNode.gain.setValueAtTime(soundSettings.volume * 0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration / 1000);
}

// 播放音效
function playSound(type) {
    if (!soundSettings.enabled) return;
    
    // 如果使用自訂音效且該音效存在
    if (soundSettings.theme === 'custom' && customSounds[type]) {
        const audio = new Audio(customSounds[type]);
        audio.volume = soundSettings.volume;
        audio.play().catch(e => console.log('播放失敗:', e));
        return;
    }
    
    // 使用預設音效（Web Audio API）
    switch(type) {
        case 'spin':
            // 輪盤旋轉音效 - 快速的滴答聲
            generateBeep(800, 50, 'square');
            break;
        case 'reveal':
            // 縮圈揭示音效 - 上升音調
            generateBeep(400, 100, 'sine');
            setTimeout(() => generateBeep(600, 100, 'sine'), 100);
            break;
        case 'winner':
            // 中獎音效 - 勝利和弦
            generateBeep(523, 200, 'sine'); // C
            setTimeout(() => generateBeep(659, 200, 'sine'), 100); // E
            setTimeout(() => generateBeep(784, 300, 'sine'), 200); // G
            break;
        case 'stop':
            // 停止音效
            generateBeep(600, 150, 'sine');
            setTimeout(() => generateBeep(400, 150, 'sine'), 150);
            break;
    }
}

// 開始輪盤循環音效
function startSpinLoop() {
    if (!soundSettings.enabled) return;
    
    if (soundSettings.theme === 'custom' && customSounds.spin) {
        spinLoopAudio = new Audio(customSounds.spin);
        spinLoopAudio.loop = true;
        spinLoopAudio.volume = soundSettings.volume;
        spinLoopAudio.play().catch(e => console.log('播放失敗:', e));
    } else {
        // 使用 Web Audio 生成循環音效
        spinLoopAudio = setInterval(() => {
            generateBeep(800, 30, 'square');
        }, 100);
    }
}

// 停止輪盤循環音效
function stopSpinLoop() {
    if (spinLoopAudio) {
        if (spinLoopAudio instanceof Audio) {
            spinLoopAudio.pause();
            spinLoopAudio.currentTime = 0;
        } else {
            clearInterval(spinLoopAudio);
        }
        spinLoopAudio = null;
    }
}

// 測試音效
function testSound(type) {
    playSound(type);
}

// ==================== 啟動應用 ====================
init();
