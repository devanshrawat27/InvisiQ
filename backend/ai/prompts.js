/**
 * AI Prompt Templates
 * --------------------
 * All 4 Gemini API prompt functions live here.
 * These are the EXACT templates from the handoff document.
 *
 *   1. intentPrompt     — Intent Classifier (on join)
 *   2. waitPrompt       — Wait Predictor (on join + every 10 min)
 *   3. sentimentPrompt  — Sentiment Flash Message Generator (system-triggered)
 *   4. briefingPrompt   — Daily Briefing Generator (nightly cron)
 */

/**
 * AI Call #1 — Intent Classifier
 * Classifies free-text visit reason into one of 7 categories.
 * Handles English, Hindi, Hinglish.
 */
const intentPrompt = (reason, queueType, calendar) => `
You are an AI assistant for a college queue system in India.
Queue type: ${queueType}
Today's academic calendar context: ${JSON.stringify(calendar)}
Student visit reason (may be English, Hindi, or mixed): "${reason}"
Classify this reason. Return ONLY a valid JSON object, no preamble, no markdown:
{
  "category": "fee_payment" | "bonafide_cert" | "tc_mc_request" | "scholarship" | "admission" | "exam_query" | "general",
  "urgency": "low" | "medium" | "high" | "critical",
  "counter_type": "cashier" | "document" | "information" | "fast_track",
  "est_service_minutes": <number>,
  "details": "<one-line summary for admin screen>"
}
`;

/**
 * AI Call #2 — Wait Predictor
 * Predicts wait time with confidence interval.
 * Accounts for service type, time of day, calendar events.
 */
const waitPrompt = (data) => `
You are an AI wait time predictor for a college queue in India.
Current queue state: ${JSON.stringify(data)}
// data shape: { people_ahead, service_type, avg_service_time_historical,
// time_of_day, day_of_week, is_fee_deadline_today, is_exam_result_day,
// current_counter_count, surge_active }
Historical service times: fee_payment=9min, bonafide=3min, tc_mc=18min,
scholarship=12min, admission=14min, exam_query=5min, general=7min.
Return ONLY a JSON object:
{
  "wait_minutes": <median estimate>,
  "lower_bound": <optimistic>,
  "upper_bound": <pessimistic>,
  "confidence": <0-100>,
  "reason": "<one sentence for display>"
}
`;

/**
 * AI Call #3 — Sentiment Flash Message Generator (UPDATED)
 * Triggered automatically by system based on AI monitor scores.
 * Student does NOT type anything.
 */
const sentimentPrompt = (context) => `
You are an empathetic AI assistant for a college queue system.
Student name: ${context.name}
Current position: #${context.position} (${context.wait_remaining} min remaining)
Queue: ${context.queue_name}
Bail probability score: ${context.bail_probability}/100
Wait exceeded by: ${context.wait_exceeded_percent}%
Generate a reassuring flash alert message for this student.
Return ONLY a JSON object:
{
  "frustration_level": <1-5>,
  "flash_message": "<personalised reassuring message using student name and current position, max 2 sentences>",
  "admin_alert": <true if level >= 4>
}
`;

/**
 * AI Call #4 — Daily Briefing Generator
 * Generates a 5-point operational briefing from yesterday's data.
 */
const briefingPrompt = (data) => `
You are an operational AI advisor for a college office queue system.
Here is yesterday's complete queue data for ${data.queue_name}:
${JSON.stringify(data)}
// data shape: { date, total_served, avg_wait_actual, avg_wait_predicted,
// accuracy_percent, peak_hour, no_show_count, top_intents[],
// surge_count, upcoming_calendar_events[] }
Generate a 5-point operational briefing for the admin. Return ONLY a JSON object:
{
  "expected_peak": "<string>",
  "staff_recommendation": "<string>",
  "top_intents": ["<intent 1>", "<intent 2>", "<intent 3>"],
  "efficiency_score": <0-100>,
  "actionable_tip": "<one specific action admin should take today>"
}
`;

module.exports = { intentPrompt, waitPrompt, sentimentPrompt, briefingPrompt };
