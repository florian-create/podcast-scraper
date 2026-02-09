const Store = require('electron-store');

const store = new Store({
  name: 'podcast-scraper-config',
  encryptionKey: 'podcast-scraper-v1',
  schema: {
    groq_api_key: { type: 'string', default: '' },
    openai_api_key: { type: 'string', default: '' },
    transcription_provider: { type: 'string', default: 'groq', enum: ['groq', 'openai'] },
    llm_api_key: { type: 'string', default: '' },
    llm_provider: { type: 'string', default: 'groq', enum: ['groq', 'anthropic', 'openai'] },
  },
});

module.exports = { store };
