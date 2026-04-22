const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
app.use(express.json());

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

const questionData = JSON.parse(fs.readFileSync('./mahjong_questions.json', 'utf8'));
const ALL_QUESTIONS = questionData.questions;

const userState = {};

function getTodayKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function getDailyCount(userId) {
  const state = userState[userId] || {};
  const today = getTodayKey();
  if (state.date !== today) return 0;
  return state.count || 0;
}

function incrementDailyCount(userId) {
  const today = getTodayKey();
  if (!userState[userId] || userState[userId].date !== today) {
    userState[userId] = { date: today, count: 0, pendingQuestionId: null };
  }
  userState[userId].count++;
}

function getQuestionsByLevel(level) {
  if (level === 0) return ALL_QUESTIONS;
  return ALL_QUESTIONS.filter(q => q.level === level);
}

function buildQuestionMessage(q, count) {
  const levels = { 1: '🟢初級', 2: '🟡中級', 3: '🔴上級' };
  let text = `${levels[q.level] || '🟢初級'} 【牌効率問題】\n`;
  text += `本日${count}/3問目\n`;
  text += `━━━━━━━━━━━━\n❓ ${q.instruction}\n`;
  if (q.hand && q.hand.length > 0) text += `\n手牌：${q.hand.join(' ')}\n`;
  text += '\n';
  q.options.forEach((opt, i) => { text += `${i+1}. ${opt}\n`; });
  text += `\n━━━━━━━━━━━━\n1〜4の番号で答えてね！`;
  return { type: 'text', text };
}

// 月〜土 朝8時に初級問題を自動配信
cron.schedule('0 8 * * 1-6', async () => {
  console.log('[CRON] 朝8時 初級問題配信');
}, { timezone: 'Asia/Tokyo' });

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  try {
    const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        handleMessage(event).catch(e => console.error('[ERR]', e.response?.data || e.message));
      }
    }
  } catch(e) {
    console.error('[ERR webhook]', e.message);
  }
});

async function handleMessage(event) {
  const userId = event.source.userId;
  const groupId = event.source.groupId || event.source.roomId;
  const text = event.message.text.trim();
  const replyToken = event.replyToken;
  const stateKey = groupId ? `group_${groupId}` : userId;

  if (text === 'ヘルプ' || text === 'help') {
    await reply(replyToken, { type: 'text', text:
      '📖 使い方\n\n' +
      '「初級問題」→ 初級問題を出題\n' +
      '「中級問題」→ 中級問題を出題\n' +
      '「上級問題」→ 上級問題を出題\n' +
      '「1〜4」→ 回答\n\n' +
      '※1日3問までです\n' +
      '毎週月〜土 朝8時に初級問題が届きます！'
    });
    return;
  }

  let level = -1;
  if (text === '初級問題' || text === '問題') level = 1;
  else if (text === '中級問題') level = 2;
  else if (text === '上級問題') level = 3;

  if (level >= 1) {
    const count = getDailyCount(userId);
    if (count >= 3) {
      await reply(replyToken, { type: 'text', text: '本日の問題は3問終了しました！\nまた明日チャレンジしてね！🀄' });
      return;
    }
    const questions = getQuestionsByLevel(level);
    if (questions.length === 0) {
      await reply(replyToken, { type: 'text', text: 'この難易度の問題がありません。' });
      return;
    }
    const q = questions[Math.floor(Math.random() * questions.length)];
    incrementDailyCount(userId);
    const newCount = getDailyCount(userId);
    if (!userState[stateKey]) userState[stateKey] = {};
    userState[stateKey].pendingQuestionId = q.id;
    await reply(replyToken, buildQuestionMessage(q, newCount));
    return;
  }

  const answer = parseInt(text);
  if (answer >= 1 && answer <= 4) {
    const state = userState[stateKey] || {};
    if (!state.pendingQuestionId) {
      await reply(replyToken, { type: 'text', text: '「初級問題」「中級問題」「上級問題」と送ると出題します！' });
      return;
    }
    const q = ALL_QUESTIONS.find(x => x.id === state.pendingQuestionId);
    if (!q) return;
    const isCorrect = (answer - 1) === q.correct;
    userState[stateKey].pendingQuestionId = null;
    let msg = isCorrect ? '✅ 正解！\n\n' : `❌ 不正解\n正解：${q.options[q.correct]}\n\n`;
    msg += `📝 ${q.explanation}`;
    const remaining = 3 - getDailyCount(userId);
    if (remaining > 0) {
      msg += `\n\nあと${remaining}問チャレンジできます！`;
    } else {
      msg += '\n\n本日の問題は終了です！また明日！🀄';
    }
    await reply(replyToken, { type: 'text', text: msg });
    return;
  }

  await reply(replyToken, { type: 'text', text: '「初級問題」「中級問題」「上級問題」と送ると出題します！\n「ヘルプ」で使い方を確認できます。' });
}

async function reply(replyToken, message) {
  await axios.post('https://api.line.me/v2/bot/message/reply',
    { replyToken, messages: [message] },
    { headers: { Authorization: `Bearer ${LINE_TOKEN}` } }
  );
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', questions: ALL_QUESTIONS.length });
});

app.listen(PORT, () => {
  console.log(`🀄 麻雀Bot起動 port:${PORT}`);
  console.log(`問題数: ${ALL_QUESTIONS.length}問`);
});
