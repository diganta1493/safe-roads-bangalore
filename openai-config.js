/**
 * openai-config.js
 *
 * AI Description Assistant configuration.
 * The OpenAI API key is stored in Firebase Secrets — NOT here.
 * The browser calls /api/suggest (Firebase Hosting rewrite → Cloud Function).
 *
 * Set AI_ENABLED = false to hide the AI button without removing code.
 */

const AI_ENABLED = true;

/* ── Do not edit below this line ── */
window.__AI_ENABLED__ = AI_ENABLED;
