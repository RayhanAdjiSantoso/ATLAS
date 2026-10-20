// Code-based sentiment › the word lists.
//
// Written for ATLAS (not copied from a third-party lexicon, so there is no
// licence to track): the words customers actually use in Google reviews of
// Indonesian businesses, in Indonesian, English and everyday slang. Weights
// run from 0.5 (faint) to 3 (strong); the sign is the direction.
//
// Words are matched AFTER normalisation (textAnalytics normaliseToken: lower
// case, slang folded — "gak/nggak/tdk" -> "tidak", "bgt" -> "banget",
// "bagussss" -> "bagus", "ramah-ramah" -> "ramah").

import { _internals } from '../textAnalytics.js';

// Phrases go through the same normalisation as review text, or "never
// again" (read as "not again") would never match.
const { normaliseToken } = _internals;

export const ENGINE_VERSION = 'code-1.1.0';

// Entries written with "_" ("luar_biasa") are phrases; they are moved to
// PHRASES below, since a single token never contains "_".
const joined = [];
const words = (weight, list) => Object.fromEntries(list.trim().split(/\s+/).flatMap((w) => {
  if (w.includes('_')) { joined.push([w.replace(/_/g, ' '), weight]); return []; }
  return [[w, weight]];
}));

export const TERMS = {
  // ── positive, Indonesian ──
  ...words(3, 'terbaik mantap mantul juara top memuaskan sempurna luar_biasa keren_banget favorit'),
  ...words(2.5, 'puas recommended rekomendasi direkomendasikan merekomendasikan sukses profesional profesional handal ahli berpengalaman teliti telaten'),
  ...words(2, 'bagus baik ramah nyaman bersih rapi enak lezat cepat sigap tanggap informatif sabar sopan helpful membantu senang suka cocok worth terjangkau kece cantik indah asri sejuk adem wangi glowing mulus cerah halus kenyal homey cozy recommend gercep responsif detail jelas komunikatif friendly hangat'),
  ...words(1.5, 'oke ok baik-baik aman murah strategis luas rileks relax santai menyenangkan berhasil efektif ampuh lancar tepat praktis'),
  ...words(1, 'lumayan cukup terima_kasih thanks makasih'),
  // ── negative, Indonesian ──
  ...words(-3, 'kecewa mengecewakan parah kapok zonk buruk terburuk jelek menyesal nyesel penipuan tipu nipu bohong rugi'),
  ...words(-2.5, 'kasar jutek judes ketus sombong cuek galak menyebalkan nyebelin kotor jorok bau pusing gatal iritasi breakout jerawatan'),
  ...words(-2, 'lambat lelet lemot mahal kemahalan lama antri antre ribet repot bingung berantakan sempit panas pengap berisik ramai rusak gagal salah lupa telat terlambat males malas mengganggu sakit perih'),
  ...words(-1.5, 'kurang_ramah kurang_bersih kurang_nyaman sayang sayangnya kesal sebel kurang_jelas'),
  ...words(-1, 'menunggu nunggu biasa_aja'),
  // ── positive, English ──
  ...words(3, 'excellent amazing awesome outstanding perfect fantastic wonderful best superb exceptional'),
  ...words(2.5, 'great love loved favorite favourite fav satisfied professional recommended highly_recommended impressive brilliant'),
  ...words(2, 'good nice friendly comfortable clean helpful kind polite fast quick efficient pleasant lovely beautiful cozy comfy relaxing relaxed informative attentive thorough responsive affordable reasonable happy glad enjoy enjoyed calm calming smooth worth'),
  ...words(1.5, 'fine okay decent neat tidy fresh'),
  // ── negative, English ──
  ...words(-3, 'terrible horrible awful worst disappointed dissapointed disapointed disappointing disgusting scam useless pathetic'),
  ...words(-2.5, 'rude unfriendly dirty bad poor unprofessional arrogant smelly'),
  ...words(-2, 'slow expensive overpriced pricey wait waiting late delay delayed crowded noisy messy confusing broken wrong forgot painful annoying problem issue'),
  ...words(-1, 'mediocre average meh'),
};

// Several words that mean something together. Matched on the token stream
// before single words; "_" joins the words of an entry above too.
export const PHRASES = [
  ['highly recommended', 3], ['highly recommend', 3], ['strongly recommend', 3], ['must try', 2.5], ['must visit', 2.5],
  ['worth it', 2.5], ['worth the price', 2.5], ['value for money', 2.5], ['love it', 3], ['will come back', 2.5],
  ['come back again', 2.5], ['coming back', 2], ['will be back', 2.5], ['no complaints', 2], ['nothing to complain', 2],
  ['waste of money', -3], ['waste of time', -3], ['never again', -3], ['not worth', -2.5], ['rip off', -3], ['long wait', -2],
  ['too long', -2], ['too expensive', -2.5], ['the best', 3],
  ['luar biasa', 3], ['top banget', 3], ['mantap jiwa', 3], ['juara banget', 3], ['balik lagi', 2.5], ['datang lagi', 2],
  ['ke sini lagi', 2], ['kesini lagi', 2], ['akan kembali', 2.5], ['bakal balik', 2.5], ['bakal ke sini', 2], ['langganan', 1.5],
  ['tidak ada keluhan', 2.5], ['tidak menyesal', 2.5], ['tidak nyesel', 2.5], ['tidak kecewa', 2.5], ['tidak akan kembali', -3],
  ['tidak sesuai harapan', -3], ['tidak sesuai', -2], ['tidak recommended', -3], ['tidak rekomen', -3], ['buang waktu', -3],
  ['buang uang', -3], ['buang duit', -3], ['harus menunggu', -1.5], ['nunggu lama', -2.5], ['menunggu lama', -2.5],
  ['antri lama', -2.5], ['waktu tunggu', -0.5], ['slow response', -2.5], ['slow respon', -2.5], ['fast response', 2],
  ['fast respon', 2], ['respon cepat', 2], ['respon lambat', -2.5], ['terima kasih', 1], ['biasa saja', -0.5], ['biasa aja', -0.5],
  ['naik darah', -2.5], ['tidak worth', -2.5], ['kurang worth', -2],
  // "tidak sabar" = can't wait (eager), not impatience.
  ['tidak sabar', 1.5], ['ga sabar', 1.5],
  // "lama" is usually the wait, but not here.
  ['sudah lama', 0.5], ['dari lama', 0.5], ['lama langganan', 1.5], ['tidak lama', 1.5], ['ga lama', 1.5],
  ...joined,
].map(([p, w]) => [p.split(' ').map((word) => normaliseToken(word) || word).join(' ').split(' '), w]);

// Words that turn the next sentiment word around ("tidak ramah",
// "not friendly"). "kurang" flips and softens ("kurang bersih").
export const NEGATORS = new Map([
  ['tidak', 1], ['bukan', 1], ['belum', 0.9], ['jangan', 1], ['tanpa', 0.9], ['kurang', 0.8],
  ['not', 1], ['never', 1], ['no', 1], ['without', 0.9], ['nothing', 0.9], ['hardly', 0.8], ['barely', 0.8],
]);

// Before a word ("sangat ramah", "really nice") or after it ("ramah banget",
// "bersih sekali", "lama parah").
export const BOOSTERS_BEFORE = new Map([
  ['sangat', 1.5], ['amat', 1.4], ['sungguh', 1.4], ['benar', 1.3], ['super', 1.5], ['paling', 1.5], ['terlalu', 1.4], ['begitu', 1.3],
  ['very', 1.5], ['really', 1.4], ['extremely', 1.7], ['so', 1.3], ['totally', 1.4], ['highly', 1.5], ['incredibly', 1.6], ['truly', 1.3],
  ['absolutely', 1.5], ['too', 1.4], ['pretty', 1.2], ['quite', 1.1],
]);
export const BOOSTERS_AFTER = new Map([
  ['banget', 1.5], ['sekali', 1.5], ['parah', 1.6], ['pol', 1.5], ['abis', 1.4], ['bener', 1.3], ['benar', 1.3], ['nian', 1.3],
]);
export const DAMPENERS = new Map([
  ['agak', 0.6], ['sedikit', 0.6], ['lumayan', 0.7], ['cukup', 0.8], ['slightly', 0.6], ['somewhat', 0.6], ['kinda', 0.6], ['bit', 0.6],
  ['rather', 0.7], ['fairly', 0.8],
]);
// "not bad at all" / "tidak buruk sama sekali": the negated word counts more.
export const EMPHATIC_TAIL = [['at', 'all'], ['sama', 'sekali']];

// The words after these carry the point of the sentence ("bagus, tapi
// antri lama" is mostly about the wait).
export const CONTRAST = new Set(['tapi', 'tetapi', 'namun', 'sayangnya', 'padahal', 'but', 'however', 'though', 'yet']);
// A clause opened by these concedes something the rest outweighs.
export const CONCESSIVE = new Set(['meskipun', 'walaupun', 'walau', 'meski', 'biarpun', 'although', 'despite']);

export const EMOJI = [
  [/[😍🥰😊😁😄😃🤩👍👏💯✨🙌❤💕💖💗💓💞🤍💙💚💜🧡🥳😘☺]/u, 2],
  [/[😂🤣]/u, 0], // laughter is too ambiguous to count
  [/[😡😠🤬👎😤😞😢😭😒😩😫🙄💔🤮😓]/u, -2],
];

// Function words, to tell the language of a review.
export const LANGUAGE_HINTS = {
  id: new Set('yang dan di ini itu untuk dengan saya tidak sangat banget juga sudah ada dari ke karena tapi aja sih nya kami kita mereka bisa akan lagi sekali buat sama'.split(' ')),
  en: new Set('the and is was very to of with my it this that for in are were have had will not but so we they you just really great good'.split(' ')),
};
