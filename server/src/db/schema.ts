import { pgTable, text, integer, timestamp, jsonb, uuid, varchar, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 200 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('bauleiter'), // 'admin' | 'bauleiter'
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  valueEncrypted: text('value_encrypted').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  status: varchar('status', { length: 20 }).notNull().default('draft'), // 'draft' | 'complete'
  bvNummer: varchar('bv_nummer', { length: 50 }),
  auftraggeber: varchar('auftraggeber', { length: 200 }),
  lieferanschrift: text('lieferanschrift'),
  datum: varchar('datum', { length: 20 }),
  ftpSourcePath: text('ftp_source_path'),
  ftpReportPath: text('ftp_report_path'),
  dataJson: jsonb('data_json'), // Full wizard payload
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

export const reportPhotos = pgTable('report_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  originalName: varchar('original_name', { length: 255 }),
  sizeBytes: integer('size_bytes'),
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
});

export const reportSignatures = pgTable('report_signatures', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 20 }).notNull(), // 'bauleiter' | 'customer'
  signerName: varchar('signer_name', { length: 200 }).notNull(),
  signaturePngPath: text('signature_png_path').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  detail: text('detail'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
