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

cron.schedule('0 9 * * *', () => { sendDailyQuestion(); }, { timezone: 'Asia/Tokyo' });

async function sendDailyQuestion() {}

function buildQuestionMessage(q) {
  const levels = { 1: '🟢初級', 2: '🟡中級', 3: '🔴上級' };
  let text = `${levels[q.level] || '🟢初級'} 【牌効率問題】\n━━━━━━━━━━━━\n❓ ${q.instruction}\n`;
  if (q.hand && q.hand.length > 0) text += `\n手牌：${q.hand.join(' ')}\n`;
  text += '\n';
  q.options.forEach((opt, i) => { text += `${i+1}. ${opt}\n`; });
  text += `\n━━━━━━━━━━━━\n1〜4の番号で答えてね！`;
  return { type: 'text', text };
}

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

  console.log('[MSG] text:', text, 'userId:', userId);

  if (text === '問題' || text === '今すぐ問題') {
    const q = ALL_QUESTIONS[Math.floor(Math.random() * ALL_QUESTIONS.length)];
    userState[stateKey] = { pendingQuestionId: q.id };
    await reply(replyToken, buildQuestionMessage(q));
    return;
  }

  const answer = parseInt(text);
  if (answer >= 1 && answer <= 4) {
    const state = userState[stateKey];
    if (!state || !state.pendingQuestionId) {
      await reply(replyToken, { type: 'text', text: '「問題」と送ると出題します！' });
      return;
    }
    const q = ALL_QUESTIONS.find(x => x.id === state.pendingQuestionId);
    if (!q) return;
    const isCorrect = (answer - 1) === q.correct;
    delete userState[stateKey].pendingQuestionId;
    let msg = isCorrect ? '✅ 正解！\n\n' : `❌ 不正解\n正解：${q.options[q.correct]}\n\n`;
    msg += `📝 ${q.explanation}`;
    await reply(replyToken, { type: 'text', text: msg });
    return;
  }

  await reply(replyToken, { type: 'text', text: '「問題」と送ると出題します！' });
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
