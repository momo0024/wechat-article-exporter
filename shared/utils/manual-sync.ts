import { normalizeAccountSyncStatus } from '~/shared/utils/account-sync-status';

export type ManualSyncStage =
  | 'queued'
  | 'syncing'
  | 'exporting'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancelling';

export interface ManualSyncJobStatus {
  jobId: string;
  fakeid: string;
  nickname: string;
  stage: ManualSyncStage;
  syncToTimestamp: number;
  startedAt: number;
  updatedAt: number;
  cancelRequested: boolean;
  pageNumber: number;
  begin: number;
  totalCount: number;
  currentPageArticleCount: number;
  currentPageFilteredCount: number;
  currentArticleTitle: string | null;
  currentArticleUrl: string | null;
  currentArticleIndex: number;
  currentArticleTotal: number;
  retrying: boolean;
  retryMessage: string | null;
  articleCount: number;
  generated: number;
  skipped: number;
  failed: number;
  failedUrls: string[];
  error?: string;
}

interface AccountSyncActionStateInput {
  fakeid?: string | null;
  status?: unknown;
  isDelete?: boolean | null;
  isDeleting?: boolean;
  isManualSyncing?: boolean;
  syncingFakeid?: string | null;
  syncStatus?: ManualSyncJobStatus | null;
}

function displayPageNumber(pageNumber: number | null | undefined): number {
  return Math.max(1, Number(pageNumber || 0));
}

export function isTerminalManualSyncStage(stage: ManualSyncStage | null | undefined): boolean {
  return stage === 'completed' || stage === 'failed' || stage === 'cancelled';
}

export function isBusyManualSyncStage(stage: ManualSyncStage | null | undefined): boolean {
  return stage === 'queued' || stage === 'syncing' || stage === 'exporting' || stage === 'finalizing' || stage === 'cancelling';
}

export function getManualSyncProgressText(
  status: ManualSyncJobStatus | null | undefined,
  options: { includeNickname?: boolean } = {},
): string {
  if (!status) {
    return '';
  }

  const prefix = options.includeNickname && status.nickname ? `公众号【${status.nickname}】` : '';
  const withPrefix = (text: string) => (prefix ? `${prefix}${text}` : text);

  if (status.retrying && status.retryMessage) {
    return withPrefix(status.retryMessage);
  }

  if (status.stage === 'exporting' && status.currentArticleTitle) {
    return withPrefix(`正在生成 ${status.currentArticleIndex}/${status.currentArticleTotal} ${status.currentArticleTitle}`);
  }

  if (status.stage === 'finalizing') {
    return withPrefix('正在生成汇总文档');
  }

  if (status.stage === 'cancelling') {
    return withPrefix('正在取消同步');
  }

  if (status.stage === 'queued' || status.stage === 'syncing') {
    const matchedCountText = status.currentPageFilteredCount > 0
      ? `，本页命中 ${status.currentPageFilteredCount} 篇`
      : '';
    return withPrefix(`正在同步第 ${displayPageNumber(status.pageNumber)} 页${matchedCountText}`);
  }

  return '';
}

export function getManualSyncProgressClass(status: ManualSyncJobStatus | null | undefined): string {
  if (!status) {
    return 'text-blue-500';
  }

  if (status.retrying) {
    return 'text-orange-600';
  }

  if (status.stage === 'cancelling') {
    return 'text-orange-500';
  }

  if (status.stage === 'exporting' || status.stage === 'finalizing') {
    return 'text-amber-600';
  }

  return 'text-blue-500';
}

export function getManualSyncProgressUrl(status: ManualSyncJobStatus | null | undefined): string {
  if (!status?.currentArticleUrl) {
    return '';
  }

  if (status.stage === 'exporting') {
    return status.currentArticleUrl;
  }

  if (status.retrying && status.currentArticleTitle) {
    return status.currentArticleUrl;
  }

  return '';
}

export function getAccountSyncActionState(input: AccountSyncActionStateInput) {
  const rowStatus = normalizeAccountSyncStatus(input.status);
  const isDisabledAccount = Boolean(input.isDelete);
  const isCurrentSyncRow = Boolean(
    input.syncStatus
      && input.syncingFakeid
      && input.fakeid
      && input.syncingFakeid === input.fakeid
      && !isTerminalManualSyncStage(input.syncStatus.stage),
  );
  const manualStage = isCurrentSyncRow ? input.syncStatus?.stage || null : null;
  const isQueued = manualStage === 'queued' || (!manualStage && rowStatus === 'queued');
  const isLoading = manualStage === 'syncing'
    || manualStage === 'exporting'
    || manualStage === 'finalizing'
    || (!manualStage && rowStatus === 'syncing');
  const isCancelling = manualStage === 'cancelling';
  const canCancel = isCurrentSyncRow && isBusyManualSyncStage(manualStage);
  const disableSync = Boolean(input.isDeleting)
    || Boolean(input.isManualSyncing)
    || isDisabledAccount
    || isQueued
    || isLoading
    || isCancelling;

  return {
    rowStatus,
    manualStage,
    isCurrentSyncRow,
    isDisabledAccount,
    isQueued,
    isLoading,
    isCancelling,
    canCancel,
    disableSync,
  };
}