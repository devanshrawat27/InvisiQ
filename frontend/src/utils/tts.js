/**
 * Text-to-Speech utility — Web Speech API
 * Uses Indian English voice when available.
 */
export function speakTurn(token, counter, userName) {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const namePhrase = userName ? `${userName}, ` : '';
  const utterance = new SpeechSynthesisUtterance(
    `${namePhrase}Token ${token}, your turn has arrived. Please proceed to ${counter}.`
  );
  utterance.lang = 'en-IN';
  utterance.rate = 0.9;
  utterance.pitch = 1;

  window.speechSynthesis.speak(utterance);
}

export function speakApproaching(userName, position, counter) {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const namePhrase = userName ? `${userName}, ` : '';
  const spotsText = position === 1 ? '1 spot' : `${position} spots`;
  const utterance = new SpeechSynthesisUtterance(
    `${namePhrase}you are almost next. You are only ${spotsText} away in the queue. Please get ready to proceed to ${counter}.`
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

