/**
 * Gemini AI Wrapper — callGemini()
 * ----------------------------------
 * Supports MOCK_MODE for demo-safe offline fallback.
 * Uses Google Gemini 2.0 Flash via REST API.
 *
 * Usage:
 *   const result = await callGemini(prompt, mockFallbackObject);
 */

const MOCK_MODE = process.env.MOCK_MODE === 'true';

/**
 * Call Gemini API or return mock response.
 * @param {string} prompt — The prompt to send
 * @param {object} mockResponse — Fallback object returned in MOCK_MODE
 * @returns {object} Parsed JSON response from Gemini
 */
async function callGemini(prompt, mockResponse) {
  // ── Mock Mode ───────────────────────────────────────────────────
  if (MOCK_MODE) {
    // Simulate realistic API latency (400–800ms)
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    console.log('🤖 [MOCK] Gemini call resolved with mock response');
    return mockResponse;
  }

  // ── Live Mode ───────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not set — falling back to mock');
    return mockResponse;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1000,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`❌ Gemini API error (${response.status}):`, errBody);
      console.warn('⚠️  Falling back to mock response');
      return mockResponse;
    }

    const data = await response.json();

    // Extract text from Gemini response structure
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.error('❌ Gemini returned empty response');
      console.warn('⚠️  Falling back to mock response');
      return mockResponse;
    }

    // Strip any markdown code fences Gemini might add
    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ Gemini API call failed:', err.message);
    console.warn('⚠️  Falling back to mock response');
    return mockResponse;
  }
}

module.exports = { callGemini, MOCK_MODE };
