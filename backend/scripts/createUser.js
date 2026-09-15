// One-off/reusable account creation — for accounts that don't go through the
// public self-registration flow (POST /api/auth/register always creates an
// unrestricted role='user' account; there's no admin "create user" UI).
// Standalone script, same convention as seed.js/mapBrandSheets.js: its own
// pg connection, not the running server's config/db.js.
//
// Usage:
//   node scripts/createUser.js --email=tes@atlas.local --password=tes12345 \
//     --fullName="Tes Opus One" --role=user --brand="Opus One" --view-only
//
// Flags:
//   --email, --password, --fullName   required
//   --role=admin|user                 optional, default "user"
//   --brand="Brand Name"              optional — locks the account to this
//                                      brand (migration 023's allowed_brand_id).
//                                      Matched case-insensitively/trimmed.
//   --view-only                       optional — account can read but never
//                                      write anywhere (migration 023's is_view_only).
import bcrypt from 'bcryptjs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function parseArgs(argv) {
  const args = { role: 'user', viewOnly: false };
  for (const raw of argv) {
    if (raw === '--view-only') { args.viewOnly = true; continue; }
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'fullName') args.fullName = value;
    else if (key === 'email') args.email = value;
    else if (key === 'password') args.password = value;
    else if (key === 'role') args.role = value;
    else if (key === 'brand') args.brand = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.password || !args.fullName) {
    console.error('Wajib: --email --password --fullName');
    process.exit(1);
  }
  if (!['admin', 'user'].includes(args.role)) {
    console.error('--role harus "admin" atau "user"');
    process.exit(1);
  }
  if (args.password.length < 8) {
    console.error('--password minimal 8 karakter');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    let brandId = null;
    if (args.brand) {
      const brandResult = await client.query(
        'SELECT brand_id, brand_name FROM public.brands WHERE LOWER(TRIM(brand_name)) = LOWER($1)',
        [args.brand.trim()],
      );
      if (!brandResult.rows[0]) {
        console.error(`Brand "${args.brand}" tidak ditemukan di public.brands.`);
        process.exit(1);
      }
      brandId = brandResult.rows[0].brand_id;
    }

    const passwordHash = await bcrypt.hash(args.password, 12);

    const result = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, allowed_brand_id, is_view_only)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING
       RETURNING user_id, email, full_name, role, allowed_brand_id, is_view_only`,
      [args.email.toLowerCase(), passwordHash, args.fullName, args.role, brandId, args.viewOnly],
    );

    if (!result.rows[0]) {
      console.warn(`Email "${args.email}" sudah terdaftar — tidak ada perubahan.`);
      process.exit(1);
    }

    const user = result.rows[0];
    console.log('Akun dibuat:');
    console.log(`  Email:       ${user.email}`);
    console.log(`  Role:        ${user.role}`);
    console.log(`  Brand:       ${args.brand ?? '(tidak dibatasi)'}`);
    console.log(`  View-only:   ${user.is_view_only}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Gagal membuat akun:', err.message);
  process.exit(1);
});
