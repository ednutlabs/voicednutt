// api/routes/outbound.js

const WebSocket = require('ws');
const https = require('https');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, '../db/data.db'));

module.exports = function (fastify, opts, done) {
  fastify.post('/outbound-call', (req, res) => {
    const { number, prompt, first_message, user_chat_id } = req.body;

    if (!number || !prompt || !first_message) {
      return res.code(400).send({ error: 'Missing required fields' });
    }

    const twilio = require('twilio')(config.twilio.accountSid, config.twilio.authToken);

    twilio.calls.create({
      to: number,
      from: config.twilio.phoneNumber,
      url: `https://${req.headers.host}/outbound-call-twiml?prompt=${encodeURIComponent(prompt)}&first_message=${encodeURIComponent(first_message)}&user_chat_id=${user_chat_id}`
    }).then(call => {
      db.run(`INSERT INTO calls (call_sid, phone_number, prompt, first_message, user_chat_id) VALUES (?, ?, ?, ?, ?)`,
        [call.sid, number, prompt, first_message, user_chat_id]
      );
      res.send({ success: true, callSid: call.sid });
    }).catch(err => {
      console.error('Call initiation error:', err);
      res.code(500).send({ error: 'Failed to initiate call' });
    });
  });

  fastify.all('/outbound-call-twiml', (req, res) => {
    const { prompt, first_message, user_chat_id } = req.query;

    const twiml = `<?xml version="1.0"?>
      <Response>
        <Connect>
          <Stream url="wss://${req.headers.host}/outbound-media-stream">
            <Parameter name="prompt" value="${prompt}" />
            <Parameter name="first_message" value="${first_message}" />
            <Parameter name="user_chat_id" value="${user_chat_id}" />
          </Stream>
        </Connect>
      </Response>`;

    res.type('text/xml').send(twiml);
  });

  fastify.get('/outbound-media-stream', { websocket: true }, (ws, req) => {
    let callSid = null;
    let streamSid = null;
    let prompt = '';
    let first_message = '';
    let user_chat_id = '';
    let audioBuffer = [];

    const deepgramSocket = new WebSocket(`wss://api.deepgram.com/v1/listen`, [], {
      headers: {
        Authorization: `Token ${config.deepgram.apiKey}`
      }
    });

    let elevenTTSWs = null;

    ws.on('message', msg => {
      const parsed = JSON.parse(msg);
      if (parsed.event === 'start') {
        callSid = parsed.start.callSid;
        streamSid = parsed.start.streamSid;
        prompt = parsed.start.customParameters.prompt;
        first_message = parsed.start.customParameters.first_message;
        user_chat_id = parsed.start.customParameters.user_chat_id;

        speak(first_message);

      } else if (parsed.event === 'media') {
        const audio = Buffer.from(parsed.media.payload, 'base64');
        if (deepgramSocket.readyState === WebSocket.OPEN) {
          deepgramSocket.send(audio);
        }
      } else if (parsed.event === 'stop') {
        deepgramSocket.close();
        ws.close();
      }
    });

    deepgramSocket.on('message', async raw => {
      const data = JSON.parse(raw.toString());
      const transcript = data.channel?.alternatives?.[0]?.transcript;

      if (transcript) {
        try {
          const aiResponse = await openRouterChat(prompt, transcript);
          speak(aiResponse);

          db.run(`UPDATE calls SET transcription = ?, summary = ? WHERE call_sid = ?`, [
            transcript,
            aiResponse,
            callSid
          ]);
        } catch (err) {
          console.error('OpenRouter/DB error:', err);
        }
      }
    });

    function speak(text) {
      axios.post('https://api.elevenlabs.io/v1/text-to-speech/' + config.elevenlabs.voiceId, {
        text,
        model_id: 'eleven_monolingual_v1'
      }, {
        responseType: 'arraybuffer',
        headers: {
          'xi-api-key': config.elevenlabs.apiKey,
          'Content-Type': 'application/json'
        }
      }).then(resp => {
        const base64Audio = Buffer.from(resp.data).toString('base64');
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: base64Audio } }));
      }).catch(err => {
        console.error('ElevenLabs TTS error:', err.message);
      });
    }

    function openRouterChat(systemPrompt, userPrompt) {
      return axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: config.openrouter.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${config.openrouter.apiKey}`,
          'Content-Type': 'application/json'
        }
      }).then(r => r.data.choices[0].message.content);
    }

    ws.on('close', () => {
      if (deepgramSocket.readyState === WebSocket.OPEN) deepgramSocket.close();
    });
  });

  done();
};