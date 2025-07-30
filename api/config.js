require('dotenv').config();

const required = [
    'ELEVENLABS_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'BOT_TOKEN',
    'BOT_CHAT_ID',
    'OPENROUTER_API_KEY'
];

for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌ Missing environment variable: ${key}`);
        process.exit(1);
    }
}

module.exports = {
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        phoneNumber: process.env.TWILIO_PHONE_NUMBER
    },
    elevenlabs: {
        apiKey: process.env.ELEVENLABS_API_KEY,
        voiceId: process.env.ELEVENLABS_VOICE_ID
    },
    deepgram: {
        apiKey: process.env.DEEPGRAM_API_KEY

    },
    bot: {
        token: process.env.BOT_TOKEN,
        chatId: process.env.BOT_CHAT_ID
    },
    openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY
    },
    server: {
        port: process.env.PORT || 8000
    },
    setupdone: process.env.SETUP_DONE || 'false'
};