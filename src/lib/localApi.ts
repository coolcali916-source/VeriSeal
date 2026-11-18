import type {
  CustodyEvent,
  DocumentFolder,
  DocumentPlacement,
  JournalEntry,
  NotarialActType,
  NotarizationCase,
  NotarizationMode,
  SignatureType,
  UserProfile,
  VerificationRecord,
} from '../types/notary';

const TOKEN_STORAGE_KEY = 'veriseal_vps_session_token';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  createdAtIso: string;
}

export interface WorkspaceSnapshot {
  profile: UserProfile;
  folders: DocumentFolder[];
  cases: NotarizationCase[];
  journalEntries: JournalEntry[];
  custodyByCase: Record<string, CustodyEvent[]>;
  verifications: Record<string, VerificationRecord>;
}

export function getStoredSessionToken(): string {
  try {
    return (
      window.localStorage.getItem(TOKEN_STORAGE_KEY) ||
      window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
      ''
    );
  } catch {
    return '';
  }
}

export function setStoredSessionToken(token: string): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / sandbox restrictions
  }
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = getStoredSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['X-VeriSeal-Token'] = token;
  }
  return headers;
}

async function apiJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = buildAuthHeaders(
    options.headers as Record<string, string> | undefined
  );
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers,
  });

  const text = await resp.text().catch(() => '');
  let data = {} as T & { ok?: boolean; error?: string };
  if (text) {
    try {
      data = JSON.parse(text) as T & { ok?: boolean; error?: string };
    } catch {
      // Non-JSON response (e.g. HTML error/challenge page)
    }
  }
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${resp.status})`);
  }
  return data;
}

export async function authMe(): Promise<{
  user: AuthUser | null;
  hasAnyUsers: boolean;
}> {
  return apiJson('/api/auth/me', { method: 'GET', cache: 'no-store' });
}

export async function authRegister(params: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await apiJson<{ user: AuthUser; token?: string }>(
    '/api/auth/register',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
  if (res.token) setStoredSessionToken(res.token);
  return res.user;
}

export async function authLogin(params: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await apiJson<{ user: AuthUser; token?: string }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
  if (res.token) setStoredSessionToken(res.token);
  return res.user;
}

export async function authLogout(): Promise<void> {
  try {
    await apiJson('/api/auth/logout', { method: 'POST' });
  } finally {
    setStoredSessionToken('');
  }
}

export async function authChangePassword(params: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await apiJson('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  return apiJson<WorkspaceSnapshot>('/api/workspace', {
    method: 'GET',
    cache: 'no-store',
  });
}

export async function apiSaveProfile(
  profile: Partial<UserProfile>
): Promise<UserProfile> {
  const res = await apiJson<{ profile: UserProfile }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
  return res.profile;
}

export async function apiCreateFolder(
  name: string,
  id?: string
): Promise<DocumentFolder> {
  const res = await apiJson<{ folder: DocumentFolder }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name, id }),
  });
  return res.folder;
}

export async function apiRenameFolder(
  folderId: string,
  name: string
): Promise<DocumentFolder> {
  const res = await apiJson<{ folder: DocumentFolder }>(
    `/api/folders/${encodeURIComponent(folderId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }
  );
  return res.folder;
}

export async function apiDeleteFolder(folderId: string): Promise<void> {
  await apiJson(`/api/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
  });
}

export async function apiCreateCase(params: {
  id: string;
  folderId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  actType: NotarialActType;
  notarizationMode: NotarizationMode;
  meetingLocation: string;
  signerName: string;
  signerEmail: string;
  documentText: string;
  documentHash: string;
  feeCents: number;
  includeCertifiedLogo: boolean;
  includeNotarizedMark: boolean;
  placement: DocumentPlacement;
  custodyEvent: {
    id: string;
    step: string;
    actor: string;
    details: string;
    eventHash: string;
  };
}): Promise<{
  caseRecord: NotarizationCase;
  custodyRecord: CustodyEvent;
}> {
  return apiJson('/api/cases', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function apiUpdateCase(
  caseId: string,
  patch: {
    folderId?: string;
    notarizationMode?: NotarizationMode;
    meetingLocation?: string;
    status?: 'draft' | 'identity_verified' | 'signed';
    idMethod?: string;
    idScore?: number;
    kbaPassed?: boolean;
    signerSignatureData?: string;
    signatureType?: SignatureType;
    includeCertifiedLogo?: boolean;
    includeNotarizedMark?: boolean;
    placement?: DocumentPlacement;
    custodyEvent?: {
      step: string;
      actor: string;
      details: string;
      eventHash: string;
    };
  }
): Promise<{
  caseRecord: NotarizationCase;
  custodyRecord?: CustodyEvent;
}> {
  return apiJson(`/api/cases/${encodeURIComponent(caseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteCase(caseId: string): Promise<void> {
  await apiJson(`/api/cases/${encodeURIComponent(caseId)}`, {
    method: 'DELETE',
  });
}

export async function apiSealCase(
  caseId: string,
  payload: {
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
  }
): Promise<{
  caseRecord: NotarizationCase;
  journalRecord: JournalEntry;
  verificationRecord: VerificationRecord;
  custodyRecord: CustodyEvent;
}> {
  return apiJson(`/api/cases/${encodeURIComponent(caseId)}/seal`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiUploadCaseFile(
  caseId: string,
  file: File
): Promise<void> {
  const bytes = await file.arrayBuffer();
  const headers = buildAuthHeaders({
    'Content-Type': file.type || 'application/octet-stream',
  });
  const resp = await fetch(`/api/cases/${encodeURIComponent(caseId)}/file`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: bytes,
  });
  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Unable to upload file to VPS storage.');
  }
}

export async function apiDownloadCaseFileBytes(
  caseId: string
): Promise<{ arrayBuffer: ArrayBuffer; contentType: string } | null> {
  try {
    const resp = await fetch(`/api/cases/${encodeURIComponent(caseId)}/file`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: buildAuthHeaders(),
    });
    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    const contentType =
      resp.headers.get('Content-Type') || 'application/octet-stream';
    return { arrayBuffer, contentType };
  } catch {
    return null;
  }
}

export async function apiVerifyCertificate(
  certificateCode: string
): Promise<VerificationRecord | null> {
  const cleaned = encodeURIComponent(certificateCode.trim().toUpperCase());
  const resp = await fetch(`/api/verifications/${cleaned}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (resp.status === 404) return null;
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    verification?: VerificationRecord;
    error?: string;
  };
  if (!resp.ok || !data.verification) {
    throw new Error(data.error || 'Unable to verify certificate.');
  }
  return data.verification;
}
