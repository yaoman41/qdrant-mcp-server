# Qdrant MCP Fork Code Review — 2026-05-23

Reviewed commit: `5f90490 feat(mordeco-fork): drop tree-sitter dependency for Node 24 compatibility`
Repo: `/Users/yao/Documents/AI_Workspace/_scripts/mcp-servers/qdrant-mcp-mordeco-fork/`
Branch: `main` (1 commit ahead of `origin/main`, clean working tree)

---

## TL;DR (給 Yao)

- 整體評分：🟡 **可 push，但有清理債**
- **0 P0 / 3 P1 / 5 P2** — runtime 完全乾淨無 crash 風險，沒安全漏洞，tsc + 748 test 全綠，stdio 啟動驗證成功。問題集中在「commit 訊息聲稱 7 個 tool 砍掉，實際 source code 只砍 tree-sitter chunker」— 對應的 indexer 程式碼 + 5 個 tool 檔（code.ts / git-history.ts / federated.ts + federated.test.ts + git/extractor 等）全留著，編進 build/ 但沒註冊 = 死代碼。不會 crash，只是 ship 不必要的 1.6MB build + 7600 行 unused code。
- **建議行動**：✅ **可以 push**（fork 是私用，dead code 不影響 Mordeco 使用）。但 P1 #1 文件不同步是真痛點 — README 還寫著 28 處被砍掉的 tool 用法，未來 Yao 自己看會困惑。push 後馬上跑後續 cleanup commit 比較好。

---

## P0 必修 (severity high — runtime crash 或 security)

**無。**

stdio 啟動測試（`EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-test-fake QDRANT_URL=http://100.76.215.16:6333`）4 行 log 全綠：Qdrant client init → embedding provider init → "running on stdio"。Node 24.14.0 上 `tsc --noEmit` clean、748 test pass、build 產出可執行。

---

## P1 該修 (severity medium — 邏輯不嚴或測試 gap / 文件嚴重不同步)

| # | 檔案 | 問題 | 建議修法 |
|---|------|------|----------|
| 1 | `README.md` line 12-17, 268, 555, 607 + 28 references | README 完全沒提這是 Mordeco fork，仍把「Code Vectorization / Git History Search / Contextual+Federated Search」當主打 feature 列出，安裝段仍寫 `CXXFLAGS='-std=c++20' npm install` 跟 tree-sitter 排錯。Node 22.x or 24.x 仍出現在 Prerequisites。未來 Yao 自己讀會以為這些 tool 還在 | 加 `## Mordeco Fork Notes` 段在 README 頂部，列「砍了什麼、為什麼、保留什麼 8 tool」。或寫 `README.mordeco.md` 獨立檔，連結放原 README 開頭 |
| 2 | `src/tools/code.ts` (217 LoC), `src/tools/git-history.ts` (237), `src/tools/federated.ts` (567), `src/tools/federated.test.ts` (741), `src/code/indexer.ts` + 整個 `src/code/sync/`, `src/git/` 整個 dir (extractor/indexer/chunker/sync — 7615 LoC 總計) | Commit 訊息聲稱「dropped tools (7)」實際上**只有 tree-sitter-chunker.ts + test 真的刪掉**。對應的 indexer class、tools registration、git extractor 全留著，編進 `build/` (1.6MB)。Tests 仍跑這些 module（test 通過但是測試 dead code）。不會 crash 因為 `registerAllTools()` 沒呼叫，但增加 fork divergence + 未來 upstream merge 衝突面 + 增加 ship 體積 | 第 2 個 commit：刪 `src/tools/{code,git-history,federated,federated.test}.ts` + `src/code/` 整個 dir + `src/git/` 整個 dir。預期 `tsc --noEmit` 仍 clean（已驗證 src/tools/index.ts 只 import 3 個保留 tool）、test count 從 748 降到 ~400-500 |
| 3 | `src/tools/schemas.ts` line 70-195 | Dropped tool 的 Zod schema 全保留（IndexCodebaseSchema / SearchCodeSchema / ReindexChangesSchema / IndexGitHistorySchema / ContextualSearchSchema / FederatedSearchSchema 等 10 個 export）。dead exports，跟 P1 #2 一起清。schemas.ts re-export 在 `src/tools/index.ts:50 export * from "./schemas.js"` — 外部 import 抓到 ghost schema 會困惑 | 刪除 line 70-195（保留前 68 行 collection/document/search schemas） |

---

## P2 改進 (severity low — 風格 / 維護性)

1. **`.env.example`** 仍以 Ollama 為預設 example（line 9-30），Mordeco 場景已拔 GPU → Ollama 本機推理下架，主要用 OpenAI。可把 OpenAI section 移到第一位、預設 `EMBEDDING_PROVIDER=openai`，降低 Yao 未來 setup confusion。
2. **`CHANGELOG.md`** 完全沒寫 fork 變更。後續 fork 升級會難追歷史。加 `## [3.3.4-mordeco.1] - 2026-05-23` 一段條列改動。
3. **`src/tools/logging.ts:16-22`** `SEARCH_TOOLS` set 仍含 `search_code / search_git_history / contextual_search / federated_search` 4 個被砍 tool 名 — 不會出錯（只是字串比對 isEmptySearchResult），但跟 P1 #2 一起清。
4. **`build/` 留 dead artifacts**（`build/code/`, `build/git/`, `build/tools/code.js` 等）— 跟 P1 #2 連動，源碼刪後 `npm run build` 會自動清掉。
5. **`src/embeddings/openai.ts:31`** `new OpenAI({ apiKey })` 沒設 `dangerouslyAllowBrowser` 也沒設 `defaultHeaders` 客戶識別。Mordeco 場景純 server-side 不需要，但若未來要在 Cloudflare Worker / Edge 跑會踩坑。記一筆。

---

## 8 軸 review 結果摘要

| # | 軸 | 評 | 摘要 |
|---|---|---|------|
| 1 | Dead code / orphan imports | ⚠️ | `src/index.ts:156` 改成註解、`src/tools/index.ts` 只 import 3 個 register。但 `src/tools/code.ts` / `git-history.ts` / `federated.ts` + `src/code/` + `src/git/` 整個 dir 都保留（7615 LoC dead），且仍編進 build。`schemas.ts` 還 export 10 個死 schema |
| 2 | Tool registry consistency | ✅ | 8 個保留 tool name 100% 對齊：`registerCollectionTools` 註冊 4 / `registerDocumentTools` 註冊 2 / `registerSearchTools` 註冊 2。沒漏 handler 沒 ghost |
| 3 | Type safety | ✅ | `npx tsc --noEmit` 0 error |
| 4 | Test coverage | ⚠️ | 748 test pass，**但有 ~340 test 在測 dead code**（federated.test.ts 741 行 + code/git module 各自有 test）。核心 keep tools 都有 test 覆蓋（collection/document/search/embeddings/qdrant client 各有獨立 test 檔） |
| 5 | Security | ✅ | OpenAI key 從未 log（搜遍 src/embeddings/*.ts 確認 logger 只收 `provider`/`model`）。`execFile` 不用 shell（不會 injection）。QDRANT_URL 雖 user-controlled 但只給 client lib，不會 SSRF 給 attacker query 控制。HTTP transport 有 rate limit + IP cleanup（防 memory leak）。stdio mode pino 用 destination(2) = stderr，不混 stdout JSON-RPC 訊息 |
| 6 | Runtime crash risk | ✅ | env var 缺漏處理：`EMBEDDING_PROVIDER` unset → fallback ollama；無 `OPENAI_API_KEY` → `logger.fatal` + `process.exit(1)`（不 silent crash）；無效 `HTTP_PORT` / `EMBEDDING_DIMENSIONS` / `EMBEDDING_RETRY_*` 都驗證 + exit。collection 不存在時 `add_documents` / `semantic_search` 回 `isError: true` 不 throw。OpenAI 429 有 exponential backoff retry (`retryWithBackoff`)。stdio 啟動實測成功 |
| 7 | Mordeco 場景適配 | ✅ | `hybrid_search` 對 `mordeco_kb` (dense 1536 + sparse BM25 IDF) → `qdrant/client.ts:259-318` 用 named vector `dense` + `text` + RRF fusion，跟 collection 的 `sparse_vectors.text.modifier=idf` 對齊。`semantic_search` 中文 query 走 embedding，OpenAI text-embedding-3-small 對中文良好（與 model 無關，不是 fork 邊際）。payload metadata filter 支援兩種格式：simple `{key: value}` + Qdrant `{must: [...]}` — `agent_owner` / `source_type` 可直接 filter |
| 8 | Fork 維護負擔 | ⚠️ | 跟 upstream `mhalder/qdrant-mcp-server` 差異：本 commit 改了 `package.json` (deps shrink) + `src/index.ts` (砍 indexer 初始化) + `src/tools/index.ts` (砍 register) + 刪 `tree-sitter-chunker.ts` + test。**未來高衝突檔**：`src/tools/index.ts` (upstream 加新 tool 必衝)、`package.json` (deps 浮動必衝)、`src/index.ts` (上游改 startup 必衝)。**低衝突**：`src/qdrant/client.ts` / `src/embeddings/*` (上游較少動)。**理想未來策略**：等 upstream 自己加 Node 24 支援後（看 issue tracker），重新 base on upstream 砍 fork。或維護長期 fork 但 P1 #2 dead code 清掉降 divergence |

---

## Fork 維護建議

- **短期 (push 後即做)**：跑 P1 #1 (README) + P1 #2 (砍 dead code) 第 2 個 commit。可降 fork divergence 約 ~7600 LoC，未來 upstream merge 衝突面少一半。建議用 `git rm -r src/code src/git src/tools/{code,git-history,federated,federated.test}.ts` + 刪 schemas.ts line 70-195 + `npm run build` 一鍵完成。
- **中期 (1-3 個月)**：每月 `git fetch upstream && git log upstream/main --since="1 month ago"` 看上游有沒有：(a) 加 Node 24 支援自己解 tree-sitter（如果有 → 可以 rebase 砍 fork）；(b) 補新 tool / 改 schema（評估要不要 pick）。
- **長期**：若 Mordeco 對 hybrid_search 有客製需求（例 zh-tw tokenizer for BM25），這個 fork 才有真存在價值。若一直只用 stock semantic_search → 等上游 Node 24 修好直接砍 fork。
- **upstream PR 機會**：本 commit 砍 tree-sitter 的修法（用 CharacterChunker fallback）可考慮 PR 給 upstream，加個 `EMBEDDING_CHUNKER=character` env switch — 對 upstream 維護者也好（少一個 native dep）。

---

## 驗證指令重跑紀錄 (2026-05-23 21:04 JST)

```
$ npm run type-check
# clean, 0 error

$ npm test -- --run
Test Files  27 passed (27)
Tests       748 passed (748)
Duration    37.92s

$ EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-test-fake \
  QDRANT_URL=http://100.76.215.16:6333 \
  perl -e 'alarm 3; exec @ARGV' node build/index.js < /dev/null
{"msg":"Qdrant client initialized"}
{"msg":"Creating embedding provider"}
{"msg":"Embedding provider initialized"}
{"msg":"Qdrant MCP server running on stdio"}
```

無 OPENAI_API_KEY 出現在 log；4 行 startup 完成；stdio 阻塞等 input 直到 alarm timeout 砍掉 = 預期行為。
