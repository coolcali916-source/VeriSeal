import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  changeUserPassword,
  createCaseWithInitialCustody,
  createFolder,
  deleteDraftCase,
  deleteFolder,
  deleteSessionToken,
  getDb,
  getPublicVerification,
  getUserBySessionToken,
  getWorkspaceForUser,
  hasAnyUsers,
  loginLocalUser,
  readCaseFileBytes,
  registerLocalUser,
  renameFolder,
  sanitizeId,
  sanitizePlacement,
  saveCaseFileBytes,
  saveUserProfile,
  sealNotarizationCase,
  updateCaseFields,
  type LocalAuthUser,
} from './server/localDb.ts';

const execFileAsync = promisify(execFile);
const ROOT_DIR = process.cwd();
const CONFIG_FILE = path.join(ROOT_DIR, '.veriseal-github.json');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface GitHubUpdateConfig {
  repoSlug: string;
  branch: string;
  lastSyncedCommit?: string;
  lastSyncedAt?: string;
}

interface BuildManifest {
  version: string;
  buildId: string;
  builtAt: string;
}

const VALID_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;
const VALID_BRANCH_RE = /^[a-zA-Z0-9._/-]+$/;

function parseGitHubRepoSlug(input?: string | null): string {
  const raw = (input || '').trim();
  if (!raw) return '';

  // Handle https://github.com/owner/repo(.git) or git@github.com:owner/repo(.git)
  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2];
    if (VALID_SEGMENT_RE.test(owner) && VALID_SEGMENT_RE.test(repo)) {
      return `${owner}/${repo}`;
    }
    return '';
  }

  const httpsMatch = raw.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
  );
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const repo = httpsMatch[2];
    if (VALID_SEGMENT_RE.test(owner) && VALID_SEGMENT_RE.test(repo)) {
      return `${owner}/${repo}`;
    }
    return '';
  }

  // Handle owner/repo shorthand
  const parts = raw.replace(/^\/+|\/+$/g, '').split('/');
  if (
    parts.length === 2 &&
    VALID_SEGMENT_RE.test(parts[0]) &&
    VALID_SEGMENT_RE.test(parts[1])
  ) {
    return `${parts[0]}/${parts[1]}`;
  }

  return '';
}

function sanitizeBranch(input?: string | null): string {
  const raw = (input || '').trim();
  if (!raw) return '';
  if (
    !VALID_BRANCH_RE.test(raw) ||
    raw.includes('..') ||
    raw.startsWith('-') ||
    raw.startsWith('/') ||
    raw.endsWith('/')
  ) {
    return '';
  }
  return raw;
}

function readSavedConfig(): GitHubUpdateConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { repoSlug: '', branch: 'main' };
    }
    const parsed = JSON.parse(
      fs.readFileSync(CONFIG_FILE, 'utf8')
    ) as Partial<GitHubUpdateConfig>;
    return {
      repoSlug: parseGitHubRepoSlug(parsed.repoSlug),
      branch: sanitizeBranch(parsed.branch) || 'main',
      lastSyncedCommit:
        typeof parsed.lastSyncedCommit === 'string'
          ? parsed.lastSyncedCommit
          : undefined,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
    };
  } catch {
    return { repoSlug: '', branch: 'main' };
  }
}

function writeSavedConfig(next: GitHubUpdateConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

function readDiskVersionManifest(): BuildManifest | null {
  try {
    const distVersionPath = path.join(DIST_DIR, 'version.json');
    if (fs.existsSync(distVersionPath)) {
      const parsed = JSON.parse(
        fs.readFileSync(distVersionPath, 'utf8')
      ) as Partial<BuildManifest>;
      if (parsed.buildId) {
        return {
          version: String(parsed.version || '1.0.0'),
          buildId: String(parsed.buildId),
          builtAt: String(parsed.builtAt || new Date().toISOString()),
        };
      }
    }
  } catch {
    // Ignore malformed dist manifest
  }
  return null;
}

let refreshedBuildManifest: BuildManifest | null = readDiskVersionManifest();
let updateInFlight = false;

async function runCmd(
  cmd: string,
  args: string[],
  cwd = ROOT_DIR,
  timeoutMs = 120000
): Promise<{ stdout: string; stderr: string }> {
  const res = await execFileAsync(cmd, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    stdout: String(res.stdout || '').trim(),
    stderr: String(res.stderr || '').trim(),
  };
}

async function tryCmd(
  cmd: string,
  args: string[],
  cwd = ROOT_DIR,
  timeoutMs = 10000
): Promise<string> {
  try {
    const { stdout } = await runCmd(cmd, args, cwd, timeoutMs);
    return stdout;
  } catch {
    return '';
  }
}

async function fetchGitHubHeadCommit(
  repoSlug: string,
  branch: string
): Promise<{
  sha: string;
  shortSha: string;
  message: string;
  date: string;
  url: string;
  error?: string;
}> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VeriSeal-Updater/1.0',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const endpoint = `https://api.github.com/repos/${repoSlug}/commits/${encodeURIComponent(
    branch
  )}`;
  const resp = await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      sha: '',
      shortSha: '',
      message: '',
      date: '',
      url: '',
      error: `GitHub API returned ${resp.status}${
        text ? `: ${text.slice(0, 140)}` : ''
      }`,
    };
  }
  const data = (await resp.json()) as {
    sha?: string;
    html_url?: string;
    commit?: {
      message?: string;
      committer?: { date?: string };
      author?: { date?: string };
    };
  };
  const sha = String(data.sha || '');
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: String(data.commit?.message || '').split('\n')[0],
    date: String(
      data.commit?.committer?.date || data.commit?.author?.date || ''
    ),
    url: String(data.html_url || `https://github.com/${repoSlug}`),
  };
}

async function getGitContext(
  overrideRepo?: string | null,
  overrideBranch?: string | null
) {
  const saved = readSavedConfig();
  const hasGit =
    (await tryCmd('git', ['rev-parse', '--is-inside-work-tree'])) === 'true';
  const originUrl = hasGit
    ? await tryCmd('git', ['remote', 'get-url', 'origin'])
    : '';
  const gitBranch = hasGit
    ? await tryCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    : '';
  const localCommit = hasGit
    ? await tryCmd('git', ['rev-parse', 'HEAD'])
    : saved.lastSyncedCommit || '';
  const localMessage = hasGit
    ? await tryCmd('git', ['log', '-1', '--format=%s'])
    : '';
  const dirtyOutput = hasGit
    ? await tryCmd('git', ['status', '--porcelain'])
    : '';

  const envRepo = parseGitHubRepoSlug(process.env.GITHUB_REPO);
  const originSlug = parseGitHubRepoSlug(originUrl);
  const queryRepo = parseGitHubRepoSlug(overrideRepo);

  const repoSlug = queryRepo || saved.repoSlug || envRepo || originSlug;
  const branch =
    sanitizeBranch(overrideBranch) ||
    saved.branch ||
    sanitizeBranch(process.env.GITHUB_BRANCH) ||
    (gitBranch && gitBranch !== 'HEAD' ? gitBranch : '') ||
    'main';

  return {
    hasGit,
    originUrl,
    repoSlug,
    branch,
    localCommit,
    localShortCommit: localCommit ? localCommit.slice(0, 7) : '',
    localMessage,
    dirtyTree: Boolean(dirtyOutput),
    saved,
  };
}

function copyDirectorySyncFiltered(srcDir: string, destDir: string): void {
  const skipTopLevel = new Set([
    '.git',
    'node_modules',
    'dist',
    '.env',
    '.env.local',
    '.env.production',
    'firebase-applet-config.json',
    '.veriseal-github.json',
    '.veriseal-data',
  ]);

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipTopLevel.has(entry.name) || entry.name.startsWith('.env')) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyDirectoryRecursive(srcDir: string, destDir: string): void {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function syncDependenciesAndBuild(packageJsonChanged: boolean) {
  if (packageJsonChanged) {
    const hasBunLock = fs.existsSync(path.join(ROOT_DIR, 'bun.lock'));
    const hasBun = Boolean(await tryCmd('bun', ['--version']));
    if (hasBunLock && hasBun) {
      await runCmd('bun', ['install'], ROOT_DIR, 180000);
    } else {
      await runCmd('npm', ['install', '--legacy-peer-deps'], ROOT_DIR, 180000);
    }
  }

  await runCmd('npm', ['run', 'build'], ROOT_DIR, 180000);
  const freshManifest = readDiskVersionManifest();
  if (freshManifest) {
    refreshedBuildManifest = freshManifest;
  }
  return freshManifest;
}

const SESSION_COOKIE = 'veriseal_session';

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function getSessionToken(req: Request): string {
  const xToken = req.headers['x-veriseal-token'];
  if (typeof xToken === 'string' && xToken.trim()) {
    return xToken.trim();
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return '';
}

function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || proto.includes('https');
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const https = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: https ? 'none' : 'lax',
    secure: https,
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  const https = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
  });
}

function resolveAuthUser(req: Request): LocalAuthUser | null {
  const token = getSessionToken(req);
  return getUserBySessionToken(token);
}

async function startServer() {
  getDb();
  const app = express();

  // Binary file upload/download on VPS disk (mounted before express.json)
  app.post(
    '/api/cases/:caseId/file',
    express.raw({ type: '*/*', limit: '100mb' }),
    (req: Request, res: Response) => {
      const user = resolveAuthUser(req);
      if (!user) {
        res.status(401).json({ ok: false, error: 'Authentication required.' });
        return;
      }
      const caseId = sanitizeId(req.params.caseId);
      if (!caseId) {
        res.status(400).json({ ok: false, error: 'Invalid case ID.' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
        res.status(400).json({ ok: false, error: 'Empty file payload.' });
        return;
      }
      try {
        saveCaseFileBytes(user.uid, caseId, req.body);
        res.json({ ok: true, bytesSaved: req.body.byteLength });
      } catch (err) {
        res.status(400).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to store file.',
        });
      }
    }
  );

  app.get('/api/cases/:caseId/file', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const caseId = sanitizeId(req.params.caseId);
    if (!caseId) {
      res.status(400).json({ ok: false, error: 'Invalid case ID.' });
      return;
    }
    const file = readCaseFileBytes(user.uid, caseId);
    if (!file) {
      res.status(404).json({ ok: false, error: 'File not found on server.' });
      return;
    }
    res.setHeader('Content-Type', file.fileType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.bytes);
  });

  app.use(express.json({ limit: '5mb' }));

  // Self-Hosted Local Authentication Endpoints (Zero cloud dependencies)
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    res.json({
      ok: true,
      user,
      hasAnyUsers: hasAnyUsers(),
    });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        fullName?: string;
        email?: string;
        password?: string;
      };
      const result = registerLocalUser({
        fullName: String(body.fullName || ''),
        email: String(body.email || ''),
        password: String(body.password || ''),
      });
      setSessionCookie(req, res, result.token);
      res.json({ ok: true, user: result.user, token: result.token });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Registration failed.',
      });
    }
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { email?: string; password?: string };
      const result = loginLocalUser({
        email: String(body.email || ''),
        password: String(body.password || ''),
      });
      setSessionCookie(req, res, result.token);
      res.json({ ok: true, user: result.user, token: result.token });
    } catch (err) {
      res.status(401).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Sign-in failed.',
      });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = getSessionToken(req);
    if (token) deleteSessionToken(token);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    try {
      const body = (req.body || {}) as {
        currentPassword?: string;
        newPassword?: string;
      };
      changeUserPassword({
        uid: user.uid,
        currentPassword: String(body.currentPassword || ''),
        newPassword: String(body.newPassword || ''),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to update password.',
      });
    }
  });

  // Self-Hosted Workspace Data Endpoints
  app.get('/api/workspace', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const workspace = getWorkspaceForUser(user);
    res.json({ ok: true, ...workspace });
  });

  app.put('/api/profile', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    try {
      const profile = saveUserProfile(user.uid, req.body || {});
      res.json({ ok: true, profile });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to save profile.',
      });
    }
  });

  app.post('/api/folders', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const body = (req.body || {}) as { id?: string; name?: string };
    const folder = createFolder(user.uid, String(body.name || ''), body.id);
    res.json({ ok: true, folder });
  });

  app.patch('/api/folders/:folderId', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const folderId = sanitizeId(req.params.folderId);
    if (!folderId) {
      res.status(400).json({ ok: false, error: 'Invalid folder ID.' });
      return;
    }
    const body = (req.body || {}) as { name?: string };
    const folder = renameFolder(user.uid, folderId, String(body.name || ''));
    if (!folder) {
      res.status(404).json({ ok: false, error: 'Folder not found.' });
      return;
    }
    res.json({ ok: true, folder });
  });

  app.delete('/api/folders/:folderId', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const folderId = sanitizeId(req.params.folderId);
    if (!folderId) {
      res.status(400).json({ ok: false, error: 'Invalid folder ID.' });
      return;
    }
    deleteFolder(user.uid, folderId);
    res.json({ ok: true });
  });

  app.post('/api/cases', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    try {
      const body = (req.body || {}) as {
        id?: string;
        folderId?: string;
        title?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        actType?: string;
        notarizationMode?: 'online' | 'in_person';
        meetingLocation?: string;
        signerName?: string;
        signerEmail?: string;
        documentText?: string;
        documentHash?: string;
        feeCents?: number;
        includeCertifiedLogo?: boolean;
        includeNotarizedMark?: boolean;
        placement?: unknown;
        custodyEvent?: {
          id?: string;
          step?: string;
          actor?: string;
          details?: string;
          eventHash?: string;
        };
      };
      const result = createCaseWithInitialCustody({
        uid: user.uid,
        caseData: {
          id: body.id,
          folderId: String(body.folderId || 'unfiled'),
          title: String(body.title || ''),
          fileName: String(body.fileName || ''),
          fileType: String(body.fileType || 'text/plain'),
          fileSize: Number(body.fileSize || 0),
          actType: String(body.actType || 'Acknowledgment'),
          notarizationMode:
            body.notarizationMode === 'in_person' ? 'in_person' : 'online',
          meetingLocation: String(body.meetingLocation || ''),
          signerName: String(body.signerName || ''),
          signerEmail: String(body.signerEmail || ''),
          documentText: String(body.documentText || ''),
          documentHash: String(body.documentHash || ''),
          feeCents: Number(body.feeCents || 0),
          includeCertifiedLogo: body.includeCertifiedLogo !== false,
          includeNotarizedMark: body.includeNotarizedMark !== false,
          placement: body.placement,
        },
        custodyEvent: {
          id: body.custodyEvent?.id,
          step: String(body.custodyEvent?.step || 'Document Uploaded & Hashed'),
          actor: String(body.custodyEvent?.actor || body.signerName || 'Signer'),
          details: String(body.custodyEvent?.details || body.fileName || ''),
          eventHash: String(body.custodyEvent?.eventHash || ''),
        },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to create case.',
      });
    }
  });

  app.patch('/api/cases/:caseId', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const caseId = sanitizeId(req.params.caseId);
    if (!caseId) {
      res.status(400).json({ ok: false, error: 'Invalid case ID.' });
      return;
    }
    try {
      const body = (req.body || {}) as {
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
        placement?: unknown;
        custodyEvent?: {
          step: string;
          actor: string;
          details: string;
          eventHash: string;
        };
      };

      const patch: Parameters<typeof updateCaseFields>[2] = {};
      if (body.folderId !== undefined) patch.folderId = String(body.folderId);
      if (body.notarizationMode !== undefined) {
        patch.notarizationMode =
          body.notarizationMode === 'in_person' ? 'in_person' : 'online';
      }
      if (body.meetingLocation !== undefined) {
        patch.meetingLocation = String(body.meetingLocation);
      }
      if (
        body.status === 'draft' ||
        body.status === 'identity_verified' ||
        body.status === 'signed'
      ) {
        patch.status = body.status;
      }
      if (body.idMethod !== undefined) patch.idMethod = String(body.idMethod);
      if (body.idScore !== undefined) patch.idScore = Number(body.idScore);
      if (body.kbaPassed !== undefined) patch.kbaPassed = Boolean(body.kbaPassed);
      if (body.signerSignatureData !== undefined) {
        patch.signerSignatureData = String(body.signerSignatureData);
      }
      if (
        body.signatureType === 'none' ||
        body.signatureType === 'drawn' ||
        body.signatureType === 'typed'
      ) {
        patch.signatureType = body.signatureType;
      }
      if (body.includeCertifiedLogo !== undefined) {
        patch.includeCertifiedLogo = Boolean(body.includeCertifiedLogo);
      }
      if (body.includeNotarizedMark !== undefined) {
        patch.includeNotarizedMark = Boolean(body.includeNotarizedMark);
      }
      if (body.placement !== undefined) {
        patch.placement = sanitizePlacement(body.placement);
      }

      const result = updateCaseFields(user.uid, caseId, patch, body.custodyEvent);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to update case.',
      });
    }
  });

  app.delete('/api/cases/:caseId', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const caseId = sanitizeId(req.params.caseId);
    if (!caseId) {
      res.status(400).json({ ok: false, error: 'Invalid case ID.' });
      return;
    }
    try {
      deleteDraftCase(user.uid, caseId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to delete case.',
      });
    }
  });

  app.post('/api/cases/:caseId/seal', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const caseId = sanitizeId(req.params.caseId);
    if (!caseId) {
      res.status(400).json({ ok: false, error: 'Invalid case ID.' });
      return;
    }
    try {
      const body = (req.body || {}) as {
        notaryName?: string;
        notaryCommission?: string;
        notaryJurisdiction?: string;
        notaryExpires?: string;
        notaryStampDataUrl?: string;
        includeCertifiedLogo?: boolean;
        includeNotarizedMark?: boolean;
        certificateCode?: string;
        sealedHash?: string;
        signatureAlgorithm?: string;
        publicKeyJwk?: string;
        digitalSignature?: string;
        signedPayload?: string;
        timestampIso?: string;
        custodyEventHash?: string;
      };
      const result = sealNotarizationCase({
        uid: user.uid,
        caseId,
        notaryName: String(body.notaryName || ''),
        notaryCommission: String(body.notaryCommission || ''),
        notaryJurisdiction: String(body.notaryJurisdiction || ''),
        notaryExpires: String(body.notaryExpires || ''),
        notaryStampDataUrl: String(body.notaryStampDataUrl || ''),
        includeCertifiedLogo: body.includeCertifiedLogo !== false,
        includeNotarizedMark: body.includeNotarizedMark !== false,
        certificateCode: String(body.certificateCode || ''),
        sealedHash: String(body.sealedHash || ''),
        signatureAlgorithm: String(body.signatureAlgorithm || ''),
        publicKeyJwk: String(body.publicKeyJwk || ''),
        digitalSignature: String(body.digitalSignature || ''),
        signedPayload: String(body.signedPayload || ''),
        timestampIso: String(body.timestampIso || new Date().toISOString()),
        custodyEventHash: String(body.custodyEventHash || ''),
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to seal document.',
      });
    }
  });

  // Public verification lookup (no login required for third-party verifiers)
  app.get('/api/verifications/:code', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const record = getPublicVerification(code);
    if (!record) {
      res.status(404).json({ ok: false, error: 'Certificate code not found.' });
      return;
    }
    res.json({ ok: true, verification: record });
  });

  // Server-assisted ECDSA P-256 fallback for plain HTTP contexts (where window.crypto.subtle is unavailable)
  app.post('/api/crypto/sign', (req: Request, res: Response) => {
    const user = resolveAuthUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    try {
      const body = (req.body || {}) as { payload?: string };
      const payload = typeof body.payload === 'string' ? body.payload : '';
      if (!payload) {
        res.status(400).json({ ok: false, error: 'Payload is required.' });
        return;
      }
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
      });
      const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
      const publicJwk = {
        kty: jwk.kty || 'EC',
        crv: jwk.crv || 'P-256',
        x: jwk.x,
        y: jwk.y,
        ext: true,
        key_ops: ['verify'],
      };
      const sigBuffer = crypto.sign(
        'sha256',
        Buffer.from(payload, 'utf8'),
        {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        }
      );
      res.json({
        ok: true,
        publicKeyJwk: JSON.stringify(publicJwk),
        digitalSignature: sigBuffer.toString('base64'),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to sign payload.',
      });
    }
  });

  app.post('/api/crypto/verify', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        payload?: string;
        signature?: string;
        publicKeyJwk?: string;
      };
      if (!body.payload || !body.signature || !body.publicKeyJwk) {
        res.json({ ok: true, valid: false });
        return;
      }
      const jwk = JSON.parse(body.publicKeyJwk) as crypto.JsonWebKey;
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const valid = crypto.verify(
        'sha256',
        Buffer.from(body.payload, 'utf8'),
        {
          key: publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(body.signature, 'base64')
      );
      res.json({ ok: true, valid: Boolean(valid) });
    } catch {
      res.json({ ok: true, valid: false });
    }
  });

  // Serve refreshed version.json when an update/rebuild occurred at runtime
  app.get('/version.json', (_req: Request, res: Response, next) => {
    if (refreshedBuildManifest) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(refreshedBuildManifest);
      return;
    }
    next();
  });

  // Save GitHub repository / branch configuration
  app.post('/api/update/config', (req: Request, res: Response) => {
    const body = (req.body || {}) as { repo?: string; branch?: string };
    const repoSlug = parseGitHubRepoSlug(body.repo);
    const branch = sanitizeBranch(body.branch) || 'main';
    if (!repoSlug) {
      res.status(400).json({
        ok: false,
        error:
          'Enter a valid GitHub repository (for example, owner/veriseal or https://github.com/owner/veriseal).',
      });
      return;
    }
    const prev = readSavedConfig();
    writeSavedConfig({
      ...prev,
      repoSlug,
      branch,
    });
    res.json({ ok: true, repoSlug, branch });
  });

  // Check local build & latest commit on GitHub
  app.get('/api/update/status', async (req: Request, res: Response) => {
    try {
      const repoParam =
        typeof req.query.repo === 'string' ? req.query.repo : undefined;
      const branchParam =
        typeof req.query.branch === 'string' ? req.query.branch : undefined;
      const ctx = await getGitContext(repoParam, branchParam);

      let remoteCommit = '';
      let remoteShortCommit = '';
      let remoteCommitMessage = '';
      let remoteCommitDate = '';
      let remoteCommitUrl = '';
      let checkError = '';

      if (ctx.hasGit && ctx.originUrl) {
        const fetched = await tryCmd('git', ['fetch', '--quiet', 'origin', ctx.branch], ROOT_DIR, 12000);
        void fetched;
        const remoteLine = await tryCmd('git', [
          'log',
          '-1',
          '--format=%H|%h|%s|%cI',
          `origin/${ctx.branch}`,
        ]);
        if (remoteLine) {
          const [sha, shortSha, msg, date] = remoteLine.split('|');
          remoteCommit = sha || '';
          remoteShortCommit = shortSha || '';
          remoteCommitMessage = msg || '';
          remoteCommitDate = date || '';
        }
      }

      if (!remoteCommit && ctx.repoSlug) {
        const gh = await fetchGitHubHeadCommit(ctx.repoSlug, ctx.branch);
        remoteCommit = gh.sha;
        remoteShortCommit = gh.shortSha;
        remoteCommitMessage = gh.message;
        remoteCommitDate = gh.date;
        remoteCommitUrl = gh.url;
        if (gh.error) checkError = gh.error;
      }

      const updateAvailable = Boolean(
        remoteCommit &&
          (!ctx.localCommit || remoteCommit !== ctx.localCommit)
      );

      res.json({
        ok: true,
        hasGit: ctx.hasGit,
        repoConfigured: Boolean(ctx.repoSlug || ctx.originUrl),
        repoSlug: ctx.repoSlug,
        branch: ctx.branch,
        originUrl: ctx.originUrl,
        localCommit: ctx.localCommit,
        localShortCommit: ctx.localShortCommit,
        localMessage: ctx.localMessage,
        remoteCommit,
        remoteShortCommit,
        remoteCommitMessage,
        remoteCommitDate,
        remoteCommitUrl,
        dirtyTree: ctx.dirtyTree,
        updateAvailable,
        checkError,
        runningBuild: refreshedBuildManifest,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err instanceof Error ? err.message : 'Unable to check GitHub status.',
      });
    }
  });

  // Pull latest changes from GitHub and rebuild the application
  app.post('/api/update/run', async (req: Request, res: Response) => {
    if (updateInFlight) {
      res.status(409).json({
        ok: false,
        error: 'An update is already in progress. Please wait a moment.',
      });
      return;
    }

    updateInFlight = true;
    try {
      const body = (req.body || {}) as {
        repo?: string;
        branch?: string;
        force?: boolean;
      };
      const ctx = await getGitContext(body.repo, body.branch);
      const repoSlug = parseGitHubRepoSlug(body.repo) || ctx.repoSlug;
      const branch = sanitizeBranch(body.branch) || ctx.branch || 'main';

      if (!ctx.hasGit && !repoSlug) {
        res.status(400).json({
          ok: false,
          needsRepoConfig: true,
          error:
            'No GitHub repository is linked yet. Enter your GitHub repository (owner/repo) to pull updates.',
        });
        return;
      }

      const beforePkg = fs.existsSync(path.join(ROOT_DIR, 'package.json'))
        ? fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')
        : '';

      if (ctx.hasGit) {
        if (!ctx.originUrl && repoSlug) {
          await runCmd('git', [
            'remote',
            'add',
            'origin',
            `https://github.com/${repoSlug}.git`,
          ]);
        } else if (!ctx.originUrl && !repoSlug) {
          res.status(400).json({
            ok: false,
            needsRepoConfig: true,
            error:
              'Git repository has no origin remote. Enter your GitHub repository (owner/repo).',
          });
          return;
        }

        if (ctx.dirtyTree && !body.force) {
          res.status(409).json({
            ok: false,
            code: 'DIRTY_WORKING_TREE',
            error:
              'Uncommitted local changes exist on the server. Commit/stash them or choose Force Pull to overwrite with GitHub.',
          });
          return;
        }

        await runCmd('git', ['fetch', 'origin', branch], ROOT_DIR, 60000);
        if (body.force) {
          await runCmd('git', ['reset', '--hard', `origin/${branch}`]);
        } else {
          await runCmd('git', ['pull', '--ff-only', 'origin', branch]);
        }

        const newCommit = await tryCmd('git', ['rev-parse', 'HEAD']);
        const newShortCommit = newCommit.slice(0, 7);
        const newMessage = await tryCmd('git', ['log', '-1', '--format=%s']);

        if (repoSlug) {
          writeSavedConfig({
            repoSlug,
            branch,
            lastSyncedCommit: newCommit,
            lastSyncedAt: new Date().toISOString(),
          });
        }

        const afterPkg = fs.readFileSync(
          path.join(ROOT_DIR, 'package.json'),
          'utf8'
        );
        const manifest = await syncDependenciesAndBuild(beforePkg !== afterPkg);

        res.json({
          ok: true,
          updated: newCommit !== ctx.localCommit || Boolean(body.force),
          method: 'git',
          repoSlug,
          branch,
          previousCommit: ctx.localCommit,
          newCommit,
          newShortCommit,
          commitMessage: newMessage,
          build: manifest,
        });
      } else {
        // Non-git deployment: fetch latest commit metadata & tarball directly from GitHub
        const ghHead = await fetchGitHubHeadCommit(repoSlug, branch);
        if (ghHead.error || !ghHead.sha) {
          res.status(400).json({
            ok: false,
            error:
              ghHead.error ||
              `Could not fetch commit metadata for ${repoSlug} (${branch}).`,
          });
          return;
        }

        if (
          !body.force &&
          ctx.saved.lastSyncedCommit &&
          ctx.saved.lastSyncedCommit === ghHead.sha
        ) {
          res.json({
            ok: true,
            updated: false,
            method: 'github_archive',
            repoSlug,
            branch,
            previousCommit: ctx.saved.lastSyncedCommit,
            newCommit: ghHead.sha,
            newShortCommit: ghHead.shortSha,
            commitMessage: ghHead.message,
            build: refreshedBuildManifest,
          });
          return;
        }

        const headers: Record<string, string> = {
          'User-Agent': 'VeriSeal-Updater/1.0',
        };
        if (process.env.GITHUB_TOKEN) {
          headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
        }
        const tarballUrl = `https://api.github.com/repos/${repoSlug}/tarball/${encodeURIComponent(
          branch
        )}`;
        const tarResp = await fetch(tarballUrl, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(60000),
        });
        if (!tarResp.ok) {
          res.status(400).json({
            ok: false,
            error: `Failed to download GitHub archive (${tarResp.status}). Verify repository visibility or GITHUB_TOKEN.`,
          });
          return;
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veriseal-upd-'));
        try {
          const tarPath = path.join(tmpDir, 'repo.tar.gz');
          const extractDir = path.join(tmpDir, 'extracted');
          fs.mkdirSync(extractDir, { recursive: true });
          const buf = Buffer.from(await tarResp.arrayBuffer());
          fs.writeFileSync(tarPath, buf);

          await runCmd('tar', ['-xzf', tarPath, '-C', extractDir], tmpDir, 60000);
          const extractedEntries = fs.readdirSync(extractDir);
          const rootExtracted =
            extractedEntries.length === 1
              ? path.join(extractDir, extractedEntries[0])
              : extractDir;

          copyDirectorySyncFiltered(rootExtracted, ROOT_DIR);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }

        writeSavedConfig({
          repoSlug,
          branch,
          lastSyncedCommit: ghHead.sha,
          lastSyncedAt: new Date().toISOString(),
        });

        const afterPkg = fs.readFileSync(
          path.join(ROOT_DIR, 'package.json'),
          'utf8'
        );
        const manifest = await syncDependenciesAndBuild(beforePkg !== afterPkg);

        res.json({
          ok: true,
          updated: true,
          method: 'github_archive',
          repoSlug,
          branch,
          previousCommit: ctx.saved.lastSyncedCommit || '',
          newCommit: ghHead.sha,
          newShortCommit: ghHead.shortSha,
          commitMessage: ghHead.message,
          build: manifest,
        });
      }

      // Optional VPS process restart hook (e.g. pm2 restart veriseal)
      const restartCmd = process.env.APP_RESTART_CMD;
      if (restartCmd) {
        const parts = restartCmd.trim().split(/\s+/);
        if (parts.length > 0 && parts[0]) {
          setTimeout(() => {
            void execFileAsync(parts[0], parts.slice(1), {
              cwd: ROOT_DIR,
            }).catch((err) => {
              console.error('Post-update restart command failed:', err);
            });
          }, 800);
        }
      }
    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to pull and rebuild update from GitHub.',
      });
    } finally {
      updateInFlight = false;
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      express.static(DIST_DIR, {
        setHeaders(res, filePath) {
          if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('version.json')
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      })
    );
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VeriSeal server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
