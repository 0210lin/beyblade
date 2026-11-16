# 戰鬥陀螺（Beyblade X）賽事配置查詢 LINE 機器人

全程免費：GitHub Actions 每 6 小時爬賽事 → 寫進 repo 的 `data/combos.json` → Vercel（或 Render）上的 LINE Webhook 讀取 GitHub Raw 回答群組查詢。

```
.
├─ api/webhook.js          LINE Webhook（Vercel Function，零相依、冷啟動快）
├─ server.js               Render / 本機用的啟動檔（同一個 handler）
├─ lib/engine.js           @mention 解析、別名/模糊比對、模式 A 配置、模式 B 解釋、排版
├─ lib/data.js             讀 GitHub Raw 的 combos.json（失敗退回內建檔，快取 5 分鐘）
├─ data/
│  ├─ dictionary.json      別名字典（110 款戰刃含聯名、56 種軸心、38 種固鎖輪；含產品編號 BX/UX/CX/BXG/BXA）
│  ├─ parts_wiki.json      零件百科（軸心 / 固鎖輪 / 戰刃：功能、優點、缺點、搭配）
│  ├─ combos.json          賽事配置資料庫（爬蟲自動更新；目前內含「示範資料」）
│  └─ manual_results.txt   手動貼賽果（爬蟲不好抓的賽事可以自己補）
├─ scraper/
│  ├─ scraper.py           爬蟲（抽取 → 正規化 → 合併 → 防呆）
│  ├─ sources.json         來源清單（可自行增刪）
│  └─ requirements.txt
├─ .github/workflows/scrape.yml   每 6 小時排程（cron: '0 */6 * * *'）
├─ test/run.js             `npm test`：解析 / 輸出 / 簽名驗證（不需安裝任何套件）
└─ vercel.json
```

## 用法

| 輸入 | 說明 |
|---|---|
| `@機器人 鯊魚配置`、`@機器人 魔導神杖 配置`、`@機器人 9-60 配置`、`@機器人 鯊魚 LF 配置` | 模式 A：近期上位配置 TOP 5 + 最新賽事 |
| `@機器人 R軸解釋`、`@機器人 3-60解釋`、`@機器人 鯊魚解釋` | 模式 B：【核心功能】【優點】【缺點】【常見搭配】 |
| `@機器人 指令` | 用法 |

- 群組內只有「@機器人」或 `!查詢 xxx` 開頭才會回應；一對一聊天一律回應。
- 俗稱、英文、全形、錯字（如「鯊玉」）都會盡量猜；`龍劍`這種對應多顆的會一起列出。
- 新增俗稱：直接編輯 `data/dictionary.json` 的 `aliases`。

## 從零到上線（5 步）

### 1. 建立 GitHub Repo 並推上去
1. 建一個 **Public** repo（Webhook 要匿名讀 Raw 檔；內容只有公開賽事資料）。
2. 把這個資料夾內容推上去（預設分支 `main`）。
3. **Settings → Actions → General → Workflow permissions** 選 **Read and write permissions** → Save（否則爬蟲無法 commit）。
4. **Actions → scrape-combos → Run workflow** 手動跑一次確認成功。

### 2. LINE Developers 建立 Messaging API Channel
1. 到 [LINE Developers Console](https://developers.line.biz/console/) → 建 Provider → **Create a Messaging API channel**（會一併建立 LINE 官方帳號）。
2. **Basic settings** 分頁複製 **Channel secret**。
3. **Messaging API** 分頁最下方 **Channel access token (long-lived) → Issue**，複製 Token。
4. 同一頁把 **Auto-reply messages**、**Greeting messages** 設為停用（點「Edit」會跳到 LINE Official Account Manager，把「自動回應訊息」關掉）。

### 3. 部署 Webhook 到 Vercel（免費 Hobby）
1. [vercel.com](https://vercel.com) 用 GitHub 登入 → **Add New Project** → 匯入此 repo（Framework 選 Other，不需 build 指令）。
2. **Environment Variables** 設定：

| 變數 | 值 |
|---|---|
| `LINE_CHANNEL_SECRET` | 步驟 2 的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 步驟 2 的 Token |
| `GITHUB_REPO` | `你的帳號/repo名稱` |
| `GITHUB_BRANCH` | `main`（可省略） |
| `BOT_NAME` | 選填。機器人在 LINE 的顯示名稱，用來支援純文字 `@名稱` |
| `WINDOW_DAYS` | 選填，統計近幾天，預設 90 |

3. Deploy 完成後，Webhook 網址是 `https://<專案>.vercel.app/api/webhook`（`/webhook` 也可）。

> 想用 Render：New → Web Service → 連 repo，Build `echo ok`，Start `node server.js`，同樣設環境變數，Webhook 網址 `https://<服務>.onrender.com/webhook`。Render 免費方案閒置會休眠，第一則訊息可能慢 30 秒以上，所以預設推薦 Vercel。

### 4. 設定 LINE Webhook、允許加入群組
1. LINE Developers → **Messaging API** 分頁 → **Webhook URL** 填上面網址 → **Update** → **Verify**（應顯示 Success）→ 開啟 **Use webhook**。
2. 同一頁 **Allow bot to join group chats** 點 **Edit** → 在 LINE Official Account Manager 的「帳號設定」勾選 **允許加入群組或多人聊天室**。
3. 用 **QR code** 加機器人好友，再把它邀進群組。

### 5. 驗收
- 群組輸入 `@機器人 鯊魚配置`，應回傳配置卡片；輸入 `@機器人 R軸解釋` 回傳解釋。
- 沒反應：Vercel → Logs 看錯誤；`401` 通常是 Channel secret 填錯。

## 爬蟲：務必先讀

我在寫這份專案時實測，**Reddit RSS 與 WBO 論壇對匿名請求回 403/429**，GitHub Actions 的雲端 IP 通常更容易被擋。所以預設資料來源不保證能直接抓到，請依序處理：

1. **Reddit 官方 API（免費，建議）**：到 <https://www.reddit.com/prefs/apps> 建一個 `script` 類型 app，把 client id / secret 存到 repo **Settings → Secrets and variables → Actions** 的 `REDDIT_CLIENT_ID`、`REDDIT_CLIENT_SECRET`。`sources.json` 中「官方 API」那一項就會生效。
2. **WBO 等網站**：`sources.json` 裡的網址是佔位，請在瀏覽器確認實際的 RSS / 結果頁網址後替換；被擋就把 `enabled` 設為 `false`。我無法從這裡驗證可用網址。
3. **手動補資料**：把賽果依 `data/manual_results.txt` 的格式貼上並 commit，下次排程（或手動 Run workflow）就會併入。台灣/日本賽事多半在 FB、X、Discord，這條最實用。
4. 抽取規則：只處理標題/內文像「賽果」的貼文，並自動把 `SharkEdge 3-60 Low Flat` 之類寫法正規化成 `Shark Edge 3-60LF`；第 4 名以後會丟棄。

**防呆**：任何來源失敗不影響其他來源；全部失敗或沒抓到任何配置時，`combos.json` 完全不動。超過 120 天的資料自動淘汰。

**示範資料**：`combos.json` 預設內含 27 筆標示為「示範資料」的假賽事，讓你一部署就能測試。真實資料累積到 15 筆後會自動移除；機器人回覆在只有示範資料時會加註提醒。

## 注意事項

- **零件資料來源**：編號、類型、旋向、重量、軸心/固鎖輪規格取自台灣社群站 beybladehub.app（非官方）；站上標「暫名」的名稱我保留為別名。CX 系列已收錄 86 項（19 種輔助戰刃、超越戰刃、主刃/金屬戰刃、19 種紋章、各 CX 整組商品），可用「J輔助解釋」「蒼龍紋章解釋」「CX-14 解釋」查詢；CX 目前只有解釋，沒有賽事配置統計。

- **`parts_wiki.json` 與中文戰刃譯名是起始版本**，由通用知識整理，零件定位與機制請對照官方資料校對再公開使用（直接改 JSON 即可，重新 push 就生效）。
- GitHub 對 60 天沒有活動的 repo 會停用排程；排程 commit 通常算活動，若被停用到 Actions 頁面重新啟用。
- 本機驗證：`npm test`（全部使用內建模組）；本機起服務：`node server.js`。
