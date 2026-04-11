/**
 * Claude AI Wrapper — callClaude()
 * ---------------------------------
 * Supports MOCK_MODE for demo-safe offline fallback.
 * Uses claude-sonnet-4-20250514 via Anthropic Messages API.
 *
 * Usage:
 *   const result = await callClaude(prompt, mockFallbackObject);
 */

const MOCK_MODE = process.env.MOCK_MODE === 'true';

/**
 * Call Claude API or return mock response.
 * @param {string} prompt — The system/user prompt to send
 * @param {object} mockResponse — Fallback object returned in MOCK_MODE
 * @returns {object} Parsed JSON response from Claude
 */
async function callClaude(prompt, mockResponse) {
  // ── Mock Mode ───────────────────────────────────────────────────
  if (MOCK_MODE) {
    // Simulate realistic API latency (400–800ms)
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    console.log('🤖 [MOCK] Claude call resolved with mock response');
    return mockResponse;
  }

  // ── Live Mode ───────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set — falling back to mock');
    return mockResponse;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`❌ Claude API error (${response.status}):`, errBody);
      console.warn('⚠️  Falling back to mock response');
      return mockResponse;
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Strip any markdown code fences Claude might add
    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ Claude API call failed:', err.message);
    console.warn('⚠️  Falling back to mock response');
    return mockResponse;
  }
}

module.exports = { callClaude, MOCK_MODE };
