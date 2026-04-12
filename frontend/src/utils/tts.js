/**
 * Text-to-Speech utility — Web Speech API
 * Uses Indian English voice when available.
 */
export function speakTurn(token, counter) {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(
    `Token ${token}, your turn has arrived. Please proceed to ${counter}.`
  );
  utterance.lang = 'en-IN';
  utterance.rate = 0.9;
  utterance.pitch = 1;

  window.speechSynthesis.speak(utterance);
}

export function speakAdmin(token, counter) {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(
    `${counter} is now serving token ${token}.`
  );
  utterance.lang = 'en-IN';
  utterance.rate = 0.9;
  utterance.pitch = 1;

  window.speechSynthesis.speak(utterance);
}
