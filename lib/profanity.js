// Handle moderation for the public leaderboard.
// The board carries the GIO/ brand, so handles get a light profanity / slur
// pass before they go public. This is a deterrent, not a guarantee - it
// normalises common leetspeak and separators, then matches a banned-substring
// list. Pair it with the admin delete path in the endpoint for anything that
// slips through.

// Base list kept deliberately small and high-signal: slurs and the hard
// profanity you don't want under a brand mark. Extend via BLOCK_EXTRA env
// (comma-separated) without touching code.
const BASE_BLOCKLIST = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'spic', 'chink',
  'cunt', 'whore', 'rape', 'rapist', 'nazi', 'hitler', 'kkk', 'paedo',
  'pedo', 'pedophile', 'molest', 'fuck', 'shit', 'bitch', 'dick', 'cock',
  'pussy', 'asshole', 'bastard', 'wank', 'twat', 'slut', 'jizz', 'cum'
];

// Leetspeak / homoglyph folding so "f4gg0t" or "n1gger" still match.
const LEET = {
  '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a',
  '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '+': 't'
};

function normalise(input) {
  let s = String(input || '').toLowerCase();
  s = s.replace(/[0134@!5$789+]/g, (c) => LEET[c] || c);
  // strip anything that isn't a-z so separators (spaces, dots, underscores,
  // zero-width chars) can't be used to break up a banned word
  s = s.replace(/[^a-z]/g, '');
  // collapse runs of the same letter ("niiigger" -> "niger" won't match, but
  // "niigger" -> "nigger" will); keep it conservative at runs of 2+
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return s;
}

function buildList() {
  const extra = (process.env.BLOCK_EXTRA || '')
    .split(',')
    .map((w) => normalise(w))
    .filter(Boolean);
  return [...new Set([...BASE_BLOCKLIST.map(normalise), ...extra])].filter(Boolean);
}

// Returns true if the handle should be blocked.
function isProfane(handle) {
  const folded = normalise(handle);
  if (!folded) return false;
  const list = buildList();
  return list.some((bad) => folded.includes(bad));
}

module.exports = { isProfane, normalise };
