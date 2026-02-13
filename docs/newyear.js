/**
 * 新年版主題 - 上上下下左右左右BA 密技
 * 輸入完成後切換為中國傳統新年配色與 newyear.png 背景，不儲存至 storage，F5 後恢復預設。
 */
(function () {
    'use strict';

    // 上上下下左右左右BA：Up Up Down Down Left Right Left Right B A
    var KONAMI_KEYS = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var KONAMI_CODE = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]; // keyCode 備援
    var BODY_CLASS = 'theme-newyear';

    var index = 0;

    function isNewYearTheme() {
        return document.body && document.body.classList.contains(BODY_CLASS);
    }

    function applyNewYearTheme(enable) {
        if (!document.body) return;
        if (enable) {
            document.body.classList.add(BODY_CLASS);
        } else {
            document.body.classList.remove(BODY_CLASS);
        }
    }

    function toggleNewYearTheme() {
        var enable = !isNewYearTheme();
        applyNewYearTheme(enable);
        return enable;
    }

    function keyMatches(e, i) {
        var key = (e.key || '').toLowerCase();
        var expectKey = KONAMI_KEYS[i].toLowerCase();
        if (key === expectKey) return true;
        if (e.keyCode === KONAMI_CODE[i]) return true;
        return false;
    }

    function onKeyDown(e) {
        if (keyMatches(e, index)) {
            index += 1;
            if (index === KONAMI_CODE.length) {
                index = 0;
                var enabled = toggleNewYearTheme();
                console.log('[新年版] ' + (enabled ? '已切換至新年主題' : '已還原預設主題'));
            }
        } else {
            index = 0;
        }
    }

    function init() {
        document.addEventListener('keydown', onKeyDown, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
