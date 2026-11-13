#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const args = new Set(process.argv.slice(2));
const includeRules = args.has('--rules');

function run(command, options = {}) {
  console.log(`\n> ${command}`);
  execSync(command, {
    cwd,
    stdio: 'inherit',
    ...options,
  });
}

function tryOutput(command) {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

console.log('=== VeriSeal App Updater ===');

// 1. Pull latest changes from GitHub if inside a linked git repository
const isGitRepo = tryOutput('git rev-parse --is-inside-work-tree') === 'true';
if (isGitRepo) {
  const originUrl = tryOutput('git remote get-url origin');
  if (originUrl) {
    const dirty = tryOutput('git status --porcelain');
    if (dirty) {
      console.log(
        '\n[!] Uncommitted local changes detected. Skipping git pull so your local edits are not overwritten.'
      );
      console.log('    Commit or stash your changes, then re-run: npm run update');
    } else {
      const branch = tryOutput('git rev-parse --abbrev-ref HEAD') || 'main';
      console.log(`\nPulling latest updates from origin/${branch}...`);
      run(`git pull --ff-only origin ${branch}`);
    }
  } else {
    console.log('\n[i] Git repository has no "origin" remote configured; skipping git pull.');
  }
} else {
  console.log('\n[i] Not a git checkout; skipping git pull and refreshing local build.');
}

// 2. Refresh dependencies (supports bun.lock or npm with --legacy-peer-deps)
console.log('\nInstalling / syncing dependencies...');
const hasBunLock = fs.existsSync(path.join(cwd, 'bun.lock'));
const hasBun = Boolean(tryOutput('bun --version'));
if (hasBunLock && hasBun) {
  run('bun install');
} else {
  run('npm install --legacy-peer-deps');
}

// 3. Verify TypeScript types
console.log('\nVerifying TypeScript types...');
run('npm run lint');

// 4. Rebuild app bundle and generate fresh dist/version.json buildId
console.log('\nBuilding production bundle & fresh version manifest...');
run('npm run build');

const versionFile = path.join(cwd, 'dist', 'version.json');
if (fs.existsSync(versionFile)) {
  const manifest = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  console.log(
    `\nUpdate complete! New build ready: ${manifest.buildId} (${manifest.builtAt})`
  );
} else {
  console.log('\nUpdate complete!');
}

// 5. Optional Firestore security rules check & deploy
if (includeRules) {
  console.log('\nLinting and deploying Firestore rules...');
  run('npx eslint firestore.rules');
  run('npx firebase deploy --only firestore:rules');
}
