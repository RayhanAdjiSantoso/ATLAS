// Google Reviews (Playwright, local development): sign a Google account in
// to the browser profile the collector uses.
//
//   npm run google-reviews:login            open Chrome, sign in by hand, close it
//   npm run google-reviews:login -- --status  is an account signed in?
//   npm run google-reviews:login -- --logout  delete the profile (signs out here)
//
// The sign-in happens in a normal Chrome window started straight from its
// binary — not driven by Playwright — and the person types their own
// password; this script never sees it. The profile (cookies included) lives
// in GR_PLAYWRIGHT_PROFILE_DIR, by default ~/.atlas/google-maps-profile,
// outside the repository. Anyone with that folder has the session: keep it on
// this machine, never on a server.
//
// --use-mock-keychain: Playwright starts Chrome with it on macOS, so cookies
// written here must use it too or the collector could not read them.

import fs from 'fs';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { isSignedIn, profileDir } from '../src/services/googleReviews/providers/playwright.js';

dotenv.config();

const dir = profileDir();
const arg = process.argv[2];

async function status() {
  if (!fs.existsSync(dir)) return { signedIn: false, why: 'profil belum ada' };
  const { chromium } = await import('playwright');
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: process.env.GR_PLAYWRIGHT_CHANNEL || undefined });
  } catch (err) {
    return { signedIn: null, why: /SingletonLock|ProcessSingleton|already in use/i.test(err.message) ? 'profil sedang dipakai (server ATLAS atau jendela lain masih terbuka)' : err.message.split('\n')[0] };
  }
  try {
    return { signedIn: isSignedIn(await ctx.cookies('https://www.google.com')) };
  } finally {
    await ctx.close();
  }
}

function chromePath() {
  if (process.env.GR_CHROME_PATH) return process.env.GR_CHROME_PATH;
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  }[process.platform] ?? [];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

if (arg === '--status') {
  const s = await status();
  console.log(`Profil: ${dir}`);
  console.log(s.signedIn ? 'Akun Google: sudah login.' : `Akun Google: belum login${s.why ? ` (${s.why})` : ''}.`);
  process.exit(0);
}

if (arg === '--logout') {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Profil dihapus: ${dir}. Sesi Google di ATLAS lokal sudah tidak ada.`);
  process.exit(0);
}

const chrome = chromePath();
if (!chrome) {
  console.error('Google Chrome tidak ditemukan. Pasang Chrome atau set GR_CHROME_PATH ke file program Chrome.');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

console.log(`Profil: ${dir}`);
console.log('Jendela Chrome akan terbuka. Login ke akun Google di sana (disarankan akun terpisah, bukan akun kerja utama),');
console.log('pastikan Google Maps terbuka dalam keadaan login, lalu TUTUP jendela Chrome itu (Cmd+Q) untuk menyimpan sesi.');

const child = spawn(chrome, [
  `--user-data-dir=${dir}`,
  '--use-mock-keychain',
  '--no-first-run',
  '--no-default-browser-check',
  'https://accounts.google.com/ServiceLogin?hl=en&continue=https%3A%2F%2Fwww.google.com%2Fmaps%3Fhl%3Den',
], { stdio: 'ignore' });

// Ten minutes to sign in; after that the window is closed.
const giveUp = setTimeout(() => { console.error('Waktu login habis (10 menit). Jendela ditutup.'); child.kill(); }, 10 * 60_000);
child.on('exit', async () => {
  clearTimeout(giveUp);
  // Chrome may still be writing its cookie file for a moment.
  await new Promise((r) => setTimeout(r, 1500));
  const s = await status();
  console.log(s.signedIn ? 'Berhasil: akun Google tersimpan di profil. ATLAS lokal sekarang membaca Google Maps dalam keadaan login.' : `Belum login${s.why ? ` (${s.why})` : ''}. Jalankan lagi bila perlu.`);
  process.exit(s.signedIn ? 0 : 2);
});
