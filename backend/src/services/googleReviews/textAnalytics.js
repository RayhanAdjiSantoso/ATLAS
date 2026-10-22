// Google Reviews › the words customers use.
//
// Turns review text into the terms the word cloud and the explorer's term
// filter share: lowercase, slang folded to one spelling, stopwords (Indonesian
// and English) and filler dropped, names left out, then 1–3 word phrases.
// A term is counted once per review (document frequency): "ramah" written
// three times in one review is still one customer saying it.
//
// Phrases never cross punctuation — "parkir susah. dokter ramah" must not
// produce "susah dokter". Within a clause, dropped words close up, so
// "pelayanan yang sangat ramah" reads as "pelayanan ramah".

// Folded before anything else; the right side is what the cloud shows.
const SLANG = {
  yg: 'yang', dg: 'dengan', dgn: 'dengan', utk: 'untuk', untk: 'untuk', krn: 'karena', karna: 'karena',
  tdk: 'tidak', gak: 'tidak', ga: 'tidak', gk: 'tidak', nggak: 'tidak', ngga: 'tidak', enggak: 'tidak', engga: 'tidak', g: 'tidak', tak: 'tidak',
  bgt: 'banget', bngt: 'banget', bener: 'benar', bnr: 'benar', sy: 'saya', aku: 'saya', gw: 'saya', gue: 'saya',
  jg: 'juga', jga: 'juga', aja: 'saja', aj: 'saja', sdh: 'sudah', udh: 'sudah', udah: 'sudah', dah: 'sudah',
  blm: 'belum', blum: 'belum', tp: 'tapi', tpi: 'tapi', trs: 'terus', trus: 'terus', bs: 'bisa', bsa: 'bisa',
  lg: 'lagi', lgi: 'lagi', dr: 'dokter', dok: 'dokter', drg: 'dokter', sm: 'sama', sma: 'sama', kalo: 'kalau', klo: 'kalau', kl: 'kalau',
  bkn: 'bukan', dpt: 'dapat', dapet: 'dapat', tmpt: 'tempat', tmp: 'tempat', pelayananya: 'pelayanannya',
  bagu: 'bagus', bgs: 'bagus', mantap: 'mantap', mantab: 'mantap', mantul: 'mantap', recommended: 'recommended', recomended: 'recommended',
  rekomen: 'recommended', rekomended: 'recommended', recommend: 'recommended', reccomend: 'recommended', recomend: 'recommended',
  thx: 'thanks', makasih: 'thanks', mksh: 'thanks', trims: 'thanks', terimakasih: 'thanks',
  staf: 'staff', staffnya: 'staff', stafnya: 'staff', pelayanannya: 'pelayanan', layanan: 'pelayanan', service: 'service',
  harganya: 'harga', tempatnya: 'tempat', dokternya: 'dokter', ruangannya: 'ruangan', hasilnya: 'hasil', treatmentnya: 'treatment',
  parkirnya: 'parkir', antriannya: 'antrian', antrean: 'antrian', antri: 'antri', ngantri: 'antri', ngantre: 'antri', antre: 'antri',
  'n': 'and', u: 'you', ur: 'your', pls: 'please', plz: 'please', govt: 'government',
  "don't": 'not', dont: 'not', "doesn't": 'not', doesnt: 'not', "didn't": 'not', didnt: 'not', "isn't": 'not', isnt: 'not',
  "wasn't": 'not', wasnt: 'not', "won't": 'not', wont: 'not', "can't": 'not', cant: 'not', "couldn't": 'not', never: 'not', no: 'not',
};

// Negations survive inside phrases ("tidak ramah", "not friendly") but are
// never a term on their own.
const NEGATIONS = new Set(['tidak', 'belum', 'kurang', 'bukan', 'not']);

const STOP_ID = `ada adalah adanya agak agar akan akhirnya aku akulah amat amatlah anda andalah antar antara apa apaan apabila apakah apalagi atas atau ataukah ataupun awal bagai bagaikan bagaimana bagi bahkan bahwa bahwasanya bakal banget banyak bapak baru bawah beberapa begini beginian begitu begitulah belakang beliau benar berada berakhir berapa berarti berbagai berikut berikutnya bermacam bersama betul biasa biasanya bila bilamana bisa boleh buat bukankah bulan cara cukup cuma dahulu dalam dan dapat dari daripada datang demi demikian dengan depan di dia diantara diri dirinya disana disini dong dulu enggaknya entah guna hal hampir hanya hari harus hingga ia ialah ibu ini inilah itu itulah jadi jika jikalau juga jumlah justru kak kakak kala kalau kali kalian kami kamu kan kapan karena kasih ke kebetulan kedua keluar kembali kemudian kenapa kepada ketika khususnya kini kita kok lagi lah lain lainnya lalu lebih lewat loh lumayan maka makin malah mampu mana masa masih mau maupun melalui memang mengenai menjadi menurut mereka merupakan mungkin nah naik namun nanti nya oleh pada padahal paling para pasti per pernah pula pun punya saat saja saling sama sambil sampai sana sangat satu saya se sebab sebagai sebelum sebelumnya sebenarnya secara sedang sedikit segala sehingga sejak sekali sekarang sekitar selalu selama seluruh semua semoga sendiri seperti sering serta sesuai setelah setiap siapa sih sini situ suatu sudah supaya tadi tahu tahun tapi telah tentang tentu terhadap terlalu termasuk tersebut terus tetap tetapi tiap toh untuk wah walau walaupun ya yaitu yakni yang ok oke okey okay terima deh dong sih kok kak ka mba mbak mas bu pak bang sus suster om tante ibu bapak kah pun tuh nih aja doang emang emg sangatlah begitupun juga banget bgtt pokoknya overall sekalian kesini kesana kemari datang dateng ke-2 kedua kali pertama kedua`;
const STOP_EN = `a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself nor of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also really much many get got go went one two lot lots thing things even still well definitely highly totally truly absolutely quite pretty super always every everything everyone`;
// Words every review of any business carries; they tell nothing apart.
const FILLER = `review ulasan google maps bintang star stars tempat place klinik clinic toko store shop recommended recommend recomended thanks terima kasih thank you sukses success semoga moga next time lagi kesini datang visit visited came come again pokoknya overall best good nice great bagus baik mantap oke ok okay keren top terbaik love like suka puas satisfied`;

const toSet = (s) => new Set(s.split(/\s+/).filter(Boolean));
const STOP = new Set([...toSet(STOP_ID), ...toSet(STOP_EN)]);
// Filler is fine inside a phrase ("tempat nyaman", "hasil bagus") but too
// general to stand alone.
const FILLER_SET = toSet(FILLER);

// A capitalised word right after one of these is a person's name; it is
// dropped along with the title (staff names are personal data).
const HONORIFICS = new Set(['dr', 'dok', 'dokter', 'drg', 'kak', 'ka', 'mba', 'mbak', 'mas', 'bu', 'ibu', 'pak', 'bapak', 'sus', 'suster', 'ners', 'ms', 'mr', 'mrs', 'miss', 'sir', 'madam', 'bang', 'teh', 'aa', 'om', 'tante', 'coach']);

const CLAUSE_SPLIT = /[.!?,;:()\[\]{}"“”\n\r\t…|/\\]+|\s[-–—]\s/;
const TOKEN = /[\p{L}\p{N}'’-]+/gu;

function normaliseToken(raw) {
  let t = raw.toLowerCase().replace(/[’]/g, "'").replace(/^[-']+|[-']+$/g, '');
  // Indonesian reduplication "ramah-ramah" → "ramah"; "kupu-kupu" too, at no loss.
  const dup = t.match(/^([\p{L}]+)-\1$/u);
  if (dup) t = dup[1];
  // Stretched letters: "bagussss" → "bagus", "mantappp" → "mantap".
  t = t.replace(/(\p{L})\1{2,}/gu, '$1');
  if (SLANG[t] !== undefined) t = SLANG[t];
  return t;
}

// Tokens of names to keep out of the cloud: the business's own name (every
// review says it) and its reviewers' names.
export function buildExclusions({ businessName = '', reviewerNames = [] } = {}) {
  const out = new Set();
  const add = (s) => {
    for (const m of String(s || '').matchAll(TOKEN)) {
      const t = normaliseToken(m[0]);
      if (t.length >= 3 && !NEGATIONS.has(t)) out.add(t);
    }
  };
  add(businessName);
  for (const n of reviewerNames) add(n);
  return out;
}

// Clauses of kept tokens. Each clause is an array; phrases are built within it.
export function tokenizeReview(text, exclusions = new Set()) {
  if (!text) return [];
  const cleaned = String(text)
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\(translated by google\)[\s\S]*?\(original\)/i, ' ')
    .replace(/\(original\)/i, ' ');
  const clauses = [];
  // "dr. Sarah" arrives as two clauses ("dr" | "Sarah …"), "dokter Sarah" as
  // one; either way the capitalised name after a title is dropped and the
  // title kept.
  let afterTitle = false;
  for (const part of cleaned.split(CLAUSE_SPLIT)) {
    const raws = part.match(TOKEN) || [];
    const kept = [];
    // gaps[i]: a word was dropped right before kept[i]. A pair may close
    // over one ("pelayanan yang ramah" → "pelayanan ramah"); a three-word
    // phrase may not ("harga mahal untuk hasil" is not "harga mahal hasil").
    const gaps = [];
    let gap = false;
    for (let i = 0; i < raws.length; i += 1) {
      const raw = raws[i];
      const isName = afterTitle && /^\p{Lu}/u.test(raw);
      afterTitle = HONORIFICS.has(raw.toLowerCase());
      if (isName) continue;
      const t = normaliseToken(raw);
      if (!t || /^\d+$/.test(t) || t.length < 2 || STOP.has(t) || exclusions.has(t)) { gap = true; continue; }
      kept.push(t);
      gaps.push(gap);
      gap = false;
    }
    if (!raws.length) afterTitle = false;
    kept.gaps = gaps;
    if (kept.length) clauses.push(kept);
  }
  return clauses;
}

const isStandalone = (t) => !NEGATIONS.has(t) && !FILLER_SET.has(t) && t.length >= 3;

// Every distinct term (1–3 words) in one review.
export function reviewTerms(text, exclusions) {
  const terms = new Set();
  for (const clause of tokenizeReview(text, exclusions)) {
    for (let i = 0; i < clause.length; i += 1) {
      if (isStandalone(clause[i])) terms.add(clause[i]);
      for (const n of [2, 3]) {
        const gram = clause.slice(i, i + n);
        if (gram.length < n) continue;
        if (n === 3 && (clause.gaps[i + 1] || clause.gaps[i + 2])) continue;
        // A phrase may start with a negation, never end with one, and must
        // carry at least one word that is not filler.
        if (NEGATIONS.has(gram.at(-1))) continue;
        if (new Set(gram).size < gram.length) continue;
        if (gram.every((w) => FILLER_SET.has(w) || NEGATIONS.has(w))) continue;
        terms.add(gram.join(' '));
      }
    }
  }
  return terms;
}

// The cloud: terms by how many reviews use them, with each term's sentiment
// split for the tooltip. `reviews`: [{ id, text, sentiment }].
export function buildWordCloud(reviews, { exclusions, limit = 60 } = {}) {
  const stats = new Map(); // term -> { df, positive, neutral, negative }
  for (const r of reviews) {
    for (const term of reviewTerms(r.text, exclusions)) {
      const s = stats.get(term) ?? { df: 0, positive: 0, neutral: 0, negative: 0 };
      s.df += 1;
      if (s[r.sentiment] !== undefined) s[r.sentiment] += 1;
      stats.set(term, s);
    }
  }
  // One mention is anecdote, not language customers share — unless the set
  // is so small that nothing repeats.
  const minDf = reviews.length >= 20 ? 2 : 1;
  const candidates = [...stats.entries()].filter(([, s]) => s.df >= minDf);
  const dfOf = new Map(candidates.map(([t, s]) => [t, s.df]));

  // A word that almost always appears inside one longer phrase is shown as
  // that phrase only: "ramah" (12) under "pelayanan ramah" (10) adds nothing.
  const subsumed = new Set();
  for (const [term, s] of candidates) {
    const words = term.split(' ');
    if (words.length === 1) continue;
    const parts = words.length === 2 ? words : [words.slice(0, 2).join(' '), words.slice(1).join(' '), ...words];
    for (const p of parts) {
      const pdf = dfOf.get(p);
      if (pdf && s.df >= 0.7 * pdf) subsumed.add(p);
    }
  }

  const weight = (term, df) => df * (1 + 0.15 * (term.split(' ').length - 1));
  return candidates
    .filter(([t]) => !subsumed.has(t))
    .sort((a, b) => weight(b[0], b[1].df) - weight(a[0], a[1].df) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, s]) => ({ term, count: s.df, positive: s.positive, neutral: s.neutral, negative: s.negative }));
}

export const _internals = { normaliseToken, STOP, FILLER_SET, NEGATIONS };
