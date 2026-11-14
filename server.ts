import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

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
