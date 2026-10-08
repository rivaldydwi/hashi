# Hashi 橋

[Bahasa Indonesia](README.md) | [English](README.en.md) | **日本語**

## Hashiについて

**LPK**（インドネシアの職業訓練校）と**TSK／登録支援機関**（日本）のための、候補者プロフィールと選考のシステムです。
1つの候補者プロフィールを LPK と提携先の TSK が共有するので、再入力は要りません。

> 現状（2026年10月）：MVP仕様のステップ1〜6、TSKの活動記録（7A）、在留カード管理（カード番号・写真の暗号化、リマインダーメール、オンライン更新用データ、
> 窓口用の手数料納付書PDF）、LPK向けのビザ状況と到着日の表示、パイロット用データ（ダミーの学生200名）まで完成しています。
> 次はTSK向けのデモです。**実データを入れる前に、サーバー外へのバックアップを必ず稼働させてください。** タスク一覧：[docs/TASKS.md](docs/TASKS.md)、
> 最新の報告：[docs/STATUS.md](docs/STATUS.md)、経緯と技術的な決定：[docs/HISTORY.md](docs/HISTORY.md)。

2種類の組織が一緒に使います。**LPK**（訓練校。LPK管理者と先生〔sensei〕）が学生のプロフィールを整え、**TSK**（支援機関。TSK管理者とTSKスタッフ）が候補者を選考し、
配属先（クライアント）へ紹介し、渡航後は就労者を支援します。各組織が見られるのは、自組織のデータと、明示的に共有されたデータだけです。

**実際に試してみたい方へ**：[スクリーンショット付きの利用ガイド](docs/panduan/README.md)（[PDF](docs/panduan/panduan-hashi.pdf)、インドネシア語）をご覧ください。LPKとTSKそれぞれの機能の使い方と、手順つきの4つの事例を載せています。

### 技術構成

| 項目 | 技術 |
| --- | --- |
| アプリケーション | Next.js 16（App Router）＋ TypeScript ＋ Tailwind CSS 4 |
| データベース | PostgreSQL 16 ＋ Drizzle ORM |
| データの分離 | PostgreSQL の行レベルセキュリティ（RLS） |
| ログイン | Auth.js v5（メール＋パスワード、8時間のJWTセッション） |
| 言語 | next-intl（インドネシア語／日本語） |
| デプロイ | Docker Compose（OptiPlex） |

## 役割別の機能

| 誰が | できること |
| --- | --- |
| **スーパー管理者** | LPK／TSKと最初の管理者の追加、組織情報の編集、どの組織のユーザーも管理、LPKとTSKの提携の作成・無効化 |
| **LPK／TSK管理者** | スタッフ（先生／TSKスタッフ）の追加、氏名・役割・言語の変更、仮パスワードの再発行、無効化・再有効化 |
| **LPK管理者**（候補者） | **1つの入力フォーム**で候補者を追加（全項目が1ページ。必須は氏名・性別・生年月日・分野のみ。繰り返し項目は行の追加・削除が可能。スマートフォン対応。エラーでも入力は消えません）、詳細ページで項目ごとに入力・編集、書類のアップロード・削除、LPK側のステータス変更、**提携TSKへの共有設定**（初期値は非共有。オンにするには「学生の同意済み」の確認が必要。オフにするとTSKからは直ちに見えなくなります） |
| **先生（sensei）** | 候補者の一覧と基本情報のみ（機微情報と書類は見られません） |
| **TSK管理者／スタッフ** | TSKに**共有された**提携LPKの候補者の閲覧、書類のダウンロード、判断と備考の記入。データの編集は「企業面接合格」以降の判断になってからに限ります |
| **TSK管理者／スタッフ**（配属先と求人） | **配属先**（法人 → 事業所 → 担当者、事業所が受け入れる分野）の管理、**求人**の作成と**マッチする候補者**の表示（同じ分野、言語・性別の条件は緑／赤で表示、最新の評価順）、**推薦する**操作、充足・終了の確認、配属の**就労開始日**の入力。配属先・事業所・担当者・求人の完全削除は**TSK管理者のみ** |
| **スーパー管理者**（分野） | 分野マスタ（`skill_fields`）の管理：追加・名称変更・無効化。使用中の分野は削除できません |
| **TSK管理者／スタッフ**（活動記録） | 業務記録、議事録・面談記録、ケースの時系列（社内用PDFとクライアント向け）、定期面談、フォローアップのタスク、日報、写真。削除はできません（誤りは取消＋理由）。[docs/catatan-kegiatan.md](docs/catatan-kegiatan.md) を参照 |
| **TSK管理者／スタッフ**（クライアント資料） | 配属先プロフィールと求人票を日本語のPDFで出力（社内用／提供用）。[docs/lembar-klien.md](docs/lembar-klien.md) を参照 |
| **LPK／TSK管理者**（履歴） | `/activity` で組織のアクティビティ履歴を閲覧（変更・削除不可）、CSV出力 |
| **全ユーザー** | ログイン、言語の切り替え、「マイアカウント」でのパスワード変更 |
| **全ユーザー** | 役割ごとに設定できるダッシュボード（並び順、サイズ、ウィジェットの非表示） |
| **TSK管理者／担当**（在留カード） | 就労者ごとの在留カード管理（リマインダーの段階、更新申請、新しいカードの受領）、カード番号・写真の暗号化保管、コピーして使えるオンライン更新用データ、窓口用の手数料納付書PDF、`/records/cards` の一覧、毎日のリマインダーメール。他のTSKスタッフは概要の閲覧のみ。[docs/zairyu-card.md](docs/zairyu-card.md) を参照 |
| **LPK管理者**（渡航後の就労者） | 提携中のTSKに共有された自分の候補者について、ビザの状況と到着日**だけ**を確認（配属先・求人・配属情報は見られません） |

新しいアカウントの流れ：

1. 管理者がユーザーを追加 → システムが**仮パスワード**を作成（一度だけ表示）
2. 管理者が安全な方法でユーザーに伝える
3. 初回ログイン時に、ユーザーは**必ず**自分のパスワードを設定してからアプリを使い始める

標準の安全策：管理者は自分自身の無効化や役割変更ができません。組織には常に有効な管理者が1人以上います。パスワードをリセットすると、そのユーザーは全セッションから直ちにログアウトされます。
無効化したユーザーはすぐにログインできなくなります（セッションの期限切れを待たず、リクエストごとに確認）。すべての変更は監査ログに記録されます。

### ブランド

ロゴ、アイコン、使用ルールは [docs/brand.md](docs/brand.md) にあります。派生アセットは `design/brand-source/` から `npm run build:brand` で生成します。

### 活動記録（ステップ7A）

TSKスタッフ専用の機能です：業務記録、議事録、ケースの時系列（クライアント向けPDF）、定期面談、フォローアップのタスク、リーダーへの日報、写真。ドキュメント：[docs/catatan-kegiatan.md](docs/catatan-kegiatan.md)。
再シードなしでデモデータを入れるには `npm run seed:records`。**記録は5年間保管され、アプリからは削除できません。実データを入れる前に、サーバー外へのバックアップが必須です。**

### クライアント資料（ステップ6）

配属先と求人の日本語PDF出力です（配属先プロフィール、求人票。社内用／提供用。ラベルは日本語、または日本語＋インドネシア語）。形式はTSKの確認が取れるまで DRAFT です。ラベルとセクションの順序はすべて
`src/lib/pdf/client-sheet.config.ts` にあります。ドキュメント：[docs/lembar-klien.md](docs/lembar-klien.md)。再シードなしのデモデータは `npm run seed:client-sheet`。

## スクリーンショット

すべてダミーデータ（デモアカウント `*@hashi.test`）で、実データではありません。さらに多くの画像は [docs/screenshots/](docs/screenshots/) にあります。

| TSKのホーム（インドネシア語） | LPKの候補者一覧（インドネシア語） |
| --- | --- |
| ![TSKのホーム](docs/screenshots/T-012/sesudah-tsk-id-desktop.png) | ![LPKの候補者一覧](docs/screenshots/T-014/daftar-kandidat-bandung.png) |

| 在留カード一覧（日本語） | スマートフォンでのLPKホーム（日本語） |
| --- | --- |
| ![在留カード一覧](docs/screenshots/T-019/3-daftar-ja-admin.png) | ![スマートフォンでのLPKホーム](docs/screenshots/T-012/sesudah-lpk-ja-mobile.png) |

## 実行方法

### OptiPlexでの実行

Docker と Docker Compose、git が必要です。概要：

```bash
git clone git@github.com:rivaldydwi/hashi.git ~/hashi && cd ~/hashi
cp .env.example .env            # その後、ランダムなシークレット（DB_OWNER_PASSWORD、DB_APP_PASSWORD、AUTH_SECRET）を設定。詳しいコマンドは README.md にあります
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build   # マイグレーションが先に自動で実行されます
docker compose run --rm migrate npm run db:seed                       # デモデータ（初回のみ）
curl -fsS http://127.0.0.1:3110/api/health                            # ヘルスチェック
```

シードで架空の候補者36名（LPK 3校×12名）と、各役割のデモアカウント（`*@hashi.test`。パスワードとアカウント一覧は [README.md](README.md) の「Akun demo」）が入ります。
ポート3100はOptiPlex上の別のアプリが使っているため、Hashiは `APP_PORT=3110` で動かします。再シードは `npm run db:seed -- --reset`（開発・デモ用データベースのみ）。

### 外部向けデモ

TSKのスタッフが公開アドレスから試す場合は、**別のデモ用インスタンス**を使います（Composeプロジェクト `hashi-demo`、ポート3111、データベース `hashi_demo`、専用ボリューム）。本番には触れません。

```bash
scripts/demo-up.sh       # 起動：.env.demo（ランダムなシークレット）を作成し、ビルド・起動・シードして、デモアカウントを表示
scripts/demo-reset.sh    # デモデータだけを入れ直す
scripts/demo-down.sh     # 停止（データは残る）。`--purge` でデモ用ボリュームも削除
```

`.env.demo` が安全でない場合、スクリプトは実行を拒否します。HTTPSは `http://127.0.0.1:3111` を向けたプロキシまたはトンネル経由です。
**デモインスタンスにはダミーデータだけを入れてください。本番（`hashi`、ポート3110）は決してインターネットに公開しないでください。** 詳細は [README.md](README.md) の「Demo untuk pihak luar」を参照。

### 最新バージョンへの更新

```bash
cd ~/hashi
scripts/deploy.sh            # git pull --ff-only ＋ GIT_SHA付きビルド ＋ /api/health が新しいコミットを返すまで待機。マイグレーションは自動
                             # オプション：--backup（先にバックアップ）、--check（前提条件の確認のみ）
```

本番の確認は **CIが緑**（`gh run list`）であることと `/api/health` で行います。本番データベースに対して `test:rls` を実行してはいけません。

### 日常のコマンド

```bash
docker compose ps                         # 状態
docker compose logs -f app                # アプリのログ
scripts/deploy.sh                         # 最新バージョンへ更新
docker compose down                       # 停止（データはボリュームに残ります）
docker compose run --rm migrate npm run db:seed -- --reset   # デモデータを最初から入れ直す
```

メモリ上限：アプリ768MB、データベース512MB。

## セキュリティと個人情報

概要です（詳細は技術セクションと各機能のドキュメントにあります）。

- **PostgreSQL の RLS による組織間の分離**：アプリは RLS を回避できない `hashi_app` ロールで接続します。アクセス規則はアプリだけでなく、データベースのトリガーでも守られます。
- **機微情報は役割ごとに制限**：先生（sensei）は基本プロフィールのみ。TSKはLPKが共有した候補者しか見られません（窓口は1つ。初期値は非共有で、「学生の同意済み」の確認が必要）。
- **在留カードの番号と写真は暗号化**（AES-256-GCM）され、TSK管理者と就労者の担当だけが開けます。開くたびに監査ログへ記録されます。鍵 `CARD_DATA_KEY` は `.env` にあります。**鍵を失うとデータは復元できません**（[docs/zairyu-card.md](docs/zairyu-card.md)、[docs/backup.md](docs/backup.md)）。
- **アクティビティ履歴は変更も削除もできません**（OWNERでもトリガーが拒否）。記録の本文、候補者名、書類番号は含まれません。
- **ブラウザの翻訳機能**：自動翻訳（ChromeのTranslate など）はブロックしません。スタッフがラベルや自由記述を読めるようにするためです。固定されるのは個人を特定する情報（氏名、住所、電話番号、コード、書類番号）だけです。例外として、健康に関するメモは固定します。Chromeは翻訳のためにテキストをGoogleのサーバーへ送るためです。
- **本番はインターネットに公開しません**。公開アドレスを付けてよいのはデモインスタンス（ダミーデータ）だけです。このリポジトリは公開されています。シークレット、IPアドレス、個人情報は絶対に入れないでください。

### データの安全性：RLSの仕組み

アプリはデータベースに **`hashi_app`** ロールで接続します。このロールは RLS を回避できません。マイグレーションとシードは **`hashi_owner`** ロールを使います。テナントのデータはすべて `withTenant({ orgId, role, userId }, …)` を通して読み書きされ、RLSポリシーのために `app.role` と `app.user_id` が設定されます。

候補者へのアクセスの概要です（全規則は [README.md](README.md) の「Hak akses data kandidat」と `CLAUDE.md` にあります）。

- LPKのステータス（`stage`）とTSKの判断は**別々**です。ステータスを設定できるのはLPK管理者だけで、各TSKは自組織の判断の行だけを見て書き込めます。LPKは判断を読めますが、書き込めません。
- TSKの備考は、初期値が `TSK_ONLY`、または `SHARED_WITH_LPK` です。先生は決して読めず、誰も削除できません。
- 提携TSKが読めるのは `shared_with_tsk = true` の候補者だけです（オンにできるのはLPK管理者のみ）。共有をオフにすると候補者は見えなくなりますが、判断や備考は削除されません。
- TSKが候補者データを編集できるのは、**自組織の**判断が「企業面接合格」「書類手続き中」「渡航済み」のいずれかで、候補者が辞退していない場合だけです（明示的なリストで、列挙型への `>=` は使いません）。
- 評価：LPKの月次評価はLPK管理者と先生、および（共有されていれば）TSKが読めます。TSKの面接・訪問評価はTSKのもので、明示的に共有された場合だけLPK管理者に届きます。
- 配属先と求人はTSKだけのものです。LPK、先生、他のTSKには行が見えません（画面では404）。
- `candidate_id` を持つテーブルは必ず `scripts/verify-rls.ts` のパートIに追加します。`npm run test:rls` が上記の規則をすべて検査します。

## バックアップ

データベースと書類ボリュームの暗号化バックアップと、その復元方法：**[docs/backup.md](docs/backup.md)**（`scripts/backup.sh`、`scripts/restore.sh`）。定期実行とサーバー外へのコピーは未設定です（チェックリストは [docs/pilot-checklist.md](docs/pilot-checklist.md)）。

候補者の書類（PDF／JPG／PNG、最大10MB）は **Docker の名前付きボリューム `docs-data`**（`app` コンテナの `/app/docs-data`）に `<org_id>/<candidate_id>/<document_id>.<拡張子>` として保存されます。ディスク上のファイル名は常に書類IDで、
ファイルの種類は中身から判定し、ダウンロードはアプリ経由だけです（ログイン＋RLS、監査ログに記録）。書類のメタデータはデータベースにあるため、**バックアップにはデータベースと `docs-data` ボリュームの両方が必要です**。片方だけでは復元できません。
在留カードの写真は同じボリューム（`cards/`）に暗号化して保存されます。`CARD_DATA_KEY` はデータとは別に必ず控えてください。

## 開発とテスト

### 開発（別データベース）

開発用データベースは独立した `db-dev` サービス（専用のコンテナ・ボリューム・ポート `127.0.0.1:5433`）で、本番とは別です。そのため、本番で `docker compose up -d --build` を実行しても止まりません。

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev
# .env：DATABASE_URL / MIGRATE_DATABASE_URL -> 127.0.0.1:5433 の .../hashi_dev
npm run db:migrate && npm run db:seed
npm run dev                       # http://localhost:3100
```

`npm run test:e2e`、`npm run test:rls`、`npm run db:seed -- --reset` は、データベース名が `_dev` または `_test` で終わっていないと**実行を拒否します**（`scripts/db-guard.ts`）。CIは `hashi_test` データベースを使います。

### テスト

| コマンド | 検査内容 |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run test:unit` | ユニットテスト（`node:test`） |
| `npm run test:rls` | データベースの規則：データ分離、役割、候補者へのアクセス、TSKの判断と備考、提携、監査ログ（dev／testデータベースのみ） |
| `npm run test:i18n` | インドネシア語と日本語のメッセージキーが同一で、インドネシア語の文に日本語の文字が混ざっていないこと |
| `npm run verify:audit-coverage` | 書き込みを行うサーバーアクションが、すべて監査ログにも書き込むこと |
| `npm run test:e2e` | ブラウザのシナリオ（Playwright）。テストデータを追加するため、dev／testデータベースのみ |

すべて、コードを変更するたびにGitHub Actionsで自動実行されます（ドキュメントだけの変更ではCIは動きません）。新しいテーブルを作るときは、Drizzleのマイグレーション＋手書きのSQLマイグレーション（`GRANT`、`ENABLE`＋`FORCE ROW LEVEL SECURITY`、ポリシー）＋ `scripts/verify-rls.ts` の検査を追加します。

### Dockerなしの開発

Node 22 と PostgreSQL 16 を用意し、`.env` に `DATABASE_URL` と `MIGRATE_DATABASE_URL` を設定して（`.env.example` を参照）、`npm ci && npm run db:migrate && npm run db:seed && npm run dev` を実行します。

### フォルダー構成

```
drizzle/                 SQLマイグレーション（RLS、トリガー、GRANTは手書き）
messages/                画面の文言：id.json、ja.json（キーは同一）
scripts/                 migrate、seed、verify-*（rls、seed、i18n、audit）、デモ／デプロイ／バックアップのスクリプト
src/db/                  スキーマ、withTenant/withSystem、共通クエリ、デモデータ、監査（scripts/ からインポートしてよいのはここだけ）
src/features/            機能ごとのロジック（candidates、assessments、clients、job-orders、records、cards、documents、dashboard、audit、users など）
src/lib/                 セッション、権限、audit()、PDF、タイムゾーン
src/components/          アプリのシェルと共通コンポーネント
src/app/                 ページ（login と、ログイン後の (app) グループ）
tests/unit/ tests/e2e/   ユニットテストとブラウザテスト
docs/                    タスク一覧、報告、機能ドキュメント、用語集、ブランド、スクリーンショット
```

### 決定事項のメモ

- **Prismaではなく Drizzle**：バイナリエンジンがなく（イメージが小さく、OptiPlexでのビルドが速い）、マイグレーションがただのSQLなのでRLSも管理しやすいためです。
- **ログインのレート制限**（同じメールで15分間に5回失敗）はメモリ上に保持します。サーバー1台なら十分です。
- **実際の学生データを入れる前に**：`SHOW_DEMO_ACCOUNTS=false` にし、自動のオフサイトバックアップを用意し、個人情報の同意書を準備してください（MVP仕様書を参照）。

## ドキュメントとチームの進め方

`docs/` 内のドキュメント：

| ファイル | 内容 |
| --- | --- |
| [docs/TASKS.md](docs/TASKS.md) · [docs/STATUS.md](docs/STATUS.md) · [docs/HISTORY.md](docs/HISTORY.md) | タスク一覧（PM）、エンジニアの報告、経緯と技術的な決定 |
| [docs/panduan/README.md](docs/panduan/README.md) · [docs/panduan/panduan-hashi.pdf](docs/panduan/panduan-hashi.pdf) | LPK・TSKスタッフ向けの利用ガイド（インドネシア語、スクリーンショット付き、4つの事例）。スクリーンショットは `npm run guide:shots`、PDFは `npm run build:guide` で再生成します |
| [docs/glossary.md](docs/glossary.md) | 日本語・インドネシア語・英語の用語集 |
| [docs/catatan-kegiatan.md](docs/catatan-kegiatan.md) | TSKの活動記録（業務記録、面談、定期面談、様式5-5） |
| [docs/lembar-klien.md](docs/lembar-klien.md) | クライアント資料のPDF（DRAFT形式） |
| [docs/zairyu-card.md](docs/zairyu-card.md) | 在留カード管理、暗号化、リマインダーメール、オンライン更新 |
| [docs/email.md](docs/email.md) | リマインダーメール用のSMTP設定 |
| [docs/backup.md](docs/backup.md) | 暗号化バックアップと復元 |
| [docs/pilot-checklist.md](docs/pilot-checklist.md) | パイロット前のチェックリストとダミーのパイロットデータ |
| [docs/brand.md](docs/brand.md) | ロゴ、アイコン、使用ルール |
| [docs/screenshots/](docs/screenshots/) | スクリーンショット（ダミーデータ） |

このREADMEは3言語で、見出しの構成は同じです：[Bahasa Indonesia](README.md)、[English](README.en.md)、日本語（このファイル）。

### チームの進め方

Ipal（オーナー）が決定し、**PM**（claude.ai/code 上のClaudeセッション）が [docs/TASKS.md](docs/TASKS.md) にタスクを書いてプルリクエストをレビューし、
**エンジニア**（ミニPCのVS Code上のClaude Code）が `eng/<ID>-…` ブランチでタスクを進めて [docs/STATUS.md](docs/STATUS.md) に報告し、
PMがPRに `PM: DISETUJUI` と書いた後にマージします。詳しい規則は `CLAUDE.md` の「Peran dan aturan kerja」にあります。
