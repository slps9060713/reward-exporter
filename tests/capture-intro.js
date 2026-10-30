// 產生說明視窗用的截圖：node tests/capture-intro.js → docs/tournament-intro.png
// 左：遴選畫面（淺灰候選人＋遴選／開賽）；右：開賽中的擂台
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./lib/cdp');
const { startServer } = require('./lib/server');

const NAMES = ['小明', '阿華', 'Kevin', '小美', '大雄', '靜香', '胖虎', 'Amy', '小夫', '出木杉', '阿傑', 'Leo'];
const OUT = path.join(__dirname, '..', 'docs', 'tournament-intro.png');

async function shot(b, selector) {
    const rect = await b.evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    })()`);
    const r = await b.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, clip: Object.assign({ scale: 1 }, rect)
    });
    return 'data:image/png;base64,' + r.data;
}

(async () => {
    const server = await startServer(path.join(__dirname, '..', 'docs'));
    const b = await launch();
    try {
        await b.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1000, deviceScaleFactor: 2, mobile: false });
        await b.goto(server.url + '/index.html');
        await b.evaluate(`localStorage.clear();
            localStorage.setItem('globalContinuousMode', 'true');
            localStorage.setItem('globalWheelMode', 'true');
            localStorage.setItem('globalWheelModeExtreme', 'true');
            localStorage.setItem('globalExtremeTournament', 'true');
            localStorage.setItem('extremeTournamentIntroHidden', 'true');
            localStorage.setItem('extremeTournamentIntroFirstShown', 'true');`);
        await b.goto(server.url + '/index.html');
        await b.evaluate(`
            document.getElementById('loginPage').classList.remove('active');
            document.getElementById('mainPage').classList.add('active');
            createCustomTab();`);
        await sleep(300);
        await b.evaluate(`importCustomLines(${JSON.stringify(NAMES.join('\n'))}, null)`);
        await sleep(900);

        // 左圖：遴選完三位，數字輪盤停在最後一位
        await b.evaluate(`['003','006','010'].forEach(id => addTournamentCandidate('custom', id));
            document.querySelector('#panel-custom .wheel-number').textContent = '010';
            document.querySelector('#panel-custom .wheel-info').textContent = '遴選：' + ${JSON.stringify(NAMES[9])};`);
        await sleep(300);
        const left = await shot(b, '#panel-custom .lottery-container');

        // 右圖：開賽中的擂台
        await b.evaluate(`Math.random = (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
            startTournamentMatch('custom')`);
        await sleep(6000);
        const right = await shot(b, '#panel-custom .lottery-container');

        // 在頁面內用 canvas 左右拼成一張（結果先放 window，再另外取回：async IIFE 的回傳值取不回來）
        await b.evaluate(`(async () => {
            const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
            const [l, r] = await Promise.all([load(${JSON.stringify(left)}), load(${JSON.stringify(right)})]);
            const half = 720, gap = 16;
            const h = Math.round(Math.max(l.height * half / l.width, r.height * half / r.width));
            const c = document.createElement('canvas');
            c.width = half * 2 + gap; c.height = h;
            const g = c.getContext('2d');
            g.fillStyle = '#0e0e10'; g.fillRect(0, 0, c.width, c.height);
            g.drawImage(l, 0, 0, half, l.height * half / l.width);
            g.drawImage(r, half + gap, 0, half, r.height * half / r.width);
            window.__intro = c.toDataURL('image/png').split(',')[1];
        })()`);
        await sleep(300);
        const b64 = await b.evaluate(`window.__intro`);
        fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
        console.log('已輸出 ' + OUT);
    } finally {
        await b.close();
        server.close();
    }
})();
