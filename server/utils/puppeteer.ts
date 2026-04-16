import type { Browser } from 'puppeteer';
import { resolveBrowserExecutablePath } from '~/server/utils/browser-executable';

let browser: Browser | null = null;

function buildLaunchErrorMessage(error: unknown, checkedCandidates: string[], invalidConfiguredPath?: string): string {
  const originalMessage = error instanceof Error ? error.message : String(error || 'unknown error');
  const configuredHint = invalidConfiguredPath
    ? `PUPPETEER_EXECUTABLE_PATH 指向的浏览器不存在：${invalidConfiguredPath}。`
    : '';
  const checkedHint = checkedCandidates.length > 0
    ? `已检查这些系统浏览器路径：${checkedCandidates.join('；')}。`
    : '当前没有可检查的系统浏览器候选路径。';

  if (/Could not find Chrome/i.test(originalMessage)) {
    return `${configuredHint}未找到可用的 Chrome/Edge 浏览器。${checkedHint}你可以安装本机 Chrome/Edge，或设置 PUPPETEER_EXECUTABLE_PATH，或执行 npx puppeteer browsers install chrome。`;
  }

  return `${configuredHint}PDF 浏览器启动失败：${originalMessage}`;
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    return browser;
  }

  const puppeteer = await import('puppeteer').then(m => m.default);
  const browserResolution = resolveBrowserExecutablePath();

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--font-render-hinting=none',
  ];

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: launchArgs,
      executablePath: browserResolution.executablePath,
    });
  } catch (error) {
    throw new Error(
      buildLaunchErrorMessage(
        error,
        browserResolution.checkedCandidates,
        browserResolution.invalidConfiguredPath,
      ),
    );
  }

  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

process.on('exit', () => {
  browser?.close();
});

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
