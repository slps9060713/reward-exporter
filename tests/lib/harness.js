// 極簡測試框架：test() 註冊、斷言、依序執行
const tests = [];
let onlyMode = false;

function test(name, fn) { tests.push({ name, fn }); }
function only(name, fn) { onlyMode = true; tests.push({ name, fn, only: true }); }

function assert(cond, msg) {
    if (!cond) throw new Error(msg || '斷言失敗');
}
function assertEq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg ? msg + '：' : ''}預期 ${e}，實際 ${a}`);
}

// ctx = { before(): Promise<any>, after(arg): Promise<void> }；before 的回傳值傳給每個測試
async function run(ctx) {
    const gi = process.argv.indexOf('--grep');
    const patterns = gi > -1 ? process.argv[gi + 1].split('|') : null;
    const selected = tests.filter(t =>
        (!onlyMode || t.only) &&
        (!patterns || patterns.some(p => t.name.includes(p))));

    const arg = await ctx.before();
    let failed = 0;
    try {
        for (const t of selected) {
            const started = Date.now();
            try {
                await t.fn(arg);
                console.log(`✓ ${t.name} (${Date.now() - started}ms)`);
            } catch (e) {
                failed++;
                console.log(`✗ ${t.name}\n    ${String(e && e.message || e).split('\n').join('\n    ')}`);
            }
        }
    } finally {
        await ctx.after(arg);
    }
    console.log(`\n${selected.length - failed}/${selected.length} passed`);
    process.exitCode = failed ? 1 : 0;
}

module.exports = { test, only, assert, assertEq, run };
