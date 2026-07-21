/**
 * openai-config.TEMPLATE.js
 *
 * Copy this file to openai-config.js and paste your real OpenAI API key.
 * openai-config.js is gitignored — your key will never be committed.
 *
 * HOW TO GET YOUR API KEY:
 * ─────────────────────────
 * 1. Go to https://platform.openai.com/api-keys
 * 2. Sign in (or create a free account)
 * 3. Click "Create new secret key"
 * 4. Copy the key (starts with sk-...)
 * 5. Paste it below as apiKey in your local openai-config.js
 *
 * Set AI_ENABLED = false to hide the AI button without removing code.
 */

const AI_ENABLED = true;

const openAIConfig = {
  apiKey: 'YOUR_OPENAI_API_KEY',   // ← paste your real sk-... key in openai-config.js
  model:  'gpt-4o-mini',           // cheap, fast — change to 'gpt-4o' for higher quality
};

/* ── Do not edit below this line ── */
window.__AI_ENABLED__ = AI_ENABLED;
window.__AI_CONFIG__  = openAIConfig;
