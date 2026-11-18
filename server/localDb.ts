import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT_DIR = process.cwd();
export const DATA_DIR = path.resolve(
  process.env.VERISEAL_DATA_DIR || path.join(ROOT_DIR, '.veriseal-data')
);
export const DB_PATH = path.join(DATA_DIR, 'veriseal.db');
export const FILES_DIR = path.join(DATA_DIR, 'files');

const VALID_ID_RE = /^[a-zA-Z0-9_-]{2,80}$/;
const DEFAULT_FOLDER_NAMES = [
  'Real Estate & Deeds',
  'Estate & Power of Attorney',
  'Corporate & Affidavits',
  'General Agreements',
];

export interface LocalAuthUser {
  uid: string;
  email: string;
  displayName: string;
  createdAtIso: string;
}

export interface PlacementBoxRecord {
  page: number;
  xPct: number;
  yPct: number;
  scale: number;
}

export interface DocumentPlacementRecord {
  signature: PlacementBoxRecord;
  stamp: PlacementBoxRecord;
}

export interface UserProfileRecord {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  location: string;
  commissionNumber: string;
  commissionJurisdiction: string;
  commissionExpires: string;
  customStampDataUrl: string;
  savedSignatureData: string;
  savedSignatureType: 'none' | 'drawn' | 'typed';
  createdAtIso: string;
  updatedAtIso: string;
}

export interface FolderRecord {
  id: string;
  ownerId: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CustodyEventRecord {
  id: string;
  ownerId: string;
  caseId: string;
  step: string;
  actor: string;
  details: string;
  eventHash: string;
  recordedAtIso: string;
}

export interface NotarizationCaseRecord {
  id: string;
  ownerId: string;
  folderId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  actType: string;
  notarizationMode: 'online' | 'in_person';
  meetingLocation: string;
  status: 'draft' | 'identity_verified' | 'signed' | 'notarized';
  signerName: string;
  signerEmail: string;
  documentText: string;
  documentHash: string;
  idMethod: string;
  idScore: number;
  kbaPassed: boolean;
  signerSignatureData: string;
  signatureType: 'none' | 'drawn' | 'typed';
  notaryName: string;
  notaryCommission: string;
  notaryJurisdiction: string;
  notaryExpires: string;
  notaryStampDataUrl: string;
  includeCertifiedLogo: boolean;
  includeNotarizedMark: boolean;
  placement: DocumentPlacementRecord;
  certificateCode: string;
  sealedHash: string;
  signatureAlgorithm: string;
  publicKeyJwk: string;
  digitalSignature: string;
  signedPayload: string;
  timestampIso: string;
  feeCents: number;
  createdAtIso: string;
  updatedAtIso: string;
  notarizedAtIso?: string;
}

export interface JournalEntryRecord {
  id: string;
  ownerId: string;
  caseId: string;
  entryNumber: string;
  documentTitle: string;
  fileName: string;
  actType: string;
  notarizationMode: 'online' | 'in_person';
  meetingLocation: string;
  signerName: string;
  idMethod: string;
  certificateCode: string;
  sealedHash: string;
  timestampIso: string;
  feeCents: number;
  recordedAtIso: string;
}

export interface VerificationRecordRow {
  certificateCode: string;
  ownerId: string;
  caseId: string;
  documentTitle: string;
  fileName: string;
  fileSize: number;
  actType: string;
  notarizationMode: 'online' | 'in_person';
  meetingLocation: string;
  documentHash: string;
  sealedHash: string;
  signatureAlgorithm: string;
  publicKeyJwk: string;
  digitalSignature: string;
  signedPayload: string;
  timestampIso: string;
  notaryName: string;
  notaryCommission: string;
  notaryJurisdiction: string;
  notaryExpires: string;
  notarizedAtIso: string;
}

const DEFAULT_PLACEMENT: DocumentPlacementRecord = {
  signature: { page: 1, xPct: 26, yPct: 78, scale: 1 },
  stamp: { page: 1, xPct: 75, yPct: 76, scale: 1 },
};

let dbInstance: DatabaseSync | null = null;

function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  ensureDirs();
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at_iso TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      expires_at_iso TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      uid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      location TEXT NOT NULL,
      commission_number TEXT NOT NULL,
      commission_jurisdiction TEXT NOT NULL,
      commission_expires TEXT NOT NULL,
      custom_stamp_data_url TEXT NOT NULL,
      saved_signature_data TEXT NOT NULL,
      saved_signature_type TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notarizations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      folder_id TEXT NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      act_type TEXT NOT NULL,
      notarization_mode TEXT NOT NULL,
      meeting_location TEXT NOT NULL,
      status TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      document_text TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      id_method TEXT NOT NULL,
      id_score INTEGER NOT NULL,
      kba_passed INTEGER NOT NULL,
      signer_signature_data TEXT NOT NULL,
      signature_type TEXT NOT NULL,
      notary_name TEXT NOT NULL,
      notary_commission TEXT NOT NULL,
      notary_jurisdiction TEXT NOT NULL,
      notary_expires TEXT NOT NULL,
      notary_stamp_data_url TEXT NOT NULL,
      include_certified_logo INTEGER NOT NULL,
      include_notarized_mark INTEGER NOT NULL,
      placement_json TEXT NOT NULL,
      certificate_code TEXT NOT NULL,
      sealed_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      public_key_jwk TEXT NOT NULL,
      digital_signature TEXT NOT NULL,
      signed_payload TEXT NOT NULL,
      timestamp_iso TEXT NOT NULL,
      fee_cents INTEGER NOT NULL,
      created_at_iso TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      notarized_at_iso TEXT,
      FOREIGN KEY (owner_id) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custody_events (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      step TEXT NOT NULL,
      actor TEXT NOT NULL,
      details TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      recorded_at_iso TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES notarizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      entry_number TEXT NOT NULL,
      document_title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      act_type TEXT NOT NULL,
      notarization_mode TEXT NOT NULL,
      meeting_location TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      id_method TEXT NOT NULL,
      certificate_code TEXT NOT NULL,
      sealed_hash TEXT NOT NULL,
      timestamp_iso TEXT NOT NULL,
      fee_cents INTEGER NOT NULL,
      recorded_at_iso TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(uid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS verifications (
      certificate_code TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      document_title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      act_type TEXT NOT NULL,
      notarization_mode TEXT NOT NULL,
      meeting_location TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      sealed_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      public_key_jwk TEXT NOT NULL,
      digital_signature TEXT NOT NULL,
      signed_payload TEXT NOT NULL,
      timestamp_iso TEXT NOT NULL,
      notary_name TEXT NOT NULL,
      notary_commission TEXT NOT NULL,
      notary_jurisdiction TEXT NOT NULL,
      notary_expires TEXT NOT NULL,
      notarized_at_iso TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);
    CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id);
    CREATE INDEX IF NOT EXISTS idx_notarizations_owner ON notarizations(owner_id);
    CREATE INDEX IF NOT EXISTS idx_custody_case ON custody_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_journal_owner ON journal_entries(owner_id);
  `);
  dbInstance = db;
  return db;
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function sanitizeId(input: unknown): string {
  const val = typeof input === 'string' ? input.trim() : '';
  return VALID_ID_RE.test(val) ? val : '';
}

function runTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const res = fn();
    db.exec('COMMIT');
    return res;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback error
    }
    throw err;
  }
}

function parsePlacementJson(raw: unknown): DocumentPlacementRecord {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') return DEFAULT_PLACEMENT;
    const rec = obj as Record<string, unknown>;
    const sig = (rec.signature || {}) as Record<string, unknown>;
    const stp = (rec.stamp || {}) as Record<string, unknown>;
    const cleanBox = (
      b: Record<string, unknown>,
      fallback: PlacementBoxRecord
    ): PlacementBoxRecord => ({
      page: Math.max(1, Math.min(500, Math.round(Number(b.page) || fallback.page))),
      xPct: Math.max(0, Math.min(100, Math.round((Number(b.xPct) ?? fallback.xPct) * 10) / 10)),
      yPct: Math.max(0, Math.min(100, Math.round((Number(b.yPct) ?? fallback.yPct) * 10) / 10)),
      scale: Math.max(0.4, Math.min(2.5, Math.round((Number(b.scale) || fallback.scale) * 100) / 100)),
    });
    return {
      signature: cleanBox(sig, DEFAULT_PLACEMENT.signature),
      stamp: cleanBox(stp, DEFAULT_PLACEMENT.stamp),
    };
  } catch {
    return DEFAULT_PLACEMENT;
  }
}

export function sanitizePlacement(raw: unknown): DocumentPlacementRecord {
  return parsePlacementJson(raw);
}

function createSessionToken(db: DatabaseSync, uid: string): {
  token: string;
  expiresAtIso: string;
} {
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAtIso = expires.toISOString();
  db.prepare(
    'DELETE FROM sessions WHERE expires_at_iso < ?'
  ).run(now.toISOString());
  db.prepare(
    'INSERT INTO sessions (token, uid, expires_at_iso, created_at_iso) VALUES (?, ?, ?, ?)'
  ).run(token, uid, expiresAtIso, now.toISOString());
  return { token, expiresAtIso };
}

export function hasAnyUsers(): boolean {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as
    | { cnt?: number }
    | undefined;
  return Number(row?.cnt || 0) > 0;
}

export function registerLocalUser(params: {
  fullName: string;
  email: string;
  password: string;
}): { user: LocalAuthUser; token: string; expiresAtIso: string } {
  const db = getDb();
  const email = params.email.trim().toLowerCase().slice(0, 120);
  const displayName = params.fullName.trim().slice(0, 100);
  const password = params.password;

  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!displayName) {
    throw new Error('Please enter your full legal name.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }

  const existing = db
    .prepare('SELECT uid FROM users WHERE email = ?')
    .get(email) as { uid?: string } | undefined;
  if (existing?.uid) {
    throw new Error('An account already exists with this email address.');
  }

  const uid = makeId('usr');
  const nowIso = new Date().toISOString();
  const pwHash = hashPassword(password);

  const session = runTx(db, () => {
    db.prepare(
      'INSERT INTO users (uid, email, display_name, password_hash, created_at_iso) VALUES (?, ?, ?, ?, ?)'
    ).run(uid, email, displayName, pwHash, nowIso);

    db.prepare(
      `INSERT INTO user_profiles (
        uid, display_name, email, phone, location,
        commission_number, commission_jurisdiction, commission_expires,
        custom_stamp_data_url, saved_signature_data, saved_signature_type,
        created_at_iso, updated_at_iso
      ) VALUES (?, ?, ?, '', 'San Francisco, CA', 'CA-2491804', 'State of California', '2028-09-30', '', '', 'none', ?, ?)`
    ).run(uid, displayName, email, nowIso, nowIso);

    const insertFolder = db.prepare(
      'INSERT INTO folders (id, owner_id, name, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?)'
    );
    for (const folderName of DEFAULT_FOLDER_NAMES) {
      insertFolder.run(makeId('fld'), uid, folderName, nowIso, nowIso);
    }

    return createSessionToken(db, uid);
  });

  return {
    user: { uid, email, displayName, createdAtIso: nowIso },
    token: session.token,
    expiresAtIso: session.expiresAtIso,
  };
}

export function loginLocalUser(params: {
  email: string;
  password: string;
}): { user: LocalAuthUser; token: string; expiresAtIso: string } {
  const db = getDb();
  const email = params.email.trim().toLowerCase();
  const row = db
    .prepare(
      'SELECT uid, email, display_name, password_hash, created_at_iso FROM users WHERE email = ?'
    )
    .get(email) as
    | {
        uid: string;
        email: string;
        display_name: string;
        password_hash: string;
        created_at_iso: string;
      }
    | undefined;

  if (!row || !verifyPassword(params.password, row.password_hash)) {
    throw new Error('Invalid email or password.');
  }

  const session = createSessionToken(db, row.uid);
  return {
    user: {
      uid: row.uid,
      email: row.email,
      displayName: row.display_name,
      createdAtIso: row.created_at_iso,
    },
    token: session.token,
    expiresAtIso: session.expiresAtIso,
  };
}

export function getUserBySessionToken(token: string): LocalAuthUser | null {
  if (!token) return null;
  const db = getDb();
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT u.uid, u.email, u.display_name, u.created_at_iso, s.expires_at_iso
       FROM sessions s
       JOIN users u ON u.uid = s.uid
       WHERE s.token = ?`
    )
    .get(token) as
    | {
        uid: string;
        email: string;
        display_name: string;
        created_at_iso: string;
        expires_at_iso: string;
      }
    | undefined;

  if (!row) return null;
  if (row.expires_at_iso < nowIso) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    createdAtIso: row.created_at_iso,
  };
}

export function deleteSessionToken(token: string): void {
  if (!token) return;
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function changeUserPassword(params: {
  uid: string;
  currentPassword: string;
  newPassword: string;
}): void {
  if (!params.newPassword || params.newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }
  const db = getDb();
  const row = db
    .prepare('SELECT password_hash FROM users WHERE uid = ?')
    .get(params.uid) as { password_hash?: string } | undefined;
  if (!row?.password_hash) {
    throw new Error('Account not found.');
  }
  if (!verifyPassword(params.currentPassword, row.password_hash)) {
    throw new Error('Current password is incorrect.');
  }
  const nextHash = hashPassword(params.newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE uid = ?').run(
    nextHash,
    params.uid
  );
}

function mapProfileRow(row: Record<string, unknown>): UserProfileRecord {
  const sigTypeRaw = String(row.saved_signature_type || 'none');
  const sigType: 'none' | 'drawn' | 'typed' =
    sigTypeRaw === 'drawn' || sigTypeRaw === 'typed' ? sigTypeRaw : 'none';
  return {
    uid: String(row.uid),
    displayName: String(row.display_name || ''),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    location: String(row.location || ''),
    commissionNumber: String(row.commission_number || ''),
    commissionJurisdiction: String(row.commission_jurisdiction || ''),
    commissionExpires: String(row.commission_expires || ''),
    customStampDataUrl: String(row.custom_stamp_data_url || ''),
    savedSignatureData: String(row.saved_signature_data || ''),
    savedSignatureType: sigType,
    createdAtIso: String(row.created_at_iso || ''),
    updatedAtIso: String(row.updated_at_iso || ''),
  };
}

function mapFolderRow(row: Record<string, unknown>): FolderRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    createdAtIso: String(row.created_at_iso),
    updatedAtIso: String(row.updated_at_iso),
  };
}

function mapCaseRow(row: Record<string, unknown>): NotarizationCaseRecord {
  const mode = String(row.notarization_mode) === 'in_person' ? 'in_person' : 'online';
  const statusRaw = String(row.status);
  const status: NotarizationCaseRecord['status'] =
    statusRaw === 'identity_verified' ||
    statusRaw === 'signed' ||
    statusRaw === 'notarized'
      ? statusRaw
      : 'draft';
  const sigTypeRaw = String(row.signature_type || 'none');
  const signatureType: 'none' | 'drawn' | 'typed' =
    sigTypeRaw === 'drawn' || sigTypeRaw === 'typed' ? sigTypeRaw : 'none';

  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    folderId: String(row.folder_id || 'unfiled'),
    title: String(row.title),
    fileName: String(row.file_name),
    fileType: String(row.file_type),
    fileSize: Number(row.file_size || 0),
    actType: String(row.act_type),
    notarizationMode: mode,
    meetingLocation: String(row.meeting_location || ''),
    status,
    signerName: String(row.signer_name || ''),
    signerEmail: String(row.signer_email || ''),
    documentText: String(row.document_text || ''),
    documentHash: String(row.document_hash || ''),
    idMethod: String(row.id_method || ''),
    idScore: Number(row.id_score || 0),
    kbaPassed: Number(row.kba_passed || 0) === 1,
    signerSignatureData: String(row.signer_signature_data || ''),
    signatureType,
    notaryName: String(row.notary_name || ''),
    notaryCommission: String(row.notary_commission || ''),
    notaryJurisdiction: String(row.notary_jurisdiction || ''),
    notaryExpires: String(row.notary_expires || ''),
    notaryStampDataUrl: String(row.notary_stamp_data_url || ''),
    includeCertifiedLogo: Number(row.include_certified_logo ?? 1) === 1,
    includeNotarizedMark: Number(row.include_notarized_mark ?? 1) === 1,
    placement: parsePlacementJson(row.placement_json),
    certificateCode: String(row.certificate_code || ''),
    sealedHash: String(row.sealed_hash || ''),
    signatureAlgorithm: String(row.signature_algorithm || ''),
    publicKeyJwk: String(row.public_key_jwk || ''),
    digitalSignature: String(row.digital_signature || ''),
    signedPayload: String(row.signed_payload || ''),
    timestampIso: String(row.timestamp_iso || ''),
    feeCents: Number(row.fee_cents || 0),
    createdAtIso: String(row.created_at_iso || ''),
    updatedAtIso: String(row.updated_at_iso || ''),
    notarizedAtIso: row.notarized_at_iso ? String(row.notarized_at_iso) : undefined,
  };
}

function mapCustodyRow(row: Record<string, unknown>): CustodyEventRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    caseId: String(row.case_id),
    step: String(row.step),
    actor: String(row.actor),
    details: String(row.details),
    eventHash: String(row.event_hash),
    recordedAtIso: String(row.recorded_at_iso),
  };
}

function mapJournalRow(row: Record<string, unknown>): JournalEntryRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    caseId: String(row.case_id),
    entryNumber: String(row.entry_number),
    documentTitle: String(row.document_title),
    fileName: String(row.file_name),
    actType: String(row.act_type),
    notarizationMode:
      String(row.notarization_mode) === 'in_person' ? 'in_person' : 'online',
    meetingLocation: String(row.meeting_location || ''),
    signerName: String(row.signer_name),
    idMethod: String(row.id_method),
    certificateCode: String(row.certificate_code),
    sealedHash: String(row.sealed_hash),
    timestampIso: String(row.timestamp_iso),
    feeCents: Number(row.fee_cents || 0),
    recordedAtIso: String(row.recorded_at_iso),
  };
}

function mapVerificationRow(row: Record<string, unknown>): VerificationRecordRow {
  return {
    certificateCode: String(row.certificate_code),
    ownerId: String(row.owner_id),
    caseId: String(row.case_id),
    documentTitle: String(row.document_title),
    fileName: String(row.file_name),
    fileSize: Number(row.file_size || 0),
    actType: String(row.act_type),
    notarizationMode:
      String(row.notarization_mode) === 'in_person' ? 'in_person' : 'online',
    meetingLocation: String(row.meeting_location || ''),
    documentHash: String(row.document_hash),
    sealedHash: String(row.sealed_hash),
    signatureAlgorithm: String(row.signature_algorithm),
    publicKeyJwk: String(row.public_key_jwk),
    digitalSignature: String(row.digital_signature),
    signedPayload: String(row.signed_payload),
    timestampIso: String(row.timestamp_iso),
    notaryName: String(row.notary_name),
    notaryCommission: String(row.notary_commission),
    notaryJurisdiction: String(row.notary_jurisdiction),
    notaryExpires: String(row.notary_expires),
    notarizedAtIso: String(row.notarized_at_iso),
  };
}

export function getWorkspaceForUser(user: LocalAuthUser): {
  profile: UserProfileRecord;
  folders: FolderRecord[];
  cases: NotarizationCaseRecord[];
  journalEntries: JournalEntryRecord[];
  custodyByCase: Record<string, CustodyEventRecord[]>;
  verifications: Record<string, VerificationRecordRow>;
} {
  const db = getDb();
  const nowIso = new Date().toISOString();

  let profileRow = db
    .prepare('SELECT * FROM user_profiles WHERE uid = ?')
    .get(user.uid) as Record<string, unknown> | undefined;

  if (!profileRow) {
    db.prepare(
      `INSERT INTO user_profiles (
        uid, display_name, email, phone, location,
        commission_number, commission_jurisdiction, commission_expires,
        custom_stamp_data_url, saved_signature_data, saved_signature_type,
        created_at_iso, updated_at_iso
      ) VALUES (?, ?, ?, '', 'San Francisco, CA', 'CA-2491804', 'State of California', '2028-09-30', '', '', 'none', ?, ?)`
    ).run(user.uid, user.displayName, user.email, nowIso, nowIso);
    profileRow = db
      .prepare('SELECT * FROM user_profiles WHERE uid = ?')
      .get(user.uid) as Record<string, unknown>;
  }

  let folderRows = db
    .prepare('SELECT * FROM folders WHERE owner_id = ? ORDER BY name ASC')
    .all(user.uid) as Record<string, unknown>[];

  if (folderRows.length === 0) {
    runTx(db, () => {
      const insertFolder = db.prepare(
        'INSERT INTO folders (id, owner_id, name, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?)'
      );
      for (const name of DEFAULT_FOLDER_NAMES) {
        insertFolder.run(makeId('fld'), user.uid, name, nowIso, nowIso);
      }
    });
    folderRows = db
      .prepare('SELECT * FROM folders WHERE owner_id = ? ORDER BY name ASC')
      .all(user.uid) as Record<string, unknown>[];
  }

  const caseRows = db
    .prepare(
      'SELECT * FROM notarizations WHERE owner_id = ? ORDER BY updated_at_iso DESC'
    )
    .all(user.uid) as Record<string, unknown>[];

  const custodyRows = db
    .prepare(
      'SELECT * FROM custody_events WHERE owner_id = ? ORDER BY recorded_at_iso ASC'
    )
    .all(user.uid) as Record<string, unknown>[];

  const custodyByCase: Record<string, CustodyEventRecord[]> = {};
  for (const r of custodyRows) {
    const ev = mapCustodyRow(r);
    if (!custodyByCase[ev.caseId]) custodyByCase[ev.caseId] = [];
    custodyByCase[ev.caseId].push(ev);
  }

  const journalRows = db
    .prepare(
      'SELECT * FROM journal_entries WHERE owner_id = ? ORDER BY recorded_at_iso DESC'
    )
    .all(user.uid) as Record<string, unknown>[];

  const verificationRows = db
    .prepare(
      'SELECT * FROM verifications WHERE owner_id = ? ORDER BY notarized_at_iso DESC'
    )
    .all(user.uid) as Record<string, unknown>[];
  const verifications: Record<string, VerificationRecordRow> = {};
  for (const r of verificationRows) {
    const v = mapVerificationRow(r);
    verifications[v.certificateCode] = v;
  }

  return {
    profile: mapProfileRow(profileRow),
    folders: folderRows.map(mapFolderRow),
    cases: caseRows.map(mapCaseRow),
    journalEntries: journalRows.map(mapJournalRow),
    custodyByCase,
    verifications,
  };
}

export function saveUserProfile(
  uid: string,
  input: Partial<UserProfileRecord>
): UserProfileRecord {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const sigType: 'none' | 'drawn' | 'typed' =
    input.savedSignatureType === 'drawn' || input.savedSignatureType === 'typed'
      ? input.savedSignatureType
      : 'none';
  const sigData =
    sigType === 'none'
      ? ''
      : String(input.savedSignatureData || '').slice(0, 500000);

  const displayName = String(input.displayName || '').trim().slice(0, 120) || 'Notary User';
  const email = String(input.email || '').trim().slice(0, 190);
  const phone = String(input.phone || '').trim().slice(0, 55);
  const location = String(input.location || '').trim().slice(0, 190);
  const commissionNumber = String(input.commissionNumber || '').trim().slice(0, 75);
  const commissionJurisdiction = String(input.commissionJurisdiction || '').trim().slice(0, 75);
  const commissionExpires = String(input.commissionExpires || '').trim().slice(0, 35);
  const customStampDataUrl = String(input.customStampDataUrl || '').slice(0, 500000);

  db.prepare(
    `UPDATE user_profiles SET
      display_name = ?,
      email = ?,
      phone = ?,
      location = ?,
      commission_number = ?,
      commission_jurisdiction = ?,
      commission_expires = ?,
      custom_stamp_data_url = ?,
      saved_signature_data = ?,
      saved_signature_type = ?,
      updated_at_iso = ?
     WHERE uid = ?`
  ).run(
    displayName,
    email,
    phone,
    location,
    commissionNumber,
    commissionJurisdiction,
    commissionExpires,
    customStampDataUrl,
    sigData,
    sigType,
    nowIso,
    uid
  );

  db.prepare('UPDATE users SET display_name = ? WHERE uid = ?').run(
    displayName,
    uid
  );

  const row = db
    .prepare('SELECT * FROM user_profiles WHERE uid = ?')
    .get(uid) as Record<string, unknown>;
  return mapProfileRow(row);
}

export function createFolder(uid: string, name: string, requestedId?: string): FolderRecord {
  const db = getDb();
  const id = sanitizeId(requestedId) || makeId('fld');
  const safeName = name.trim().slice(0, 60) || 'Untitled Folder';
  const nowIso = new Date().toISOString();
  db.prepare(
    'INSERT INTO folders (id, owner_id, name, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?)'
  ).run(id, uid, safeName, nowIso, nowIso);
  return {
    id,
    ownerId: uid,
    name: safeName,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };
}

export function renameFolder(uid: string, folderId: string, name: string): FolderRecord | null {
  const db = getDb();
  const safeName = name.trim().slice(0, 60) || 'Untitled Folder';
  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      'UPDATE folders SET name = ?, updated_at_iso = ? WHERE id = ? AND owner_id = ?'
    )
    .run(safeName, nowIso, folderId, uid);
  if (result.changes === 0) return null;
  const row = db
    .prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?')
    .get(folderId, uid) as Record<string, unknown>;
  return mapFolderRow(row);
}

export function deleteFolder(uid: string, folderId: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?')
    .run(folderId, uid);
  return result.changes > 0;
}

export function createCaseWithInitialCustody(params: {
  uid: string;
  caseData: {
    id?: string;
    folderId: string;
    title: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    actType: string;
    notarizationMode: 'online' | 'in_person';
    meetingLocation: string;
    signerName: string;
    signerEmail: string;
    documentText: string;
    documentHash: string;
    feeCents: number;
    includeCertifiedLogo: boolean;
    includeNotarizedMark: boolean;
    placement?: unknown;
  };
  custodyEvent: {
    id?: string;
    step: string;
    actor: string;
    details: string;
    eventHash: string;
  };
}): { caseRecord: NotarizationCaseRecord; custodyRecord: CustodyEventRecord } {
  const db = getDb();
  const caseId = sanitizeId(params.caseData.id) || makeId('case');
  const eventId = sanitizeId(params.custodyEvent.id) || makeId('ev');
  const nowIso = new Date().toISOString();

  const d = params.caseData;
  const safeMode: 'online' | 'in_person' =
    d.notarizationMode === 'in_person' ? 'in_person' : 'online';
  const safeFolderId = (d.folderId || 'unfiled').trim().slice(0, 64) || 'unfiled';
  const safeTitle = (d.title || '').trim().slice(0, 140) || 'Untitled Document';
  const safeFileName = (d.fileName || '').trim().slice(0, 180) || 'document.txt';
  const safeFileType = (d.fileType || 'text/plain').trim().slice(0, 100) || 'text/plain';
  const safeFileSize = Math.max(0, Math.min(524288000, Math.round(Number(d.fileSize) || 0)));
  const safeLocation = (d.meetingLocation || '').trim().slice(0, 160);
  const safeSignerName = (d.signerName || '').trim().slice(0, 100) || 'Principal Signer';
  const safeSignerEmail = (d.signerEmail || '').trim().slice(0, 120) || 'signer@veriseal.example';
  const safeDocText = (d.documentText || '').trim().slice(0, 500000) || 'Document content';
  const safeIdMethod =
    safeMode === 'in_person'
      ? 'Physical Government Photo ID'
      : 'Government Photo ID + KBA';
  const safePlacement = parsePlacementJson(d.placement);
  const safeFeeCents = Math.max(0, Math.min(100000, Math.round(Number(d.feeCents) || 0)));

  return runTx(db, () => {
    db.prepare(
      `INSERT INTO notarizations (
        id, owner_id, folder_id, title, file_name, file_type, file_size,
        act_type, notarization_mode, meeting_location, status,
        signer_name, signer_email, document_text, document_hash,
        id_method, id_score, kba_passed,
        signer_signature_data, signature_type,
        notary_name, notary_commission, notary_jurisdiction, notary_expires,
        notary_stamp_data_url, include_certified_logo, include_notarized_mark,
        placement_json, certificate_code, sealed_hash, signature_algorithm,
        public_key_jwk, digital_signature, signed_payload, timestamp_iso,
        fee_cents, created_at_iso, updated_at_iso, notarized_at_iso
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 'draft',
        ?, ?, ?, ?,
        ?, 0, 0,
        '', 'none',
        '', '', '', '',
        '', ?, ?,
        ?, '', '', '',
        '', '', '', '',
        ?, ?, ?, NULL
      )`
    ).run(
      caseId,
      params.uid,
      safeFolderId,
      safeTitle,
      safeFileName,
      safeFileType,
      safeFileSize,
      String(d.actType || 'Acknowledgment'),
      safeMode,
      safeLocation,
      safeSignerName,
      safeSignerEmail,
      safeDocText,
      String(d.documentHash || ''),
      safeIdMethod,
      d.includeCertifiedLogo !== false ? 1 : 0,
      d.includeNotarizedMark !== false ? 1 : 0,
      JSON.stringify(safePlacement),
      safeFeeCents,
      nowIso,
      nowIso
    );

    const safeStep = (params.custodyEvent.step || 'Document Uploaded & Hashed').trim().slice(0, 80);
    const safeActor = (params.custodyEvent.actor || safeSignerName).trim().slice(0, 120);
    const safeDetails = (params.custodyEvent.details || safeFileName).trim().slice(0, 300);

    db.prepare(
      `INSERT INTO custody_events (
        id, owner_id, case_id, step, actor, details, event_hash, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      params.uid,
      caseId,
      safeStep,
      safeActor,
      safeDetails,
      String(params.custodyEvent.eventHash || ''),
      nowIso
    );

    const caseRow = db
      .prepare('SELECT * FROM notarizations WHERE id = ?')
      .get(caseId) as Record<string, unknown>;
    const custodyRow = db
      .prepare('SELECT * FROM custody_events WHERE id = ?')
      .get(eventId) as Record<string, unknown>;

    return {
      caseRecord: mapCaseRow(caseRow),
      custodyRecord: mapCustodyRow(custodyRow),
    };
  });
}

export function getCaseForUser(
  uid: string,
  caseId: string
): NotarizationCaseRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM notarizations WHERE id = ? AND owner_id = ?')
    .get(caseId, uid) as Record<string, unknown> | undefined;
  return row ? mapCaseRow(row) : null;
}

export function updateCaseFields(
  uid: string,
  caseId: string,
  patch: {
    folderId?: string;
    notarizationMode?: 'online' | 'in_person';
    meetingLocation?: string;
    status?: 'draft' | 'identity_verified' | 'signed';
    idMethod?: string;
    idScore?: number;
    kbaPassed?: boolean;
    signerSignatureData?: string;
    signatureType?: 'none' | 'drawn' | 'typed';
    includeCertifiedLogo?: boolean;
    includeNotarizedMark?: boolean;
    placement?: DocumentPlacementRecord;
  },
  custodyEvent?: {
    step: string;
    actor: string;
    details: string;
    eventHash: string;
  }
): { caseRecord: NotarizationCaseRecord; custodyRecord?: CustodyEventRecord } {
  const db = getDb();
  return runTx(db, () => {
    const existingRow = db
      .prepare('SELECT * FROM notarizations WHERE id = ? AND owner_id = ?')
      .get(caseId, uid) as Record<string, unknown> | undefined;
    if (!existingRow) {
      throw new Error('Notarization case not found.');
    }
    const existing = mapCaseRow(existingRow);

    if (
      existing.status === 'notarized' &&
      Object.keys(patch).some((k) => k !== 'folderId')
    ) {
      throw new Error('Notarized records are sealed and immutable.');
    }

    const nowIso = new Date().toISOString();
    const nextFolderId =
      patch.folderId !== undefined
        ? patch.folderId.trim().slice(0, 64) || 'unfiled'
        : existing.folderId;
    const nextMode =
      patch.notarizationMode !== undefined
        ? patch.notarizationMode === 'in_person'
          ? 'in_person'
          : 'online'
        : existing.notarizationMode;
    const nextLocation =
      patch.meetingLocation !== undefined
        ? patch.meetingLocation.trim().slice(0, 160)
        : existing.meetingLocation;
    const nextStatus = patch.status ?? existing.status;
    const nextIdMethod =
      patch.idMethod !== undefined
        ? patch.idMethod.trim().slice(0, 80)
        : existing.idMethod;
    const nextIdScore =
      patch.idScore !== undefined
        ? Math.max(0, Math.min(100, Math.round(Number(patch.idScore) || 0)))
        : existing.idScore;
    const nextKbaPassed =
      patch.kbaPassed !== undefined ? Boolean(patch.kbaPassed) : existing.kbaPassed;
    const nextSigData =
      patch.signerSignatureData !== undefined
        ? String(patch.signerSignatureData).slice(0, 200000)
        : existing.signerSignatureData;
    const nextSigType =
      patch.signatureType !== undefined ? patch.signatureType : existing.signatureType;
    const nextCertLogo =
      patch.includeCertifiedLogo !== undefined
        ? patch.includeCertifiedLogo
        : existing.includeCertifiedLogo;
    const nextNotMark =
      patch.includeNotarizedMark !== undefined
        ? patch.includeNotarizedMark
        : existing.includeNotarizedMark;
    const nextPlacement =
      patch.placement !== undefined
        ? parsePlacementJson(patch.placement)
        : existing.placement;

    db.prepare(
      `UPDATE notarizations SET
        folder_id = ?,
        notarization_mode = ?,
        meeting_location = ?,
        status = ?,
        id_method = ?,
        id_score = ?,
        kba_passed = ?,
        signer_signature_data = ?,
        signature_type = ?,
        include_certified_logo = ?,
        include_notarized_mark = ?,
        placement_json = ?,
        updated_at_iso = ?
      WHERE id = ? AND owner_id = ?`
    ).run(
      nextFolderId,
      nextMode,
      nextLocation,
      nextStatus,
      nextIdMethod,
      nextIdScore,
      nextKbaPassed ? 1 : 0,
      nextSigData,
      nextSigType,
      nextCertLogo ? 1 : 0,
      nextNotMark ? 1 : 0,
      JSON.stringify(nextPlacement),
      nowIso,
      caseId,
      uid
    );

    let custodyRecord: CustodyEventRecord | undefined;
    if (custodyEvent) {
      const eventId = makeId('ev');
      db.prepare(
        `INSERT INTO custody_events (
          id, owner_id, case_id, step, actor, details, event_hash, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        uid,
        caseId,
        custodyEvent.step.trim().slice(0, 80),
        custodyEvent.actor.trim().slice(0, 120),
        custodyEvent.details.trim().slice(0, 300),
        custodyEvent.eventHash,
        nowIso
      );
      const evRow = db
        .prepare('SELECT * FROM custody_events WHERE id = ?')
        .get(eventId) as Record<string, unknown>;
      custodyRecord = mapCustodyRow(evRow);
    }

    const updatedRow = db
      .prepare('SELECT * FROM notarizations WHERE id = ?')
      .get(caseId) as Record<string, unknown>;
    return {
      caseRecord: mapCaseRow(updatedRow),
      custodyRecord,
    };
  });
}

export function deleteDraftCase(uid: string, caseId: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT status FROM notarizations WHERE id = ? AND owner_id = ?')
    .get(caseId, uid) as { status?: string } | undefined;
  if (!row) return false;
  if (row.status === 'notarized') {
    throw new Error('Sealed notarization records cannot be deleted.');
  }
  const result = db
    .prepare('DELETE FROM notarizations WHERE id = ? AND owner_id = ?')
    .run(caseId, uid);
  if (result.changes > 0) {
    deleteStoredCaseFile(caseId);
    return true;
  }
  return false;
}

export function sealNotarizationCase(params: {
  uid: string;
  caseId: string;
  notaryName: string;
  notaryCommission: string;
  notaryJurisdiction: string;
  notaryExpires: string;
  notaryStampDataUrl: string;
  includeCertifiedLogo: boolean;
  includeNotarizedMark: boolean;
  certificateCode: string;
  sealedHash: string;
  signatureAlgorithm: string;
  publicKeyJwk: string;
  digitalSignature: string;
  signedPayload: string;
  timestampIso: string;
  custodyEventHash: string;
}): {
  caseRecord: NotarizationCaseRecord;
  journalRecord: JournalEntryRecord;
  verificationRecord: VerificationRecordRow;
  custodyRecord: CustodyEventRecord;
} {
  const db = getDb();
  return runTx(db, () => {
    const existingRow = db
      .prepare('SELECT * FROM notarizations WHERE id = ? AND owner_id = ?')
      .get(params.caseId, params.uid) as Record<string, unknown> | undefined;
    if (!existingRow) {
      throw new Error('Notarization case not found.');
    }
    const existing = mapCaseRow(existingRow);
    if (existing.status === 'notarized') {
      throw new Error('This document is already notarized and sealed.');
    }

    const nowIso = params.timestampIso || new Date().toISOString();
    const journalCountRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM journal_entries WHERE owner_id = ?')
      .get(params.uid) as { cnt?: number } | undefined;
    const nextSeq = Number(journalCountRow?.cnt || 0) + 1;
    const entryNumber = `NJ-2026-${String(nextSeq).padStart(4, '0')}`;
    const entryId = makeId('jrn');
    const eventId = makeId('ev');

    db.prepare(
      `UPDATE notarizations SET
        status = 'notarized',
        notary_name = ?,
        notary_commission = ?,
        notary_jurisdiction = ?,
        notary_expires = ?,
        notary_stamp_data_url = ?,
        include_certified_logo = ?,
        include_notarized_mark = ?,
        certificate_code = ?,
        sealed_hash = ?,
        signature_algorithm = ?,
        public_key_jwk = ?,
        digital_signature = ?,
        signed_payload = ?,
        timestamp_iso = ?,
        notarized_at_iso = ?,
        updated_at_iso = ?
      WHERE id = ? AND owner_id = ?`
    ).run(
      params.notaryName.trim().slice(0, 100),
      params.notaryCommission.trim().slice(0, 60),
      params.notaryJurisdiction.trim().slice(0, 60),
      params.notaryExpires.trim().slice(0, 30),
      String(params.notaryStampDataUrl || '').slice(0, 500000),
      params.includeCertifiedLogo ? 1 : 0,
      params.includeNotarizedMark ? 1 : 0,
      params.certificateCode,
      params.sealedHash,
      params.signatureAlgorithm,
      params.publicKeyJwk,
      params.digitalSignature,
      params.signedPayload,
      nowIso,
      nowIso,
      nowIso,
      params.caseId,
      params.uid
    );

    db.prepare(
      `INSERT INTO journal_entries (
        id, owner_id, case_id, entry_number, document_title, file_name,
        act_type, notarization_mode, meeting_location, signer_name,
        id_method, certificate_code, sealed_hash, timestamp_iso,
        fee_cents, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entryId,
      params.uid,
      existing.id,
      entryNumber,
      existing.title,
      existing.fileName,
      existing.actType,
      existing.notarizationMode,
      existing.meetingLocation,
      existing.signerName,
      existing.idMethod || 'Government Photo ID + KBA',
      params.certificateCode,
      params.sealedHash,
      nowIso,
      existing.feeCents,
      nowIso
    );

    db.prepare(
      `INSERT INTO verifications (
        certificate_code, owner_id, case_id, document_title, file_name,
        file_size, act_type, notarization_mode, meeting_location,
        document_hash, sealed_hash, signature_algorithm, public_key_jwk,
        digital_signature, signed_payload, timestamp_iso,
        notary_name, notary_commission, notary_jurisdiction, notary_expires,
        notarized_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.certificateCode,
      params.uid,
      existing.id,
      existing.title,
      existing.fileName,
      existing.fileSize,
      existing.actType,
      existing.notarizationMode,
      existing.meetingLocation,
      existing.documentHash,
      params.sealedHash,
      params.signatureAlgorithm,
      params.publicKeyJwk,
      params.digitalSignature,
      params.signedPayload,
      nowIso,
      params.notaryName.trim().slice(0, 100),
      params.notaryCommission.trim().slice(0, 60),
      params.notaryJurisdiction.trim().slice(0, 60),
      params.notaryExpires.trim().slice(0, 30),
      nowIso
    );

    db.prepare(
      `INSERT INTO custody_events (
        id, owner_id, case_id, step, actor, details, event_hash, recorded_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      params.uid,
      existing.id,
      'Notary Seal & ECDSA Timestamp Applied',
      params.notaryName.trim().slice(0, 120),
      `Certificate ${params.certificateCode} sealed & recorded in statutory journal`.slice(
        0,
        300
      ),
      params.custodyEventHash,
      nowIso
    );

    const caseRow = db
      .prepare('SELECT * FROM notarizations WHERE id = ?')
      .get(params.caseId) as Record<string, unknown>;
    const journalRow = db
      .prepare('SELECT * FROM journal_entries WHERE id = ?')
      .get(entryId) as Record<string, unknown>;
    const verificationRow = db
      .prepare('SELECT * FROM verifications WHERE certificate_code = ?')
      .get(params.certificateCode) as Record<string, unknown>;
    const custodyRow = db
      .prepare('SELECT * FROM custody_events WHERE id = ?')
      .get(eventId) as Record<string, unknown>;

    return {
      caseRecord: mapCaseRow(caseRow),
      journalRecord: mapJournalRow(journalRow),
      verificationRecord: mapVerificationRow(verificationRow),
      custodyRecord: mapCustodyRow(custodyRow),
    };
  });
}

export function getPublicVerification(
  certificateCode: string
): VerificationRecordRow | null {
  const cleaned = certificateCode.trim().toUpperCase();
  if (!cleaned) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM verifications WHERE certificate_code = ?')
    .get(cleaned) as Record<string, unknown> | undefined;
  return row ? mapVerificationRow(row) : null;
}

export function saveCaseFileBytes(
  uid: string,
  caseId: string,
  bytes: Buffer
): void {
  const safeId = sanitizeId(caseId);
  if (!safeId) {
    throw new Error('Invalid case ID.');
  }
  const existing = getCaseForUser(uid, safeId);
  if (!existing) {
    throw new Error('Notarization case not found.');
  }
  ensureDirs();
  const targetPath = path.join(FILES_DIR, `${safeId}.bin`);
  const tmpPath = path.join(FILES_DIR, `${safeId}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, bytes);
  fs.renameSync(tmpPath, targetPath);
}

export function readCaseFileBytes(
  uid: string,
  caseId: string
): { fileName: string; fileType: string; bytes: Buffer } | null {
  const safeId = sanitizeId(caseId);
  if (!safeId) return null;
  const existing = getCaseForUser(uid, safeId);
  if (!existing) return null;
  const targetPath = path.join(FILES_DIR, `${safeId}.bin`);
  if (!fs.existsSync(targetPath)) return null;
  return {
    fileName: existing.fileName,
    fileType: existing.fileType || 'application/octet-stream',
    bytes: fs.readFileSync(targetPath),
  };
}

export function deleteStoredCaseFile(caseId: string): void {
  const safeId = sanitizeId(caseId);
  if (!safeId) return;
  const targetPath = path.join(FILES_DIR, `${safeId}.bin`);
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  } catch {
    // Ignore file cleanup errors
  }
}
