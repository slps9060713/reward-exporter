# 🎲 Twitch 獎勵抽獎系統

從 Twitch 頻道點數獎勵的兌換名單中抽獎,支援圓餅輪盤與數字縮圈兩種開獎演出。

**線上使用:** https://slps9060713.github.io/reward-exporter/

---

## 使用方式

首頁有兩種模式可選:

### 未登入模式(自定義號碼抽獎)

不需要 Twitch 帳號。直接貼上名單(每行一位)或匯入 txt 檔就能開始抽,適合任何場合的抽籤。

### Twitch 登入模式(載入頻道獎勵名單)

讀取你頻道的點數獎勵兌換名單,每個獎項會變成一個分頁、可分別抽獎。需要先完成下方的
Twitch 應用程式設定。

---

## 抽獎選項

| 選項 | 說明 |
|---|---|
| **連續抽取** | 中獎者從名單移除,可連續抽出多位。停輪後畫面凍結在結果,直到下次開獎 |
| **輪盤模式** | 可抽人數低於設定上限時改用圓餅輪盤演出(預設 5 人) |
| **秒** | 輪盤旋轉的基礎秒數,範圍 1–60,留空為 5 秒。實際總時長會再加 0–2 秒隨機 |
| **輪盤模式・極致** | 需先勾選輪盤模式。可抽人數 2–5 人時改用戰鬥陀螺擂台對戰演出;勝者在開場前就已抽出,對戰過程不影響結果 |
| **啟用音效** | 開場倒數、旋轉、減速滴答、中獎音效,可調音量並上傳自訂音效 |

人數較多時走「數字輪盤 + 手動縮圈」演出:轉出數字後逐位揭曉百位、十位、個位。

---

## Twitch 應用程式設定

只有 Twitch 登入模式需要。**Token 與 Client ID 都只存在你自己的瀏覽器(localStorage),
不會上傳到任何伺服器。**

**1. 建立應用程式**

前往 [Twitch 開發者控制台](https://dev.twitch.tv/console) → Applications → Register Your Application。

**2. 設定 OAuth Redirect URL**

填入你部署的網址,**結尾的 `/` 不能少**:

```
https://slps9060713.github.io/reward-exporter/
```

程式用 `window.location.origin + pathname` 自動組出這個值,所以本機測試與線上部署要各自登記一組。

**3. 取得 Client ID 並填入**

複製應用程式的 Client ID,在首頁「Twitch 登入模式」的欄位貼上並儲存 —— **不需要修改程式碼**。

授權時會請求以下權限:

```
channel:read:redemptions
channel:manage:redemptions
```

**注意:** 帳號必須是實況主、且頻道已啟用頻道點數,才會有獎勵可以讀取。

---

## 部署

純靜態網站,**沒有 build step、沒有套件管理、沒有框架**,`docs/` 就是網站根目錄。

GitHub Pages 設定:Settings → Pages → Deploy from a branch,分支選 `main`、資料夾選 `/docs`。
推送到 `main` 後約 1–5 分鐘生效。

## 檔案結構

```
docs/
├── index.html              唯一的頁面
├── app.js                  主程式（抽獎流程、Twitch API、名單管理、音效）
├── style.css               樣式
├── battle-arena.js         極致模式（零依賴模組）
├── battle-arena-demo.html  極致模式的手感調校台（開發用）
└── newyear.{css,js,png}    節慶彩蛋
```

## 開發

`app.js` 內以 `// ====` 分成 24 個功能區塊,用 `grep -n '^// ='` 可列出全部區塊位置。

同目錄的 `CLAUDE.md`(架構設計、既有修正的原因、測試方法)與 `BATTLE-ARENA.md`
(極致模式的物理設計與調參紀錄)記錄了改動前該知道的事,但兩份都只保存在本機、未納入版控。

## 授權

開源專案,可自由使用和修改。

## 致謝

Twitch API、GitHub Pages,以及原始專案的靈感來源。
