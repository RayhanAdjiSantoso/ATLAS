import { findCol } from './columns';
import type { SheetRow } from './types';

// ══════════════════════════════════════════════════════
// FILE UPLOAD VALIDATION
// Runs before any parsing starts — rejects bad input early with a clear
// message instead of letting it fail deep inside a parser.
//
// Ported from the original alert()-based validateFileBasics/requireColumns:
// these return a result object instead of alerting directly, so the UI layer
// (which owns how errors are surfaced) decides what to do with the message.
// ══════════════════════════════════════════════════════

export const MAX_FILE_SIZE_MB = 20;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function validateFileBasics(
  file: { name: string; size: number },
  allowedExts: string[],
): ValidationResult {
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!allowedExts.includes(ext)) {
    return {
      ok: false,
      message: `Format file "${ext || '(tanpa ekstensi)'}" tidak didukung. Gunakan salah satu: ${allowedExts.join(', ')}`,
    };
  }
  if (file.size === 0) {
    return { ok: false, message: 'File kosong (0 byte). Pilih file lain.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: `Ukuran file ${(file.size / 1024 / 1024).toFixed(1)}MB melebihi batas maksimum ${MAX_FILE_SIZE_MB}MB.`,
    };
  }
  return { ok: true };
}

export interface ColumnRequirement {
  label: string;
  kw: string[];
}

// Checks presence only (via the same substring match used elsewhere to locate
// columns) — doesn't re-validate cell contents.
export function requireColumns(rows: SheetRow[], requirements: ColumnRequirement[]): ValidationResult {
  const missing = requirements.filter((req) => !findCol(rows, req.kw)).map((req) => req.label);
  if (missing.length) {
    return {
      ok: false,
      message: `File tidak memiliki kolom wajib berikut: ${missing.join(', ')}. Pastikan Anda mengunggah file yang benar.`,
    };
  }
  return { ok: true };
}
