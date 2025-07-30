const axios = require('axios');
const config = require('../config');
const sqlite3 = require('sqlite3').verbose();

module.exports = function (fastify, opts, done) {
  fastify.post('/status', async (req, reply) => {
    const { CallSid, transcription, summary } = req.body;

    if (!CallSid) {
      return reply.code(400).send({ error: 'Missing CallSid' });
    }

    const db = new sqlite3.Database('./db/data.db');
    db.get('SELECT * FROM calls WHERE call_sid = ?', [CallSid], async (err, row) => {
      if (err) {
        console.error('[DB Error]', err.message);
        db.close();
        return reply.code(500).send({ error: 'Database error' });
      }

      if (!row) {
        db.close();
        return reply.code(404).send({ error: 'Call record not found' });
      }

      const userChatId = row.user_chat_id || config.telegramChatId;
      const message = `📞 *Call Summary*\n\n• CallSid: \`${CallSid}\`\n• Phone: \`${row.phone_number || 'N/A'}\`\n• Prompt: _${row.prompt || 'N/A'}_\n• Transcript: ${transcription || row.transcription || '_None_'}\n• Summary: ${summary || row.summary || '_Not available yet_'}\n\n🕓 ${row.timestamp || ''}`;

      const url = `https://api.telegram.org/bot${config.bot.token}/sendMessage`;

      try {
        await axios.post(url, {
          chat_id: userChatId,
          text: message,
          parse_mode: 'Markdown'
        });

        db.close();
        return reply.send({ success: true });
      } catch (error) {
        console.error('Telegram Error:', error.response?.data || error.message);
        db.close();
        return reply.code(500).send({ error: 'Telegram message failed' });
      }
    });
  });

  done();
};