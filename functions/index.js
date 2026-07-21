const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

/* OpenAI API key stored as a Firebase secret — never in source code */
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

/**
 * openaiProxy — HTTPS Cloud Function
 *
 * Called by the browser at /api/suggest via Firebase Hosting rewrite.
 * Accepts: POST { issueType, severity, address }
 * Returns: { text }
 */
exports.openaiProxy = onRequest(
  {
    region: 'us-central1',
    cors: true,
    secrets: [OPENAI_API_KEY],
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { issueType, severity, address } = req.body;
    if (!issueType || !severity) {
      res.status(400).json({ error: 'issueType and severity are required' });
      return;
    }

    try {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY.value()}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 100,
          messages: [
            {
              role: 'system',
              content: 'You are a civic issue reporting assistant for Bangalore, India. Write concise, factual road issue descriptions in 1–2 sentences. No preamble, no quotes, no bullet points.',
            },
            {
              role: 'user',
              content: `Write a description for a road issue report:\n- Issue type: ${issueType}\n- Severity: ${severity}\n- Location: ${address || 'Bangalore'}`,
            },
          ],
        }),
      });

      if (!openaiRes.ok) {
        const err = await openaiRes.json().catch(() => ({}));
        const msg = err.error?.message || `HTTP ${openaiRes.status}`;
        console.error('[openaiProxy] OpenAI error:', msg);
        res.status(openaiRes.status).json({ error: msg });
        return;
      }

      const data = await openaiRes.json();
      const text = data.choices?.[0]?.message?.content?.trim() || '';
      res.json({ text });
    } catch (err) {
      console.error('[openaiProxy] Fetch error:', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);
