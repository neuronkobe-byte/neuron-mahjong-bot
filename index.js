// ニューロン麻雀スクール 神戸校
// 牌効率トレーナー LINE Bot
// =============================

const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET;
const PORT = process.env.PORT || 3000;

const questionData = JSON.parse(fs.readFileSync('./mahjong_questions.json', 'utf8'));
const ALL_QUESTIONS = questionData.questions;

const userState = {};

let subscribedIds = process.env.SUBSCRIBE_IDS
  ? process.env.SUBSCRIBE_IDS.split(',')
  : [];

cron.schedule('0 9 * * *', () => {
  sendDailyQuestion();
}, { timezone: 'Asia/Tokyo' });

async function sendDailyQuestion() {
  if (subscribedIds.length === 0) return;
  const q = ALL_QUESTIONS[Math.floor(Math.random() * ALL_QUESTIONS.length)];
  const levelNames = { 1: '初級', 2: '中級', 3: '上級' };
  const msg = buildQuestionMessage(q, levelNames[q.level]);
  for (const id of subscribedIds) {
    try {
      await lineApi('pushMessage', { to: id, messages: [msg] });
      userState[`group_${id}`] = { pendingQuestionId: q.id };
    } catch (e) {
      console.error('[ERR]', e.response?.data || e.message);
    }
  }
}

function buildQuestionMessage(q, levelName) {
  const badge = { '初級': '🟢', '中級': '🟡', '上級': '🔴' }[levelName] || '🟢';
  let text = `${badge} 【本日の牌効率問題】\n━━━━━━━━━━━━\n📂 ${q.category}\n\n❓ ${q.instruction}\n`;
  if (q.hand && q.hand.length > 0) text += `\n🀄 手牌：${formatHand(q.hand)}\n`;
  text += '\n';
  q.options.forEach((opt, i) => { text += `${i + 1}. ${opt}\n`; });
  text += `\n━━━━━━━━━━━━\n1〜4の番号を送って答えてね！`;
  return { type: 'text', text };
}

function formatHand(hand) {
  return hand.map(t => {
    if (t.endsWith('m')) return t.replace('m', '') + '万';
    if (t.endsWith('p')) return t.replace('p', '') + '筒';
    if (t.endsWith('s')) return t.replace('s', '') + '索';
    return t;
  }).join(' ');
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleMessage(event);
    } else if (event.type === 'follow') {
      await handleFollow(event);
    }
  }
});

async function handleMessage(event) {
  const userId = event.source.userId;
  const groupId = event.source.groupId || event.source.roomId;
  const text = event.message.text.trim();
  const stateKey = groupId ? `group_${groupId}` : userId;
  const replyTo = groupId || userId;

  if (text === '今すぐ問題' || text === '問題') {
    await sendRandomQuestionToUser(replyTo, stateKey);
    return;
  }
  if (text === '成績' || text === 'せいせき') {
    await sendStats(replyTo, userId);
    return;
  }
  if (text === 'ランキング') {
    await sendRanking(replyTo);
    return;
  }
  if (text === 'ヘルプ' || text === 'help') {
    await pushText(replyTo, '📖 使い方\n\n• 毎朝9時に問題が届きます\n• 1〜4の番号で回答\n\n【コマンド】\n「問題」→ 今すぐ1問\n「成績」→ 自分の正解率\n「ランキング」→ みんなの成績');
    return;
  }
  const answer = parseInt(text);
  if (answer >= 1 && answer <= 4) {
    await handleAnswer(replyTo, stateKey, userId, answer);
    return;
  }
}

async function handleAnswer(replyTo, stateKey, userId, answer) {
  const state = userState[stateKey];
  if (!state || !state.pendingQuestionId) {
    await pushText(replyTo, '問題がありません。\n「問題」と送ると今すぐ1問出題します！');
    return;
  }
  const q = ALL_QUESTIONS.find(x => x.id === state.pendingQuestionId);
  if (!q) return;
  const isCorrect = (answer - 1) === q.correct;
  if (!userState[userId]) userState[userId] = { totalCorrect: 0, totalAnswered: 0, streak: 0 };
  userState[userId].totalAnswered++;
  if (isCorrect) {
    userState[userId].totalCorrect++;
    userState[userId].streak = (userState[userId].streak || 0) + 1;
  } else {
    userState[userId].streak = 0;
  }
  delete userState[stateKey].pendingQuestionId;
  let msg = isCorrect ? '✅ 正解！\n\n' : `❌ 不正解\n\n正解は「${answer}. ${q.options[q.correct]}」でした\n\n`;
  msg += `📝 解説：\n${q.explanation}`;
  const streak = userState[userId].streak;
  if (isCorrect && streak >= 3) msg += `\n\n🔥 ${streak}問連続正解！すごい！`;
  await pushText(replyTo, msg);
}

async function sendRandomQuestionToUser(replyTo, stateKey) {
  const q = ALL_QUESTIONS[Math.floor(Math.random() * ALL_QUESTIONS.length)];
  const levelNames = { 1: '初級', 2: '中級', 3: '上級' };
  const msg = buildQuestionMessage(q, levelNames[q.level]);
  userState[stateKey] = { ...(userState[stateKey] || {}), pendingQuestionId: q.id };
  await lineApi('pushMessage', { to: replyTo, messages: [msg] });
}

async function sendStats(replyTo, userId) {
  const s = userState[userId] || { totalCorrect: 0, totalAnswered: 0, streak: 0 };
  const rate = s.totalAnswered > 0 ? Math.round(s.totalCorrect / s.totalAnswered * 100) : 0;
  await pushText(replyTo, `📊 あなたの成績\n━━━━━━━━━━━━\n✅ 正解数：${s.totalCorrect}問\n📝 挑戦数：${s.totalAnswered}問\n🎯 正解率：${rate}%\n🔥 連続正解：${s.streak || 0}問\n━━━━━━━━━━━━\n「問題」で今すぐ練習！`);
}

async function sendRanking(replyTo) {
  const ranking = Object.entries(userState)
    .filter(([k, v]) => !k.startsWith('group_') && v.totalAnswered > 0)
    .map(([userId, s]) => ({ userId, correct: s.totalCorrect, rate: Math.round(s.totalCorrect / s.totalAnswered * 100) }))
    .sort((a, b) => b.correct - a.correct).slice(0, 5);
  if (ranking.length === 0) {
    await pushText(replyTo, 'まだデータがありません。\n「問題」で練習を始めよう！');
    return;
  }
  const medals = ['🥇', '🥈', '🥉', '4位', '5位'];
  let msg = `🏆 正解数ランキング\n━━━━━━━━━━━━\n`;
  ranking.forEach((r, i) => { msg += `${medals[i]} ${r.correct}問正解（正解率${r.rate}%）\n`; });
  msg += `━━━━━━━━━━━━\n今月の点棒山盛王を目指せ！`;
  await pushText(replyTo, msg);
}

async function handleFollow(event) {
  const userId = event.source.userId;
  if (!subscribedIds.includes(userId)) subscribedIds.push(userId);
  await pushText(userId, '🀄 ニューロン麻雀スクール 神戸校\n牌効率トレーナーBotへようこそ！\n\n毎朝9時に牌効率問題が届きます。\n番号を返信して力を磨こう！\n\n【コマンド一覧】\n「問題」→ 今すぐ1問\n「成績」→ 自分の正解率\n「ランキング」→ みんなの成績\n「ヘルプ」→ 使い方\n\n「問題」と送って試してみてね！');
}

async function lineApi(endpoint, data) {
  return axios.post(`https://api.line.me/v2/bot/message/${endpoint}`, data, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` }
  });
}

async function pushText(to, text) {
  return lineApi('pushMessage', { to, messages: [{ type: 'text', text }] });
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', questions: ALL_QUESTIONS.length });
});

app.get('/test-send', async (req, res) => {
  await sendDailyQuestion();
  res.json({ message: 'テスト配信しました' });
});

app.listen(PORT, () => {
  console.log(`🀄 麻雀Botサーバー起動 port:${PORT}`);
  console.log(`問題数: ${ALL_QUESTIONS.length}問`);
});
