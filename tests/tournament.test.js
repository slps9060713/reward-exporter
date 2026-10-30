// 極致錦標賽測試：node tests/tournament.test.js [--grep a|b]
const path = require('path');
const { launch, sleep } = require('./lib/cdp');
const { startServer } = require('./lib/server');
const { test, assert, assertEq, run } = require('./lib/harness');

let server = null;

// ---------- 頁面設置 ----------
function optionStorage(opts) {
    const o = Object.assign({
        continuous: true, wheel: true, extreme: true, tournament: true, introSeen: true, limit: 999
    }, opts || {});
    return `localStorage.clear();
        localStorage.setItem('globalContinuousMode', '${o.continuous}');
        localStorage.setItem('globalWheelMode', '${o.wheel}');
        localStorage.setItem('globalWheelModeExtreme', '${o.extreme}');
        localStorage.setItem('globalExtremeTournament', '${o.tournament}');
        ${o.introSeen ? `localStorage.setItem('extremeTournamentIntroHidden', 'true');` : ''}
        ${o.firstShown === false ? '' : `localStorage.setItem('extremeTournamentIntroFirstShown', 'true');`}
        localStorage.setItem('wheelModeLimit', '${o.limit}');`;
}

async function setupCustom(b, n, opts) {
    await b.goto(server.url + '/index.html');
    await b.evaluate(optionStorage(opts));
    await b.goto(server.url + '/index.html');
    const lines = Array.from({ length: n }, (_, i) => 'P' + String(i + 1).padStart(2, '0')).join('\\n');
    await b.evaluate(`
        document.getElementById('loginPage').classList.remove('active');
        document.getElementById('mainPage').classList.add('active');
        createCustomTab();
        importCustomLines('${lines}', null);`);
    await sleep(900);
}

// rewards = [{ id, title, users: [...] }]
async function setupTwitch(b, rewards, opts) {
    await b.goto(server.url + '/index.html');
    await b.evaluate(optionStorage(opts) + `localStorage.setItem('twitch_token', 'faketoken');`);
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        (() => {
            const rewards = ${JSON.stringify(rewards)};
            const json = body => Promise.resolve(new Response(JSON.stringify(body),
                { status: 200, headers: { 'Content-Type': 'application/json' } }));
            const realFetch = window.fetch;
            window.fetch = (input, init) => {
                const url = String(input && input.url || input);
                if (url.includes('/redemptions')) {
                    const rid = new URL(url).searchParams.get('reward_id');
                    const r = rewards.find(x => x.id === rid) || { users: [] };
                    return json({ data: r.users.map((u, i) => ({ id: 'x' + i, user_id: 'u' + rid + i,
                        user_name: u, user_input: '' })), pagination: {} });
                }
                if (url.includes('/custom_rewards')) {
                    return json({ data: rewards.map(r => ({ id: r.id, title: r.title, cost: 1,
                        prompt: '', is_enabled: true })) });
                }
                if (url.includes('api.twitch.tv/helix/users')) {
                    return json({ data: [{ id: '123', login: 'test', display_name: 'Test' }] });
                }
                if (url.includes('id.twitch.tv/oauth2/validate')) return json({ client_id: 'x' });
                return realFetch(input, init);
            };
        })();` });
    await b.goto(server.url + '/index.html');
    await waitFor(b, `document.querySelectorAll('.tab-btn').length >= ${rewards.length}`);
    for (let i = 0; i < rewards.length; i++) {
        await b.evaluate(`switchTab('reward-${i}')`);
        await b.evaluate(`loadRedemptionsForTab('reward-${i}')`);
    }
    await b.evaluate(`switchTab('reward-0')`);
    await sleep(900);
}

async function state(b, tabId = 'custom') {
    return b.evaluate(`(() => {
        const tab = ${JSON.stringify(tabId)};
        const $ = id => document.getElementById(id);
        const vis = el => !!el && el.offsetParent !== null;
        const ids = sel => [...document.querySelectorAll(sel)].map(e => e.dataset.id);
        const arena = $('extreme-arena-area-' + tab);
        const actions = $('tournamentActions-' + tab);
        const start = $('startBtn-' + tab);
        const info = document.querySelector('#panel-' + tab + ' .wheel-info');
        return {
            pool: ids('#id-list-' + tab + ' .id-item'),
            candidates: typeof getTournamentCandidates === 'function' ? getTournamentCandidates(tab) : [],
            greyIds: ids('#winners-list-' + tab + ' .id-item.tournament-candidate'),
            winnerIds: ids('#winners-list-' + tab + ' .id-item:not(.tournament-candidate)'),
            drawn: drawnWinners[tab] || [],
            sidebar: winnersRecord.map(w => w.id),
            startVisible: vis(start),
            selectVisible: vis($('selectBtn-' + tab)),
            selectDisabled: !!$('selectBtn-' + tab) && $('selectBtn-' + tab).disabled,
            matchVisible: vis($('matchBtn-' + tab)),
            matchDisabled: !!$('matchBtn-' + tab) && $('matchBtn-' + tab).disabled,
            startInArena: !!arena && !!start && arena.contains(start),
            actionsInArena: !!arena && !!actions && arena.contains(actions) && vis(actions),
            digitVisible: vis($('digit-wheel-area-' + tab)),
            pieVisible: vis($('pie-wheel-area-' + tab)),
            arenaVisible: vis(arena),
            info: info ? info.textContent.trim() : '',
            busy: lotteryBusy
        };
    })()`);
}

async function waitFor(b, expr, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await b.evaluate(expr)) return;
        await sleep(100);
    }
    throw new Error('waitFor 逾時：' + expr);
}

async function finishMatch(b) {
    await b.evaluate(`extremeStage && extremeStage.abort()`);
    await waitFor(b, `!lotteryBusy`);
}

// ---------- Task 0 ----------
test('smoke: existing extreme draw with 4 still works', async (b) => {
    await setupCustom(b, 4, { tournament: false });
    const s = await state(b);
    assert(s.arenaVisible && s.startInArena, '4 人應直接掛擂台且按鈕在擂台中央');
    await b.evaluate(`startLottery('custom')`);
    await sleep(4000);   // 倒數 3 秒後進入 battle
    await finishMatch(b);
    const t = await state(b);
    assertEq(t.drawn.length, 1, '應有一位中獎者');
    assertEq(t.pool.length, 3, '連續模式下中獎者移出名單');
});

test('smoke: twitch setup loads reward tabs', async (b) => {
    await setupTwitch(b, [{ id: 'r1', title: '獎項A', users: ['A01', 'A02', 'A03'] },
                          { id: 'r2', title: '獎項B', users: ['B01', 'B02'] }], { tournament: false });
    assertEq((await state(b, 'reward-0')).pool, ['001', '002', '003']);
    assertEq((await state(b, 'reward-1')).pool, ['001', '002']);
});

// ---------- Task 1：勾選項、啟用條件、說明視窗 ----------
test('option: disabled unless continuous+extreme', async (b) => {
    await setupCustom(b, 8, { tournament: false, continuous: false });
    assert(await b.evaluate(`document.getElementById('globalExtremeTournament').disabled`), '無連續時應泛灰');
    await b.evaluate(`document.getElementById('globalContinuousMode').checked = true; toggleGlobalContinuousMode(true)`);
    assert(!(await b.evaluate(`document.getElementById('globalExtremeTournament').disabled`)), '連續+極致時可勾');
    await b.evaluate(`document.getElementById('globalWheelModeExtreme').checked = false; toggleGlobalExtremeMode(false)`);
    assert(await b.evaluate(`document.getElementById('globalExtremeTournament').disabled`), '取消極致後應泛灰');
});
test('option: unchecking prerequisite unchecks and persists false', async (b) => {
    await setupCustom(b, 8);
    assert(await b.evaluate(`document.getElementById('globalExtremeTournament').checked`), '應還原勾選');
    await b.evaluate(`document.getElementById('globalWheelMode').checked = false; toggleGlobalWheelMode(false)`);
    assertEq(await b.evaluate(`[document.getElementById('globalExtremeTournament').checked, localStorage.getItem('globalExtremeTournament')]`), [false, 'false']);
    await b.evaluate(`document.getElementById('globalWheelMode').checked = true; toggleGlobalWheelMode(true)`);
    assertEq(await b.evaluate(`document.getElementById('globalExtremeTournament').checked`), false, '重新勾回前提不自動恢復');
});
test('option: not restored when prerequisite missing at load', async (b) => {
    await setupCustom(b, 8, { continuous: false });
    assertEq(await b.evaluate(`[document.getElementById('globalExtremeTournament').checked, localStorage.getItem('globalExtremeTournament')]`), [false, 'false']);
});
test('intro: shows every time until 不再提醒 is checked', async (b) => {
    await setupCustom(b, 8, { tournament: false, introSeen: false });
    const shown = `getComputedStyle(document.getElementById('tournamentIntroOverlay')).display !== 'none'`;
    const recheck = `const x = document.getElementById('globalExtremeTournament'); x.checked = false; toggleExtremeTournament(false); x.checked = true; toggleExtremeTournament(true)`;
    await b.evaluate(`const x = document.getElementById('globalExtremeTournament'); x.checked = true; toggleExtremeTournament(true)`);
    assert(await b.evaluate(shown), '第一次應顯示');
    assertEq(await b.evaluate(`document.getElementById('tournamentIntroDontRemind').checked`), false, '不再提醒預設不勾');
    await b.evaluate(`document.getElementById('closeTournamentIntroBtn').click()`);
    assert(!(await b.evaluate(shown)), '按我知道了應關閉');
    await b.evaluate(recheck);
    assert(await b.evaluate(shown), '沒勾不再提醒：第二次仍顯示');
    assert(await b.evaluate(`document.getElementById('globalExtremeTournament').checked`), '關閉視窗後仍維持勾選');
    await b.evaluate(`document.getElementById('tournamentIntroDontRemind').checked = true; document.getElementById('closeTournamentIntroBtn').click()`);
    await b.evaluate(recheck);
    assert(!(await b.evaluate(shown)), '勾了不再提醒：之後不顯示');
    await b.goto(server.url + '/index.html');
    assertEq(await b.evaluate(`localStorage.getItem('extremeTournamentIntroHidden')`), 'true', '重新整理後仍記得');
});
test('intro: forced once on first entering the lottery screen', async (b) => {
    const shown = `getComputedStyle(document.getElementById('tournamentIntroOverlay')).display !== 'none'`;
    // 就算已勾「不再提醒」、錦標賽也沒開，第一次進入仍強制跳出
    await b.goto(server.url + '/index.html');
    await b.evaluate(optionStorage({ tournament: false, firstShown: false }));
    await b.goto(server.url + '/index.html');
    assert(!(await b.evaluate(shown)), '登入頁不跳');
    await b.evaluate(`handleStartGuest()`);
    assert(await b.evaluate(shown), '第一次進入抽獎畫面強制跳出');
    assertEq(await b.evaluate(`localStorage.getItem('extremeTournamentIntroFirstShown')`), 'true');
    await b.evaluate(`document.getElementById('closeTournamentIntroBtn').click()`);
    await b.goto(server.url + '/index.html');
    await b.evaluate(`handleStartGuest()`);
    assert(!(await b.evaluate(shown)), '第二次進入不再強制跳出');
    // 之後只看「不再提醒」：已勾 → 勾選錦標賽也不跳
    await b.evaluate(`const x = document.getElementById('globalExtremeTournament'); x.checked = true; toggleExtremeTournament(true)`);
    assert(!(await b.evaluate(shown)), '不再提醒已勾：勾選錦標賽不跳');
});
test('intro: forced on first twitch login too', async (b) => {
    await setupTwitch(b, [{ id: 'r1', title: '獎項A', users: ['A01', 'A02'] }], { firstShown: false });
    assert(await b.evaluate(`getComputedStyle(document.getElementById('tournamentIntroOverlay')).display !== 'none'`), 'Twitch 登入第一次進入也強制跳出');
});
test('intro: rule text', async (b) => {
    await setupCustom(b, 8);
    const items = await b.evaluate(`[...document.querySelectorAll('.tournament-intro-rules li')].map(li => li.textContent.trim())`);
    assertEq(items.length, 5);
    assert(items[0].startsWith('連續抽取模式開啟時並且名單超過 5 人時') && items[0].includes('（淺灰色，跳過縮圈）'), '第一條：' + items[0]);
    assert(items[0].includes('從名單中抽出候選人'), '第一條用「抽出」：' + items[0]);
    assert(items[2].endsWith('中獎冠軍會留在那邊，後續仍然可以追加遴選，已中獎冠軍不會再次被算在後續對戰名單中。'), '第三條補充：' + items[2]);
    assertEq(items[4], '建議在抽選人數多，並且需要製造懸念的大獎環節使用');
    const color = await b.evaluate(`getComputedStyle(document.querySelector('.tournament-intro-rules li:nth-child(5)')).color`);
    assertEq(color, 'rgb(255, 230, 153)', '第五條淺黃色');
});

// ---------- Task 2：候選人狀態、按鈕切換、數字輪盤分支、✕ ----------
test('flow boundary 5 vs 6', async (b) => {
    await setupCustom(b, 5);
    let s = await state(b);
    assert(s.arenaVisible && s.startInArena && !s.selectVisible, '5 人直接極致');
    await setupCustom(b, 6);
    s = await state(b);
    assert(s.digitVisible && !s.arenaVisible && s.selectVisible && s.matchVisible && !s.startVisible, '6 人走錦標賽、數字輪盤');
    await b.evaluate(`addTournamentCandidate('custom','003')`);
    s = await state(b);
    assertEq(s.pool.length, 5);
    assert(s.digitVisible && !s.arenaVisible && s.selectVisible, '遴選區有人時即使剩 5 人仍是錦標賽');
});
test('candidate state and button rules', async (b) => {
    await setupCustom(b, 8);
    let s = await state(b);
    assertEq([s.selectDisabled, s.matchDisabled], [false, true], '0 人：開賽 disabled');
    await b.evaluate(`['002','005'].forEach(id => addTournamentCandidate('custom', id))`);
    s = await state(b);
    assertEq(s.candidates, ['002', '005']); assertEq(s.greyIds, ['002', '005']);
    assertEq(s.sidebar, []); assertEq(s.drawn, []);
    assert(!s.pool.includes('002'), '候選人不在獎池'); assertEq(s.matchDisabled, false);
    await b.evaluate(`['001','003','004'].forEach(id => addTournamentCandidate('custom', id))`);
    s = await state(b);
    assertEq([s.selectDisabled, s.matchDisabled], [true, false], '5 人：遴選 disabled');
});
test('candidate copy has no custom delete button', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`addTournamentCandidate('custom','004')`);
    assertEq(await b.evaluate(`document.querySelectorAll('#winners-list-custom .tournament-candidate .remove-custom-btn').length`), 0);
    assertEq(await b.evaluate(`document.querySelectorAll('#winners-list-custom .tournament-candidate .candidate-remove-btn').length`), 1);
});
test('remove candidate returns to pool in order', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`addTournamentCandidate('custom','004'); addTournamentCandidate('custom','006')`);
    await b.evaluate(`document.querySelector('#winners-list-custom [data-id="004"] .candidate-remove-btn').click()`);
    const s = await state(b);
    assertEq(s.candidates, ['006']);
    assertEq(s.pool, ['001', '002', '003', '004', '005', '007', '008']);
});
test('remove blocked while busy', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`addTournamentCandidate('custom','004'); lotteryBusy = true; removeTournamentCandidate('custom','004')`);
    assertEq((await state(b)).candidates, ['004']);
});
test('grey styling differs from winners', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`addTournamentCandidate('custom','004')`);
    const bg = await b.evaluate(`getComputedStyle(document.querySelector('#winners-list-custom .tournament-candidate')).backgroundImage`);
    assertEq(bg, 'none', '候選人不可用綠色漸層（用淺灰純色）');
});

// ---------- Task 3：遴選（數字跳號、無縮圈） ----------
test('select picks one candidate without shrink', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`selectTournamentCandidate('custom')`);
    let s = await state(b);
    assert(s.busy && s.selectDisabled, '跳號中鎖住');
    await waitFor(b, `!lotteryBusy`, 5000);
    s = await state(b);
    assertEq(s.candidates.length, 1);
    assert(s.info.startsWith('遴選：'), 'wheel-info 顯示遴選結果，實際：' + s.info);
    assertEq(await b.evaluate(`document.querySelector('#panel-custom .wheel-number').textContent`), s.candidates[0]);
    assertEq(await b.evaluate(`!!document.getElementById('no-overlay-shrink-custom') && document.getElementById('no-overlay-shrink-custom').offsetParent !== null`), false, '不可出現縮圈');
    assertEq(s.pool.length, 7);
});
test('double click select adds one', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`selectTournamentCandidate('custom'); selectTournamentCandidate('custom')`);
    await waitFor(b, `!lotteryBusy`, 5000);
    assertEq((await state(b)).candidates.length, 1);
});
test('select roll cancelled by clear', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`selectTournamentCandidate('custom')`);
    await b.evaluate(`const x = document.getElementById('globalExtremeTournament'); x.checked = false; toggleExtremeTournament(false)`);
    await sleep(3200);
    const s = await state(b);
    assertEq(s.candidates, []); assertEq(s.pool.length, 8); assertEq(s.busy, false);
});
test('select stays in tournament after winners exist', async (b) => {
    await setupCustom(b, 9);
    await b.evaluate(`handleWinner('custom','001')`);   // 模擬已有正式中獎者
    await b.evaluate(`selectTournamentCandidate('custom')`);
    await waitFor(b, `!lotteryBusy`, 5000);
    const s = await state(b);
    assertEq(s.winnerIds, ['001']); assertEq(s.candidates.length, 1);
    assert(!s.candidates.includes('001'), '已中獎者不會被遴選');
});

// ---------- Task 4：清空遴選區的時機 ----------
for (const [name, op] of [
    ['import', `importCustomLines('新人甲', null)`],
    ['add', `document.getElementById('customTextInput').value = '新人乙'; addCustomTextEntry()`],
    ['delete', `removeCustomEntry('008')`],
    ['delete candidate itself', `removeCustomEntry('005')`],
    ['continuous off', `document.getElementById('globalContinuousMode').checked = false; toggleGlobalContinuousMode(false)`],
    ['extreme off', `document.getElementById('globalWheelModeExtreme').checked = false; toggleGlobalExtremeMode(false)`],
]) {
    test(`clear on ${name}`, async (b) => {
        await setupCustom(b, 8);
        await b.evaluate(`addTournamentCandidate('custom','002'); addTournamentCandidate('custom','005')`);
        await b.evaluate(op);
        const s = await state(b);
        assertEq(s.candidates, []); assertEq(s.greyIds, []);
        assert(s.pool.includes('002'), '候選人回到名單');
        if (name !== 'delete candidate itself') assert(s.pool.includes('005'), '候選人回到名單');
        else assert(!s.pool.includes('005'), '被刪除的候選人不應回到名單');
        assertEq(new Set(s.pool).size, s.pool.length, '名單沒有重複');
    });
}
test('clear on tab switch and reload (twitch)', async (b) => {
    await setupTwitch(b, [{ id: 'r1', title: '獎項A', users: 'A01 A02 A03 A04 A05 A06 A07'.split(' ') },
                          { id: 'r2', title: '獎項B', users: 'B01 B02 B03'.split(' ') }]);
    await b.evaluate(`addTournamentCandidate('reward-0','002')`);
    await b.evaluate(`switchTab('reward-1'); switchTab('reward-0')`);
    let s = await state(b, 'reward-0');
    assertEq(s.candidates, []); assert(s.pool.includes('002'), '切分頁後候選人回到名單');
    await b.evaluate(`addTournamentCandidate('reward-0','003')`);
    await b.evaluate(`reloadRedemptionsForTab('reward-0')`);
    await waitFor(b, `!document.querySelector('#panel-reward-0 .reload-icon-btn').disabled`);
    s = await state(b, 'reward-0');
    assertEq(s.candidates, []); assertEq(s.pool.length, 7);
});

// ---------- Task 5：開賽、冠軍記帳、擂台內按鈕、中止收尾 ----------
test('match: champion recorded, others back to pool (twitch)', async (b) => {
    await setupTwitch(b, [{ id: 'r1', title: '獎項A', users: 'A01 A02 A03 A04 A05 A06 A07 A08 A09'.split(' ') }]);
    await b.evaluate(`['002','004','006'].forEach(id => addTournamentCandidate('reward-0', id))`);
    await b.evaluate(`startTournamentMatch('reward-0')`);
    let s = await state(b, 'reward-0');
    assert(s.arenaVisible && s.actionsInArena && s.busy, '開賽中：擂台＋按鈕在中央＋鎖住');
    assert(s.selectDisabled && s.matchDisabled, '開賽中兩顆都鎖住');
    await sleep(4000);
    await finishMatch(b);
    s = await state(b, 'reward-0');
    assertEq(s.drawn.length, 1);
    const champ = s.drawn[0];
    assert(['002', '004', '006'].includes(champ), '冠軍來自候選人');
    assertEq(s.sidebar.length, 1, '只有冠軍進右側紀錄');
    assertEq(s.candidates, []); assertEq(s.greyIds, []);
    assertEq(s.winnerIds, [champ]);
    assertEq(s.pool.length, 8, '其他兩位回名單');
    assert(s.arenaVisible, '結果暫留在擂台');
    assert(s.actionsInArena && !s.startVisible && s.matchDisabled && !s.selectDisabled, '可抽 8 > 5：中央是遴選/開賽，開賽 disabled');
    await b.evaluate(`selectTournamentCandidate('reward-0')`);
    s = await state(b, 'reward-0');
    assert(s.digitVisible && !s.arenaVisible && !s.actionsInArena && s.selectVisible, '按遴選回到數字輪盤、按鈕回控制列');
});
test('match: pool 2-5 after match shows start button in arena', async (b) => {
    await setupCustom(b, 6);
    await b.evaluate(`['001','002'].forEach(id => addTournamentCandidate('custom', id))`);
    await b.evaluate(`startTournamentMatch('custom')`);
    await sleep(4000);
    await finishMatch(b);
    const t = await state(b);
    assertEq(t.pool.length, 5);
    assert(t.arenaVisible && t.startInArena && t.startVisible && !t.actionsInArena, '可抽 5：中央是啟動抽獎');
    assertEq(await b.evaluate(`document.getElementById('startBtn-custom').disabled`), false);
    await b.evaluate(`startLottery('custom')`);
    assert((await state(b)).busy, '啟動抽獎走一般極致');
    await sleep(4000);
    await finishMatch(b);
    assertEq((await state(b)).drawn.length, 2);
});
test('abort during countdown still finishes', async (b) => {
    await setupTwitch(b, [{ id: 'r1', title: '獎項A', users: 'A01 A02 A03 A04 A05 A06 A07'.split(' ') },
                          { id: 'r2', title: '獎項B', users: 'B01 B02'.split(' ') }]);
    await b.evaluate(`['001','002'].forEach(id => addTournamentCandidate('reward-0', id)); startTournamentMatch('reward-0')`);
    await b.evaluate(`switchTab('reward-1')`);   // 倒數中（< 3 秒）切走
    const s = await state(b, 'reward-0');
    assertEq(s.busy, false); assertEq(s.drawn.length, 1); assertEq(s.candidates, []);
    assertEq(s.sidebar.length, 1);
    assertEq(s.pool.length, 6);
    const r1 = await state(b, 'reward-1');
    assert(r1.arenaVisible && r1.startInArena, '切到的分頁正常顯示擂台');
});
test('abort during battle still finishes once', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`['003','007'].forEach(id => addTournamentCandidate('custom', id)); startTournamentMatch('custom')`);
    await sleep(4000);
    await finishMatch(b);
    const s = await state(b);
    assertEq(s.drawn.length, 1); assertEq(s.pool.length, 7); assertEq(s.busy, false);
});
test('match button ignored with <2 candidates or while busy', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`addTournamentCandidate('custom','001'); startTournamentMatch('custom')`);
    let s = await state(b);
    assertEq([s.busy, s.arenaVisible], [false, false]);
    await b.evaluate(`addTournamentCandidate('custom','002'); lotteryBusy = true; startTournamentMatch('custom')`);
    s = await state(b);
    assertEq(s.arenaVisible, false);
});

test('match falls back to pie with same champion when arena fails', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`['003','007'].forEach(id => addTournamentCandidate('custom', id));
        BattleArena.mount = () => null;
        Math.random = () => 0.99;   // 冠軍 = 最後一位候選人 007
        startTournamentMatch('custom')`);
    let s = await state(b);
    assert(s.pieVisible && s.busy, '退回圓餅開獎');
    assertEq(s.candidates, []);
    await waitFor(b, `!lotteryBusy`, 15000);
    s = await state(b);
    assertEq(s.drawn, ['007']); assertEq(s.pool.length, 7);
});

// ---------- Task 6：高度預算 ----------
// .wheel-container 本身有 min-height，直接量它永遠 ≥ 500；改量可見子元素高度＋gap
const contentHeight = `(() => {
    const wc = document.querySelector('#panel-custom .wheel-container');
    const kids = [...wc.children].filter(c => c.offsetParent !== null);
    const gap = parseFloat(getComputedStyle(wc).rowGap) || 0;
    return kids.reduce((a, c) => a + c.getBoundingClientRect().height, 0) + gap * Math.max(0, kids.length - 1);
})()`;
test('layout: right column within 500px budget', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`['001','002','003','004','005'].forEach(id => addTournamentCandidate('custom', id))`);
    const h = await b.evaluate(contentHeight);
    assert(h <= 500, '數字輪盤＋並排按鈕高度 ' + h);
    await b.evaluate(`startTournamentMatch('custom')`);
    await sleep(4000);
    await finishMatch(b);
    const h2 = await b.evaluate(contentHeight);
    assert(h2 <= 500, '5 人擂台結果高度 ' + h2);
    console.log(`    高度：遴選畫面 ${h.toFixed(1)}px、5 人擂台結果 ${h2.toFixed(1)}px`);
});

// ---------- 最終審閱修正 ----------
test('review: unchecking extreme mid-match finishes and unlocks', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`['003','007'].forEach(id => addTournamentCandidate('custom', id)); startTournamentMatch('custom')`);
    await sleep(1000);
    await b.evaluate(`document.getElementById('globalWheelModeExtreme').checked = false; toggleGlobalExtremeMode(false)`);
    const s = await state(b);
    assertEq([s.busy, s.drawn.length, s.candidates.length, s.pool.length], [false, 1, 0, 7]);
    assert(!s.arenaVisible && (s.pieVisible || s.digitVisible) && s.startVisible, '回到一般輪盤且有啟動抽獎');
    assertEq(await b.evaluate(`document.getElementById('startBtn-custom').disabled`), false);
});
test('review: unchecking extreme mid plain extreme draw finishes and unlocks', async (b) => {
    await setupCustom(b, 4, { tournament: false });
    await b.evaluate(`startLottery('custom')`);
    await sleep(1000);
    await b.evaluate(`document.getElementById('globalWheelModeExtreme').checked = false; toggleGlobalExtremeMode(false)`);
    const s = await state(b);
    assertEq([s.busy, s.drawn.length, s.pool.length], [false, 1, 3]);
    assert(!s.arenaVisible && s.startVisible, '回到一般輪盤且有啟動抽獎');
});
test('review: unchecking tournament mid-match leaves a usable button', async (b) => {
    await setupCustom(b, 9);
    await b.evaluate(`['003','007'].forEach(id => addTournamentCandidate('custom', id)); startTournamentMatch('custom')`);
    await sleep(1000);
    await b.evaluate(`const x = document.getElementById('globalExtremeTournament'); x.checked = false; toggleExtremeTournament(false)`);
    await sleep(3500);
    await finishMatch(b);
    const s = await state(b);
    assertEq([s.drawn.length, s.pool.length], [1, 8]);
    assert(s.startVisible && !s.selectVisible, '要看得到可按的啟動抽獎');
    assertEq(await b.evaluate(`document.getElementById('startBtn-custom').disabled`), false);
});
test('review: tab switch during select roll leaves new tab usable', async (b) => {
    await setupTwitch(b, [{ id: 'r1', title: '獎項A', users: 'A01 A02 A03 A04 A05 A06 A07'.split(' ') },
                          { id: 'r2', title: '獎項B', users: 'B01 B02 B03'.split(' ') }]);
    await b.evaluate(`selectTournamentCandidate('reward-0')`);
    await sleep(500);
    await b.evaluate(`switchTab('reward-1')`);
    await sleep(3200);
    const r1 = await state(b, 'reward-1');
    assertEq(r1.busy, false);
    assertEq(await b.evaluate(`[document.getElementById('startBtn-reward-1').disabled, document.getElementById('startBtn-reward-1').textContent.trim()]`), [false, '啟動抽獎']);
});
test('review: custom list edits ignored mid-match', async (b) => {
    await setupCustom(b, 8);
    await b.evaluate(`['003','007'].forEach(id => addTournamentCandidate('custom', id)); startTournamentMatch('custom')`);
    await sleep(500);
    await b.evaluate(`window.alert = () => {}; removeCustomEntry('001'); removeCustomEntry('007'); importCustomLines('新人', null)`);
    let s = await state(b);
    assertEq(s.candidates, ['003', '007'], '開賽中遴選區不變');
    assertEq(s.pool.length, 6, '開賽中名單不變');
    await finishMatch(b);
    s = await state(b);
    assertEq([s.drawn.length, s.winnerIds.length, s.pool.length], [1, 1, 7]);
});

module.exports = { setupCustom, setupTwitch, state, waitFor, finishMatch };

if (require.main === module) {
    run({
        before: async () => {
            server = await startServer(path.join(__dirname, '..', 'docs'));
            return launch({ headless: !process.argv.includes('--headed') });
        },
        after: async (b) => { await b.close(); server.close(); }
    });
}
