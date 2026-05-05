import pg from 'pg';
import bcrypt from 'bcrypt';
import { config } from '../config.js';

const SQL_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'bauleiter',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  bv_nummer VARCHAR(50),
  auftraggeber VARCHAR(200),
  lieferanschrift TEXT,
  projektbezeichnung TEXT,
  sollstunden_minuten INTEGER,
  datum VARCHAR(20),
  ftp_source_path TEXT,
  ftp_report_path TEXT,
  data_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Spalten für bestehende Installationen nachziehen (idempotent)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS projektbezeichnung TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS sollstunden_minuten INTEGER;

CREATE TABLE IF NOT EXISTS report_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_name VARCHAR(255),
  size_bytes INTEGER,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  signer_name VARCHAR(200) NOT NULL,
  signature_png_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  detail TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

export async function migrate() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();

  try {
    await client.query(SQL_CREATE_TABLES);
    console.log('[DB] Tables created/verified');

    // Seed default admin if no users exist
    const result = await client.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(result.rows[0].count) === 0) {
      const hash = await bcrypt.hash(config.admin.password, 12);
      await client.query(
        `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)`,
        [config.admin.username, hash, 'Administrator', 'admin']
      );
      console.log(`[DB] Default admin created: ${config.admin.username}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// Run directly if called as script
const isDirectRun = process.argv[1]?.includes('migrate');
if (isDirectRun) {
  migrate().then(() => {
    console.log('[DB] Migration complete');
    process.exit(0);
  }).catch((err) => {
    console.error('[DB] Migration failed:', err);
    process.exit(1);
  });
}
