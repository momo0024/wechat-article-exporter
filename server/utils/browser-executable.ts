import { existsSync } from 'node:fs';
import path from 'node:path';

interface ResolveBrowserExecutablePathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
}

export interface BrowserExecutableResolution {
  executablePath?: string;
  checkedCandidates: string[];
  invalidConfiguredPath?: string;
}

function normalizeCandidate(filePath: string): string {
  return path.normalize(filePath.trim());
}

function pushCandidate(candidates: string[], candidate?: string) {
  if (!candidate || !candidate.trim()) {
    return;
  }

  const normalized = normalizeCandidate(candidate);
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

export function getBrowserExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const candidates: string[] = [];

  if (platform === 'win32') {
    const programFiles = env.PROGRAMFILES;
    const programFilesX86 = env['PROGRAMFILES(X86)'];
    const localAppData = env.LOCALAPPDATA;

    [programFiles, programFilesX86].forEach(basePath => {
      pushCandidate(candidates, basePath ? path.join(basePath, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined);
      pushCandidate(candidates, basePath ? path.join(basePath, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined);
    });

    pushCandidate(candidates, localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined);
    pushCandidate(candidates, localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined);
  } else if (platform === 'darwin') {
    pushCandidate(candidates, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    pushCandidate(candidates, '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    pushCandidate(candidates, '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    pushCandidate(candidates, '/usr/bin/google-chrome-stable');
    pushCandidate(candidates, '/usr/bin/google-chrome');
    pushCandidate(candidates, '/usr/bin/chromium-browser');
    pushCandidate(candidates, '/usr/bin/chromium');
    pushCandidate(candidates, '/usr/bin/microsoft-edge');
    pushCandidate(candidates, '/snap/bin/chromium');
  }

  return candidates;
}

export function resolveBrowserExecutablePath(
  options: ResolveBrowserExecutablePathOptions = {},
): BrowserExecutableResolution {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const exists = options.exists || existsSync;
  const configuredPath = env.PUPPETEER_EXECUTABLE_PATH?.trim();
  const checkedCandidates: string[] = [];

  if (configuredPath) {
    const normalizedConfiguredPath = normalizeCandidate(configuredPath);
    checkedCandidates.push(normalizedConfiguredPath);
    if (exists(normalizedConfiguredPath)) {
      return {
        executablePath: normalizedConfiguredPath,
        checkedCandidates,
      };
    }

    return {
      checkedCandidates,
      invalidConfiguredPath: normalizedConfiguredPath,
    };
  }

  for (const candidate of getBrowserExecutableCandidates(platform, env)) {
    checkedCandidates.push(candidate);
    if (exists(candidate)) {
      return {
        executablePath: candidate,
        checkedCandidates,
      };
    }
  }

  return { checkedCandidates };
}