/*!
 * battle-arena.js — 輪盤模式・極致（戰鬥陀螺開獎特效）
 *
 * 設計原則
 *  1. 完全獨立於 app.js：不讀寫 app.js 的任何全域變數，不依賴任何外部套件。
 *  2. 先定勝者，再找演出：外部傳入已決定的 winnerId，本模組用「種子搜尋」
 *     找出一場「真實物理模擬中該人獲勝、且時長落在指定區間」的對戰，再播放它。
 *     物理本身是真的（會有意外、逆轉），只是我們挑了結果符合的那一場。
 *  3. 模擬與渲染分離：先把整場模擬跑完存成逐格資料，再照時間軸播放。
 *     這樣畫面不論掉幀都不會影響勝負，勝者保證等於 winnerId。
 *
 * 用法
 *   BattleArena.start({
 *     container,                              // 放置畫面的 DOM 容器
 *     entries: [{ id, label }, ...],          // 2~4 人
 *     winnerId,                               // 預先決定的中獎者 id
 *     options: {},                            // 可選，覆寫 DEFAULTS
 *     onEvent: (evt) => {},                   // 可選：clash / stall / ringout / win
 *     onFinish: ({ winnerId, durationMs }) => {}
 *   });
 *
 * 勝負規則：轉速歸零（轉停）或被撞出擂台（擊飛）皆判敗，最後存活者獲勝。
 */
(function (global) {
    'use strict';

    // ==================== 可調參數 ====================
    // 模擬使用自己的長度單位，渲染時再依畫布大小等比縮放。
    const DEFAULTS = {
        // --- 擂台與陀螺 ---
        arenaR: 150,            // 擂台半徑
        topR: 17,               // 陀螺半徑

        // --- 運動 ---
        bowlPull: 1.5,          // 碗狀擂台的回復力。與 driveSpeed 一起決定「巡航軌道半徑」：
                                // 太小 → 貼著牆跑、開場就被擊飛；太大 → 擠在中央磨。
                                // 目前設定讓滿轉時的軌道半徑約 95（擂台半徑 150、牆界 133）
        bowlNonLinear: 0.6,     // 非線性項，打破軌道週期同步、製造混亂
        bowlPullFloor: 0.15,    // 回復力與轉速的關係：pull = bowlPull × (floor + (1-floor) × 轉速²)
                                // 轉速掉下來就抓不住中心、被離心力推到外圈 →
                                // 後期虛弱的陀螺會貼著擂台邊緣跑，變成容易被擊飛的目標
        dragBase: 0.08,         // 基礎阻力
        dragSpinFactor: 0.25,   // 轉速越低阻力越大（看起來像沒力了）
        driveSpeed: 130,        // 轉速驅動：滿轉時的巡航速度（速度 ≈ driveSpeed × 轉速）
        driveAccel: 1.2,        // 巡航速度的收斂速度
        driveVar: 0.14,         // 每顆陀螺的巡航速度差異 → 軌道半徑不同才會互相追撞
        driveSpinFloor: 0.5,    // 速度與轉速的耦合下限：速度 = drive × (floor + (1-floor) × 轉速)
                                // 太低 → 虛弱的陀螺縮在中央永遠不會被擊飛，只能等轉停
        oppositeChance: 0.5,    // 每顆陀螺獨立決定是否逆向的機率（僅 dirMode='random' 時使用）
                                // 注意：0.5 才是「最容易出現對向繞行」的值；
                                // 設成 1.0 會讓所有陀螺一起逆向 → 變成全部同向 → 幾乎不對撞
        dirMode: 'random',      // 'random'    = 每顆獨立隨機（實測手感最好，預設）
                                // 'alternate' = 奇偶交錯、保證對向，但正面對撞過猛（2 人局會 5 秒收場）
        wander: 7,              // 微小擾動，避免完美對稱
        initSpeed: 120,         // 初速（貼近巡航速度，避免開場就往外甩）
        initSpeedVar: 0.15,     // 初速隨機幅度
        initSpinVar: 0.07,      // 初始轉速差異，避免同時轉停造成平手

        // --- 轉速（體力）---
        spinDecay: 0.026,       // 每秒自然衰減（決定整場長度的主要旋鈕；沒有對應人數設定時使用）
        spinDecayByCount: {     // 依參戰人數的衰減：人少時碰撞少，要衰減快一點才會落在目標時長
            2: 0.044,
            3: 0.038,
            4: 0.026
        },
        spinSpeedDrain: 0.00010,// 移動額外消耗
        spinHitLoss: 0.00042,   // 每次碰撞的消耗係數（乘上撞擊力道）

        // --- 碰撞 ---
        restitution: 0.92,      // 陀螺互撞彈性
        hitTangential: 0.55,    // 旋轉造成的切線彈開（製造擊飛機會）
        minSepSpeed: 30,        // 撞擊後最低分離速度，避免兩顆黏在一起連續磨擦
        impactCap: 130,         // 撞擊力道上限：開場正面對撞的相對速度可達 240，
                                // 不設限會一擊就把人打殘或掃出場，開場就結束
        hitCooldownFrames: 10,  // 同一對陀螺多久才算下一次「撞擊」（火花／音效／扣血）
        wallBounce: 0.86,       // 撞牆彈性
        ringOutSpeed: 60,       // 徑向外衝速度超過此值即被擊飛出場（門檻會隨轉速提高）
        ringOutSpinGuard: 0.3,  // 轉速越高越穩、越難被擊飛：門檻 = ringOutSpeed × (guard + 轉速)
        ringOutMaxSpin: 0.7,    // 陀螺儀效應：轉速高於此值時「站得很穩」，不會被擊出場外。
                                // 這條規則讓前期是激烈但不致命的對撞，後期虛弱了才會被一擊掃出場

        // --- 時間 ---
        fps: 60,
        targetMinMs: 10000,     // 主要對戰時長下限
        targetMaxMs: 20000,     // 主要對戰時長上限
        quickChance: 0.22,      // 有多少比例的對戰允許「快速決勝」（增加變化，不會每場都拖滿）
        quickMinMs: 6000,       // 快速決勝也至少要這麼久，避免一秒就結束的掃興場面
        hardMaxMs: 70000,       // 模擬硬上限，超過視為失敗種子
        tailMs: 2200,           // 結束後多錄一段（讓勝者續轉、敗者飛完）

        // --- 種子搜尋 ---
        searchMaxSeeds: 4000,   // 最多試幾個種子
        searchMaxMs: 800,       // 搜尋時間上限（毫秒）
        searchCandidates: 6,    // 收集幾個符合條件的候選，再從中挑「最有戲」的那一場播出

        // --- 演出 ---
        countdownMs: 3000,      // 開場倒數：3 格 × 1 秒，配合賽車燈號式的嘟聲節奏
                                // （改成 2400 會變成每 0.8 秒一聲，比較急促）
        celebrateMs: 2600,      // 勝利演出
        sound: true,            // 是否播放內建音效
        volume: 0.35
    };

    // 顏色（沿用 app.js 的調色盤色相，但不加暗色遮罩，讓對撞更醒目）
    const COLORS = ['#9146FF', '#2EC4B6', '#FF9F1C', '#E71D36'];

    const STRIDE = 4;           // 每格每人存 x, y, spin, state
    const ALIVE = 0, STALLED = 1, FLYING = 2, GONE = 3;

    // ==================== 決定性亂數 ====================
    // 模擬全程只用這個 PRNG，不碰 Math.random，確保同一種子必定重現同一場對戰。
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ==================== 物理模擬 ====================
    /**
     * 跑完一整場對戰。
     * @param {number} n 參戰人數
     * @param {object} o 參數
     * @param {number} seed 亂數種子
     * @param {boolean} record 是否記錄逐格資料（搜尋階段不需要，省時省記憶體）
     * @returns {{winnerIndex:number, durationMs:number, totalFrames:number,
     *            frames:Float32Array|null, events:Array, deaths:Array, ok:boolean}}
     */
    function simulate(n, o, seed, record) {
        const rand = mulberry32(seed);
        const dt = 1 / o.fps;
        // 依人數取衰減值（沒設定就用通用值）
        const spinDecay = (o.spinDecayByCount && o.spinDecayByCount[n] != null)
            ? o.spinDecayByCount[n] : o.spinDecay;
        const wallR = o.arenaR - o.topR;      // 陀螺中心可及的最遠距離
        const goneR = o.arenaR + o.topR * 3;  // 完全離場
        const maxFrames = Math.ceil((o.hardMaxMs + o.tailMs) / 1000 * o.fps);

        // 初始擺位：等角分布 + 隨機抖動
        const tops = [];
        const baseAngle = rand() * Math.PI * 2;
        const dirFlip = rand() < 0.5 ? 1 : -1;
        for (let i = 0; i < n; i++) {
            const a = baseAngle + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
            const d = o.arenaR * (0.52 + rand() * 0.14);
            const speed = o.initSpeed * (1 + (rand() - 0.5) * 2 * o.initSpeedVar);
            // 繞行方向：有對向繞行才會正面對撞，否則大家同向繞圈永遠碰不到
            let dir;
            if (o.dirMode === 'alternate') {
                dir = ((i % 2 === 0) ? 1 : -1) * dirFlip;   // 交錯，整體再隨機翻轉
            } else {
                dir = rand() < o.oppositeChance ? -1 : 1;
            }
            tops.push({
                x: Math.cos(a) * d,
                y: Math.sin(a) * d,
                // 初速方向偏切線，讓它們先繞圈再交會
                vx: -Math.sin(a) * speed * dir + (rand() - 0.5) * 12,
                vy: Math.cos(a) * speed * dir + (rand() - 0.5) * 12,
                spin: 1 - rand() * o.initSpinVar,
                // 每顆的巡航速度略有不同 → 軌道半徑不同 → 會互相追上
                drive: o.driveSpeed * (1 + (rand() - 0.5) * 2 * o.driveVar),
                state: ALIVE
            });
        }

        const frames = record ? new Float32Array(maxFrames * n * STRIDE) : null;
        const lastHit = new Int32Array(n * n).fill(-9999);   // 每對陀螺上次計為撞擊的格數
        const events = [];
        const deaths = [];
        let alive = n;
        let endFrame = -1;
        let winnerIdx = -1;
        let winnerEndSpin = 0;
        let f = 0;

        const kill = (i, type) => {
            // 勝負已定之後不再淘汰任何人，否則勝者會在收尾片段中把轉速耗盡而變成平手
            if (endFrame >= 0) return;
            const t = tops[i];
            t.state = (type === 'ringout') ? FLYING : STALLED;
            t.spin = 0;
            alive--;
            deaths.push({ index: i, frame: f, type: type });
            events.push({ frame: f, type: type, index: i, x: t.x, y: t.y });
        };

        for (; f < maxFrames; f++) {
            // ---- 記錄本格狀態 ----
            if (record) {
                const base = f * n * STRIDE;
                for (let i = 0; i < n; i++) {
                    const t = tops[i];
                    frames[base + i * STRIDE] = t.x;
                    frames[base + i * STRIDE + 1] = t.y;
                    frames[base + i * STRIDE + 2] = t.spin;
                    frames[base + i * STRIDE + 3] = t.state;
                }
            }

            // ---- 結束後只跑收尾（讓被擊飛的陀螺飛完）----
            if (endFrame >= 0 && f - endFrame >= o.tailMs / 1000 * o.fps) {
                f++;
                break;
            }

            // ---- 積分 ----
            for (let i = 0; i < n; i++) {
                const t = tops[i];
                if (t.state === GONE) continue;

                if (t.state === FLYING) {
                    // 已被擊飛：不受碗狀拉力，直線飛出去
                    t.x += t.vx * dt;
                    t.y += t.vy * dt;
                    if (Math.hypot(t.x, t.y) > goneR) t.state = GONE;
                    continue;
                }
                if (t.state === STALLED) continue;   // 轉停：留在原地倒下

                const d = Math.hypot(t.x, t.y);
                // 碗狀擂台：往中心的回復力（帶非線性）
                const spinGrip = o.bowlPullFloor + (1 - o.bowlPullFloor) * t.spin * t.spin;
                const pull = o.bowlPull * spinGrip * (1 + o.bowlNonLinear * d / o.arenaR);
                let ax = -pull * t.x;
                let ay = -pull * t.y;
                // 阻力：轉速越低越拖
                const drag = o.dragBase + o.dragSpinFactor * (1 - t.spin);
                ax -= drag * t.vx;
                ay -= drag * t.vy;
                // 轉速驅動（像巡航定速）：轉速高就跑得快、能打到擂台邊緣；
                // 轉速掉下來就慢慢縮回中央，自然形成「前期高速對撞、後期慢磨」的節奏
                const spNow = Math.hypot(t.vx, t.vy);
                if (spNow > 1e-3) {
                    const target = t.drive * (o.driveSpinFloor + (1 - o.driveSpinFloor) * t.spin);
                    const accel = o.driveAccel * (target - spNow);
                    ax += accel * t.vx / spNow;
                    ay += accel * t.vy / spNow;
                }
                // 微擾
                ax += (rand() - 0.5) * o.wander;
                ay += (rand() - 0.5) * o.wander;

                t.vx += ax * dt;
                t.vy += ay * dt;
                t.x += t.vx * dt;
                t.y += t.vy * dt;

                // 轉速衰減
                const sp = Math.hypot(t.vx, t.vy);
                t.spin -= (spinDecay + o.spinSpeedDrain * sp) * dt;
                if (t.spin <= 0) kill(i, 'stall');
            }

            // ---- 陀螺互撞 ----
            for (let i = 0; i < n; i++) {
                if (tops[i].state !== ALIVE) continue;
                for (let j = i + 1; j < n; j++) {
                    if (tops[j].state !== ALIVE) continue;
                    const a = tops[i], b = tops[j];
                    let dx = b.x - a.x, dy = b.y - a.y;
                    let dist = Math.hypot(dx, dy);
                    if (dist >= o.topR * 2 || dist === 0) continue;

                    const nx = dx / dist, ny = dy / dist;
                    // 分離重疊
                    const overlap = o.topR * 2 - dist;
                    a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
                    b.x += nx * overlap / 2; b.y += ny * overlap / 2;

                    // 法向相對速度
                    const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                    if (rvn > 0) continue;                 // 正在分開，不處理
                    const impact = -rvn;
                    const jimp = -(1 + o.restitution) * rvn / 2;
                    a.vx -= jimp * nx; a.vy -= jimp * ny;
                    b.vx += jimp * nx; b.vy += jimp * ny;

                    // 旋轉造成的切線彈開：這是擊飛的主要來源
                    const tx = -ny, ty = nx;
                    const eff = Math.min(impact, o.impactCap);
                    const kick = o.hitTangential * eff * (a.spin + b.spin) * 0.5;
                    a.vx += tx * kick; a.vy += ty * kick;
                    b.vx -= tx * kick; b.vy -= ty * kick;

                    // 確保確實彈開：否則兩顆會黏在一起每格都判定碰撞
                    const rvn2 = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                    if (rvn2 < o.minSepSpeed) {
                        const add = (o.minSepSpeed - rvn2) / 2;
                        a.vx -= add * nx; a.vy -= add * ny;
                        b.vx += add * nx; b.vy += add * ny;
                    }

                    // 同一對陀螺在冷卻時間內只算一次撞擊（扣血／火花／音效）
                    const pair = i * n + j;
                    if (f - lastHit[pair] < o.hitCooldownFrames) continue;
                    lastHit[pair] = f;

                    // 轉速消耗：轉速低的一方吃虧更多
                    const sum = a.spin + b.spin + 1e-6;
                    const la = o.spinHitLoss * eff * (2 * b.spin / sum);
                    const lb = o.spinHitLoss * eff * (2 * a.spin / sum);
                    a.spin -= la;
                    b.spin -= lb;

                    events.push({
                        frame: f, type: 'clash', impact: impact,
                        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, i: i, j: j
                    });

                    if (a.spin <= 0) kill(i, 'stall');
                    if (b.spin <= 0 && tops[j].state === ALIVE) kill(j, 'stall');
                }
            }

            // ---- 撞牆 / 擊飛 ----
            for (let i = 0; i < n; i++) {
                const t = tops[i];
                if (t.state !== ALIVE) continue;
                const d = Math.hypot(t.x, t.y);
                if (d <= wallR) continue;
                const nx = t.x / d, ny = t.y / d;
                const vr = t.vx * nx + t.vy * ny;      // 徑向外速度
                // 高轉速的陀螺像高速陀螺儀一樣穩，不容易被推出場外
                const outThreshold = o.ringOutSpeed * (o.ringOutSpinGuard + t.spin);
                if (t.spin < o.ringOutMaxSpin && vr > outThreshold) {
                    kill(i, 'ringout');                // 衝力夠大 → 飛出場外
                } else {
                    const jn = (1 + o.wallBounce) * vr;
                    t.vx -= jn * nx; t.vy -= jn * ny;
                    t.x = nx * wallR; t.y = ny * wallR;
                }
            }

            // ---- 勝負判定 ----
            if (alive <= 1 && endFrame < 0) {
                endFrame = f;
                for (let i = 0; i < n; i++) {
                    if (tops[i].state === ALIVE) { winnerIdx = i; winnerEndSpin = tops[i].spin; break; }
                }
            }
        }

        const winnerIndex = winnerIdx;
        const durationMs = endFrame >= 0 ? (endFrame / o.fps) * 1000 : Infinity;
        return {
            winnerIndex: winnerIndex,
            winnerEndSpin: winnerEndSpin,
            clashes: events.reduce((c, e) => c + (e.type === 'clash' ? 1 : 0), 0),
            finishType: deaths.length ? deaths[deaths.length - 1].type : null,
            durationMs: durationMs,
            totalFrames: f,
            frames: record ? frames : null,
            events: events,
            deaths: deaths,
            ok: winnerIndex >= 0 && isFinite(durationMs)
        };
    }

    /**
     * 種子搜尋：找出「指定人獲勝 + 時長落在期望區間」的那一場。
     * 搜尋階段不記錄逐格資料，所以很快；找到後才用同一種子重跑並記錄。
     */
    function findSeed(n, targetIndex, o, seedBase) {
        const t0 = now();
        // 這一局要不要走「快速決勝」：由 seedBase 決定，比例 = quickChance
        const wantQuick = mulberry32(seedBase ^ 0x5bf03635)() < o.quickChance;
        const loMain = o.targetMinMs, hiMain = o.targetMaxMs;
        const loQuick = o.quickMinMs, hiQuick = o.targetMinMs;
        const wantCandidates = Math.max(1, o.searchCandidates || 1);

        // 戲劇性評分：撞擊多、以擊飛收場、勝者也快沒力了（險勝）→ 分數高
        const drama = (r) => r.clashes
            + (r.finishType === 'ringout' ? 4 : 0)
            + Math.max(0, 3 - r.winnerEndSpin * 6);

        let tried = 0;
        const cands = [];
        let fallback = null;      // 勝者正確但時長不在偏好區間的備案
        for (let k = 0; k < o.searchMaxSeeds; k++) {
            const seed = (seedBase + k * 2654435761) >>> 0;
            const r = simulate(n, o, seed, false);
            tried++;
            if (r.ok && r.winnerIndex === targetIndex) {
                const d = r.durationMs;
                const good = wantQuick
                    ? (d >= loQuick && d < hiQuick)
                    : (d >= loMain && d <= hiMain);
                if (good) {
                    cands.push({ seed: seed, durationMs: d, score: drama(r), clashes: r.clashes });
                    if (cands.length >= wantCandidates) break;
                } else if (d >= loQuick && (!fallback || d > fallback.durationMs)) {
                    fallback = { seed: seed, durationMs: d, exact: false, quick: wantQuick, clashes: r.clashes };
                }
            }
            if ((k & 15) === 0 && now() - t0 > o.searchMaxMs) break;
        }

        if (cands.length) {
            // 從符合條件的候選中挑最有戲的那一場
            cands.sort((a, b) => b.score - a.score);
            const best = cands[0];
            return {
                seed: best.seed, tried: tried, durationMs: best.durationMs,
                exact: true, quick: wantQuick, clashes: best.clashes,
                candidates: cands.length, score: best.score
            };
        }
        if (fallback) fallback.tried = tried;
        return fallback;   // 可能為 null → 呼叫端需自行退場
    }

    function now() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();
    }

    // ==================== 小工具 ====================
    function mix(hex, target, amount) {
        const h = String(hex).replace('#', '');
        if (h.length !== 6) return hex;
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        const tr = target >> 16 & 255, tg = target >> 8 & 255, tb = target & 255;
        const f = (a, t) => Math.round(a + (t - a) * amount).toString(16).padStart(2, '0');
        return '#' + f(r, tr) + f(g, tg) + f(b, tb);
    }
    const lighten = (hex, a) => mix(hex, 0xffffff, a);
    const darken = (hex, a) => mix(hex, 0x000000, a);

    // ==================== 內建音效（可關閉）====================
    function createSound(o) {
        if (!o.sound) return { clash: noop, stall: noop, ringout: noop, win: noop, countdown: noop };
        let ctx = null;
        try {
            ctx = new (global.AudioContext || global.webkitAudioContext)();
        } catch (e) { return { clash: noop, stall: noop, ringout: noop, win: noop, countdown: noop }; }

        function tone(freq, dur, type, vol, slideTo) {
            if (!ctx) return;
            const t0 = ctx.currentTime;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, t0);
            if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
            const peak = Math.max(0.0001, o.volume * (vol == null ? 1 : vol));
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.006, dur * 0.3));
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            osc.start(t0); osc.stop(t0 + dur);
        }
        function noise(dur, vol) {
            if (!ctx) return;
            const len = Math.floor(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
            const src = ctx.createBufferSource();
            const g = ctx.createGain();
            src.buffer = buf; src.connect(g); g.connect(ctx.destination);
            g.gain.value = o.volume * (vol == null ? 1 : vol);
            src.start();
        }
        return {
            // 賽車燈號式的開場：倒數每一格一聲同音高的短嘟，
            // 最後「開始」的那一聲改為更高、更長並向上滑音（像燈號熄滅起跑）
            countdown: (isFinal) => {
                if (isFinal) {
                    tone(760, 0.44, 'square', 0.95, 1180);
                    noise(0.07, 0.28);
                } else {
                    tone(500, 0.15, 'square', 0.6);
                }
            },
            clash: (impact) => {
                const s = Math.min(1, impact / 140);
                tone(240 + 500 * s, 0.05 + 0.05 * s, 'square', 0.35 + 0.5 * s);
                noise(0.05 + 0.06 * s, 0.25 + 0.4 * s);
            },
            stall: () => { tone(300, 0.5, 'sine', 0.7, 90); },
            ringout: () => { tone(700, 0.35, 'sawtooth', 0.8, 160); noise(0.18, 0.5); },
            win: () => {
                tone(523, 0.22, 'sine', 0.8);
                setTimeout(() => tone(659, 0.22, 'sine', 0.8), 110);
                setTimeout(() => tone(784, 0.36, 'sine', 0.9), 220);
            }
        };
    }
    function noop() { }

    // ==================== 樣式（自帶，不需改 style.css）====================
    const STYLE_ID = 'battle-arena-styles';
    function ensureStyles() {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
        const css = [
            '.battle-arena{display:flex;flex-direction:column;align-items:center;gap:.6rem;}',
            '.battle-arena-stage{position:relative;line-height:0;}',
            '.battle-arena-canvas{border-radius:50%;box-shadow:0 0 26px rgba(145,70,255,.35);',
            'transition:filter .5s ease;}',
            '.battle-arena-canvas.is-blurred{filter:blur(3px) brightness(.8);}',
            /* 擂台中央的插槽：外部把「啟動抽獎」按鈕放進來 */
            '.battle-arena-overlay{position:absolute;inset:0;display:flex;flex-direction:column;',
            'align-items:center;justify-content:center;gap:.55rem;z-index:2;',
            'transition:opacity .35s ease;}',
            '.battle-arena-overlay.is-hidden{opacity:0;pointer-events:none;}',
            /* 外部塞進來的按鈕：不要撐滿整個擂台 */
            '.battle-arena-overlay > button{width:auto;min-width:118px;padding:.5rem 1.3rem;',
            'line-height:1.3;font-size:.92rem;box-shadow:0 6px 18px rgba(0,0,0,.5);}',
            '.battle-arena-result{font-size:.85rem;font-weight:600;color:#EFEFF1;max-width:80%;',
            'line-height:1.35;text-align:center;overflow:hidden;text-overflow:ellipsis;',
            'white-space:nowrap;text-shadow:0 2px 8px rgba(0,0,0,.95);}',
            '.battle-arena-result:empty{display:none;}',
            /* 小小的跳過鍵，不搶畫面 */
            '.battle-arena-skip{position:absolute;right:6px;bottom:6px;z-index:3;',
            'background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.22);color:#ADADB8;',
            'font-size:.68rem;line-height:1;padding:.22rem .45rem;border-radius:4px;cursor:pointer;',
            'opacity:.5;transition:opacity .2s ease;}',
            '.battle-arena-skip:hover{opacity:1;color:#EFEFF1;}',
            '.battle-arena-skip.is-hidden{display:none;}',
            '.battle-arena-legend{display:flex;flex-direction:column;gap:.25rem;width:100%;max-width:300px;}',
            '.battle-legend-item{display:flex;align-items:center;gap:.45rem;padding:.22rem .45rem;',
            'border:1px solid #2D2D35;border-radius:6px;background:#18181B;transition:opacity .3s ease;}',
            '.battle-legend-swatch{width:13px;height:13px;border-radius:50%;flex:0 0 auto;}',
            '.battle-legend-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;',
            'white-space:nowrap;font-size:.8rem;line-height:16px;color:#EFEFF1;}',
            '.battle-legend-tag{flex:0 0 auto;font-size:.7rem;color:#ADADB8;}',
            '.battle-legend-item.is-out{opacity:.4;}',
            '.battle-legend-item.is-out .battle-legend-label{text-decoration:line-through;}',
            '.battle-legend-item.is-winner{border-color:#00F593;box-shadow:0 0 10px rgba(0,245,147,.3);}',
            '.battle-legend-item.is-winner .battle-legend-tag{color:#00F593;font-weight:700;}'
        ].join('');
        const el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = css;
        document.head.appendChild(el);
    }

    // ==================== 掛載（產生擂台與名牌，等待開始）====================
    /**
     * 建立擂台畫面並停在「待機」狀態：擂台留空、中央提供按鈕插槽、下方名牌已就位。
     * @returns {object} stage — 具有 overlay / run / abort / destroy 等成員
     */
    function mount(cfg) {
        ensureStyles();
        const o = Object.assign({}, DEFAULTS, cfg.options || {});
        const container = cfg.container;
        const entries = (cfg.entries || []).slice(0, 4).map((e, i) => ({
            id: e.id, label: e.label, color: e.color || COLORS[i % COLORS.length]
        }));
        const n = entries.length;
        if (!container || n < 2) return null;

        const size = o.size || 320;
        const dpr = Math.min(2, global.devicePixelRatio || 1);

        container.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'battle-arena';

        const stageEl = document.createElement('div');
        stageEl.className = 'battle-arena-stage';

        const canvas = document.createElement('canvas');
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        canvas.className = 'battle-arena-canvas';
        stageEl.appendChild(canvas);

        const overlay = document.createElement('div');
        overlay.className = 'battle-arena-overlay';
        const resultEl = document.createElement('div');
        resultEl.className = 'battle-arena-result';
        overlay.appendChild(resultEl);          // 按鈕由外部插到 resultEl 前面
        stageEl.appendChild(overlay);

        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'battle-arena-skip is-hidden';
        skipBtn.textContent = '跳過';
        stageEl.appendChild(skipBtn);

        root.appendChild(stageEl);

        const legend = document.createElement('div');
        legend.className = 'battle-arena-legend';
        const rows = entries.map(e => {
            const row = document.createElement('div');
            row.className = 'battle-legend-item';
            const sw = document.createElement('span');
            sw.className = 'battle-legend-swatch';
            sw.style.background = e.color;
            const label = document.createElement('span');
            label.className = 'battle-legend-label';
            label.textContent = e.label;
            label.title = e.label;
            const tag = document.createElement('span');
            tag.className = 'battle-legend-tag';
            row.appendChild(sw); row.appendChild(label); row.appendChild(tag);
            legend.appendChild(row);
            return { row: row, tag: tag };
        });
        root.appendChild(legend);
        container.appendChild(root);

        const ctx = canvas.getContext('2d');
        const cx = size / 2, cy = size / 2, R = size / 2 - 6;
        const scale = R / o.arenaR;

        // 待機：擂台留空
        function drawIdle() {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, size, size);
            drawArena(ctx, cx, cy, R, true);
        }
        drawIdle();

        let raf = 0;
        let state = 'idle';
        let current = null;      // 本場對戰的執行狀態

        function setOverlayVisible(v) {
            overlay.classList.toggle('is-hidden', !v);
        }
        function setBlur(v) {
            canvas.classList.toggle('is-blurred', !!v);
        }

        const stage = {
            root: root,
            overlay: overlay,        // 外部把「啟動抽獎」按鈕 appendChild 進來（會排在勝者文字之上）
            resultEl: resultEl,
            entries: entries,
            get state() { return state; },

            /** 開始一場對戰。回傳搜尋資訊；若找不到可用種子則回傳 null（呼叫端應退回原本開獎） */
            run: function (runCfg) {
                if (state === 'battle') return null;
                const targetIndex = entries.findIndex(e => String(e.id) === String(runCfg.winnerId));
                if (targetIndex < 0) return null;

                const seedBase = (runCfg.seed != null) ? (runCfg.seed >>> 0)
                    : ((now() * 1000) >>> 0) ^ 0x9e3779b9;
                const found = findSeed(n, targetIndex, o, seedBase);
                if (!found) return null;
                const run = simulate(n, o, found.seed, true);
                if (!run.ok || run.winnerIndex !== targetIndex) return null;

                const sound = createSound(o);
                const onFinish = runCfg.onFinish || noop;
                const onEvent = runCfg.onEvent || noop;
                const sparks = [];
                const angles = new Array(n).fill(0);
                let shake = 0, nextEvent = 0, celebrated = false, done = false;
                let lastCountdownStep = -1;   // 已經響過的倒數格（3 = 起跑那一聲）
                const t0 = now();

                state = 'battle';
                setBlur(false);
                setOverlayVisible(false);
                resultEl.textContent = '';
                rows.forEach(r => { r.row.classList.remove('is-out', 'is-winner'); r.tag.textContent = ''; });
                skipBtn.classList.remove('is-hidden');

                const frameAt = (idx, i, k) => {
                    const c = Math.max(0, Math.min(run.totalFrames - 1, idx));
                    return run.frames[c * n * STRIDE + i * STRIDE + k];
                };

                function finish(skipped) {
                    if (done) return;
                    done = true;
                    global.cancelAnimationFrame(raf);
                    state = 'result';
                    skipBtn.classList.add('is-hidden');
                    // 收尾畫面：勝者定格 → 模糊 → 按鈕與勝者文字回來
                    const wi = run.winnerIndex;
                    rows.forEach((r, i) => {
                        if (i === wi) return;
                        if (!r.tag.textContent) {
                            const d = run.deaths.find(x => x.index === i);
                            r.tag.textContent = d ? (d.type === 'ringout' ? '擊飛' : '轉停') : '敗';
                            r.row.classList.add('is-out');
                        }
                    });
                    rows[wi].tag.textContent = '勝出';
                    rows[wi].row.classList.add('is-winner');
                    setBlur(true);
                    resultEl.textContent = '本輪勝者：' + entries[wi].label;
                    setOverlayVisible(true);
                    onFinish({
                        winnerId: entries[wi].id, durationMs: run.durationMs,
                        seed: found.seed, skipped: !!skipped
                    });
                }

                current = { finish: finish };
                skipBtn.onclick = () => finish(true);

                function loop() {
                    const elapsed = now() - t0;
                    const battleMs = elapsed - o.countdownMs;

                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    ctx.clearRect(0, 0, size, size);
                    if (shake > 0.2) {
                        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
                        shake *= 0.86;
                    }
                    drawArena(ctx, cx, cy, R, battleMs < 0);

                    if (battleMs < 0) {
                        // 倒數：每跳一格響一聲
                        const cdElapsed = o.countdownMs + battleMs;
                        const step = Math.min(2, Math.floor(cdElapsed / (o.countdownMs / 3)));
                        if (step !== lastCountdownStep) {
                            lastCountdownStep = step;
                            sound.countdown(false);
                        }
                        drawCountdown(ctx, cx, cy, cdElapsed, o.countdownMs);
                        raf = global.requestAnimationFrame(loop);
                        return;
                    }
                    // 起跑瞬間：更高、上揚的一聲
                    if (lastCountdownStep !== 3) {
                        lastCountdownStep = 3;
                        sound.countdown(true);
                    }

                    const fpos = battleMs / 1000 * o.fps;
                    const i0 = Math.floor(fpos);
                    const frac = fpos - i0;

                    while (nextEvent < run.events.length && run.events[nextEvent].frame <= i0) {
                        const e = run.events[nextEvent++];
                        if (e.type === 'clash') {
                            sound.clash(e.impact);
                            spawnSparks(sparks, cx + e.x * scale, cy + e.y * scale,
                                entries[e.i].color, entries[e.j].color, e.impact);
                            shake = Math.max(shake, Math.min(7, e.impact / 22));
                        } else if (e.type === 'stall') {
                            sound.stall();
                            rows[e.index].tag.textContent = '轉停';
                            rows[e.index].row.classList.add('is-out');
                        } else if (e.type === 'ringout') {
                            sound.ringout();
                            shake = Math.max(shake, 6);
                            rows[e.index].tag.textContent = '擊飛';
                            rows[e.index].row.classList.add('is-out');
                        }
                        onEvent(e);
                    }

                    for (let i = 0; i < n; i++) {
                        const st = frameAt(i0, i, 3);
                        if (st === GONE) continue;
                        const x = frameAt(i0, i, 0) + (frameAt(i0 + 1, i, 0) - frameAt(i0, i, 0)) * frac;
                        const y = frameAt(i0, i, 1) + (frameAt(i0 + 1, i, 1) - frameAt(i0, i, 1)) * frac;
                        const spin = frameAt(i0, i, 2);
                        angles[i] += (0.12 + spin * 0.75);
                        const d = run.deaths.find(z => z.index === i);
                        drawTop(ctx, cx + x * scale, cy + y * scale, o.topR * scale,
                            entries[i].color, spin, angles[i], st,
                            d ? (fpos - d.frame) / o.fps : 0, battleMs / 1000);
                    }
                    updateSparks(ctx, sparks);

                    if (battleMs >= run.durationMs) {
                        const wi = run.winnerIndex;
                        drawWinnerRing(ctx, cx + frameAt(i0, wi, 0) * scale,
                            cy + frameAt(i0, wi, 1) * scale, o.topR * scale,
                            entries[wi].color, (battleMs - run.durationMs) / 1000);
                        if (!celebrated) {
                            celebrated = true;
                            sound.win();
                            onEvent({ type: 'win', index: wi });
                        }
                        if (battleMs - run.durationMs > o.celebrateMs) { finish(false); return; }
                    }
                    raf = global.requestAnimationFrame(loop);
                }

                raf = global.requestAnimationFrame(loop);
                return {
                    seed: found.seed, tried: found.tried, durationMs: run.durationMs,
                    exact: found.exact, quick: found.quick, clashes: found.clashes
                };
            },

            /** 中止進行中的對戰，但仍然把結果算出來（呼叫端據此寫入中獎者） */
            abort: function () {
                if (state === 'battle' && current) current.finish(true);
                else global.cancelAnimationFrame(raf);
            },

            destroy: function () {
                global.cancelAnimationFrame(raf);
                state = 'idle';
                if (root.parentNode) root.parentNode.removeChild(root);
            }
        };

        return stage;
    }

    // 舊介面：掛載後立刻開打（調校台用）
    function start(cfg) {
        const stage = mount(cfg);
        if (!stage) {
            (cfg.onFinish || noop)({ winnerId: cfg.winnerId, aborted: true, reason: 'invalid-input' });
            return null;
        }
        const info = stage.run({ winnerId: cfg.winnerId, seed: cfg.seed, onFinish: cfg.onFinish, onEvent: cfg.onEvent });
        if (!info) {
            (cfg.onFinish || noop)({ winnerId: cfg.winnerId, aborted: true, reason: 'no-seed' });
            return null;
        }
        return { abort: stage.abort, destroy: stage.destroy, info: info };
    }

    // ==================== 繪圖 ====================
    function drawArena(ctx, cx, cy, R, dim) {
        const g = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R);
        g.addColorStop(0, '#2b2b42');
        g.addColorStop(0.75, '#1b1b28');
        g.addColorStop(1, '#101018');
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        for (let k = 1; k <= 3; k++) {
            ctx.beginPath(); ctx.arc(cx, cy, R * k / 4, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.strokeStyle = dim ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 5; ctx.stroke();
    }

    function drawCountdown(ctx, cx, cy, elapsed, total) {
        const step = total / 3;
        const idx = Math.min(2, Math.floor(elapsed / step));
        const local = (elapsed - idx * step) / step;
        const txt = ['3', '2', '1'][idx];
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - local * 0.85);
        ctx.translate(cx, cy);
        ctx.scale(1 + local * 0.9, 1 + local * 0.9);
        ctx.font = 'bold 84px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, 0, 0);
        ctx.restore();
    }

    function drawTop(ctx, x, y, r, color, spin, angle, state, sinceDeath, t) {
        ctx.save();

        if (state === STALLED) {
            // 轉停：搖晃後倒下並淡出
            const p = Math.min(1, sinceDeath / 0.9);
            ctx.globalAlpha = 1 - p;
            ctx.translate(x, y + p * r * 0.35);
            ctx.rotate(p * 0.9);
            ctx.scale(1, 1 - p * 0.75);
        } else if (state === FLYING) {
            ctx.globalAlpha = Math.max(0, 1 - sinceDeath / 0.7);
            ctx.translate(x, y);
            ctx.rotate(angle * 0.35);
        } else {
            // 轉速低時晃動，表示快沒力了
            const wob = spin < 0.28 ? (0.28 - spin) * 26 : 0;
            ctx.translate(x + Math.sin(t * 22) * wob, y + Math.cos(t * 19) * wob * 0.6);
        }

        // 陰影
        ctx.beginPath();
        ctx.ellipse(0, r * 0.55, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill();

        // 本體
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = darken(color, 0.32); ctx.fill();

        // 旋轉葉片（看得出在轉）
        ctx.save();
        ctx.rotate(angle);
        for (let k = 0; k < 3; k++) {
            const a0 = k * Math.PI * 2 / 3;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, r * 0.88, a0, a0 + 0.78);
            ctx.closePath();
            ctx.fillStyle = lighten(color, 0.12);
            ctx.fill();
        }
        ctx.restore();

        // 金屬輪圈 + 中心軸
        ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = lighten(color, 0.55); ctx.lineWidth = Math.max(1.5, r * 0.13); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
        ctx.fillStyle = '#f2f2f5'; ctx.fill();

        // 體力環（剩餘轉速）
        if (state === ALIVE) {
            ctx.beginPath();
            ctx.arc(0, 0, r * 1.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, spin));
            ctx.strokeStyle = spin < 0.25 ? '#FFB627' : lighten(color, 0.3);
            ctx.lineWidth = Math.max(2, r * 0.16);
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawWinnerRing(ctx, x, y, r, color, t) {
        const pulse = (t % 0.9) / 0.9;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - pulse);
        ctx.beginPath();
        ctx.arc(x, y, r * (1.5 + pulse * 1.6), 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    }

    function spawnSparks(list, x, y, c1, c2, impact) {
        const count = Math.min(16, 4 + Math.round(impact / 12));
        for (let k = 0; k < count; k++) {
            const a = Math.random() * Math.PI * 2;
            const s = 40 + Math.random() * (60 + impact);
            list.push({
                x: x, y: y,
                vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                life: 1, color: Math.random() < 0.5 ? c1 : c2
            });
        }
    }

    function updateSparks(ctx, list) {
        for (let k = list.length - 1; k >= 0; k--) {
            const p = list[k];
            p.x += p.vx * 0.016; p.y += p.vy * 0.016;
            p.vx *= 0.94; p.vy *= 0.94;
            p.life -= 0.045;
            if (p.life <= 0) { list.splice(k, 1); continue; }
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.2 * p.life + 0.6, 0, Math.PI * 2);
            ctx.fillStyle = p.life > 0.6 ? '#fff' : p.color;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ==================== 匯出 ====================
    const api = {
        mount: mount,
        start: start,
        simulate: simulate,
        findSeed: findSeed,
        DEFAULTS: DEFAULTS,
        COLORS: COLORS
    };
    global.BattleArena = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);
