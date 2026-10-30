// 以 DevTools Protocol 驅動本機 headless Edge（零依賴：Node 24 內建 WebSocket / fetch）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ headless = true } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tournament-edge-'));
    const args = [
        '--remote-debugging-port=0',
        `--user-data-dir=${dataDir}`,
        '--window-size=1440,1000',
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
    ];
    if (headless) args.unshift('--headless=new');
    const proc = spawn(EDGE, args, { stdio: 'ignore' });
    proc.unref();

    // 等 DevToolsActivePort 出現，拿到埠號
    const portFile = path.join(dataDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
        await sleep(100);
        if (fs.existsSync(portFile)) {
            try {
                const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
                if (line) port = Number(line);
            } catch (e) { /* Edge 正在寫入（EBUSY），下一輪再讀 */ }
        }
    }
    if (!port) throw new Error('Edge 沒有開出 DevTools 埠');

    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find(t => t.type === 'page');
        if (!target) await sleep(100);
    }
    if (!target) throw new Error('找不到 page target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();   // method -> [callback]
    ws.addEventListener('message', ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        } else if (msg.method && listeners.has(msg.method)) {
            const cbs = listeners.get(msg.method);
            listeners.set(msg.method, []);
            cbs.forEach(cb => cb(msg.params));
        }
    });

    function send(method, params = {}) {
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
    function once(method) {
        return new Promise(resolve => {
            if (!listeners.has(method)) listeners.set(method, []);
            listeners.get(method).push(resolve);
        });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    const browser = {
        send,
        async evaluate(expr) {
            const r = await send('Runtime.evaluate', {
                expression: expr,
                awaitPromise: true,
                returnByValue: true,
                replMode: true
            });
            if (r.exceptionDetails) {
                const ex = r.exceptionDetails.exception;
                throw new Error((ex && ex.description) || r.exceptionDetails.text);
            }
            return r.result.value;
        },
        async goto(url) {
            const loaded = once('Page.loadEventFired');
            await send('Page.navigate', { url });
            await loaded;
        },
        async addInitScript(source) {
            await send('Page.addScriptToEvaluateOnNewDocument', { source });
        },
        async screenshot(file, clip) {
            const params = { format: 'png' };
            if (clip) params.clip = Object.assign({ scale: 1 }, clip);
            const r = await send('Page.captureScreenshot', params);
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        },
        async close() {
            try { await send('Browser.close'); } catch (e) { /* 連線已斷 */ }
            try { ws.close(); } catch (e) { /* 已關閉 */ }
            proc.kill();
            await sleep(300);
            try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* Edge 可能還鎖著檔案 */ }
        }
    };
    return browser;
}

module.exports = { launch, sleep };
