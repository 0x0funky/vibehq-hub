<p align="center">
  <strong>🌐 言語:</strong>
  <a href="README.md">English</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  日本語
</p>

<h1 align="center">⚡ VibeHQ</h1>

<p align="center">
  <strong>5 つの AI エージェントを並列で走らせるのは簡単。<br/>互いのコードを壊さないようにするのが難しい。</strong>
</p>

<p align="center">
  <em>VibeHQ は Claude Code、Codex、Gemini CLI に契約署名、タスク追跡、Idle 対応メッセージングを追加 — 同じファイルを編集する 5 人のインターンではなく、本物のエンジニアリングチームとして機能させます。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Gemini-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
</p>

---

## 誰も語らない問題

すべての「マルチエージェント」ツールは複数の CLI エージェントを並列実行できます。しかし並列 ≠ 協調。5 つのエージェントが同じアプリを同時に開発すると実際に起こること：

| 何が起こるか | ログからの実例 |
|---|---|
| **スキーマ競合** — 各エージェントが独自の JSON 形式を発明 | フロントエンドは `{ data: [] }` を期待、バックエンドは `{ results: [] }` を出力、3 つ目のエージェントは独自コピーを作成 |
| **オーケストレーターの役割逸脱** — PM がコードを書き始める | PM が調整の代わりに 6 回の手動 JS パッチで統合バグを修正 |
| **ゴーストファイル** — 43 バイトのスタブを本物のコンテンツとして公開 | エージェントが `share_file` で完全なファイルをアップロード後、`publish_artifact` に `"See local file..."` と記述。68 分間ループ |
| **早期実行** — 依存関係の完了前に作業開始 | エージェントが `QUEUED` タスクの説明を見てステータスを無視、ハードコードデータで開発開始 |
| **サイレント障害** — クラッシュしたエージェントがシグナルを出さない | オーケストレーターが死んだプロセスからの応答を 18 分間待機 |

これらはエッジケースではなく、モデルファミリー横断で確実に現れる **LLM ネイティブ行動パターン**です。完全なセッションログで 7 つを文書化しました。

📖 **[完全な分析を読む：7 つの LLM ネイティブ問題 →](blog/llm-native-problems-to-controllable-framework-en.md)**

---

## VibeHQ が実際にすること

VibeHQ は実際の CLI エージェントの上に置かれる**チームワークプロトコル層**です。各エージェントはすべてのネイティブ機能を保持した完全な Claude Code / Codex / Gemini プロセスのまま — VibeHQ は欠けている協調を追加します：

| 問題 | VibeHQ の修正 |
|---|---|
| スキーマ競合 | **契約システム** — コーディング開始前に API 仕様の署名が必須 |
| 役割逸脱 | **構造化タスクライフサイクル** — `create → accept → in_progress → done`、成果物添付必須 |
| ゴーストファイル | **Hub 側バリデーション** — スタブコンテンツ（<200 バイト）の `publish_artifact` を拒否 |
| 早期実行 | **Idle 対応キュー** — 依存関係が完了するまでタスク詳細を保留 |
| サイレント障害 | **ハートビート監視** — オフラインエージェントを自動検出、オーケストレーターに通知 |
| 品質チェックなし | **独立 QA** — 別のエージェントがソースドキュメントに対してデータを検証 |
| 事後分析なし | **13 の自動検出ルール** — セッションログの障害パターンを分析 |

---

## 自己改善する協調：自動デバッグするフレームワーク

VibeHQ はエージェントを協調させるだけでなく、**自身の失敗を分析し、コードを書いて修正します。** 完全自動化、人手介入ゼロ。

クローズドループシステムを構築しました：ベンチマーク実行 → ログ分析 → `/optimize-protocol` が分析を読み取り、実際のコード変更を実装 → リビルド → 再実行して測定：

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│ ベンチマーク │────▶│  vibehq-analyze   │────▶│ /optimize-protocol│
│（チーム実行）│     │  --with-llm       │     │（Claude skill）   │
└─────────────┘     └──────────────────┘     └───────────────────┘
       ▲                                              │
       │             実際のコード変更を書き込み         │
       └──────────────────────────────────────────────┘
```

### ベンチマーク結果：Todo App（V1 → V5、4 エージェント）

| 指標 | V1 | V2 | V3 | V4 | V5 |
|------|----|----|----|----|-----|
| **総トークン** | 7.2M | 3.9M | 14.6M | 15.0M | **5.7M** |
| **PM トークン** | 0.3M | 0.2M | 10.1M | 9.8M | **1.8M** |
| **PM 割合** | 4% | 5% | 69% | 65% | **32%** |
| **ターン数** | 233 | 164 | 326 | 308 | 216 |
| **所要時間** | 47min | 13min | 10min | 9min | 14min |
| **フラグ（問題）** | 4 | 3 | 5 | 3 | **0** |
| **コンテキスト肥大（PM）** | 7.07x | 10.56x | 6.62x | 7.04x | **2.84x** |

### ベンチマーク結果：Classroom Quiz（完全自動ループ）

| 指標 | V1（最適化前） | V2（ループ後） | 変化 |
|------|---------------|---------------|------|
| **総トークン** | 23.1M | 13.8M | **-40%** |
| **PM トークン** | ~15.2M | ~1.3M | **-91%** |
| **ターン数** | 460 | 353 | -23% |
| **フラグ** | 14 | 3 | **-79%** |
| **STUB_FILE** | 8 | 0 | 排除 |
| **コンテキスト肥大（PM）** | 7.87x | 2.84x | -64% |

### システムが学習し構築したもの

| 反復 | 発見された問題 | 構築された修正 |
|---|---|---|
| V1→V2 | Hub が起動中にエージェントを誤って停止；PM がコードを書く | 起動猶予期間（180s）；ツール禁止付きロールプリセット |
| V2→V3 | Codex PM がプロンプト制約を無視（shell_command 4→42 回） | `--disallowedTools` CLI レベル強制；PM を Claude に変更 |
| V3→V4 | PM が Glob でワーカーを監視；成果物が 0 バイトに上書き | 禁止ツールリスト拡張；MCP 層で 0 バイトコンテンツ拒否 |
| V4→V5 | PM ポーリング爆発（28 回 check_status）；スタブが検証を通過 | `McpRateLimiter`（5 回/60s）；`CODE_MIN` 強制；完了後クワイエス |
| CQ V1→V2 | 8 スタブファイル；PM が 66% のトークンをポーリングに浪費 | 同じ修正が自動適用 — スタブ排除、トークン -40% |

```
       23.1M ┤                         * CQ-V1
             │
       15.0M ┤               * V3  * V4
       13.8M ┤                            * CQ-V2
             │
        7.2M ┤  * V1
        5.7M ┤                                  * V5
        3.9M ┤      * V2
             │
           0 ┼──────────────────────────────────────
             V1   V2   V3   V4  CQ1  CQ2   V5
```

**核心的洞察：** プロンプト制約は提案に過ぎない。CLI レベルの強制が法律。エージェントはソフトな制限に適応して迂回する — 修正はアーキテクチャレベルでなければならない。

📖 **[完全なブログ記事：自己改善するマルチエージェント協調 →](blog/self-improving-agents.md)**

---

## 📱 Web ダッシュボード — デスクトップ & モバイル

ブラウザですべてを管理。PC でエージェントを起動、スマホで監視。

### モバイル

https://github.com/user-attachments/assets/9d056e18-44ea-418a-8831-dafc5cb724b8

### デスクトップ

https://github.com/user-attachments/assets/6f0fe691-bef8-49f9-a0ce-a65b215d264f

---

## 🚀 クイックスタート

```bash
git clone https://github.com/0x0funky/vibehq-hub.git
cd vibehq-hub && npm install
npm run build
```

### ターミナル（TUI）

```bash
vibehq
```

インタラクティブメニュー — チーム選択、エージェント設定、起動。すべてターミナルで完結。

### Web ダッシュボード

```bash
npm run build:web
vibehq-web
```

`http://localhost:3100` を開く — チーム作成、エージェント追加、Start を押す。ブラウザですべてを管理。

```bash
# 認証付き（LAN/モバイルアクセス時推奨）
VIBEHQ_AUTH=admin:secret vibehq-web
```

サーバーが LAN IP を表示 — スマホで開けばすぐに使える。

---

## 🔧 20 MCP ツール

各エージェントに 20 の協調ツールが Model Context Protocol 経由で自動注入：

**コミュニケーション（6）：** `ask_teammate`、`reply_to_team`、`post_update`、`get_team_updates`、`list_teammates`、`check_status`

**タスク（5）：** `create_task`、`accept_task`、`update_task`、`complete_task`、`list_tasks`

**成果物（5）：** `publish_artifact`、`list_artifacts`、`share_file`、`read_shared_file`、`list_shared_files`

**契約（3）：** `publish_contract`、`sign_contract`、`check_contract`

**システム（1）：** `get_hub_info`

> 🎬 **[7 エージェントのリアルタイム協調を見る →](https://drive.google.com/file/d/1zzY3f8iCthb_s240rV67uiA9VpskZr2s/view?usp=sharing)**

<details>
<summary><strong>MCP ツールの動作（動画）</strong></summary>

#### チームメイト一覧
https://github.com/user-attachments/assets/b4e20201-dc32-4ab4-b5fe-84b165d44e23

#### チームメイト会話
https://github.com/user-attachments/assets/ea254931-9981-4eb6-8db3-44480ec88041

#### タスク割り当て
https://github.com/user-attachments/assets/fec7634e-976a-4100-8b78-bd63ad1dbec0

</details>

---

## 📊 セッション後分析 & 自動最適化

### 分析

```bash
vibehq-analyze ./data                        # セッションログを分析
vibehq-analyze --team my-team --with-llm     # チームログ自動解決 + LLM 洞察
vibehq-analyze --team my-team --with-llm --save --run-id v1  # 最適化用に保存
vibehq-analyze compare v1 v2                 # 2 つの実行を並列比較
vibehq-analyze history --last 10             # 履歴を表示
```

**13 の自動検出ルール：** 成果物リグレッション、オーケストレーター役割逸脱、スタブファイル、タスクタイムアウト、未完了タスク、調整オーバーヘッド、無応答エージェント、成果物ゼロ、コンテキスト肥大、重複成果物、早期タスク承認、過剰 MCP ポーリング、タスク再割り当て。

### スキル：`/optimize-protocol` & `/benchmark-loop`

VibeHQ には自己改善ループを駆動する 2 つのスキルが付属。スキルは **Claude Code** と **Codex CLI** の両方で動作 — 同じフォーマット、異なるディレクトリ。

#### クロスプラットフォームスキルの配置場所

| プラットフォーム | プロジェクトレベル | ユーザーレベル |
|----------------|-------------------|--------------|
| **Claude Code** | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/` |
| **Codex CLI** | `.agents/skills/<name>/SKILL.md` | `~/.codex/skills/` |

`SKILL.md` フォーマットはクロスプラットフォーム標準として確立 — 同じフロントマター（`name`、`description`）、同じ Markdown 本文。一方のプラットフォームで作成したスキルはもう一方でそのまま使用可能。

#### セットアップ

**Claude Code** — スキルは `.claude/skills/` に含まれています。そのまま使用：

```bash
# Claude Code で入力：
/optimize-protocol v1
/benchmark-loop
```

**Codex CLI** — スキルを Codex のディレクトリにコピー：

```bash
# プロジェクトレベル（リポジトリにコミット）
mkdir -p .agents/skills
cp -r .claude/skills/optimize-protocol .agents/skills/
cp -r .claude/skills/benchmark-loop .agents/skills/

# またはユーザーレベル（全プロジェクトで使用可能）
cp -r .claude/skills/optimize-protocol ~/.codex/skills/
cp -r .claude/skills/benchmark-loop ~/.codex/skills/
```

Codex CLI では `/skills` または `$` を入力してスキルを使用。

#### `/optimize-protocol` — フレームワークエンジニア

分析データを読み取り、**実際のコード修正を書き込み**（パラメータ調整ではない）：

```bash
/optimize-protocol v1    # v1 の分析を読み取り、修正を実装
```

1. 現在の run + すべての過去の最適化レポートをロード
2. クロスラン傾向テーブルを構築（改善中、回帰、副作用）
3. 各問題を NEW、RECURRING、SIDE-EFFECT に分類
4. フレームワークに実際の TypeScript 変更を実装
5. ビルド通過を検証
6. 詳細な変更ログを `~/.vibehq/analytics/optimizations/` に保存

#### `/benchmark-loop` — 自律実行ランナー

完全な自己改善サイクルを自動実行：

```bash
/benchmark-loop "REST API、React フロントエンド、WebSocket リアルタイム更新付き Todo アプリを構築"
```

1. 標準化プロジェクトで新しいチームを起動
2. チームの完了を待機（ハートビート監視）
3. セッションログを分析（13 ルール + LLM グレーディング）
4. `/optimize-protocol` をトリガーしてコード修正を書き込み
5. フレームワークをリビルド（`npx tsup`）
6. 新しいチームで繰り返し — 人手介入ゼロ

#### 手動ステップバイステップ（任意の CLI で動作）

基盤ツールは通常の CLI コマンド — **スキル不要**：

```bash
# 1. ベンチマーク実行
vibehq start --team your-team

# 2. 分析
vibehq-analyze --team your-team --with-llm --save --run-id v1

# 3. 自動最適化（Claude Code / Codex スキル）
/optimize-protocol v1

# 4. 再実行、比較
vibehq start --team your-team
vibehq-analyze --team your-team --with-llm --save --run-id v2
vibehq-analyze compare v1 v2
```

すべての最適化レポートは `~/.vibehq/analytics/optimizations/` に保存。

Claude Code と Codex CLI のネイティブ JSONL 形式に対応。

<details>
<summary><strong>📱 リモートアクセス</strong></summary>

Web プラットフォームはデフォルトで LAN からアクセス可能。外部からの接続：

> ⚠️ **リモート公開前に必ず `VIBEHQ_AUTH` を設定** — Web UI は完全なターミナルアクセスを提供します。

| 方法 | 適用 |
|------|------|
| **[Tailscale](https://tailscale.com/)** | 個人利用 — プライベート VPN、設定不要、無料 |
| **[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)** | 共有 — Cloudflare 経由の公開 URL、無料 |
| **[ngrok](https://ngrok.com/)** | クイックテスト — `ngrok http 3100`、一時 URL |
| **SSH Tunnel** | VPS — `ssh -R 8080:localhost:3100 your-server` |

**Tailscale（推奨）：** PC + スマホにインストール → 両方でサインイン → `VIBEHQ_AUTH=admin:secret vibehq-web` → スマホで `http://<tailscale-ip>:3100` を開く。

</details>

<details>
<summary><strong>📝 設定</strong></summary>

### `vibehq.config.json`

```jsonc
{
  "teams": [{
    "name": "my-project",
    "hub": { "port": 3001 },
    "agents": [
      { "name": "Alex", "role": "Project Manager", "cli": "codex", "cwd": "D:\\project" },
      { "name": "Jordan", "role": "Frontend Engineer", "cli": "claude", "cwd": "D:\\project\\frontend",
        "dangerouslySkipPermissions": true, "additionalDirs": ["D:\\project\\shared"] }
    ]
  }]
}
```

| フィールド | 説明 |
|-----------|------|
| `name` | エージェント表示名（チーム内で一意） |
| `role` | ロール — `systemPrompt` 未設定時にプリセットを自動ロード |
| `cli` | `claude`、`codex`、または `gemini` |
| `cwd` | 作業ディレクトリ（エージェントごとに分離） |
| `systemPrompt` | カスタムプロンプト（プリセットを上書き） |
| `dangerouslySkipPermissions` | Claude 権限を自動承認 |
| `additionalDirs` | エージェントがアクセスできる追加ディレクトリ |

**内蔵プリセット：** Project Manager、Product Designer、Frontend Engineer、Backend Engineer、AI Engineer、QA Engineer

</details>

<details>
<summary><strong>🛠 CLI リファレンス</strong></summary>

```bash
vibehq              # インタラクティブ TUI
vibehq-web          # Web プラットフォーム（ブラウザ + モバイル）
vibehq-hub          # スタンドアロン Hub サーバー
vibehq-spawn        # 単一エージェント起動
vibehq-analyze      # セッション後分析
```

### 手動起動

```bash
vibehq-spawn --name "Jordan" --role "Frontend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  --skip-permissions --add-dir "/shared" -- claude
```

</details>

<details>
<summary><strong>🏗 アーキテクチャ</strong></summary>

```
┌──────────────────────────────────────────────────┐
│                   VibeHQ Hub                      │
│             （WebSocket サーバー）                 │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐ │
│  │ タスク │ │ 成果物   │ │  契約  │ │ メッセ  │ │
│  │ ストア │ │レジストリ│ │ ストア │ │ージキュー│ │
│  └────────┘ └──────────┘ └────────┘ └─────────┘ │
│  ┌──────────────────────────────────────────────┐│
│  │  エージェントレジストリ — idle/working 検出   ││
│  └──────────────────────────────────────────────┘│
└────────┬──────────┬──────────┬──────────┬────────┘
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐
    │ Claude │ │ Claude │ │ Codex  │ │ Claude │
    │  (FE)  │ │  (BE)  │ │  (PM)  │ │  (QA)  │
    │ 20 MCP │ │ 20 MCP │ │ 20 MCP │ │ 20 MCP │
    └────────┘ └────────┘ └────────┘ └────────┘
         ▲          ▲          ▲          ▲
         └──────────┴────┬─────┴──────────┘
                    ┌────▼─────────────┐
                    │ Web ダッシュボード │
                    │デスクトップ&モバイル│
                    └──────────────────┘
```

**設計の要点：**
- **プロセス分離** — 各エージェントは独立 OS プロセス。クラッシュが連鎖しない
- **契約駆動** — コーディング開始前に仕様書の署名が必須
- **Idle 対応キュー** — 忙しい時はキュー、アイドル時にフラッシュ（JSONL watcher + PTY timeout）
- **状態永続化** — すべてのデータは `~/.vibehq/teams/<team>/hub-state.json` に保存
- **MCP ネイティブ** — 20 の専用ツール、型安全、自動設定
- **オーケストレーター強制** — Claude PM は `--disallowedTools`（CLI レベルで Bash/Write/Edit/Read/Glob をハードブロック）；Codex PM は `--sandbox read-only`
- **コンテンツ検証** — MCP がツールレベルで 0 バイト成果物、スタブパターン、>80% サイズ回帰を拒否
- **自己改善** — analyze→optimize ループ、クロスラン傾向追跡と自動変更ログ

</details>

<details>
<summary><strong>⚠️ プラットフォームサポート</strong></summary>

| 機能 | Windows | Mac | Linux |
|------|---------|-----|-------|
| Web プラットフォーム | ✅ テスト済 | ✅ 動作するはず | ✅ 動作するはず |
| TUI | ✅ テスト済 | ✅ テスト済 | ⚠️ 未テスト |
| Hub + Spawn | ✅ テスト済 | ✅ テスト済 | ✅ 動作するはず |
| JSONL ウォッチャー | ✅ テスト済 | ✅ テスト済 | ⚠️ パスエンコーディング |
| node-pty | ✅ テスト済 | ✅ テスト済 | ⚠️ 未テスト |

**Mac：** `xcode-select --install` が必要。`posix_spawnp failed` の場合：`chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`

**Linux：** `build-essential` と `python3` が必要。

</details>

<details>
<summary><strong>📁 プロジェクト構造</strong></summary>

```
agent-hub/
├── bin/                  # CLI エントリポイント（start、spawn、hub、web、analyze）
├── src/
│   ├── hub/              # WebSocket Hub、エージェントレジストリ、メッセージリレー
│   ├── spawner/          # PTY マネージャー、JSONL ウォッチャー、idle 検出
│   ├── web/              # Express サーバー、REST API、WebSocket
│   ├── mcp/              # 20 MCP ツール + hub-client ブリッジ
│   ├── analyzer/         # セッション後分析パイプライン（13 ルール）
│   ├── shared/           # TypeScript 型
│   └── tui/              # TUI 画面 + ロールプリセット
├── web/                  # React フロントエンド（Vite + xterm.js）
├── blog/                 # LLM 行動パターン技術記事
└── benchmarks/           # V1 vs V2 比較レポート
```

</details>

---

## 🤝 コントリビューション

PR 歓迎。モジュラーアーキテクチャ：
- **新しい MCP ツール？** → `src/mcp/tools/` + `hub-client.ts` で登録
- **新しい CLI？** → `spawner.ts` で検出 + `autoConfigureMcp()` で設定
- **新しいウィジェット？** → `web/src/components/` または `src/tui/screens/`

## 📄 ライセンス

MIT

---

<p align="center">
  <a href="https://x.com/0x0funky">𝕏 @0x0funky</a>
</p>
