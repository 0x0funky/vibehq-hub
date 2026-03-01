<p align="center">
  <img src="images/vibehq_index.png" alt="VibeHQ" width="100%" />
</p>

<p align="center">
  <strong>🌐 言語:</strong>
  <a href="README.md">English</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  日本語
</p>

<h1 align="center">⚡ VibeHQ</h1>

<p align="center">
  <strong>マルチエージェント AI コラボレーションプラットフォーム</strong><br/>
  <em>Claude、Codex、Gemini エージェントを本物のエンジニアリングチームのように連携させる。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-Windows%20(テスト済)%20%7C%20Mac%20%7C%20Linux-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/agents-Claude%20%7C%20Codex%20%7C%20Gemini-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
</p>

<p align="center">
  <a href="#-課題">課題</a> •
  <a href="#-解決策">解決策</a> •
  <a href="#-機能">機能</a> •
  <a href="#%EF%B8%8F-クイックスタート">クイックスタート</a> •
  <a href="#-仕組み">仕組み</a> •
  <a href="#-設定">設定</a> •
  <a href="#-デモ">デモ</a>
</p>

---

## 🧩 課題

単一の AI コーディングエージェントと対話することはできます。しかし、**本格的なソフトウェアは一人では作れません。**

すべての本格プロジェクトには、調整する PM、UI を定義するデザイナー、API を設計するバックエンドエンジニア、インターフェースを構築するフロントエンドエンジニア、すべてを検証する QA が必要です。一つのエージェントにすべてをやらせようとすると：

- 🧠 **コンテキストの崩壊** — 一つのエージェントが PM + FE + BE + QA のコンテキストを同時に保持できない
- 🔄 **専門化がない** — すべてのプロンプトがコンテキストスイッチ
- 🚫 **プロセスがない** — 仕様書なし、レビューなし、契約なし、ただの vibe
- 💬 **コラボレーションがない** — エージェント同士が対話できず、互いの作業をレビューできず、依存関係を待てない

**業界は「マルチエージェントフレームワーク」で溢れていますが、実態はラッピングされた chain-of-thought です。** 同じプロセス内で順次実行され、会話は人工的に合成されます。それはコラボレーションではなく、パイプラインです。

## 💡 解決策

VibeHQ は根本的に異なるアプローチを取ります：**本物の CLI エージェント、本物のターミナル、本物のコラボレーション。**

```
PM に一つのプロンプトを与える。
7 つのエージェントがアプリケーション全体を構築。
各エージェントは独自のターミナルで実行。
構造化されたプロトコルで通信。
仕様書が署名されるまでコーディングを開始しない。
```

各エージェントは Claude Code、Codex CLI、または Gemini CLI の**実際のインスタンス**です — 独自のターミナルウィンドウ、独自の作業ディレクトリ、独自のファイルアクセススコープ、独自の会話コンテキストで実行されます。Hub は会話をシミュレートしません。メッセージをルーティングし、タスクを管理し、契約を実行し、エージェントの準備ができたときに作業をプッシュします。

**各エージェントは実際の CLI プロセスであるため、すべてのネイティブ機能がそのまま使用可能です：**
- 🔧 **Claude Code**：Skills、カスタム MCP サーバー、`.claude/` プロジェクト設定、メモリ、すべての CLI フラグ
- 🔧 **Codex CLI**：内蔵ツール、ファイル編集、ターミナルコマンド、カスタム指示
- 🔧 **Gemini CLI**：Extensions、Google Cloud 統合、`.gemini/` 設定

VibeHQ は既存の機能の**上に** 20 のコラボレーションツールを追加します — CLI 自体の機能を置き換えたり制限したりすることはありません。エージェントはフルパワーを保持し、互いにコミュニケーションする能力を獲得するだけです。

**これが「マルチエージェント」と「マルチエージェントコラボレーション」の違いです。**

<p align="center">
  <img src="images/vibehq_dashboard.png" alt="VibeHQ Dashboard" width="100%" />
</p>

---

## 🎥 実際の動作

> 🎬 **[完全な 7 エージェントコラボレーションデモを見る →](https://drive.google.com/file/d/1zzY3f8iCthb_s240rV67uiA9VpskZr2s/view?usp=sharing)**

### MCP ツールの動作

#### チームメイト一覧 — オンライン中のメンバーとステータスを確認

https://github.com/user-attachments/assets/b4e20201-dc32-4ab4-b5fe-84b165d44e23

#### チームメイト会話 — リアルタイムエージェント間コミュニケーション

https://github.com/user-attachments/assets/ea254931-9981-4eb6-8db3-44480ec88041

#### タスク割り当て — PM がタスクを作成しエンジニアに割り当て

https://github.com/user-attachments/assets/fec7634e-976a-4100-8b78-bd63ad1dbec0

---

## 🔬 このアーキテクチャが重要な理由

### 真のエージェント分離
各エージェントは独自の PTY（擬似端末）で**独立した OS プロセス**として実行されます。スレッドやコルーチンではなく、完全なプロセス分離です。一つのエージェントがクラッシュしてもチーム全体に影響しません。一つのエージェントのコンテキストウィンドウは完全に独自のものです。これが本物のエンジニアリングチームの動作方式です：別々のマシン、別々のコンテキスト、共有されたプロトコル。

### 契約駆動開発
コードが書かれる前に、仕様書は公開され署名されなければなりません。`publish_contract("api-spec.md", ["Jordan", "Sam"])` はフロントエンドエンジニアとデザイナーがバックエンドの開発開始前に API スキーマを承認することを要求します。これにより、マルチエージェント失敗の最大の原因である**エージェントが異なる前提で開発すること**を排除します。

### Idle 対応メッセージキュー
エージェント A がエージェント B にタスクを送信し、エージェント B がコードを書いている最中である場合、メッセージは**中断しません**。キューに入ります。B が完了すると（Claude Code の JSONL トランスクリプトまたは PTY 出力タイムアウトで検出）、キューがフラッシュされます。これにより「タスク実行中に新しい指示を受信」する問題を防ぎ、エージェントの出力品質の低下を防ぎます。

### 状態の永続化
すべてのタスク、成果物、契約、チーム更新はディスクに永続化されます（`~/.vibehq/teams/<team>/hub-state.json`）。Hub の再起動で状態は失われません。エージェントは再接続して中断したところから再開できます。

### MCP ネイティブ通信
エージェント間の通信はプロンプトインジェクションハックではありません。各エージェントの起動時に自動設定される **20 の専用 MCP ツール**を使用します。ツールは型安全で、メッセージは構造化され、Hub がすべてを検証します。

---

## ✨ 機能

### 🎯 コアプラットフォーム
- **マルチ CLI サポート** — Claude Code、Codex CLI、Gemini CLI を並行動作
- **リアルタイムダッシュボード** — ライブエージェントステータス、チーム更新、メッセージルーティングの可視化
- **MCP 統合** — Model Context Protocol を通じて各エージェントに 20 の専用ツールを注入
- **エージェント別ターミナル** — 各エージェントが独自のターミナルウィンドウを持ち、完全にインタラクティブ
- **ホットリスポーン** — チームを再起動せずにクラッシュしたエージェントを再接続

### 🔄 V2 コラボレーションフレームワーク
- **タスクライフサイクル** — `create → accept → in_progress → blocked → done`、成果物添付必須
- **契約システム** — API/デザイン仕様を公開し、コーディング開始前に署名を要求
- **成果物レジストリ** — メタデータとバージョニング付きの構造化ドキュメント公開
- **Idle 対応キュー** — エージェントが忙しい時にメッセージをキューイング、アイドル時にフラッシュ
- **状態永続化** — JSON ファイルストレージによりすべてのデータが Hub 再起動後も保持

### 🧠 スマート検出
- **Claude JSONL ウォッチャー** — `~/.claude/projects/` トランスクリプトファイルを解析して idle/working をリアルタイム検出
- **PTY 出力タイムアウト** — Codex/Gemini のフォールバック idle 検出（10秒無出力 = idle）
- **自動プリセットローディング** — ロールに基づいて内蔵システムプロンプトを自動ロード

### 🔒 エージェント分離と権限
- **エージェント別作業ディレクトリ** — 各エージェントは自分のコードだけを参照可能
- **`additionalDirs`** — 選択的なクロスディレクトリアクセスの付与（例：共有モックデータ）
- **`dangerouslySkipPermissions`** — 信頼できる環境での Claude 権限プロンプトの自動承認

---

## ⚡️ クイックスタート

### 前提条件
- **Node.js** ≥ 18
- 少なくとも一つの AI CLI がインストール済み：
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（`npm install -g @anthropic-ai/claude-code`）
  - [Codex CLI](https://github.com/openai/codex)（`npm install -g @openai/codex`）
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)（`npm install -g @anthropic-ai/gemini-cli`）

### インストール（ソースからビルド）

> ⚠️ `npm install -g @vibehq/agent-hub` は現在 npm で利用できません。レジストリ登録完了後にパッケージが公開されます。現時点では、ビルド＆リンクの方法を使用してください：

```bash
git clone https://github.com/0x0funky/vibehq-hub.git
cd vibehq-hub
npm install
npm run build
npm link
```

これにより `vibehq`、`vibehq-spawn`、`vibehq-hub` コマンドがグローバルに登録されます。

### 起動（Windows — TUI モード）

```bash
vibehq
```

チームを選択 → Start → エージェントが Windows Terminal の新しいタブで起動。

### 起動（Mac / Linux — 手動モード）

TUI の自動起動は現在 Windows Terminal（`wt`）、iTerm2、標準 Linux ターミナルをターゲットとしています。TUI がシステムでターミナルを正しく起動できない場合、手動でエージェントを起動できます：

```bash
# ターミナル 1：Hub を起動
vibehq-hub --port 3001

# ターミナル 2：エージェントを起動
cd /path/to/frontend
vibehq-spawn --name "Jordan" --role "Frontend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  --add-dir "/path/to/shared" \
  -- claude

# ターミナル 3：別のエージェントを起動
cd /path/to/backend
vibehq-spawn --name "Riley" --role "Backend Engineer" \
  --team "my-team" --hub "ws://localhost:3001" \
  -- claude
```

---

## ⚠️ プラットフォームサポート

> **VibeHQ は現在 Windows で開発・テストされています。**
> Mac と Linux のサポートはアーキテクチャ的にサポートされていますが、完全なテストはまだ行われていません。

| 機能 | Windows | Mac | Linux |
|------|---------|-----|-------|
| TUI（インタラクティブチームランチャー） | ✅ テスト済 | ⚠️ 未テスト（iTerm2/Terminal.app） | ⚠️ 未テスト（gnome-terminal/xterm） |
| Hub サーバー | ✅ テスト済 | ✅ 動作するはず | ✅ 動作するはず |
| 手動スポーン（`vibehq-spawn`） | ✅ テスト済 | ✅ 動作するはず | ✅ 動作するはず |
| Claude JSONL idle 検出 | ✅ テスト済 | ⚠️ パスエンコーディングが異なる可能性 | ⚠️ パスエンコーディングが異なる可能性 |
| PTY スポーン（node-pty） | ✅ テスト済 | ⚠️ 未テスト | ⚠️ 未テスト |
| MCP 自動設定 | ✅ テスト済 | ⚠️ 設定パスが異なる可能性 | ⚠️ 設定パスが異なる可能性 |

### Mac/Linux で発生しうる問題

- **ターミナル起動**：TUI は Windows で `wt`、Mac で `osascript`、Linux で `gnome-terminal`/`xterm` を使用。ターミナルエミュレーターが検出されない場合、手動 `vibehq-spawn` コマンドを使用。
- **Claude JSONL パスエンコーディング**：Claude Code は OS ごとにプロジェクトパスのエンコーディングが異なる（`\` vs `/`）。ウォッチャーは両方を処理する正規表現を使用しますが、エッジケースが存在する可能性。
- **node-pty コンパイル**：`node-pty` はネイティブコンパイルが必要。Mac では Xcode Command Line Tools（`xcode-select --install`）のインストールを確認。Linux では `build-essential` と `python3` が必要。
- **node-pty spawn-helper 権限（macOS）**：プリビルドの `spawn-helper` バイナリに実行権限（`0644`）がない場合があります。`postinstall` スクリプトが自動的に修正します。`posix_spawnp failed` が発生する場合：`chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`
- **ファイルパス区切り文字**：設定ファイルのパスは Windows で `\\` を使用。Mac/Linux では `/` を使用。

> 🍎 **Mac テストは近日予定。** 検証完了後、このセクションは確認済みサポート状態に更新されます。

---

## 🏗 仕組み

```
┌──────────────────────────────────────────────────────────┐
│                      VibeHQ Hub                           │
│                （WebSocket サーバー）                      │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │ タスク   │  │ 成果物   │  │  契約     │  │ メッセ  │ │
│  │ ストア   │  │ レジストリ│  │  ストア   │  │ ージキュー│ │
│  └─────────┘  └──────────┘  └───────────┘  └─────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │          エージェントレジストリ                       │ │
│  │  idle/working 検出 • ステータスブロードキャスト        │ │
│  └─────────────────────────────────────────────────────┘ │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐
    │ Claude │ │ Claude │ │ Codex  │ │ Claude │
    │ (FE)   │ │ (BE)   │ │ (PM)   │ │ (QA)   │
    │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │
    │ │MCP │ │ │ │MCP │ │ │ │MCP │ │ │ │MCP │ │
    │ │20  │ │ │ │20  │ │ │ │20  │ │ │ │20  │ │
    │ │ツール│ │ │ │ツール│ │ │ │ツール│ │ │ │ツール│ │
    │ └────┘ │ │ └────┘ │ │ └────┘ │ │ └────┘ │
    └────────┘ └────────┘ └────────┘ └────────┘
```

### データフロー

1. **PM** が MCP 経由で `create_task("Build login page", ..., "Jordan")` を呼び出す
2. **Hub** がタスクを保存し、Jordan のステータスを確認
3. Jordan は**作業中** → タスクが**メッセージキュー**に入る
4. Jordan が現在の作業を完了 → **JSONL ウォッチャー**が `turn_duration` イベントを検出 → ステータス = `idle`
5. Hub が**キューをフラッシュ** → Jordan がタスクを受信
6. Jordan が `accept_task` を呼び出す → コードを書く → 成果物付きで `complete_task` を呼び出す
7. Hub がすべてをディスクに**永続化**、チームにステータスを**ブロードキャスト**

---

## 📝 設定

### `vibehq.config.json`

```jsonc
{
  "teams": [
    {
      "name": "my-project",
      "hub": { "port": 3001 },
      "agents": [
        {
          "name": "Alex",
          "role": "Project Manager",       // プリセットシステムプロンプトを自動ロード
          "cli": "codex",
          "cwd": "D:\\my-project"          // Mac/Linux では "/" を使用
        },
        {
          "name": "Jordan",
          "role": "Frontend Engineer",
          "cli": "claude",
          "cwd": "D:\\my-project\\frontend",
          "dangerouslySkipPermissions": true,
          "additionalDirs": ["D:\\my-project\\shared"]
        }
      ]
    }
  ]
}
```

### エージェント設定リファレンス

| フィールド | 型 | デフォルト | 説明 |
|-----------|------|----------|------|
| `name` | `string` | *必須* | エージェント表示名（チーム内で一意） |
| `role` | `string` | *必須* | ロール — `systemPrompt` 未設定時に対応するプリセットを自動ロード |
| `cli` | `string` | *必須* | `claude`、`codex`、または `gemini` |
| `cwd` | `string` | *必須* | 作業ディレクトリ（エージェントごとに分離） |
| `systemPrompt` | `string?` | preset | カスタムシステムプロンプト（ロールプリセットを上書き） |
| `dangerouslySkipPermissions` | `bool?` | `false` | Claude 権限プロンプトをスキップ（Claude のみ） |
| `additionalDirs` | `string[]?` | `[]` | エージェントがアクセスできる追加ディレクトリ（Claude `--add-dir`） |

### 内蔵ロールプリセット

| ロール | フォーカス |
|--------|----------|
| Project Manager | タスク委任、仕様ファーストワークフロー、進捗追跡 |
| Product Designer | デザイン仕様、契約レビュー、ビジュアル QA |
| Frontend Engineer | UI 開発、契約ファースト API 統合 |
| Backend Engineer | API ファースト開発、契約公開 |
| AI Engineer | ML パイプライン、モデル統合 |
| QA Engineer | テスト計画、クロスモジュール検証 |

---

## 🚀 V2 コラボレーションフレームワーク — 20 MCP ツール

<details>
<summary><strong>💬 コミュニケーション（6 ツール）</strong></summary>

| ツール | 説明 |
|--------|------|
| `ask_teammate(name, question)` | チームメイトに質問（非同期、忙しい時はキュー） |
| `reply_to_team(name, message)` | 特定のチームメイトにメッセージを送信 |
| `post_update(message)` | チーム全体にステータス更新をブロードキャスト |
| `get_team_updates(limit?)` | 最近のチーム更新を読む |
| `list_teammates()` | すべてのチームメイトの名前、ロール、ステータスを表示 |
| `check_status(name?)` | 特定のチームメイトが idle/working かをチェック |

</details>

<details>
<summary><strong>📋 タスク管理（5 ツール）</strong></summary>

| ツール | 説明 |
|--------|------|
| `create_task(title, desc, assignee, priority)` | 追跡タスクを作成（taskId を返す） |
| `accept_task(task_id, accepted, note?)` | タスクを承認または拒否 |
| `update_task(task_id, status, note?)` | `in_progress` または `blocked` に更新 |
| `complete_task(task_id, artifact, note?)` | 完了マーク — **成果物の参照が必須** |
| `list_tasks(filter?)` | タスクを一覧：`all`、`mine`、`active` |

</details>

<details>
<summary><strong>📦 成果物と共有ファイル（5 ツール）</strong></summary>

| ツール | 説明 |
|--------|------|
| `publish_artifact(filename, content, type, summary)` | メタデータ付き構造化ドキュメントを公開 |
| `list_artifacts(type?)` | タイプ別に公開済み成果物を一覧 |
| `share_file(filename, content)` | チームの共有フォルダにファイルを保存 |
| `read_shared_file(filename)` | 共有フォルダから読み取り |
| `list_shared_files()` | すべての共有ファイルを一覧 |

</details>

<details>
<summary><strong>📜 契約署名（3 ツール）</strong></summary>

| ツール | 説明 |
|--------|------|
| `publish_contract(spec_path, required_signers[])` | 署名が必要な仕様を公開 |
| `sign_contract(spec_path, comment?)` | 契約を承認 |
| `check_contract(spec_path?)` | 署名ステータスをチェック |

</details>

---

## 🎬 デモ

### 構築したもの：MedVault — AI 病院システム

7 つの AI エージェントが協力して、PM への一つのプロンプトからフルスタックの病院管理プラットフォームを構築：

| エージェント | ロール | CLI | 担当 |
|-------------|--------|-----|------|
| Alex | プロジェクトマネージャー | Codex | 調整、タスク追跡、仕様レビュー |
| Sam | プロダクトデザイナー | Claude | UI/UX デザイン仕様、カラーシステム、コンポーネントレイアウト |
| Jordan | フロントエンドリード | Claude | ダッシュボード、患者記録、ログインページ |
| Taylor | イメージングスペシャリスト | Claude | 医療画像ビューワー（ズーム、パン、明るさ） |
| Riley | バックエンドエンジニア | Claude | REST API、SQLite DB、JWT 認証 |
| Morgan | AI エンジニア | Claude | 信頼スコア付き AI 診断エンドポイント |
| Casey | QA エンジニア | Claude | 統合テスト、バグ報告 |

### デモのハイライト

- **リアルタイムエージェント会話** — エージェント間の MCP ツールを使った質問と回答
- **タスク作成と承認** — PM がタスクを作成、エンジニアが承認/拒否
- **契約交渉** — バックエンドが API 仕様を公開 → フロントエンドとデザイナーがレビュー・署名
- **契約承認ブロードキャスト** — `"✅ CONTRACT APPROVED"` がチーム全体に同時送信
- **ステータスのリアルタイム変化** — ダッシュボードで `idle` ↔ `working` の切り替えを表示
- **キューの動作** — エージェントが忙しい時にメッセージが待機、アイドル時にフラッシュ
- **バグ報告フロー** — QA が問題発見 → エンジニアに報告 → 修正 → 再テスト
- **成果物公開** — デザイン仕様、API ドキュメント、テストレポートのチーム間共有
- **最終製品** — ログイン → ダッシュボード → 患者記録 → X 線ビューワー → AI 診断

---

## 🛠 CLI リファレンス

```bash
vibehq              # インタラクティブ TUI（Windows 推奨）
vibehq start        # 設定から直接チームを起動
vibehq init         # 新しい vibehq.config.json を作成
vibehq dashboard    # ダッシュボードのみ（既存 Hub に接続）
```

### スタンドアロン Hub

```bash
vibehq-hub --port 3001 --verbose
```

### 単一エージェントの起動

```bash
vibehq-spawn \
  --name "Jordan" \
  --role "Frontend Engineer" \
  --team "my-team" \
  --hub "ws://localhost:3001" \
  --skip-permissions \
  --add-dir "/path/to/shared" \
  -- claude
```

---

## 📁 プロジェクト構造

```
agent-hub/
├── bin/
│   ├── start.ts          # メイン CLI エントリポイント（TUI、チーム管理）
│   ├── spawn.ts          # 単一エージェント spawner CLI
│   ├── hub.ts            # スタンドアロン Hub サーバー
│   └── agent.ts          # MCP エージェントサーバー
├── src/
│   ├── hub/
│   │   ├── server.ts     # WebSocket Hub + V2 ストア + 永続化
│   │   ├── registry.ts   # エージェントレジストリ + idle ルーティング
│   │   └── relay.ts      # メッセージリレーエンジン
│   ├── spawner/
│   │   └── spawner.ts    # PTY マネージャー + JSONL ウォッチャー + idle 検出
│   ├── mcp/
│   │   ├── hub-client.ts # MCP ↔ Hub WebSocket ブリッジ
│   │   └── tools/        # 20 MCP ツール実装
│   ├── shared/
│   │   └── types.ts      # 共有 TypeScript 型（V2 メッセージ）
│   └── tui/
│       ├── role-presets.ts    # 内蔵ロールシステムプロンプト（V2）
│       └── screens/           # ダッシュボード、ウェルカム、設定
├── vibehq.config.json    # チーム設定
└── images/               # スクリーンショット
```

---

## 🤝 コントリビューション

PR 歓迎。アーキテクチャはモジュラーです：
- **新しい MCP ツール？** `src/mcp/tools/` に追加 + `hub-client.ts` で登録
- **新しい CLI サポート？** `spawner.ts` で検出を追加 + `autoConfigureMcp()` で MCP 設定
- **新しいダッシュボードウィジェット？** `src/tui/screens/dashboard.ts` を拡張

## 📄 ライセンス

MIT

---

<p align="center">
  <a href="https://x.com/0x0funky">𝕏 @0x0funky</a>
</p>
