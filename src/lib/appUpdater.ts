export interface AppVersionManifest {
  version: string;
  buildId: string;
  builtAt: string;
}

export interface GitHubUpdateStatus {
  ok: boolean;
  hasGit: boolean;
  repoConfigured: boolean;
  repoSlug: string;
  branch: string;
  originUrl: string;
  localCommit: string;
  localShortCommit: string;
  localMessage: string;
  remoteCommit: string;
  remoteShortCommit: string;
  remoteCommitMessage: string;
  remoteCommitDate: string;
  remoteCommitUrl: string;
  dirtyTree: boolean;
  updateAvailable: boolean;
  checkError?: string;
  runningBuild?: AppVersionManifest | null;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentBuild: AppVersionManifest;
  remoteBuild: AppVersionManifest | null;
  githubStatus: GitHubUpdateStatus | null;
  checkedAtIso: string;
}

export interface GitHubUpdateRunResult {
  ok: boolean;
  updated?: boolean;
  needsRepoConfig?: boolean;
  code?: string;
  method?: string;
  repoSlug?: string;
  branch?: string;
  previousCommit?: string;
  newCommit?: string;
  newShortCommit?: string;
  commitMessage?: string;
  build?: AppVersionManifest | null;
  error?: string;
}

const STORAGE_REPO_KEY = 'veriseal_github_repo';
const STORAGE_BRANCH_KEY = 'veriseal_github_branch';

export function getSavedGitHubTarget(): { repo: string; branch: string } {
  if (typeof window === 'undefined') return { repo: '', branch: 'main' };
  return {
    repo: window.localStorage.getItem(STORAGE_REPO_KEY) || '',
    branch: window.localStorage.getItem(STORAGE_BRANCH_KEY) || 'main',
  };
}

export function saveGitHubTarget(repo: string, branch: string): void {
  if (typeof window === 'undefined') return;
  if (repo.trim()) {
    window.localStorage.setItem(STORAGE_REPO_KEY, repo.trim());
  } else {
    window.localStorage.removeItem(STORAGE_REPO_KEY);
  }
  window.localStorage.setItem(STORAGE_BRANCH_KEY, branch.trim() || 'main');
}

export const CURRENT_APP_BUILD: AppVersionManifest = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0',
  buildId: typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev',
  builtAt:
    typeof __APP_BUILT_AT__ !== 'undefined'
      ? __APP_BUILT_AT__
      : new Date().toISOString(),
};

export function clearUpdateQueryParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('_upd')) {
    url.searchParams.delete('_upd');
    window.history.replaceState({}, '', url.toString());
  }
}

export async function checkForAppUpdate(
  repoOverride?: string,
  branchOverride?: string
): Promise<UpdateCheckResult> {
  const checkedAtIso = new Date().toISOString();
  const saved = getSavedGitHubTarget();
  const repo = (repoOverride ?? saved.repo).trim();
  const branch = (branchOverride ?? saved.branch).trim() || 'main';

  let githubStatus: GitHubUpdateStatus | null = null;
  try {
    const params = new URLSearchParams();
    if (repo) params.set('repo', repo);
    if (branch) params.set('branch', branch);
    params.set('ts', String(Date.now()));
    const statusRes = await fetch(`/api/update/status?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (statusRes.ok) {
      githubStatus = (await statusRes.json()) as GitHubUpdateStatus;
    }
  } catch {
    // Fall back to /version.json check below
  }

  let remoteBuild: AppVersionManifest | null = githubStatus?.runningBuild || null;
  let buildChanged = false;

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map((reg) => reg.update().catch(() => undefined))
      );
    }

    const res = await fetch(`/version.json?ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
      },
    });
    if (res.ok) {
      const remote = (await res.json()) as Partial<AppVersionManifest>;
      if (remote.buildId) {
        remoteBuild = {
          version: String(remote.version || CURRENT_APP_BUILD.version),
          buildId: String(remote.buildId),
          builtAt: String(remote.builtAt || checkedAtIso),
        };
        buildChanged = remoteBuild.buildId !== CURRENT_APP_BUILD.buildId;
      }
    }
  } catch {
    // Ignore version.json fetch failure
  }

  return {
    updateAvailable: Boolean(githubStatus?.updateAvailable || buildChanged),
    currentBuild: CURRENT_APP_BUILD,
    remoteBuild,
    githubStatus,
    checkedAtIso,
  };
}

export async function saveGitHubConfigOnServer(
  repo: string,
  branch: string
): Promise<{ ok: boolean; repoSlug?: string; branch?: string; error?: string }> {
  const res = await fetch('/api/update/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo, branch }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    repoSlug?: string;
    branch?: string;
    error?: string;
  };
  if (data.ok && data.repoSlug) {
    saveGitHubTarget(data.repoSlug, data.branch || branch);
  }
  return data;
}

export async function runGitHubAppUpdate(options?: {
  repo?: string;
  branch?: string;
  force?: boolean;
}): Promise<GitHubUpdateRunResult> {
  const saved = getSavedGitHubTarget();
  const repo = (options?.repo ?? saved.repo).trim();
  const branch = (options?.branch ?? saved.branch).trim() || 'main';

  try {
    const res = await fetch('/api/update/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: repo || undefined,
        branch,
        force: Boolean(options?.force),
      }),
    });
    const data = (await res.json()) as GitHubUpdateRunResult;
    if (data.ok && data.repoSlug) {
      saveGitHubTarget(data.repoSlug, data.branch || branch);
    }
    return data;
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Unable to reach server update endpoint.',
    };
  }
}

export async function applyAppUpdate(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(async (reg) => {
          await reg.update().catch(() => undefined);
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        })
      );
    }
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    // Proceed with cache-busted reload even if Cache API is restricted
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('_upd', String(Date.now()));
  window.location.replace(nextUrl.toString());
}
