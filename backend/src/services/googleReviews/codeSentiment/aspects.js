// Code-based sentiment › what a review talks about.
//
// A fixed set of aspects common to service businesses, each recognised by
// its words in Indonesian and English. A topic only reaches the dashboard
// when reviews actually mention it (topicStats drops the empty ones), so a
// clinic shows "Dokter & Tenaga Ahli" and a café "Rasa & Menu" without
// configuring anything. The label is what reviews are tagged with; the
// topic name is what the page shows.

export const ASPECTS = [
  { label: 'pelayanan', topic: 'Kualitas Pelayanan', words: 'pelayanan layanan service servis dilayani melayani pelayanannya hospitality' },
  { label: 'staf', topic: 'Keramahan & Sikap Staf', words: 'staff staf karyawan pegawai resepsionis receptionist kasir terapis therapist beautician perawat suster nurse crew waiter waitress pelayan frontliner team tim' },
  { label: 'dokter', topic: 'Dokter & Tenaga Ahli', words: 'dokter doctor dermatologist dokternya konsultasi consultation ahli expert spesialis' },
  { label: 'hasil', topic: 'Hasil & Kualitas Treatment/Produk', words: 'hasil hasilnya result results treatment perawatan facial produk product kualitas quality efek glowing kulit skin' },
  { label: 'harga', topic: 'Harga & Value', words: 'harga harganya price prices mahal murah biaya tarif worth terjangkau expensive cheap pricey value overpriced kemahalan promo diskon' },
  { label: 'waktu tunggu', topic: 'Kecepatan & Waktu Tunggu', words: 'antri antre antrian antrean nunggu menunggu tunggu waiting wait queue lambat lelet lemot slow cepat fast quick telat terlambat late' },
  { label: 'kebersihan', topic: 'Kebersihan', words: 'bersih kotor clean dirty hygiene higienis steril jorok rapi' },
  { label: 'tempat', topic: 'Tempat & Suasana', words: 'tempat tempatnya place ruangan ruang room suasana ambience ambiance atmosphere interior nyaman comfortable cozy comfy homey sejuk adem pengap' },
  { label: 'lokasi & parkir', topic: 'Lokasi & Parkir', words: 'lokasi location parkir parking parkiran akses strategis' },
  { label: 'reservasi', topic: 'Reservasi & Komunikasi', words: 'booking reservasi reservation jadwal appointment janji whatsapp respon response respons chat admin dihubungi' },
  { label: 'makanan', topic: 'Rasa & Menu', words: 'makanan food rasa rasanya taste menu minuman drink drinks porsi portion enak delicious lezat kopi coffee' },
].map((a) => ({ ...a, set: new Set(a.words.split(' ')) }));

const BY_WORD = new Map();
for (const a of ASPECTS) for (const w of a.set) if (!BY_WORD.has(w)) BY_WORD.set(w, a);

export function aspectOf(token) {
  return BY_WORD.get(token) ?? null;
}

// The code engine's topics, in the same shape the AI's summary gives
// (name + member aspect labels), so topicStats counts both alike.
export const CODE_TOPICS = ASPECTS.map((a) => ({ name: a.topic, aspects: [a.label], insight: '' }));
