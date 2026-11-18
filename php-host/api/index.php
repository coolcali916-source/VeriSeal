<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');

const DATA_DIR = __DIR__ . '/.veriseal-data';
const FILES_DIR = DATA_DIR . '/files';
const SQLITE_PATH = DATA_DIR . '/veriseal.sqlite';
const SESSION_COOKIE = 'veriseal_session';
const VALID_ID_RE = '/^[a-zA-Z0-9_-]{2,80}$/';
const DEFAULT_FOLDER_NAMES = [
  'Real Estate & Deeds',
  'Estate & Power of Attorney',
  'Corporate & Affidavits',
  'General Agreements',
];

function sendJson(int $status, array $payload): never {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store, no-cache, must-revalidate');
  echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

function readJsonBody(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') {
    return [];
  }
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function nowIso(): string {
  $dt = new DateTimeImmutable('now', new DateTimeZone('UTC'));
  return $dt->format('Y-m-d\TH:i:s.v\Z');
}

function makeId(string $prefix): string {
  return $prefix . '_' . bin2hex(random_bytes(6));
}

function sanitizeId(mixed $input): string {
  $val = is_string($input) ? trim($input) : '';
  return preg_match(VALID_ID_RE, $val) === 1 ? $val : '';
}

function isHttpsRequest(): bool {
  if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
    return true;
  }
  $proto = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
  return str_contains($proto, 'https');
}

function setSessionCookie(string $token): void {
  $https = isHttpsRequest();
  setcookie(SESSION_COOKIE, $token, [
    'expires' => time() + 30 * 24 * 60 * 60,
    'path' => '/',
    'secure' => $https,
    'httponly' => true,
    'samesite' => $https ? 'None' : 'Lax',
  ]);
}

function clearSessionCookie(): void {
  $https = isHttpsRequest();
  setcookie(SESSION_COOKIE, '', [
    'expires' => time() - 3600,
    'path' => '/',
    'secure' => $https,
    'httponly' => true,
    'samesite' => $https ? 'None' : 'Lax',
  ]);
}

function getSessionToken(): string {
  if (!empty($_SERVER['HTTP_X_VERISEAL_TOKEN'])) {
    $t = trim((string)$_SERVER['HTTP_X_VERISEAL_TOKEN']);
    if ($t !== '') return $t;
  }
  $auth = (string)(
    $_SERVER['HTTP_AUTHORIZATION'] ??
    $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ??
    ''
  );
  if ($auth === '' && function_exists('apache_request_headers')) {
    $hdrs = apache_request_headers();
    if (is_array($hdrs)) {
      foreach ($hdrs as $k => $v) {
        if (strtolower((string)$k) === 'x-veriseal-token' && trim((string)$v) !== '') {
          return trim((string)$v);
        }
        if (strtolower((string)$k) === 'authorization') {
          $auth = (string)$v;
        }
      }
    }
  }
  if (str_starts_with($auth, 'Bearer ')) {
    $t = trim(substr($auth, 7));
    if ($t !== '') return $t;
  }
  if (!empty($_COOKIE[SESSION_COOKIE])) {
    return trim((string)$_COOKIE[SESSION_COOKIE]);
  }
  if (!empty($_GET['token']) && is_string($_GET['token'])) {
    return trim($_GET['token']);
  }
  return '';
}

function ensureDataDirs(): void {
  if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0750, true);
  }
  if (!is_dir(FILES_DIR)) {
    @mkdir(FILES_DIR, 0750, true);
  }
  $htaccessPath = DATA_DIR . '/.htaccess';
  if (!file_exists($htaccessPath)) {
    @file_put_contents(
      $htaccessPath,
      "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n"
    );
  }
}

function loadDbConfig(): array {
  $defaults = [
    'DB_DRIVER' => 'auto',
    'MYSQL_HOST' => 'sql309.iceiy.com',
    'MYSQL_PORT' => 3306,
    'MYSQL_USER' => '',
    'MYSQL_PASS' => '',
    'MYSQL_DB' => '',
  ];
  $configPath = __DIR__ . '/config.php';
  if (is_file($configPath)) {
    $loaded = require $configPath;
    if (is_array($loaded)) {
      return array_merge($defaults, $loaded);
    }
  }
  return $defaults;
}

function openDatabase(): array {
  static $cached = null;
  if ($cached !== null) return $cached;

  $cfg = loadDbConfig();
  $mode = strtolower((string)($cfg['DB_DRIVER'] ?? 'auto'));

  if ($mode === 'mysql' || ($mode === 'auto' && !empty($cfg['MYSQL_DB']) && !empty($cfg['MYSQL_USER']))) {
    try {
      $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $cfg['MYSQL_HOST'],
        (int)$cfg['MYSQL_PORT'],
        $cfg['MYSQL_DB']
      );
      $pdo = new PDO($dsn, (string)$cfg['MYSQL_USER'], (string)$cfg['MYSQL_PASS'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 4,
      ]);
      ensureMysqlSchema($pdo);
      $cached = ['pdo' => $pdo, 'driver' => 'mysql'];
      return $cached;
    } catch (Throwable $e) {
      if ($mode === 'mysql') {
        throw $e;
      }
      // In 'auto' mode, gracefully fall back to protected SQLite storage
    }
  }

  ensureDataDirs();
  $pdo = new PDO('sqlite:' . SQLITE_PATH, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
  $pdo->exec('PRAGMA foreign_keys = ON;');
  $pdo->exec('PRAGMA busy_timeout = 5000;');
  ensureSqliteSchema($pdo);
  $cached = ['pdo' => $pdo, 'driver' => 'sqlite'];
  return $cached;
}

function ensureSqliteSchema(PDO $pdo): void {
  $pdo->exec('
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
  ');
}

function ensureMysqlSchema(PDO $pdo): void {
  $statements = [
    "CREATE TABLE IF NOT EXISTS users (
      uid VARCHAR(120) PRIMARY KEY,
      email VARCHAR(191) NOT NULL UNIQUE,
      display_name VARCHAR(191) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at_iso VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(191) PRIMARY KEY,
      uid VARCHAR(120) NOT NULL,
      expires_at_iso VARCHAR(64) NOT NULL,
      created_at_iso VARCHAR(64) NOT NULL,
      INDEX idx_sessions_uid (uid),
      FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS user_profiles (
      uid VARCHAR(120) PRIMARY KEY,
      display_name VARCHAR(191) NOT NULL,
      email VARCHAR(191) NOT NULL,
      phone VARCHAR(80) NOT NULL,
      location VARCHAR(255) NOT NULL,
      commission_number VARCHAR(120) NOT NULL,
      commission_jurisdiction VARCHAR(120) NOT NULL,
      commission_expires VARCHAR(64) NOT NULL,
      custom_stamp_data_url LONGTEXT NOT NULL,
      saved_signature_data LONGTEXT NOT NULL,
      saved_signature_type VARCHAR(32) NOT NULL,
      created_at_iso VARCHAR(64) NOT NULL,
      updated_at_iso VARCHAR(64) NOT NULL,
      FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS folders (
      id VARCHAR(120) PRIMARY KEY,
      owner_id VARCHAR(120) NOT NULL,
      name VARCHAR(120) NOT NULL,
      created_at_iso VARCHAR(64) NOT NULL,
      updated_at_iso VARCHAR(64) NOT NULL,
      INDEX idx_folders_owner (owner_id),
      FOREIGN KEY (owner_id) REFERENCES users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS notarizations (
      id VARCHAR(120) PRIMARY KEY,
      owner_id VARCHAR(120) NOT NULL,
      folder_id VARCHAR(120) NOT NULL,
      title VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(120) NOT NULL,
      file_size BIGINT NOT NULL,
      act_type VARCHAR(120) NOT NULL,
      notarization_mode VARCHAR(32) NOT NULL,
      meeting_location VARCHAR(255) NOT NULL,
      status VARCHAR(32) NOT NULL,
      signer_name VARCHAR(191) NOT NULL,
      signer_email VARCHAR(191) NOT NULL,
      document_text LONGTEXT NOT NULL,
      document_hash VARCHAR(128) NOT NULL,
      id_method VARCHAR(120) NOT NULL,
      id_score INT NOT NULL,
      kba_passed TINYINT(1) NOT NULL,
      signer_signature_data LONGTEXT NOT NULL,
      signature_type VARCHAR(32) NOT NULL,
      notary_name VARCHAR(191) NOT NULL,
      notary_commission VARCHAR(120) NOT NULL,
      notary_jurisdiction VARCHAR(120) NOT NULL,
      notary_expires VARCHAR(64) NOT NULL,
      notary_stamp_data_url LONGTEXT NOT NULL,
      include_certified_logo TINYINT(1) NOT NULL,
      include_notarized_mark TINYINT(1) NOT NULL,
      placement_json TEXT NOT NULL,
      certificate_code VARCHAR(80) NOT NULL,
      sealed_hash VARCHAR(128) NOT NULL,
      signature_algorithm VARCHAR(80) NOT NULL,
      public_key_jwk TEXT NOT NULL,
      digital_signature TEXT NOT NULL,
      signed_payload LONGTEXT NOT NULL,
      timestamp_iso VARCHAR(64) NOT NULL,
      fee_cents INT NOT NULL,
      created_at_iso VARCHAR(64) NOT NULL,
      updated_at_iso VARCHAR(64) NOT NULL,
      notarized_at_iso VARCHAR(64) NULL,
      INDEX idx_notarizations_owner (owner_id),
      FOREIGN KEY (owner_id) REFERENCES users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS custody_events (
      id VARCHAR(120) PRIMARY KEY,
      owner_id VARCHAR(120) NOT NULL,
      case_id VARCHAR(120) NOT NULL,
      step VARCHAR(120) NOT NULL,
      actor VARCHAR(191) NOT NULL,
      details TEXT NOT NULL,
      event_hash VARCHAR(128) NOT NULL,
      recorded_at_iso VARCHAR(64) NOT NULL,
      INDEX idx_custody_case (case_id),
      FOREIGN KEY (case_id) REFERENCES notarizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS journal_entries (
      id VARCHAR(120) PRIMARY KEY,
      owner_id VARCHAR(120) NOT NULL,
      case_id VARCHAR(120) NOT NULL,
      entry_number VARCHAR(64) NOT NULL,
      document_title VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      act_type VARCHAR(120) NOT NULL,
      notarization_mode VARCHAR(32) NOT NULL,
      meeting_location VARCHAR(255) NOT NULL,
      signer_name VARCHAR(191) NOT NULL,
      id_method VARCHAR(120) NOT NULL,
      certificate_code VARCHAR(80) NOT NULL,
      sealed_hash VARCHAR(128) NOT NULL,
      timestamp_iso VARCHAR(64) NOT NULL,
      fee_cents INT NOT NULL,
      recorded_at_iso VARCHAR(64) NOT NULL,
      INDEX idx_journal_owner (owner_id),
      FOREIGN KEY (owner_id) REFERENCES users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",

    "CREATE TABLE IF NOT EXISTS verifications (
      certificate_code VARCHAR(80) PRIMARY KEY,
      owner_id VARCHAR(120) NOT NULL,
      case_id VARCHAR(120) NOT NULL,
      document_title VARCHAR(255) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_size BIGINT NOT NULL,
      act_type VARCHAR(120) NOT NULL,
      notarization_mode VARCHAR(32) NOT NULL,
      meeting_location VARCHAR(255) NOT NULL,
      document_hash VARCHAR(128) NOT NULL,
      sealed_hash VARCHAR(128) NOT NULL,
      signature_algorithm VARCHAR(80) NOT NULL,
      public_key_jwk TEXT NOT NULL,
      digital_signature TEXT NOT NULL,
      signed_payload LONGTEXT NOT NULL,
      timestamp_iso VARCHAR(64) NOT NULL,
      notary_name VARCHAR(191) NOT NULL,
      notary_commission VARCHAR(120) NOT NULL,
      notary_jurisdiction VARCHAR(120) NOT NULL,
      notary_expires VARCHAR(64) NOT NULL,
      notarized_at_iso VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  ];

  foreach ($statements as $sql) {
    $pdo->exec($sql);
  }
}

function defaultPlacement(): array {
  return [
    'signature' => ['page' => 1, 'xPct' => 26.0, 'yPct' => 78.0, 'scale' => 1.0],
    'stamp' => ['page' => 1, 'xPct' => 75.0, 'yPct' => 76.0, 'scale' => 1.0],
  ];
}

function parsePlacementJson(mixed $raw): array {
  $defaults = defaultPlacement();
  $obj = is_string($raw) ? json_decode($raw, true) : $raw;
  if (!is_array($obj)) return $defaults;

  $cleanBox = function (mixed $b, array $fallback): array {
    if (!is_array($b)) $b = [];
    $page = max(1, min(500, (int)round((float)($b['page'] ?? $fallback['page']))));
    $xPct = max(0.0, min(100.0, round((float)($b['xPct'] ?? $fallback['xPct']) * 10) / 10));
    $yPct = max(0.0, min(100.0, round((float)($b['yPct'] ?? $fallback['yPct']) * 10) / 10));
    $scale = max(0.4, min(2.5, round((float)($b['scale'] ?? $fallback['scale']) * 100) / 100));
    return ['page' => $page, 'xPct' => $xPct, 'yPct' => $yPct, 'scale' => $scale];
  };

  return [
    'signature' => $cleanBox($obj['signature'] ?? [], $defaults['signature']),
    'stamp' => $cleanBox($obj['stamp'] ?? [], $defaults['stamp']),
  ];
}

function mapProfileRow(array $row): array {
  $sigType = (string)($row['saved_signature_type'] ?? 'none');
  if ($sigType !== 'drawn' && $sigType !== 'typed') $sigType = 'none';
  return [
    'uid' => (string)$row['uid'],
    'displayName' => (string)($row['display_name'] ?? ''),
    'email' => (string)($row['email'] ?? ''),
    'phone' => (string)($row['phone'] ?? ''),
    'location' => (string)($row['location'] ?? ''),
    'commissionNumber' => (string)($row['commission_number'] ?? ''),
    'commissionJurisdiction' => (string)($row['commission_jurisdiction'] ?? ''),
    'commissionExpires' => (string)($row['commission_expires'] ?? ''),
    'customStampDataUrl' => (string)($row['custom_stamp_data_url'] ?? ''),
    'savedSignatureData' => (string)($row['saved_signature_data'] ?? ''),
    'savedSignatureType' => $sigType,
    'createdAtIso' => (string)($row['created_at_iso'] ?? ''),
    'updatedAtIso' => (string)($row['updated_at_iso'] ?? ''),
  ];
}

function mapFolderRow(array $row): array {
  return [
    'id' => (string)$row['id'],
    'ownerId' => (string)$row['owner_id'],
    'name' => (string)$row['name'],
    'createdAtIso' => (string)$row['created_at_iso'],
    'updatedAtIso' => (string)$row['updated_at_iso'],
  ];
}

function mapCaseRow(array $row): array {
  $mode = (string)($row['notarization_mode'] ?? 'online') === 'in_person' ? 'in_person' : 'online';
  $status = (string)($row['status'] ?? 'draft');
  if (!in_array($status, ['draft', 'identity_verified', 'signed', 'notarized'], true)) {
    $status = 'draft';
  }
  $sigType = (string)($row['signature_type'] ?? 'none');
  if ($sigType !== 'drawn' && $sigType !== 'typed') $sigType = 'none';

  $out = [
    'id' => (string)$row['id'],
    'ownerId' => (string)$row['owner_id'],
    'folderId' => (string)($row['folder_id'] ?: 'unfiled'),
    'title' => (string)$row['title'],
    'fileName' => (string)$row['file_name'],
    'fileType' => (string)$row['file_type'],
    'fileSize' => (int)($row['file_size'] ?? 0),
    'actType' => (string)$row['act_type'],
    'notarizationMode' => $mode,
    'meetingLocation' => (string)($row['meeting_location'] ?? ''),
    'status' => $status,
    'signerName' => (string)($row['signer_name'] ?? ''),
    'signerEmail' => (string)($row['signer_email'] ?? ''),
    'documentText' => (string)($row['document_text'] ?? ''),
    'documentHash' => (string)($row['document_hash'] ?? ''),
    'idMethod' => (string)($row['id_method'] ?? ''),
    'idScore' => (int)($row['id_score'] ?? 0),
    'kbaPassed' => ((int)($row['kba_passed'] ?? 0)) === 1,
    'signerSignatureData' => (string)($row['signer_signature_data'] ?? ''),
    'signatureType' => $sigType,
    'notaryName' => (string)($row['notary_name'] ?? ''),
    'notaryCommission' => (string)($row['notary_commission'] ?? ''),
    'notaryJurisdiction' => (string)($row['notary_jurisdiction'] ?? ''),
    'notaryExpires' => (string)($row['notary_expires'] ?? ''),
    'notaryStampDataUrl' => (string)($row['notary_stamp_data_url'] ?? ''),
    'includeCertifiedLogo' => ((int)($row['include_certified_logo'] ?? 1)) === 1,
    'includeNotarizedMark' => ((int)($row['include_notarized_mark'] ?? 1)) === 1,
    'placement' => parsePlacementJson($row['placement_json'] ?? null),
    'certificateCode' => (string)($row['certificate_code'] ?? ''),
    'sealedHash' => (string)($row['sealed_hash'] ?? ''),
    'signatureAlgorithm' => (string)($row['signature_algorithm'] ?? ''),
    'publicKeyJwk' => (string)($row['public_key_jwk'] ?? ''),
    'digitalSignature' => (string)($row['digital_signature'] ?? ''),
    'signedPayload' => (string)($row['signed_payload'] ?? ''),
    'timestampIso' => (string)($row['timestamp_iso'] ?? ''),
    'feeCents' => (int)($row['fee_cents'] ?? 0),
    'createdAtIso' => (string)($row['created_at_iso'] ?? ''),
    'updatedAtIso' => (string)($row['updated_at_iso'] ?? ''),
  ];
  if (!empty($row['notarized_at_iso'])) {
    $out['notarizedAtIso'] = (string)$row['notarized_at_iso'];
  }
  return $out;
}

function mapCustodyRow(array $row): array {
  return [
    'id' => (string)$row['id'],
    'ownerId' => (string)$row['owner_id'],
    'caseId' => (string)$row['case_id'],
    'step' => (string)$row['step'],
    'actor' => (string)$row['actor'],
    'details' => (string)$row['details'],
    'eventHash' => (string)$row['event_hash'],
    'recordedAtIso' => (string)$row['recorded_at_iso'],
  ];
}

function mapJournalRow(array $row): array {
  return [
    'id' => (string)$row['id'],
    'ownerId' => (string)$row['owner_id'],
    'caseId' => (string)$row['case_id'],
    'entryNumber' => (string)$row['entry_number'],
    'documentTitle' => (string)$row['document_title'],
    'fileName' => (string)$row['file_name'],
    'actType' => (string)$row['act_type'],
    'notarizationMode' => (string)$row['notarization_mode'] === 'in_person' ? 'in_person' : 'online',
    'meetingLocation' => (string)($row['meeting_location'] ?? ''),
    'signerName' => (string)$row['signer_name'],
    'idMethod' => (string)$row['id_method'],
    'certificateCode' => (string)$row['certificate_code'],
    'sealedHash' => (string)$row['sealed_hash'],
    'timestampIso' => (string)$row['timestamp_iso'],
    'feeCents' => (int)($row['fee_cents'] ?? 0),
    'recordedAtIso' => (string)$row['recorded_at_iso'],
  ];
}

function mapVerificationRow(array $row): array {
  return [
    'certificateCode' => (string)$row['certificate_code'],
    'ownerId' => (string)$row['owner_id'],
    'caseId' => (string)$row['case_id'],
    'documentTitle' => (string)$row['document_title'],
    'fileName' => (string)$row['file_name'],
    'fileSize' => (int)($row['file_size'] ?? 0),
    'actType' => (string)$row['act_type'],
    'notarizationMode' => (string)$row['notarization_mode'] === 'in_person' ? 'in_person' : 'online',
    'meetingLocation' => (string)($row['meeting_location'] ?? ''),
    'documentHash' => (string)$row['document_hash'],
    'sealedHash' => (string)$row['sealed_hash'],
    'signatureAlgorithm' => (string)$row['signature_algorithm'],
    'publicKeyJwk' => (string)$row['public_key_jwk'],
    'digitalSignature' => (string)$row['digital_signature'],
    'signedPayload' => (string)$row['signed_payload'],
    'timestampIso' => (string)$row['timestamp_iso'],
    'notaryName' => (string)$row['notary_name'],
    'notaryCommission' => (string)$row['notary_commission'],
    'notaryJurisdiction' => (string)$row['notary_jurisdiction'],
    'notaryExpires' => (string)$row['notary_expires'],
    'notarizedAtIso' => (string)$row['notarized_at_iso'],
  ];
}

function createSessionToken(PDO $pdo, string $uid): string {
  $now = nowIso();
  $expiresDt = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('+30 days');
  $expiresIso = $expiresDt->format('Y-m-d\TH:i:s.v\Z');
  $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');

  $pdo->prepare('DELETE FROM sessions WHERE expires_at_iso < ?')->execute([$now]);
  $pdo->prepare('INSERT INTO sessions (token, uid, expires_at_iso, created_at_iso) VALUES (?, ?, ?, ?)')
    ->execute([$token, $uid, $expiresIso, $now]);
  return $token;
}

function resolveAuthUser(PDO $pdo): ?array {
  $token = getSessionToken();
  if ($token === '') return null;
  $stmt = $pdo->prepare(
    'SELECT u.uid, u.email, u.display_name, u.created_at_iso, s.expires_at_iso
     FROM sessions s
     JOIN users u ON u.uid = s.uid
     WHERE s.token = ?'
  );
  $stmt->execute([$token]);
  $row = $stmt->fetch();
  if (!$row) return null;
  if ((string)$row['expires_at_iso'] < nowIso()) {
    $pdo->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
    return null;
  }
  return [
    'uid' => (string)$row['uid'],
    'email' => (string)$row['email'],
    'displayName' => (string)$row['display_name'],
    'createdAtIso' => (string)$row['created_at_iso'],
  ];
}

function requireAuth(PDO $pdo): array {
  $user = resolveAuthUser($pdo);
  if (!$user) {
    sendJson(401, ['ok' => false, 'error' => 'Authentication required.']);
  }
  return $user;
}

function hasAnyUsers(PDO $pdo): bool {
  $row = $pdo->query('SELECT COUNT(*) AS cnt FROM users')->fetch();
  return ((int)($row['cnt'] ?? 0)) > 0;
}

function base64UrlEncode(string $bin): string {
  return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function base64UrlDecode(string $b64u): string {
  $pad = (4 - (strlen($b64u) % 4)) % 4;
  return base64_decode(strtr($b64u, '-_', '+/') . str_repeat('=', $pad), true) ?: '';
}

function ecdsaDerToIeeeP1363(string $der): string {
  $pos = 0;
  if (strlen($der) < 8 || ord($der[$pos++]) !== 0x30) {
    throw new RuntimeException('Invalid ECDSA DER sequence.');
  }
  $seqLen = ord($der[$pos++]);
  if (($seqLen & 0x80) !== 0) {
    $numBytes = $seqLen & 0x7f;
    $pos += $numBytes;
  }
  if (ord($der[$pos++]) !== 0x02) {
    throw new RuntimeException('Invalid DER integer R.');
  }
  $rLen = ord($der[$pos++]);
  $r = substr($der, $pos, $rLen);
  $pos += $rLen;

  if (ord($der[$pos++]) !== 0x02) {
    throw new RuntimeException('Invalid DER integer S.');
  }
  $sLen = ord($der[$pos++]);
  $s = substr($der, $pos, $sLen);

  $r = ltrim($r, "\x00");
  $s = ltrim($s, "\x00");
  $r = str_pad($r, 32, "\x00", STR_PAD_LEFT);
  $s = str_pad($s, 32, "\x00", STR_PAD_LEFT);
  if (strlen($r) > 32) $r = substr($r, -32);
  if (strlen($s) > 32) $s = substr($s, -32);
  return $r . $s;
}

function ecdsaIeeeP1363ToDer(string $sig64): string {
  if (strlen($sig64) !== 64) {
    throw new RuntimeException('Invalid P-256 signature length.');
  }
  $encodeInt = static function (string $bytes): string {
    $trimmed = ltrim($bytes, "\x00");
    if ($trimmed === '') $trimmed = "\x00";
    if ((ord($trimmed[0]) & 0x80) !== 0) {
      $trimmed = "\x00" . $trimmed;
    }
    return "\x02" . chr(strlen($trimmed)) . $trimmed;
  };
  $rDer = $encodeInt(substr($sig64, 0, 32));
  $sDer = $encodeInt(substr($sig64, 32, 32));
  $body = $rDer . $sDer;
  return "\x30" . chr(strlen($body)) . $body;
}

function p256JwkToPem(array $jwk): string {
  if (($jwk['kty'] ?? '') !== 'EC' || ($jwk['crv'] ?? '') !== 'P-256') {
    throw new RuntimeException('Unsupported JWK key type.');
  }
  $x = str_pad(base64UrlDecode((string)($jwk['x'] ?? '')), 32, "\x00", STR_PAD_LEFT);
  $y = str_pad(base64UrlDecode((string)($jwk['y'] ?? '')), 32, "\x00", STR_PAD_LEFT);
  if (strlen($x) !== 32 || strlen($y) !== 32) {
    throw new RuntimeException('Invalid P-256 JWK coordinates.');
  }
  // ASN.1 SubjectPublicKeyInfo header for P-256 uncompressed EC point (0x04 || x || y)
  $spkiHeader = hex2bin('3059301306072a8648ce3d020106082a8648ce3d03010703420004');
  $der = $spkiHeader . $x . $y;
  return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

try {
  $dbCtx = openDatabase();
  /** @var PDO $pdo */
  $pdo = $dbCtx['pdo'];
  $driver = (string)$dbCtx['driver'];

  $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
  if ($method === 'OPTIONS') {
    sendJson(200, ['ok' => true]);
  }

  $route = '';
  if (isset($_GET['route']) && is_string($_GET['route'])) {
    $route = trim($_GET['route'], '/');
  } else {
    $uriPath = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $uriPath = preg_replace('#^/api/?#', '', $uriPath);
    $route = trim((string)$uriPath, '/');
  }

  // Health & Updater status
  if ($method === 'GET' && ($route === '' || $route === 'health')) {
    sendJson(200, ['ok' => true, 'driver' => $driver, 'php' => PHP_VERSION]);
  }

  if ($method === 'GET' && $route === 'update/status') {
    sendJson(200, [
      'ok' => true,
      'hasGit' => false,
      'repoConfigured' => false,
      'repoSlug' => '',
      'branch' => 'main',
      'originUrl' => '',
      'localCommit' => '',
      'localShortCommit' => '',
      'localMessage' => '',
      'remoteCommit' => '',
      'remoteShortCommit' => '',
      'remoteCommitMessage' => '',
      'remoteCommitDate' => '',
      'remoteCommitUrl' => '',
      'dirtyTree' => false,
      'updateAvailable' => false,
      'runningBuild' => null,
    ]);
  }

  // Auth endpoints
  if ($method === 'GET' && $route === 'auth/me') {
    $user = resolveAuthUser($pdo);
    sendJson(200, [
      'ok' => true,
      'user' => $user,
      'hasAnyUsers' => hasAnyUsers($pdo),
    ]);
  }

  if ($method === 'POST' && $route === 'auth/register') {
    $body = readJsonBody();
    $fullName = trim((string)($body['fullName'] ?? ''));
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $password = (string)($body['password'] ?? '');

    $fullName = mb_substr($fullName, 0, 100);
    $email = mb_substr($email, 0, 120);

    if ($email === '' || !str_contains($email, '@')) {
      sendJson(400, ['ok' => false, 'error' => 'Please enter a valid email address.']);
    }
    if ($fullName === '') {
      sendJson(400, ['ok' => false, 'error' => 'Please enter your full legal name.']);
    }
    if (strlen($password) < 6) {
      sendJson(400, ['ok' => false, 'error' => 'Password must be at least 6 characters long.']);
    }

    $checkStmt = $pdo->prepare('SELECT uid FROM users WHERE email = ?');
    $checkStmt->execute([$email]);
    if ($checkStmt->fetch()) {
      sendJson(400, ['ok' => false, 'error' => 'An account already exists with this email address.']);
    }

    $uid = makeId('usr');
    $now = nowIso();
    $pwHash = password_hash($password, PASSWORD_DEFAULT);

    $pdo->beginTransaction();
    try {
      $pdo->prepare(
        'INSERT INTO users (uid, email, display_name, password_hash, created_at_iso) VALUES (?, ?, ?, ?, ?)'
      )->execute([$uid, $email, $fullName, $pwHash, $now]);

      $pdo->prepare(
        "INSERT INTO user_profiles (
          uid, display_name, email, phone, location,
          commission_number, commission_jurisdiction, commission_expires,
          custom_stamp_data_url, saved_signature_data, saved_signature_type,
          created_at_iso, updated_at_iso
        ) VALUES (?, ?, ?, '', 'San Francisco, CA', 'CA-2491804', 'State of California', '2028-09-30', '', '', 'none', ?, ?)"
      )->execute([$uid, $fullName, $email, $now, $now]);

      $folderStmt = $pdo->prepare(
        'INSERT INTO folders (id, owner_id, name, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?)'
      );
      foreach (DEFAULT_FOLDER_NAMES as $folderName) {
        $folderStmt->execute([makeId('fld'), $uid, $folderName, $now, $now]);
      }

      $token = createSessionToken($pdo, $uid);
      $pdo->commit();
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      throw $e;
    }

    setSessionCookie($token);
    sendJson(200, [
      'ok' => true,
      'user' => [
        'uid' => $uid,
        'email' => $email,
        'displayName' => $fullName,
        'createdAtIso' => $now,
      ],
      'token' => $token,
    ]);
  }

  if ($method === 'POST' && $route === 'auth/login') {
    $body = readJsonBody();
    $email = strtolower(trim((string)($body['email'] ?? '')));
    $password = (string)($body['password'] ?? '');

    $stmt = $pdo->prepare(
      'SELECT uid, email, display_name, password_hash, created_at_iso FROM users WHERE email = ?'
    );
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, (string)$row['password_hash'])) {
      sendJson(401, ['ok' => false, 'error' => 'Invalid email or password.']);
    }

    $token = createSessionToken($pdo, (string)$row['uid']);
    setSessionCookie($token);
    sendJson(200, [
      'ok' => true,
      'user' => [
        'uid' => (string)$row['uid'],
        'email' => (string)$row['email'],
        'displayName' => (string)$row['display_name'],
        'createdAtIso' => (string)$row['created_at_iso'],
      ],
      'token' => $token,
    ]);
  }

  if ($method === 'POST' && $route === 'auth/logout') {
    $token = getSessionToken();
    if ($token !== '') {
      $pdo->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
    }
    clearSessionCookie();
    sendJson(200, ['ok' => true]);
  }

  if ($method === 'POST' && $route === 'auth/change-password') {
    $user = requireAuth($pdo);
    $body = readJsonBody();
    $currentPassword = (string)($body['currentPassword'] ?? '');
    $newPassword = (string)($body['newPassword'] ?? '');
    if (strlen($newPassword) < 6) {
      sendJson(400, ['ok' => false, 'error' => 'New password must be at least 6 characters long.']);
    }
    $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE uid = ?');
    $stmt->execute([$user['uid']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($currentPassword, (string)$row['password_hash'])) {
      sendJson(400, ['ok' => false, 'error' => 'Current password is incorrect.']);
    }
    $nextHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $pdo->prepare('UPDATE users SET password_hash = ? WHERE uid = ?')
      ->execute([$nextHash, $user['uid']]);
    sendJson(200, ['ok' => true]);
  }

  // Workspace snapshot
  if ($method === 'GET' && $route === 'workspace') {
    $user = requireAuth($pdo);
    $uid = $user['uid'];
    $now = nowIso();

    $profStmt = $pdo->prepare('SELECT * FROM user_profiles WHERE uid = ?');
    $profStmt->execute([$uid]);
    $profRow = $profStmt->fetch();
    if (!$profRow) {
      $pdo->prepare(
        "INSERT INTO user_profiles (
          uid, display_name, email, phone, location,
          commission_number, commission_jurisdiction, commission_expires,
          custom_stamp_data_url, saved_signature_data, saved_signature_type,
          created_at_iso, updated_at_iso
        ) VALUES (?, ?, ?, '', 'San Francisco, CA', 'CA-2491804', 'State of California', '2028-09-30', '', '', 'none', ?, ?)"
      )->execute([$uid, $user['displayName'], $user['email'], $now, $now]);
      $profStmt->execute([$uid]);
      $profRow = $profStmt->fetch();
    }

    $fldStmt = $pdo->prepare('SELECT * FROM folders WHERE owner_id = ? ORDER BY name ASC');
    $fldStmt->execute([$uid]);
    $fldRows = $fldStmt->fetchAll();
    if (count($fldRows) === 0) {
      $insFld = $pdo->prepare(
        'INSERT INTO folders (id, owner_id, name, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?)'
      );
      foreach (DEFAULT_FOLDER_NAMES as $fname) {
        $insFld->execute([makeId('fld'), $uid, $fname, $now, $now]);
      }
      $fldStmt->execute([$uid]);
      $fldRows = $fldStmt->fetchAll();
    }

    $caseStmt = $pdo->prepare('SELECT * FROM notarizations WHERE owner_id = ? ORDER BY updated_at_iso DESC');
    $caseStmt->execute([$uid]);
    $caseRows = $caseStmt->fetchAll();

    $custStmt = $pdo->prepare('SELECT * FROM custody_events WHERE owner_id = ? ORDER BY recorded_at_iso ASC');
    $custStmt->execute([$uid]);
    $custodyByCase = [];
    foreach ($custStmt->fetchAll() as $cr) {
      $ev = mapCustodyRow($cr);
      $custodyByCase[$ev['caseId']][] = $ev;
    }

    $jrnStmt = $pdo->prepare('SELECT * FROM journal_entries WHERE owner_id = ? ORDER BY recorded_at_iso DESC');
    $jrnStmt->execute([$uid]);
    $jrnRows = $jrnStmt->fetchAll();

    $verStmt = $pdo->prepare('SELECT * FROM verifications WHERE owner_id = ? ORDER BY notarized_at_iso DESC');
    $verStmt->execute([$uid]);
    $verifications = [];
    foreach ($verStmt->fetchAll() as $vr) {
      $v = mapVerificationRow($vr);
      $verifications[$v['certificateCode']] = $v;
    }

    sendJson(200, [
      'ok' => true,
      'profile' => mapProfileRow($profRow ?: []),
      'folders' => array_map('mapFolderRow', $fldRows),
      'cases' => array_map('mapCaseRow', $caseRows),
      'journalEntries' => array_map('mapJournalRow', $jrnRows),
      'custodyByCase' => $custodyByCase ?: new stdClass(),
      'verifications' => $verifications ?: new stdClass(),
    ]);
  }

  // Profile update
  if ($method === 'PUT' && $route === 'profile') {
    $user = requireAuth($pdo);
    $uid = $user['uid'];
    $input = readJsonBody();
    $now = nowIso();

    $sigType = (string)($input['savedSignatureType'] ?? 'none');
    if ($sigType !== 'drawn' && $sigType !== 'typed') $sigType = 'none';
    $sigData = $sigType === 'none' ? '' : mb_substr((string)($input['savedSignatureData'] ?? ''), 0, 500000);

    $displayName = mb_substr(trim((string)($input['displayName'] ?? '')), 0, 120) ?: 'Notary User';
    $email = mb_substr(trim((string)($input['email'] ?? '')), 0, 190);
    $phone = mb_substr(trim((string)($input['phone'] ?? '')), 0, 55);
    $location = mb_substr(trim((string)($input['location'] ?? '')), 0, 190);
    $commissionNumber = mb_substr(trim((string)($input['commissionNumber'] ?? '')), 0, 75);
    $commissionJurisdiction = mb_substr(trim((string)($input['commissionJurisdiction'] ?? '')), 0, 75);
    $commissionExpires = mb_substr(trim((string)($input['commissionExpires'] ?? '')), 0, 35);
    $customStamp = mb_substr((string)($input['customStampDataUrl'] ?? ''), 0, 500000);

    $pdo->prepare(
      'UPDATE user_profiles SET
        display_name = ?, email = ?, phone = ?, location = ?,
        commission_number = ?, commission_jurisdiction = ?, commission_expires = ?,
        custom_stamp_data_url = ?, saved_signature_data = ?, saved_signature_type = ?,
        updated_at_iso = ?
       WHERE uid = ?'
    )->execute([
      $displayName, $email, $phone, $location,
      $commissionNumber, $commissionJurisdiction, $commissionExpires,
      $customStamp, $sigData, $sigType,
      $now, $uid,
    ]);

    $pdo->prepare('UPDATE users SET display_name = ? WHERE uid = ?')
      ->execute([$displayName, $uid]);

    $stmt = $pdo->prepare('SELECT * FROM user_profiles WHERE uid = ?');
    $stmt->execute([$uid]);
    $row = $stmt->fetch();
    sendJson(200, ['ok' => true, 'profile' => mapProfileRow($row ?: [])]);
  }

  // Folders
  if ($method === 'POST' && $route === 'folders') {
    $user = requireAuth($pdo);
    $body = readJsonBody();
    $id = sanitizeId($body['id'] ?? '') ?: makeId('fld');
    $name = mb_substr(trim((string)($body['name'] ?? '')), 0, 60) ?: 'Untitled Folder';
    $now = nowIso();
    $pdo->prepare(
      'INSERT INTO folders (id, owner_id, name, created_at_iso, updated_at_iso) VALUES (?, ?, ?, ?, ?)'
    )->execute([$id, $user['uid'], $name, $now, $now]);
    sendJson(200, [
      'ok' => true,
      'folder' => [
        'id' => $id,
        'ownerId' => $user['uid'],
        'name' => $name,
        'createdAtIso' => $now,
        'updatedAtIso' => $now,
      ],
    ]);
  }

  if (preg_match('#^folders/([^/]+)$#', $route, $m)) {
    $user = requireAuth($pdo);
    $folderId = sanitizeId(urldecode($m[1]));
    if ($folderId === '') {
      sendJson(400, ['ok' => false, 'error' => 'Invalid folder ID.']);
    }
    if ($method === 'PATCH') {
      $body = readJsonBody();
      $name = mb_substr(trim((string)($body['name'] ?? '')), 0, 60) ?: 'Untitled Folder';
      $now = nowIso();
      $stmt = $pdo->prepare('UPDATE folders SET name = ?, updated_at_iso = ? WHERE id = ? AND owner_id = ?');
      $stmt->execute([$name, $now, $folderId, $user['uid']]);
      $getStmt = $pdo->prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?');
      $getStmt->execute([$folderId, $user['uid']]);
      $row = $getStmt->fetch();
      if (!$row) {
        sendJson(404, ['ok' => false, 'error' => 'Folder not found.']);
      }
      sendJson(200, ['ok' => true, 'folder' => mapFolderRow($row)]);
    }
    if ($method === 'DELETE') {
      $pdo->prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?')
        ->execute([$folderId, $user['uid']]);
      sendJson(200, ['ok' => true]);
    }
  }

  // Case file upload / download
  if (preg_match('#^cases/([^/]+)/file$#', $route, $m)) {
    $user = requireAuth($pdo);
    $caseId = sanitizeId(urldecode($m[1]));
    if ($caseId === '') {
      sendJson(400, ['ok' => false, 'error' => 'Invalid case ID.']);
    }
    $caseStmt = $pdo->prepare('SELECT id, file_name, file_type FROM notarizations WHERE id = ? AND owner_id = ?');
    $caseStmt->execute([$caseId, $user['uid']]);
    $caseRow = $caseStmt->fetch();

    if ($method === 'POST') {
      if (!$caseRow) {
        sendJson(404, ['ok' => false, 'error' => 'Notarization case not found.']);
      }
      $bytes = file_get_contents('php://input');
      if ($bytes === false || strlen($bytes) === 0) {
        sendJson(400, ['ok' => false, 'error' => 'Empty file payload.']);
      }
      ensureDataDirs();
      $targetPath = FILES_DIR . '/' . $caseId . '.bin';
      $tmpPath = FILES_DIR . '/' . $caseId . '.' . time() . '.tmp';
      if (file_put_contents($tmpPath, $bytes) === false || !rename($tmpPath, $targetPath)) {
        sendJson(500, ['ok' => false, 'error' => 'Unable to store document file on host.']);
      }
      sendJson(200, ['ok' => true, 'bytesSaved' => strlen($bytes)]);
    }

    if ($method === 'GET') {
      if (!$caseRow) {
        sendJson(404, ['ok' => false, 'error' => 'Notarization case not found.']);
      }
      $targetPath = FILES_DIR . '/' . $caseId . '.bin';
      if (!is_file($targetPath)) {
        sendJson(404, ['ok' => false, 'error' => 'File not found on server.']);
      }
      $mime = trim((string)($caseRow['file_type'] ?? '')) ?: 'application/octet-stream';
      header('Content-Type: ' . $mime);
      header('Cache-Control: private, max-age=3600');
      header('Content-Length: ' . filesize($targetPath));
      readfile($targetPath);
      exit;
    }
  }

  // Case seal
  if ($method === 'POST' && preg_match('#^cases/([^/]+)/seal$#', $route, $m)) {
    $user = requireAuth($pdo);
    $uid = $user['uid'];
    $caseId = sanitizeId(urldecode($m[1]));
    if ($caseId === '') {
      sendJson(400, ['ok' => false, 'error' => 'Invalid case ID.']);
    }
    $body = readJsonBody();

    $pdo->beginTransaction();
    try {
      $stmt = $pdo->prepare('SELECT * FROM notarizations WHERE id = ? AND owner_id = ?');
      $stmt->execute([$caseId, $uid]);
      $existingRow = $stmt->fetch();
      if (!$existingRow) {
        $pdo->rollBack();
        sendJson(404, ['ok' => false, 'error' => 'Notarization case not found.']);
      }
      $existing = mapCaseRow($existingRow);
      if ($existing['status'] === 'notarized') {
        $pdo->rollBack();
        sendJson(400, ['ok' => false, 'error' => 'This document is already notarized and sealed.']);
      }

      $tsIso = trim((string)($body['timestampIso'] ?? '')) ?: nowIso();
      $cntRow = $pdo->prepare('SELECT COUNT(*) AS cnt FROM journal_entries WHERE owner_id = ?');
      $cntRow->execute([$uid]);
      $cnt = (int)($cntRow->fetch()['cnt'] ?? 0);
      $entryNumber = sprintf('NJ-2026-%04d', $cnt + 1);
      $entryId = makeId('jrn');
      $eventId = makeId('ev');

      $notaryName = mb_substr(trim((string)($body['notaryName'] ?? '')), 0, 100);
      $notaryCommission = mb_substr(trim((string)($body['notaryCommission'] ?? '')), 0, 60);
      $notaryJurisdiction = mb_substr(trim((string)($body['notaryJurisdiction'] ?? '')), 0, 60);
      $notaryExpires = mb_substr(trim((string)($body['notaryExpires'] ?? '')), 0, 30);
      $notaryStamp = mb_substr((string)($body['notaryStampDataUrl'] ?? ''), 0, 500000);
      $includeCertLogo = (!isset($body['includeCertifiedLogo']) || $body['includeCertifiedLogo'] !== false) ? 1 : 0;
      $includeNotMark = (!isset($body['includeNotarizedMark']) || $body['includeNotarizedMark'] !== false) ? 1 : 0;
      $certificateCode = trim((string)($body['certificateCode'] ?? ''));
      $sealedHash = (string)($body['sealedHash'] ?? '');
      $signatureAlgorithm = (string)($body['signatureAlgorithm'] ?? '');
      $publicKeyJwk = (string)($body['publicKeyJwk'] ?? '');
      $digitalSignature = (string)($body['digitalSignature'] ?? '');
      $signedPayload = (string)($body['signedPayload'] ?? '');
      $custodyEventHash = (string)($body['custodyEventHash'] ?? '');

      $pdo->prepare(
        "UPDATE notarizations SET
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
         WHERE id = ? AND owner_id = ?"
      )->execute([
        $notaryName, $notaryCommission, $notaryJurisdiction, $notaryExpires, $notaryStamp,
        $includeCertLogo, $includeNotMark,
        $certificateCode, $sealedHash, $signatureAlgorithm,
        $publicKeyJwk, $digitalSignature, $signedPayload,
        $tsIso, $tsIso, $tsIso,
        $caseId, $uid,
      ]);

      $pdo->prepare(
        'INSERT INTO journal_entries (
          id, owner_id, case_id, entry_number, document_title, file_name,
          act_type, notarization_mode, meeting_location, signer_name,
          id_method, certificate_code, sealed_hash, timestamp_iso,
          fee_cents, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )->execute([
        $entryId, $uid, $existing['id'], $entryNumber, $existing['title'], $existing['fileName'],
        $existing['actType'], $existing['notarizationMode'], $existing['meetingLocation'], $existing['signerName'],
        $existing['idMethod'] ?: 'Government Photo ID + KBA', $certificateCode, $sealedHash, $tsIso,
        $existing['feeCents'], $tsIso,
      ]);

      $pdo->prepare(
        'INSERT INTO verifications (
          certificate_code, owner_id, case_id, document_title, file_name,
          file_size, act_type, notarization_mode, meeting_location,
          document_hash, sealed_hash, signature_algorithm, public_key_jwk,
          digital_signature, signed_payload, timestamp_iso,
          notary_name, notary_commission, notary_jurisdiction, notary_expires,
          notarized_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )->execute([
        $certificateCode, $uid, $existing['id'], $existing['title'], $existing['fileName'],
        $existing['fileSize'], $existing['actType'], $existing['notarizationMode'], $existing['meetingLocation'],
        $existing['documentHash'], $sealedHash, $signatureAlgorithm, $publicKeyJwk,
        $digitalSignature, $signedPayload, $tsIso,
        $notaryName, $notaryCommission, $notaryJurisdiction, $notaryExpires,
        $tsIso,
      ]);

      $details = mb_substr("Certificate {$certificateCode} sealed & recorded in statutory journal", 0, 300);
      $pdo->prepare(
        'INSERT INTO custody_events (
          id, owner_id, case_id, step, actor, details, event_hash, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )->execute([
        $eventId, $uid, $existing['id'],
        'Notary Seal & ECDSA Timestamp Applied',
        mb_substr($notaryName, 0, 120),
        $details,
        $custodyEventHash,
        $tsIso,
      ]);

      $pdo->commit();

      $cStmt = $pdo->prepare('SELECT * FROM notarizations WHERE id = ?');
      $cStmt->execute([$caseId]);
      $jStmt = $pdo->prepare('SELECT * FROM journal_entries WHERE id = ?');
      $jStmt->execute([$entryId]);
      $vStmt = $pdo->prepare('SELECT * FROM verifications WHERE certificate_code = ?');
      $vStmt->execute([$certificateCode]);
      $eStmt = $pdo->prepare('SELECT * FROM custody_events WHERE id = ?');
      $eStmt->execute([$eventId]);

      sendJson(200, [
        'ok' => true,
        'caseRecord' => mapCaseRow($cStmt->fetch()),
        'journalRecord' => mapJournalRow($jStmt->fetch()),
        'verificationRecord' => mapVerificationRow($vStmt->fetch()),
        'custodyRecord' => mapCustodyRow($eStmt->fetch()),
      ]);
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      throw $e;
    }
  }

  // Create case
  if ($method === 'POST' && $route === 'cases') {
    $user = requireAuth($pdo);
    $uid = $user['uid'];
    $body = readJsonBody();

    $caseId = sanitizeId($body['id'] ?? '') ?: makeId('case');
    $evBody = is_array($body['custodyEvent'] ?? null) ? $body['custodyEvent'] : [];
    $eventId = sanitizeId($evBody['id'] ?? '') ?: makeId('ev');
    $now = nowIso();

    $mode = (($body['notarizationMode'] ?? '') === 'in_person') ? 'in_person' : 'online';
    $folderId = mb_substr(trim((string)($body['folderId'] ?? 'unfiled')), 0, 64) ?: 'unfiled';
    $title = mb_substr(trim((string)($body['title'] ?? '')), 0, 140) ?: 'Untitled Document';
    $fileName = mb_substr(trim((string)($body['fileName'] ?? '')), 0, 180) ?: 'document.txt';
    $fileType = mb_substr(trim((string)($body['fileType'] ?? 'text/plain')), 0, 100) ?: 'text/plain';
    $fileSize = max(0, min(524288000, (int)round((float)($body['fileSize'] ?? 0))));
    $actType = (string)($body['actType'] ?? 'Acknowledgment');
    $location = mb_substr(trim((string)($body['meetingLocation'] ?? '')), 0, 160);
    $signerName = mb_substr(trim((string)($body['signerName'] ?? '')), 0, 100) ?: 'Principal Signer';
    $signerEmail = mb_substr(trim((string)($body['signerEmail'] ?? '')), 0, 120) ?: 'signer@veriseal.example';
    $docText = mb_substr(trim((string)($body['documentText'] ?? '')), 0, 500000) ?: 'Document content';
    $docHash = (string)($body['documentHash'] ?? '');
    $idMethod = $mode === 'in_person' ? 'Physical Government Photo ID' : 'Government Photo ID + KBA';
    $includeCertLogo = (!isset($body['includeCertifiedLogo']) || $body['includeCertifiedLogo'] !== false) ? 1 : 0;
    $includeNotMark = (!isset($body['includeNotarizedMark']) || $body['includeNotarizedMark'] !== false) ? 1 : 0;
    $placement = parsePlacementJson($body['placement'] ?? null);
    $feeCents = max(0, min(100000, (int)round((float)($body['feeCents'] ?? 0))));

    $evStep = mb_substr(trim((string)($evBody['step'] ?? 'Document Uploaded & Hashed')), 0, 80);
    $evActor = mb_substr(trim((string)($evBody['actor'] ?? $signerName)), 0, 120);
    $evDetails = mb_substr(trim((string)($evBody['details'] ?? $fileName)), 0, 300);
    $evHash = (string)($evBody['eventHash'] ?? '');

    $pdo->beginTransaction();
    try {
      $pdo->prepare(
        "INSERT INTO notarizations (
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
        )"
      )->execute([
        $caseId, $uid, $folderId, $title, $fileName, $fileType, $fileSize,
        $actType, $mode, $location,
        $signerName, $signerEmail, $docText, $docHash,
        $idMethod,
        $includeCertLogo, $includeNotMark,
        json_encode($placement, JSON_UNESCAPED_SLASHES),
        $feeCents, $now, $now,
      ]);

      $pdo->prepare(
        'INSERT INTO custody_events (
          id, owner_id, case_id, step, actor, details, event_hash, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )->execute([
        $eventId, $uid, $caseId, $evStep, $evActor, $evDetails, $evHash, $now,
      ]);

      $pdo->commit();
    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      throw $e;
    }

    $cStmt = $pdo->prepare('SELECT * FROM notarizations WHERE id = ?');
    $cStmt->execute([$caseId]);
    $eStmt = $pdo->prepare('SELECT * FROM custody_events WHERE id = ?');
    $eStmt->execute([$eventId]);
    sendJson(200, [
      'ok' => true,
      'caseRecord' => mapCaseRow($cStmt->fetch()),
      'custodyRecord' => mapCustodyRow($eStmt->fetch()),
    ]);
  }

  // Update / Delete case
  if (preg_match('#^cases/([^/]+)$#', $route, $m)) {
    $user = requireAuth($pdo);
    $uid = $user['uid'];
    $caseId = sanitizeId(urldecode($m[1]));
    if ($caseId === '') {
      sendJson(400, ['ok' => false, 'error' => 'Invalid case ID.']);
    }

    if ($method === 'PATCH') {
      $body = readJsonBody();
      $pdo->beginTransaction();
      try {
        $stmt = $pdo->prepare('SELECT * FROM notarizations WHERE id = ? AND owner_id = ?');
        $stmt->execute([$caseId, $uid]);
        $existingRow = $stmt->fetch();
        if (!$existingRow) {
          $pdo->rollBack();
          sendJson(404, ['ok' => false, 'error' => 'Notarization case not found.']);
        }
        $existing = mapCaseRow($existingRow);

        $patchKeys = array_filter(array_keys($body), static fn($k) => $k !== 'custodyEvent');
        if ($existing['status'] === 'notarized') {
          foreach ($patchKeys as $pk) {
            if ($pk !== 'folderId') {
              $pdo->rollBack();
              sendJson(400, ['ok' => false, 'error' => 'Notarized records are sealed and immutable.']);
            }
          }
        }

        $now = nowIso();
        $nextFolderId = array_key_exists('folderId', $body)
          ? (mb_substr(trim((string)$body['folderId']), 0, 64) ?: 'unfiled')
          : $existing['folderId'];
        $nextMode = array_key_exists('notarizationMode', $body)
          ? (($body['notarizationMode'] === 'in_person') ? 'in_person' : 'online')
          : $existing['notarizationMode'];
        $nextLocation = array_key_exists('meetingLocation', $body)
          ? mb_substr(trim((string)$body['meetingLocation']), 0, 160)
          : $existing['meetingLocation'];
        $nextStatus = (isset($body['status']) && in_array($body['status'], ['draft', 'identity_verified', 'signed'], true))
          ? (string)$body['status']
          : $existing['status'];
        $nextIdMethod = array_key_exists('idMethod', $body)
          ? mb_substr(trim((string)$body['idMethod']), 0, 80)
          : $existing['idMethod'];
        $nextIdScore = array_key_exists('idScore', $body)
          ? max(0, min(100, (int)round((float)$body['idScore'])))
          : $existing['idScore'];
        $nextKbaPassed = array_key_exists('kbaPassed', $body)
          ? (bool)$body['kbaPassed']
          : $existing['kbaPassed'];
        $nextSigData = array_key_exists('signerSignatureData', $body)
          ? mb_substr((string)$body['signerSignatureData'], 0, 200000)
          : $existing['signerSignatureData'];
        $nextSigType = (isset($body['signatureType']) && in_array($body['signatureType'], ['none', 'drawn', 'typed'], true))
          ? (string)$body['signatureType']
          : $existing['signatureType'];
        $nextCertLogo = array_key_exists('includeCertifiedLogo', $body)
          ? (bool)$body['includeCertifiedLogo']
          : $existing['includeCertifiedLogo'];
        $nextNotMark = array_key_exists('includeNotarizedMark', $body)
          ? (bool)$body['includeNotarizedMark']
          : $existing['includeNotarizedMark'];
        $nextPlacement = array_key_exists('placement', $body)
          ? parsePlacementJson($body['placement'])
          : $existing['placement'];

        $pdo->prepare(
          'UPDATE notarizations SET
            folder_id = ?, notarization_mode = ?, meeting_location = ?, status = ?,
            id_method = ?, id_score = ?, kba_passed = ?,
            signer_signature_data = ?, signature_type = ?,
            include_certified_logo = ?, include_notarized_mark = ?,
            placement_json = ?, updated_at_iso = ?
           WHERE id = ? AND owner_id = ?'
        )->execute([
          $nextFolderId, $nextMode, $nextLocation, $nextStatus,
          $nextIdMethod, $nextIdScore, $nextKbaPassed ? 1 : 0,
          $nextSigData, $nextSigType,
          $nextCertLogo ? 1 : 0, $nextNotMark ? 1 : 0,
          json_encode($nextPlacement, JSON_UNESCAPED_SLASHES), $now,
          $caseId, $uid,
        ]);

        $custodyRecord = null;
        if (!empty($body['custodyEvent']) && is_array($body['custodyEvent'])) {
          $ev = $body['custodyEvent'];
          $eventId = makeId('ev');
          $pdo->prepare(
            'INSERT INTO custody_events (
              id, owner_id, case_id, step, actor, details, event_hash, recorded_at_iso
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          )->execute([
            $eventId, $uid, $caseId,
            mb_substr(trim((string)($ev['step'] ?? '')), 0, 80),
            mb_substr(trim((string)($ev['actor'] ?? '')), 0, 120),
            mb_substr(trim((string)($ev['details'] ?? '')), 0, 300),
            (string)($ev['eventHash'] ?? ''),
            $now,
          ]);
          $eStmt = $pdo->prepare('SELECT * FROM custody_events WHERE id = ?');
          $eStmt->execute([$eventId]);
          $evRow = $eStmt->fetch();
          if ($evRow) $custodyRecord = mapCustodyRow($evRow);
        }

        $pdo->commit();

        $uStmt = $pdo->prepare('SELECT * FROM notarizations WHERE id = ?');
        $uStmt->execute([$caseId]);
        $out = [
          'ok' => true,
          'caseRecord' => mapCaseRow($uStmt->fetch()),
        ];
        if ($custodyRecord !== null) {
          $out['custodyRecord'] = $custodyRecord;
        }
        sendJson(200, $out);
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
      }
    }

    if ($method === 'DELETE') {
      $stmt = $pdo->prepare('SELECT status FROM notarizations WHERE id = ? AND owner_id = ?');
      $stmt->execute([$caseId, $uid]);
      $row = $stmt->fetch();
      if ($row) {
        if ((string)$row['status'] === 'notarized') {
          sendJson(400, ['ok' => false, 'error' => 'Sealed notarization records cannot be deleted.']);
        }
        $pdo->prepare('DELETE FROM notarizations WHERE id = ? AND owner_id = ?')
          ->execute([$caseId, $uid]);
        $binPath = FILES_DIR . '/' . $caseId . '.bin';
        if (is_file($binPath)) {
          @unlink($binPath);
        }
      }
      sendJson(200, ['ok' => true]);
    }
  }

  // Public verification lookup
  if ($method === 'GET' && preg_match('#^verifications/([^/]+)$#', $route, $m)) {
    $code = strtoupper(trim(urldecode($m[1])));
    if ($code === '') {
      sendJson(404, ['ok' => false, 'error' => 'Certificate code not found.']);
    }
    $stmt = $pdo->prepare('SELECT * FROM verifications WHERE certificate_code = ?');
    $stmt->execute([$code]);
    $row = $stmt->fetch();
    if (!$row) {
      sendJson(404, ['ok' => false, 'error' => 'Certificate code not found.']);
    }
    sendJson(200, ['ok' => true, 'verification' => mapVerificationRow($row)]);
  }

  // OpenSSL ECDSA P-256 fallback for plain HTTP contexts
  if ($method === 'POST' && $route === 'crypto/sign') {
    requireAuth($pdo);
    $body = readJsonBody();
    $payload = isset($body['payload']) && is_string($body['payload']) ? $body['payload'] : '';
    if ($payload === '') {
      sendJson(400, ['ok' => false, 'error' => 'Payload is required.']);
    }
    $key = openssl_pkey_new([
      'curve_name' => 'prime256v1',
      'private_key_type' => OPENSSL_KEYTYPE_EC,
    ]);
    if ($key === false) {
      sendJson(500, ['ok' => false, 'error' => 'OpenSSL EC key generation unavailable.']);
    }
    $details = openssl_pkey_get_details($key);
    $x = str_pad((string)($details['ec']['x'] ?? ''), 32, "\x00", STR_PAD_LEFT);
    $y = str_pad((string)($details['ec']['y'] ?? ''), 32, "\x00", STR_PAD_LEFT);
    if (strlen($x) > 32) $x = substr($x, -32);
    if (strlen($y) > 32) $y = substr($y, -32);

    $derSig = '';
    if (!openssl_sign($payload, $derSig, $key, OPENSSL_ALGO_SHA256)) {
      sendJson(500, ['ok' => false, 'error' => 'OpenSSL ECDSA signing failed.']);
    }
    $p1363 = ecdsaDerToIeeeP1363($derSig);

    $jwk = [
      'kty' => 'EC',
      'crv' => 'P-256',
      'x' => base64UrlEncode($x),
      'y' => base64UrlEncode($y),
      'ext' => true,
      'key_ops' => ['verify'],
    ];

    sendJson(200, [
      'ok' => true,
      'publicKeyJwk' => json_encode($jwk, JSON_UNESCAPED_SLASHES),
      'digitalSignature' => base64_encode($p1363),
    ]);
  }

  if ($method === 'POST' && $route === 'crypto/verify') {
    $body = readJsonBody();
    $payload = isset($body['payload']) && is_string($body['payload']) ? $body['payload'] : '';
    $sigB64 = isset($body['signature']) && is_string($body['signature']) ? $body['signature'] : '';
    $jwkStr = isset($body['publicKeyJwk']) && is_string($body['publicKeyJwk']) ? $body['publicKeyJwk'] : '';

    if ($payload === '' || $sigB64 === '' || $jwkStr === '') {
      sendJson(200, ['ok' => true, 'valid' => false]);
    }
    try {
      $jwk = json_decode($jwkStr, true);
      if (!is_array($jwk)) {
        sendJson(200, ['ok' => true, 'valid' => false]);
      }
      $pem = p256JwkToPem($jwk);
      $sigRaw = base64_decode($sigB64, true);
      if ($sigRaw === false) {
        sendJson(200, ['ok' => true, 'valid' => false]);
      }
      $derSig = strlen($sigRaw) === 64 ? ecdsaIeeeP1363ToDer($sigRaw) : $sigRaw;
      $verified = openssl_verify($payload, $derSig, $pem, OPENSSL_ALGO_SHA256);
      sendJson(200, ['ok' => true, 'valid' => $verified === 1]);
    } catch (Throwable) {
      sendJson(200, ['ok' => true, 'valid' => false]);
    }
  }

  sendJson(404, ['ok' => false, 'error' => 'API endpoint not found.']);
} catch (Throwable $e) {
  sendJson(500, ['ok' => false, 'error' => $e->getMessage()]);
}
