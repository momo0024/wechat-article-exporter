import { randomUUID } from 'node:crypto';
import {
  type ArticleExportProgress,
  type ArticleExportRetryProgress,
  type ExportSource,
} from '~/server/utils/docx-generator';
import {
  getAccountInfoRecord,
  updateAccountSyncStatus,
} from '~/server/utils/account-info';
import { compactEscapedJson } from '~/server/utils/async-log';
import {
  getActiveSession,
  syncAccountByRange,
  type SyncAccountResult,
  type SyncPageProgress,
  type SyncRetryProgress,
  type SyncYieldReason,
} from '~/server/utils/sync-engine';
import { ACCOUNT_SYNC_STATUS } from '~/shared/utils/account-sync-status';

export type SyncQueueSource = 'interface' | 'manual' | 'schedule';
export type QueueRuntimeStage = 'queued' | 'syncing' | 'exporting' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

interface QueueSubscriber {
  onStageChange?: (stage: QueueRuntimeStage) => void | Promise<void>;
  onPageFetched?: (progress: SyncPageProgress) => void | Promise<void>;
  onExportArticleStart?: (progress: ArticleExportProgress) => void | Promise<void>;
  onRetry?: (progress: SyncRetryProgress | ArticleExportRetryProgress) => void | Promise<void>;
  isCancelled?: () => boolean;
}

export interface EnqueueAccountSyncInput extends QueueSubscriber {
  source: SyncQueueSource;
  fakeid: string;
  nickname: string;
  roundHeadImg?: string | null;
  syncToTimestamp: number;
  exportDocs: boolean;
}

export interface AccountSyncTaskHandle {
  id: string;
  fakeid: string;
  promise: Promise<SyncAccountResult>;
}

interface QueueTask {
  id: string;
  fakeid: string;
  nickname: string;
  roundHeadImg?: string | null;
  priority: number;
  source: SyncQueueSource;
  syncToTimestamp: number;
  exportDocs: boolean;
  order: number;
  subscribers: QueueSubscriber[];
  promise: Promise<SyncAccountResult>;
  resolve: (result: SyncAccountResult) => void;
  syncedMessageCount: number;
  yieldAfterMessages: number;
  forceYield: boolean;
  preferredResumeTaskId: string | null;
  resumePriority: number;
  deferredPriority: number | null;
  canPreemptActiveTask: boolean;
  yieldRequestedByTaskId: string | null;
  yieldRequestedByFakeid: string | null;
}

const PRIORITY: Record<SyncQueueSource, number> = {
  interface: 0,
  manual: 1,
  schedule: 2,
};

const INTERFACE_PREEMPTION_MESSAGE_THRESHOLD = 40;
const DEFERRED_INTERFACE_PRIORITY = PRIORITY.schedule + 1;

const taskByFakeid = new Map<string, QueueTask>();
const pendingTasks: QueueTask[] = [];
let activeTask: QueueTask | null = null;
let taskOrder = 0;
let queueDraining = false;

function describeTask(task: QueueTask | null) {
  if (!task) {
    return null;
  }

  return {
    id: task.id,
    fakeid: task.fakeid,
    nickname: task.nickname,
    source: task.source,
    priority: task.priority,
    effectivePriority: getEffectivePriority(task),
    order: task.order,
    syncedMessageCount: task.syncedMessageCount,
    yieldAfterMessages: task.yieldAfterMessages,
    forceYield: task.forceYield,
    preferredResumeTaskId: task.preferredResumeTaskId,
    resumePriority: task.resumePriority,
    deferredPriority: task.deferredPriority,
    canPreemptActiveTask: task.canPreemptActiveTask,
    yieldRequestedByTaskId: task.yieldRequestedByTaskId,
    yieldRequestedByFakeid: task.yieldRequestedByFakeid,
  };
}

function logQueueEvent(event: string, payload: Record<string, any>) {
  console.log(`[sync-queue] ${event}: ${compactEscapedJson(payload)}`);
}

function toExportSource(source: SyncQueueSource): ExportSource {
  if (source === 'manual') {
    return 'manual-sync';
  }

  if (source === 'schedule') {
    return 'schedule';
  }

  return 'interface-sync';
}

function normalizeSyncToTimestamp(currentValue: number, nextValue: number): number {
  const left = Number(currentValue || 0);
  const right = Number(nextValue || 0);
  if (left <= 0 || right <= 0) {
    return 0;
  }

  return Math.min(left, right);
}

function isTaskCancelled(task: QueueTask): boolean {
  return task.subscribers.length > 0 && task.subscribers.every(subscriber => subscriber.isCancelled?.() ?? false);
}

async function notifyStage(task: QueueTask, stage: QueueRuntimeStage) {
  for (const subscriber of task.subscribers) {
    await subscriber.onStageChange?.(stage);
  }
}

async function notifyPageFetched(task: QueueTask, progress: SyncPageProgress) {
  for (const subscriber of task.subscribers) {
    await subscriber.onPageFetched?.(progress);
  }
}

async function notifyExportStart(task: QueueTask, progress: ArticleExportProgress) {
  for (const subscriber of task.subscribers) {
    await subscriber.onExportArticleStart?.(progress);
  }
}

async function notifyRetry(task: QueueTask, progress: SyncRetryProgress | ArticleExportRetryProgress) {
  for (const subscriber of task.subscribers) {
    await subscriber.onRetry?.(progress);
  }
}

function getEffectivePriority(task: QueueTask): number {
  return task.deferredPriority ?? task.priority;
}

function sortPendingTasks() {
  pendingTasks.sort((left, right) => {
    if (left.resumePriority !== right.resumePriority) {
      return left.resumePriority - right.resumePriority;
    }

    const leftPriority = getEffectivePriority(left);
    const rightPriority = getEffectivePriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.order - right.order;
  });
}

function findPendingPreemptibleInterfaceTask(): QueueTask | null {
  return pendingTasks.find(task => task.source === 'interface' && task.canPreemptActiveTask) || null;
}

function shouldPreemptScheduleImmediately(task: QueueTask): boolean {
  return task.source === 'interface' && activeTask?.source === 'schedule';
}

function tryRequestInterfacePreemption(task: QueueTask) {
  if (task.source !== 'interface' || !task.canPreemptActiveTask || !activeTask || activeTask.id === task.id || activeTask.forceYield) {
    return;
  }

  const preemptScheduleImmediately = shouldPreemptScheduleImmediately(task);
  if (!preemptScheduleImmediately && activeTask.syncedMessageCount < INTERFACE_PREEMPTION_MESSAGE_THRESHOLD) {
    logQueueEvent('接口任务等待抢占阈值', {
      threshold: INTERFACE_PREEMPTION_MESSAGE_THRESHOLD,
      waitingTask: describeTask(task),
      activeTask: describeTask(activeTask),
    });
    return;
  }

  activeTask.forceYield = true;
  activeTask.yieldRequestedByTaskId = task.id;
  activeTask.yieldRequestedByFakeid = task.fakeid;
  task.yieldAfterMessages = Math.max(task.yieldAfterMessages, INTERFACE_PREEMPTION_MESSAGE_THRESHOLD);
  task.preferredResumeTaskId = activeTask.id;
  task.deferredPriority = null;
  if (preemptScheduleImmediately) {
    void updateAccountSyncStatus(activeTask.fakeid, ACCOUNT_SYNC_STATUS.QUEUED);
    logQueueEvent('定时任务被接口任务立即抢占，先标记为排队中', {
      waitingTask: describeTask(task),
      activeTask: describeTask(activeTask),
    });
  }
  logQueueEvent(preemptScheduleImmediately ? '接口任务立即抢占定时任务' : '接口任务触发抢占', {
    threshold: INTERFACE_PREEMPTION_MESSAGE_THRESHOLD,
    preemptScheduleImmediately,
    waitingTask: describeTask(task),
    activeTask: describeTask(activeTask),
  });
}

function reevaluatePendingInterfacePreemption() {
  const pendingInterfaceTask = findPendingPreemptibleInterfaceTask();
  if (!pendingInterfaceTask) {
    return;
  }

  tryRequestInterfacePreemption(pendingInterfaceTask);
}

async function runTask(task: QueueTask): Promise<SyncAccountResult> {
  const account = await getAccountInfoRecord(task.fakeid, { includeDisabled: true });
  if (!account) {
    return {
      fakeid: task.fakeid,
      nickname: task.nickname,
      success: false,
      articleCount: 0,
      failedUrls: [],
      generated: 0,
      skipped: 0,
      failed: 0,
      error: '公众号不存在',
    };
  }

  if (account.isDelete) {
    return {
      fakeid: task.fakeid,
      nickname: task.nickname,
      success: false,
      articleCount: 0,
      failedUrls: [],
      generated: 0,
      skipped: 0,
      failed: 0,
      error: '公众号已禁用',
    };
  }

  if (isTaskCancelled(task)) {
    return {
      fakeid: task.fakeid,
      nickname: task.nickname,
      success: false,
      articleCount: 0,
      failedUrls: [],
      generated: 0,
      skipped: 0,
      failed: 0,
      error: 'cancelled',
    };
  }

  const session = await getActiveSession();
  if (!session) {
    return {
      fakeid: task.fakeid,
      nickname: task.nickname,
      success: false,
      articleCount: 0,
      failedUrls: [],
      generated: 0,
      skipped: 0,
      failed: 0,
      error: '未登录或登录已过期，请重新扫码登录',
    };
  }

  return await syncAccountByRange({
    authKey: session.authKey,
    token: session.token,
    cookie: session.cookie,
    fakeid: task.fakeid,
    nickname: task.nickname,
    roundHeadImg: task.roundHeadImg,
    syncToTimestamp: task.syncToTimestamp,
    source: toExportSource(task.source),
    exportDocs: task.exportDocs,
    isCancelled: () => isTaskCancelled(task),
    shouldYield: () => task.forceYield,
    yieldAfterMessages: task.yieldAfterMessages,
    onStageChange: async (stage) => {
      await notifyStage(task, stage);
    },
    onPageFetched: async (progress) => {
      task.syncedMessageCount = progress.syncedMessageCount;
      reevaluatePendingInterfacePreemption();
      await notifyPageFetched(task, progress);
    },
    onExportArticleStart: async (progress) => {
      await notifyExportStart(task, progress);
    },
    onRetry: async (progress) => {
      await notifyRetry(task, progress);
    },
  });
}

async function requeueYieldedTask(task: QueueTask, yieldReason?: SyncYieldReason) {
  const preferredResumeTaskId = task.preferredResumeTaskId;
  const shouldDeferInterfaceTask = yieldReason === 'message-slice' && Boolean(preferredResumeTaskId);

  task.forceYield = false;
  task.syncedMessageCount = 0;
  task.yieldAfterMessages = 0;
  task.preferredResumeTaskId = null;
  task.resumePriority = 0;
  task.deferredPriority = shouldDeferInterfaceTask ? DEFERRED_INTERFACE_PRIORITY : null;
  task.canPreemptActiveTask = task.source === 'interface' && !shouldDeferInterfaceTask;
  task.yieldRequestedByTaskId = null;
  task.yieldRequestedByFakeid = null;
  task.order = ++taskOrder;

  pendingTasks.push(task);

  if (yieldReason === 'message-slice' && preferredResumeTaskId) {
    const resumeTask = pendingTasks.find(item => item.id === preferredResumeTaskId);
    if (resumeTask) {
      resumeTask.resumePriority = -1;
      logQueueEvent('安排恢复被打断任务', {
        resumedTask: describeTask(resumeTask),
        yieldingInterfaceTask: describeTask(task),
      });
    }
    logQueueEvent('接口任务完成 40 条切片后重新排队', {
      yieldingTask: describeTask(task),
      preferredResumeTaskId,
    });
  }

  sortPendingTasks();
  await updateAccountSyncStatus(task.fakeid, ACCOUNT_SYNC_STATUS.QUEUED);
  await notifyStage(task, 'queued');
}

async function drainQueue() {
  if (queueDraining) {
    return;
  }

  queueDraining = true;
  try {
    while (!activeTask && pendingTasks.length > 0) {
      const nextTask = pendingTasks.shift() || null;
      if (!nextTask) {
        break;
      }

      activeTask = nextTask;
      const wasResumedTask = activeTask.resumePriority < 0;
      activeTask.resumePriority = 0;
      activeTask.deferredPriority = null;
      activeTask.canPreemptActiveTask = activeTask.source === 'interface';
      activeTask.forceYield = false;
      activeTask.syncedMessageCount = 0;
      activeTask.yieldRequestedByTaskId = null;
      activeTask.yieldRequestedByFakeid = null;
      logQueueEvent(wasResumedTask ? '恢复执行被打断任务' : '开始执行队列任务', {
        activeTask: describeTask(activeTask),
        pendingTaskCount: pendingTasks.length,
      });
      await updateAccountSyncStatus(nextTask.fakeid, ACCOUNT_SYNC_STATUS.SYNCING);
      await notifyStage(nextTask, 'syncing');

      let result: SyncAccountResult;
      try {
        result = await runTask(nextTask);
      } catch (error: any) {
        result = {
          fakeid: nextTask.fakeid,
          nickname: nextTask.nickname,
          success: false,
          articleCount: 0,
          failedUrls: [],
          generated: 0,
          skipped: 0,
          failed: 0,
          error: error?.message || 'unknown error',
        };
      }

      if (result.yielded) {
        logQueueEvent('运行中任务主动让出执行权', {
          yieldingTask: describeTask(nextTask),
          yieldReason: result.yieldReason,
          requestedByTaskId: nextTask.yieldRequestedByTaskId,
          requestedByFakeid: nextTask.yieldRequestedByFakeid,
          syncedMessageCount: result.syncedMessageCount,
        });
        await requeueYieldedTask(nextTask, result.yieldReason);
        activeTask = null;
        continue;
      }

      const terminalStage: QueueRuntimeStage = result.error === 'cancelled'
        ? 'cancelled'
        : result.success
          ? 'completed'
          : 'failed';
      await updateAccountSyncStatus(
        nextTask.fakeid,
        result.success ? ACCOUNT_SYNC_STATUS.SUCCESS : ACCOUNT_SYNC_STATUS.FAILED,
      );
      await notifyStage(nextTask, terminalStage);

      logQueueEvent('队列任务执行结束', {
        task: describeTask(nextTask),
        terminalStage,
        success: result.success,
        error: result.error || null,
        yielded: Boolean(result.yielded),
      });

      taskByFakeid.delete(nextTask.fakeid);
      activeTask = null;
      nextTask.resolve(result);
    }
  } finally {
    queueDraining = false;
    if (!activeTask && pendingTasks.length > 0) {
      void drainQueue();
    }
  }
}

export async function enqueueAccountSync(input: EnqueueAccountSyncInput): Promise<AccountSyncTaskHandle> {
  const account = await getAccountInfoRecord(input.fakeid, { includeDisabled: true });
  if (!account) {
    throw new Error('公众号不存在');
  }

  if (account.isDelete) {
    throw new Error('公众号已禁用');
  }

  const existingTask = taskByFakeid.get(input.fakeid);
  if (existingTask) {
    existingTask.priority = Math.min(existingTask.priority, PRIORITY[input.source]);
    if (PRIORITY[input.source] < PRIORITY[existingTask.source]) {
      existingTask.source = input.source;
    }
    existingTask.nickname = input.nickname || existingTask.nickname;
    existingTask.roundHeadImg = input.roundHeadImg || existingTask.roundHeadImg;
    existingTask.syncToTimestamp = normalizeSyncToTimestamp(existingTask.syncToTimestamp, input.syncToTimestamp);
    existingTask.exportDocs = existingTask.exportDocs || input.exportDocs;
    if (input.source === 'interface') {
      existingTask.canPreemptActiveTask = true;
      if (activeTask?.id !== existingTask.id) {
        existingTask.deferredPriority = null;
      }
    }
    existingTask.subscribers.push({
      onStageChange: input.onStageChange,
      onPageFetched: input.onPageFetched,
      onExportArticleStart: input.onExportArticleStart,
      onRetry: input.onRetry,
      isCancelled: input.isCancelled,
    });

    if (activeTask?.id !== existingTask.id) {
      await updateAccountSyncStatus(existingTask.fakeid, ACCOUNT_SYNC_STATUS.QUEUED);
      sortPendingTasks();
    }

    reevaluatePendingInterfacePreemption();

    return {
      id: existingTask.id,
      fakeid: existingTask.fakeid,
      promise: existingTask.promise,
    };
  }

  let resolveTask: (result: SyncAccountResult) => void = () => {};
  const promise = new Promise<SyncAccountResult>((resolve) => {
    resolveTask = resolve;
  });

  const task: QueueTask = {
    id: randomUUID(),
    fakeid: input.fakeid,
    nickname: input.nickname,
    roundHeadImg: input.roundHeadImg,
    priority: PRIORITY[input.source],
    source: input.source,
    syncToTimestamp: Number(input.syncToTimestamp || 0),
    exportDocs: input.exportDocs,
    order: ++taskOrder,
    subscribers: [{
      onStageChange: input.onStageChange,
      onPageFetched: input.onPageFetched,
      onExportArticleStart: input.onExportArticleStart,
      onRetry: input.onRetry,
      isCancelled: input.isCancelled,
    }],
    promise,
    resolve: resolveTask,
    syncedMessageCount: 0,
    yieldAfterMessages: 0,
    forceYield: false,
    preferredResumeTaskId: null,
    resumePriority: 0,
    deferredPriority: null,
    canPreemptActiveTask: input.source === 'interface',
    yieldRequestedByTaskId: null,
    yieldRequestedByFakeid: null,
  };

  taskByFakeid.set(task.fakeid, task);
  pendingTasks.push(task);
  sortPendingTasks();
  logQueueEvent('任务入队', {
    task: describeTask(task),
    activeTask: describeTask(activeTask),
    pendingTaskCount: pendingTasks.length,
  });
  await updateAccountSyncStatus(task.fakeid, ACCOUNT_SYNC_STATUS.QUEUED);
  await notifyStage(task, 'queued');
  reevaluatePendingInterfacePreemption();
  void drainQueue();

  return {
    id: task.id,
    fakeid: task.fakeid,
    promise: task.promise,
  };
}