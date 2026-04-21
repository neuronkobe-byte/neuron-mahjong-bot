// ニューロン麻雀スクール 神戸校
// 牌効率トレーナー LINE Bot
// =============================

const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
app.use(express.json());

// --- 環境変数 ---
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;
const PORT = process.env.PORT || 3000;

// --- 問題データ読み込み ---
const questionData = JSON.parse(fs.readFileSync('./mahjong_questions.json', 'utf8'));
const ALL_QUESTIONS = questionData.questions;

// --- ユーザー状態管理（メモリ内・本番はDBを推奨）---
// { userId: { pendingQuestionId, totalCorrect, totalAnswered, streak } }
const userState = {};

// --- 配信先のLINEグループ/ユーザーIDリスト ---
// LINE Developersのコンソールで確認 or Webhookで自動取得
let subscribedIds = process.env.SUBSCRIBE_IDS
  ? process.env.SUBSCRIBE_IDS.split(',')
  : [];

// ===============================
// 毎朝9時に問題を自動配信
// ===============================
cron.schedule('0 9 * * *', () => {
  console.log('[CRON] 毎日問題配信開始');
  sendDailyQuestion();
}, { timezone: 'Asia/Tokyo' });

async function sendDailyQuestion() {
  if (subscribedIds.length === 0) {
    console.log('[WARN] 配信先IDが設定されていません');
    return;
  }

  // ランダムに1問選択（全レベルから）
  const q = ALL_QUESTIONS[Math.floor(Math.random() * ALL_QUESTIONS.length)];

  const levelNames = { 1: '初級', 2: '中級', 3: '上級' };
  const msg = buildQuestionMessage(q, levelNames[q.level]);

  for (const id of subscribedIds) {
    try {
      await lineApi('pushMessage', {
        to: id,
        messages: [msg]
      });
      // この問題IDをグループ共有状態に保存
      userState[`group_${id}`] = {
        pendingQuestionId: q.id,
        sentAt: new Date().toISOString()
      };
      console.log(`[OK] 配信完了: ${id} / 問題ID:${q.id}`);
    } catch (e) {
      console.error(`[ERR] 配信失敗: ${id}`, e.response?.data || e.message);
    }
  }
}

// ===============================
// 問題メッセージを組み立てる
// ===============================
function buildQuestionMessage(q, levelName) {
  const levelBadge = { '初級': '🟢', '中級': '🟡', '上級': '🔴' };
  const badge = levelBadge[levelName] || '🟢';

  let text = `${badge} 【本日の牌効率問題】\n`;
  text += `━━━━━━━━━━━━\n`;
  text += `📂 ${q.category}\n\n`;
  text += `❓ ${q.instruction}\n`;

  if (q.hand && q.hand.length > 0) {
    text += `\n🀄 手牌：${formatHand(q.hand)}\n`;
  }

  text += `\n`;
  q.options.forEach((opt, i) => {
    text += `${i + 1}. ${opt}\n`;
  });

  text += `\n━━━━━━━━━━━━\n`;
  text += `1〜4の番号を送って答えてね！`;

  return { type: 'text', text };
}

// 牌を読みやすく表示
function formatHand(hand) {
  return hand.map(t => {
    if (t.endsWith('m')) return t.replace('m', '') + '万';
    if (t.endsWith('p')) return t.replace('p', '') + '筒';
    if (t.endsWith('s')) return t.replace('s', '') + '索';
    return t;
  }).join(' ');
}

// ===============================
// Webhook受信（LINEからの返信）
// ===============================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // LINEには即200を返す

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleMessage(event);
    } else if (event.type === 'follow') {
      await handleFollow(event);
    }
  }
});

// ===============================
// メッセージ処理
// ===============================
async function handleMessage(event) {
  const userId = event.source.userId;
  const groupId = event.source.groupId || event.source.roomId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();

  // グループの場合はグループIDで状態管理
  const stateKey = groupId ? `group_${groupId}` : userId;

  // コマンド処理
  if (text === '今すぐ問題' || text === '問題') {
    await sendRandomQuestionToUser(replyToken, stateKey, userId);
    return;
  }

  if (text === '成績' || text === 'せいせき') {
    await sendStats(replyToken, userId);
    return;
  }

  if (text === 'ランキング') {
    await sendRanking(replyToken);
    return;
  }

  if (text === 'ヘルプ' || text === 'help') {
    await replyText(replyToken,
      '📖 使い方\n\n' +
      '• 毎朝9時に問題が届きます\n' +
      '• 1〜4の番号で回答\n\n' +
      '【コマンド】\n' +
      '「問題」→ 今すぐ1問\n' +
      '「成績」→ 自分の正解率\n' +
      '「ランキング」→ みんなの成績'
    );
    return;
  }

  // 数字回答の処理（1〜4）
  const answer = parseInt(text);
  if (answer >= 1 && answer <= 4) {
    await handleAnswer(replyToken, stateKey, userId, answer);
    return;
  }
}

// ===============================
// 回答判定
// ===============================
async function handleAnswer(replyToken, stateKey, userId, answer) {
  const state = userState[stateKey];

  if (!state || !state.pendingQuestionId) {
    await replyText(replyToken,
      '問題がありません。\n「問題」と送ると今すぐ1問出題します！'
    );
    return;
  }

  const q = ALL_QUESTIONS.find(x => x.id === state.pendingQuestionId);
  if (!q) return;

  const isCorrect = (answer - 1) === q.correct;

  // ユーザー成績を更新
  if (!userState[userId]) {
    userState[userId] = { totalCorrect: 0, totalAnswered: 0, streak: 0 };
  }
  userState[userId].totalAnswered++;
  if (isCorrect) {
    userState[userId].totalCorrect++;
    userState[userId].streak = (userState[userId].streak || 0) + 1;
  } else {
    userState[userId].streak = 0;
  }

  // 問題をクリア
  delete userState[stateKey].pendingQuestionId;

  // 正解・不正解メッセージ
  const correctOption = q.options[q.correct];
  let msg = isCorrect ? '✅ 正解！\n\n' : `❌ 不正解\n\n正解は「${answer}. ${q.options[q.correct]}」でした\n\n`;
  msg += `📝 解説：\n${q.explanation}`;

  const streak = userState[userId].streak;
  if (isCorrect && streak >= 3) {
    msg += `\n\n🔥 ${streak}問連続正解！すごい！`;
  }

  await replyText(replyToken, msg);
}

// ===============================
// 今すぐ問題送信
// ===============================
async function sendRandomQuestionToUser(replyToken, stateKey, userId) {
  const q = ALL_QUESTIONS[Math.floor(Math.random() * ALL_QUESTIONS.length)];
  const levelNames = { 1: '初級', 2: '中級', 3: '上級' };
  const msg = buildQuestionMessage(q, levelNames[q.level]);

  userState[stateKey] = {
    ...(userState[stateKey] || {}),
    pendingQuestionId: q.id,
    sentAt: new Date().toISOString()
  };

  await lineApi('replyMessage', { replyToken, messages: [msg] });
}

// ===============================
// 成績表示
// ===============================
async function sendStats(replyToken, userId) {
  const s = userState[userId] || { totalCorrect: 0, totalAnswered: 0, streak: 0 };
  const rate = s.totalAnswered > 0
    ? Math.round(s.totalCorrect / s.totalAnswered * 100)
    : 0;

  const msg =
    `📊 あなたの成績\n` +
    `━━━━━━━━━━━━\n` +
    `✅ 正解数：${s.totalCorrect}問\n` +
    `📝 挑戦数：${s.totalAnswered}問\n` +
    `🎯 正解率：${rate}%\n` +
    `🔥 連続正解：${s.streak || 0}問\n` +
    `━━━━━━━━━━━━\n` +
    `「問題」で今すぐ練習！`;

  await replyText(replyToken, msg);
}

// ===============================
// ランキング（簡易版）
// ===============================
async function sendRanking(replyToken) {
  const ranking = Object.entries(userState)
    .filter(([k, v]) => !k.startsWith('group_') && v.totalAnswered > 0)
    .map(([userId, s]) => ({
      userId,
      correct: s.totalCorrect,
      answered: s.totalAnswered,
      rate: Math.round(s.totalCorrect / s.totalAnswered * 100)
    }))
    .sort((a, b) => b.correct - a.correct)
    .slice(0, 5);

  if (ranking.length === 0) {
    await replyText(replyToken, 'まだデータがありません。\n「問題」で練習を始めよう！');
    return;
  }

  const medals = ['🥇', '🥈', '🥉', '4位', '5位'];
  let msg = `🏆 正解数ランキング\n━━━━━━━━━━━━\n`;
  ranking.forEach((r, i) => {
    msg += `${medals[i]} ${r.correct}問正解（正解率${r.rate}%）\n`;
  });
  msg += `━━━━━━━━━━━━\n今月の点棒山盛王を目指せ！`;

  await replyText(replyToken, msg);
}

// ===============================
// フォロー時のウェルカムメッセージ
// ===============================
async function handleFollow(event) {
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  // 購読リストに追加
  if (!subscribedIds.includes(userId)) {
    subscribedIds.push(userId);
  }

  await replyText(replyToken,
    '🀄 ニューロン麻雀スクール 神戸校\n牌効率トレーナーBotへようこそ！\n\n' +
    '毎朝9時に牌効率問題が届きます。\n番号を返信して力を磨こう！\n\n' +
    '【コマンド一覧】\n' +
    '「問題」→ 今すぐ1問\n' +
    '「成績」→ 自分の正解率\n' +
    '「ランキング」→ みんなの成績\n' +
    '「ヘルプ」→ 使い方\n\n' +
    '「問題」と送って試してみてね！'
  );
}

// ===============================
// LINE API ヘルパー
// ===============================
async function lineApi(endpoint, data) {
  return axios.post(
    `https://api.line.me/v2/bot/message/${endpoint}`,
    data,
    { headers: { Authorization: `Bearer ${LINE_TOKEN}` } }
  );
}

async function replyText(replyToken, text) {
  return lineApi('replyMessage', {
    replyToken,
    messages: [{ type: 'text', text }]
  });
}

// ===============================
// ヘルスチェック用
// ===============================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    name: 'ニューロン麻雀スクール 牌効率トレーナーBot',
    questions: ALL_QUESTIONS.length,
    subscribers: subscribedIds.length
  });
});

// ===============================
// 手動テスト用エンドポイント
// ===============================
app.get('/test-send', async (req, res) => {
  await sendDailyQuestion();
  res.json({ message: 'テスト配信しました' });
});

app.listen(PORT, () => {
  console.log(`🀄 麻雀Botサーバー起動 port:${PORT}`);
  console.log(`問題数: ${ALL_QUESTIONS.length}問`);
});
