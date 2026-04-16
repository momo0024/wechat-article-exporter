import type { ExportRunResult } from './types';

export interface ExportFeedback {
  level: 'success' | 'warning' | 'error';
  title: string;
  description: string;
}

export function buildExportFeedback(
  formatLabel: string,
  elapsedText: string,
  result: Pick<ExportRunResult, 'completedFiles' | 'failedFiles'>,
): ExportFeedback {
  const completedCount = result.completedFiles.length;
  const failedCount = result.failedFiles.length;

  if (failedCount === 0) {
    return {
      level: 'success',
      title: `${formatLabel} 导出完成`,
      description: `本次导出耗时 ${elapsedText}，成功 ${completedCount} 篇`,
    };
  }

  const firstFailure = result.failedFiles[0];
  const failureHint = firstFailure ? `；首个失败：${firstFailure.reason}` : '';

  if (completedCount === 0) {
    return {
      level: 'error',
      title: `${formatLabel} 导出失败`,
      description: `本次导出耗时 ${elapsedText}，失败 ${failedCount} 篇${failureHint}`,
    };
  }

  return {
    level: 'warning',
    title: `${formatLabel} 导出部分失败`,
    description: `本次导出耗时 ${elapsedText}，成功 ${completedCount} 篇，失败 ${failedCount} 篇${failureHint}`,
  };
}