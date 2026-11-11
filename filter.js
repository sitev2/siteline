// Basic chat swear filter: bad words keep their first letter and the rest becomes stars
// ("f***"). Catches simple tricks like repeated letters, 0/1/3/4/5/$/@ for letters, and
// dots or dashes between letters. Not perfect, just enough for a friendly game.

const WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'shitty', 'bitch', 'bastard', 'asshole', 'arsehole',
  'cunt', 'dick', 'dickhead', 'cock', 'pussy', 'wanker', 'twat', 'prick', 'slut', 'whore', 'bollocks', 'piss', 'crap',
  'damn', 'douche', 'jackass', 'retard', 'fag', 'faggot', 'nigger', 'nigga', 'spastic', 'tosser', 'bellend', 'knob',
];

const LEET = { a: '[a4@]', e: '[e3]', i: '[i1!l|]', o: '[o0]', s: '[s5$]', t: '[t7+]', g: '[g9]', b: '[b8]', l: '[l1|]', c: '[c(k]', u: '[uv]' };
const sep = '[\\s._\\-*]?';
const pattern = WORDS.slice().sort((a, b) => b.length - a.length)
  .map(w => [...w].map(ch => `(?:${LEET[ch] || ch})+`).join(sep))
  .join('|');
// whole words only (so "class", "shitake"-style false hits are rarer), letters may be glued to "s"/"ing"/"ed"
const RE = new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9]|s\\b|es\\b|ed\\b|ing\\b|er\\b|y\\b)`, 'gi');

export function cleanChat(text, max = 100) {
  let s = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  s = s.replace(RE, (m, pre, word) => pre + word[0] + '*'.repeat(Math.max(2, word.length - 1)));
  return s;
}

export const CHAT_LIMIT = { length: 100, count: 3, seconds: 5 };
