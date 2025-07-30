const WebSocket = require('ws');
const https = require('https');
const { request } = require('undici');
const Twilio = require('twilio');
const config = require('../config');
const sqlite3 = require('sqlite3').verbose();

module.exports = function (fastify, opts, done) {
  fastify.all('/inbound-call', async (req, reply) => {
    const { From: phone_number, CallSid: callSid } = req.body;

    if (!phone_number || !callSid) {
      return reply.code(400).send('Missing required fields');
    }

    const db = new sqlite3.Database('./db/data.db');
    db.run(
      `INSERT OR IGNORE INTO calls (call_sid, phone_number, status) VALUES (?, ?, ?)`,
      [callSid, phone_number, 'initiated'],
      () => db.close()
    );

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Connect>
          <Stream url="wss://${req.headers.host}/inbound-media-stream">
            <Parameter name="callSid" value="${callSid}" />
          </Stream>
        </Connect>
      </Response>`;

    reply.type('text/xml').send(twiml);
  });

  fastify.get('/inbound-media-stream', { websocket: true }, (ws, req) => {
    const params = {};
    req.query.forEach(p => { params[p.name] = p.value; });

    let streamSid = null;
    const callSid = params.callSid;
    const transcriptChunks = [];
    let deepgramWS, dgReady = false;

    function connectDeepgram() {
      deepgramWS = new WebSocket('wss://api.deepgram.com/v1/listen', {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
      });

      deepgramWS.on('open', () => {
        dgReady = true;
        speakText("Hi, this is a test call. How can I help?");
      });

      deepgramWS.on('message', async (msg) => {
        const data = JSON.parse(msg.toString());
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript) {
          transcriptChunks.push(transcript);
          const reply = await generateResponse(transcript);
          speakText(reply);
        }
      });

      deepgramWS.on('error', err => console.error('Deepgram error:', err));
    }

    async function generateResponse(user_input) {
      const payload = {
        model: 'mistralai/mixtral-8x7b',
        messages: [
          { role: 'system', content: 'You are a helpful voice agent.' },
          { role: 'user', content: user_input }
        ]
      };

      const res = await request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouter.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const json = await res.body.json();
      return json.choices?.[0]?.message?.content || '';
    }

    async function speakText(text) {
      const res = await request('https://api.elevenlabs.io/v1/text-to-speech', {
        method: 'POST',
        headers: {
          'xi-api-key': config.elevenlabs.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      });

      const audioBuffer = Buffer.from(await res.body.arrayBuffer());
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: audioBuffer.toString('base64') } }));
    }

    connectDeepgram();

    ws.on('message', msg => {
      const data = JSON.parse(msg);
      if (data.event === 'start') {
        streamSid = data.start.streamSid;
      } else if (data.event === 'media' && dgReady) {
        const audio = Buffer.from(data.media.payload, 'base64');
        if (deepgramWS?.readyState === WebSocket.OPEN) {
          deepgramWS.send(audio);
        }
      } else if (data.event === 'stop') {
        deepgramWS?.close();
        const fullTranscript = transcriptChunks.join(' ');
        const summary = fullTranscript.split('.').slice(0, 2).join('. ') + '.';

        const db = new sqlite3.Database('./db/data.db');
        db.run(
          `UPDATE calls SET transcription = ?, summary = ?, status = 'completed' WHERE call_sid = ?`,
          [fullTranscript, summary, callSid],
          () => db.close()
        );

        request(`http://localhost:${config.server.port}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ CallSid: callSid, transcription: fullTranscript, summary })
        }).catch(console.error);
      }
    });

    ws.on('close', () => {
      if (deepgramWS?.readyState === WebSocket.OPEN) deepgramWS.close();
    });
  });

  done();
};