# ニューロン麻雀スクール 神戸校
# 牌効率トレーナー LINE Bot — セットアップ手順

---

## 必要なもの（全て無料）

1. **LINE Developers アカウント** → https://developers.line.biz/ja/
2. **Renderアカウント（無料ホスティング）** → https://render.com
3. **GitHubアカウント** → https://github.com

---

## STEP 1: LINE Developersで設定する

1. https://developers.line.biz/ja/ にアクセスしてLINEアカウントでログイン
2. 「新規プロバイダー作成」→ 名前：「ニューロン麻雀スクール」
3. 「Messaging APIチャネル」を作成
   - チャネル名：`牌効率トレーナー`
   - チャネル説明：`毎朝9時に牌効率問題を配信します`
4. 作成後、以下の2つの値をメモ（後で使います）：
   - **チャネルアクセストークン**（長期）→ 「Messaging API設定」タブで発行
   - **チャネルシークレット**→ 「チャネル基本設定」タブに表示

---

## STEP 2: GitHubにコードをアップロード

1. GitHubで新しいリポジトリを作成（例：`neuron-mahjong-bot`）
2. 以下のファイルをアップロード：
   - `index.js`
   - `package.json`
   - `mahjong_questions.json`

---

## STEP 3: Renderでサーバーを立ち上げる

1. https://render.com にアクセスしてGitHubでログイン
2. 「New Web Service」→ GitHubリポジトリを選択
3. 以下を設定：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

4. 「Environment Variables」に以下を追加：

   | キー | 値 |
   |------|-----|
   | `LINE_CHANNEL_ACCESS_TOKEN` | STEP1でメモしたチャネルアクセストークン |
   | `LINE_CHANNEL_SECRET` | STEP1でメモしたチャネルシークレット |
   | `SUBSCRIBE_IDS` | 配信先のLINEグループID（後で設定） |

5. 「Create Web Service」をクリック
6. デプロイ完了後、URLが発行される（例：`https://neuron-mahjong-bot.onrender.com`）

---

## STEP 4: LINE DevelopersにWebhook URLを設定

1. LINE Developersの「Messaging API設定」タブを開く
2. 「Webhook URL」に以下を入力：
   ```
   https://あなたのRenderURL.onrender.com/webhook
   ```
3. 「検証」ボタンを押して成功することを確認
4. 「Webhookの利用」をONにする

---

## STEP 5: LINEグループIDを取得する

Botを友達追加またはグループに招待した後：

1. Botに「ヘルプ」と送信
2. RenderのログでグループIDまたはユーザーIDを確認
   （ログに `source.groupId` または `source.userId` が表示されます）
3. そのIDを環境変数 `SUBSCRIBE_IDS` に設定

---

## 動作確認

ブラウザで以下にアクセスすると今すぐテスト配信できます：
```
https://あなたのRenderURL.onrender.com/test-send
```

---

## 毎朝9時の自動配信について

`node-cron` による自動タイマーが毎朝9時（日本時間）に動きます。
無料プランのRenderはアクセスがないとスリープするため、
**UptimeRobot（無料）** でサーバーを15分おきにPingするとスリープを防げます。

→ https://uptimerobot.com（無料登録）

---

## ファイル構成

```
neuron-mahjong-bot/
├── index.js              ← Botのメインコード
├── package.json          ← Node.js設定
└── mahjong_questions.json ← 105問の問題データ
```

---

## 問題を追加したいとき

`mahjong_questions.json` を開いて、末尾に以下の形式で追加するだけです：

```json
{
  "id": 106,
  "level": 1,
  "category": "両面搭子",
  "instruction": "問題文をここに",
  "hand": ["3m","4m","5m"],
  "options": ["選択肢1","選択肢2","選択肢3","選択肢4"],
  "correct": 0,
  "explanation": "解説文をここに"
}
```

`correct` は0始まりのインデックス（0=1番目、1=2番目...）

---

## サポート

Claude Codeを使ってさらに機能追加できます：
- 生徒別の成績をデータベース（Supabase）に記録
- 点棒山盛王ランキングの月次リセット
- レベル別問題のフィルター配信
- 管理者向けの問題追加コマンド
