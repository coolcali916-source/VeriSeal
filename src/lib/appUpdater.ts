export interface AppVersionManifest {
  version: string;
  buildId: string;
  builtAt: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentBuild: AppVersionManifest;
  remoteBuild: AppVersionManifest | null;
  checkedAtIso: string;
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

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const checkedAtIso = new Date().toISOString();
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
    if (!res.ok) {
      return {
        updateAvailable: false,
        currentBuild: CURRENT_APP_BUILD,
        remoteBuild: null,
        checkedAtIso,
      };
    }

    const remote = (await res.json()) as Partial<AppVersionManifest>;
    if (!remote.buildId) {
      return {
        updateAvailable: false,
        currentBuild: CURRENT_APP_BUILD,
        remoteBuild: null,
        checkedAtIso,
      };
    }

    const remoteBuild: AppVersionManifest = {
      version: String(remote.version || CURRENT_APP_BUILD.version),
      buildId: String(remote.buildId),
      builtAt: String(remote.builtAt || checkedAtIso),
    };

    return {
      updateAvailable: remoteBuild.buildId !== CURRENT_APP_BUILD.buildId,
      currentBuild: CURRENT_APP_BUILD,
      remoteBuild,
      checkedAtIso,
    };
  } catch {
    return {
      updateAvailable: false,
      currentBuild: CURRENT_APP_BUILD,
      remoteBuild: null,
      checkedAtIso,
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
