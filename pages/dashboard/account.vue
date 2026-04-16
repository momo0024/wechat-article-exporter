<script setup lang="ts">
import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridOptions,
  GridReadyEvent,
  ICellRendererParams,
  RowHeightParams,
  SelectionChangedEvent,
  ValueGetterParams,
} from 'ag-grid-community';
import { AgGridVue } from 'ag-grid-vue3';
import { defu } from 'defu';
import { formatTimeStamp } from '#shared/utils/helpers';
import GlobalSearchAccountDialog from '~/components/global/SearchAccountDialog.vue';
import GridAccountActions from '~/components/grid/AccountActions.vue';
import GridLoadProgress from '~/components/grid/LoadProgress.vue';
import ConfirmModal from '~/components/modal/Confirm.vue';
import LoginModal from '~/components/modal/Login.vue';
import toastFactory from '~/composables/toast';
import useLoginCheck from '~/composables/useLoginCheck';
import { IMAGE_PROXY, websiteName } from '~/config';
import { sharedGridOptions } from '~/config/shared-grid-options';
import { getAccountSyncStatusLabel } from '~/shared/utils/account-sync-status';
import {
  getAccountSyncActionState,
  getManualSyncProgressClass,
  getManualSyncProgressText,
  getManualSyncProgressUrl,
  isBusyManualSyncStage,
  isTerminalManualSyncStage,
  type ManualSyncJobStatus,
} from '~/shared/utils/manual-sync';
import { deleteAccountData } from '~/store/v2';
import { getAllInfo, getInfoCache, importMpAccounts, type MpAccount } from '~/store/v2/info';
import type { AccountManifest } from '~/types/account';
import { exportAccountJsonFile } from '~/utils/exporter';
import { createBooleanColumnFilterParams, createDateColumnFilterParams } from '~/utils/grid';

useHead({
  title: `公众号管理 | ${websiteName}`,
});

const toast = toastFactory();
const modal = useModal();
const { checkLogin } = useLoginCheck();

const { getSyncTimestamp, getSyncRangeLabel, getActualDateRange, isSyncAll } = useSyncDeadline();
// syncToTimestamp 在每次同步时重新计算，确保使用最新的时间范围配置
let syncToTimestamp = getSyncTimestamp();

const ACCOUNT_PAGE_REFRESH_INTERVAL_MS = 10000;
const MANUAL_SYNC_STATUS_POLL_INTERVAL_MS = 5000;
const SYNC_PROGRESS_ROW_HEIGHT = 64;

// 账号事件总线，用于和 Credentials 面板保持列表同步
const { accountEventBus } = useAccountEventBus();
accountEventBus.on(event => {
  if (event === 'account-added' || event === 'account-removed') {
    refresh();
  }
});

const searchAccountDialogRef = ref<typeof GlobalSearchAccountDialog | null>(null);

const addBtnLoading = ref(false);
const isSyncing = ref(false);
const syncingRowId = ref<string | null>(null);
const currentSyncJobId = ref<string | null>(null);
const syncStatus = ref<ManualSyncJobStatus | null>(null);
let isRefreshingAccounts = false;
let syncPollSequence = 0;

function addAccount() {
  if (!checkLogin()) return;

  searchAccountDialogRef.value!.open();
}
async function onSelectAccount(account: MpAccount) {
  addBtnLoading.value = true;
  await importMpAccounts([account]);
  await refresh();
  addBtnLoading.value = false;
  toast.success('公众号添加成功', `已成功添加公众号【${account.nickname}】，请手动点击同步按钮获取文章数据`);
  // 通知 Credentials 面板按钮立即变更为“已添加”
  accountEventBus.emit('account-added', { fakeid: account.fakeid });
}

// 表示同步过程中是否执行了取消操作
const isDeleting = ref(false);
let refreshTimer: number | null = null;

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function startManualSyncRequest(account: MpAccount) {
  return await $fetch<{ jobId: string; status: ManualSyncJobStatus }>('/api/web/worker/manual-sync', {
    method: 'POST',
    body: {
      fakeid: account.fakeid,
      nickname: account.nickname,
      roundHeadImg: account.round_head_img,
      syncToTimestamp,
    },
  });
}

async function getManualSyncStatus(jobId?: string) {
  return await $fetch<ManualSyncJobStatus | null>('/api/web/worker/manual-sync-status', jobId
    ? {
        query: { jobId },
      }
    : undefined);
}

function applySyncStatus(status: ManualSyncJobStatus) {
  currentSyncJobId.value = status.jobId;
  syncStatus.value = status;
  syncingRowId.value = status.fakeid;
  isSyncing.value = !isTerminalManualSyncStage(status.stage);
}

const syncStatusText = computed(() => getManualSyncProgressText(syncStatus.value, { includeNickname: true }));
const syncStatusUrl = computed(() => getManualSyncProgressUrl(syncStatus.value));
const syncStatusClass = computed(() => getManualSyncProgressClass(syncStatus.value));
const canCancelCurrentSync = computed(() => Boolean(currentSyncJobId.value) && isBusyManualSyncStage(syncStatus.value?.stage));

function clearSyncRuntimeState() {
  isSyncing.value = false;
  syncingRowId.value = null;
  currentSyncJobId.value = null;
  syncStatus.value = null;
  syncPollSequence += 1;
}

function replaceRow(account: MpAccount) {
  const rowIndex = globalRowData.findIndex(row => row.fakeid === account.fakeid);
  if (rowIndex === -1) {
    globalRowData = [account, ...globalRowData];
  } else {
    const nextRows = [...globalRowData];
    nextRows.splice(rowIndex, 1, account);
    globalRowData = nextRows;
  }

  gridApi.value?.setGridOption('rowData', globalRowData);
}

async function updateRow(fakeid: string) {
  const account = await getInfoCache(fakeid);
  if (!account) {
    await refresh();
    return;
  }

  replaceRow(account);
}

function getRowSyncActionState(account: Pick<MpAccount, 'fakeid' | 'status' | 'is_delete'>) {
  return getAccountSyncActionState({
    fakeid: account.fakeid,
    status: account.status,
    isDelete: account.is_delete,
    isDeleting: isDeleting.value,
    isManualSyncing: isSyncing.value,
    syncingFakeid: syncingRowId.value,
    syncStatus: syncStatus.value,
  });
}

function canSyncAccount(account: Pick<MpAccount, 'fakeid' | 'status' | 'is_delete'>) {
  return !getRowSyncActionState(account).disableSync;
}

const selectedRows = ref<MpAccount[]>([]);
const hasSelectedRows = computed(() => selectedRows.value.length > 0);
const isBatchSyncDisabled = computed(() => {
  if (isDeleting.value || selectedRows.value.length === 0) {
    return true;
  }

  return selectedRows.value.some(account => !canSyncAccount(account));
});

async function waitForManualSyncJob(fakeid: string, jobId: string) {
  const pollSequence = ++syncPollSequence;

  while (true) {
    let status: ManualSyncJobStatus | null;
    try {
      status = await getManualSyncStatus(jobId);
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.data?.statusCode || error?.response?.status;
      if (statusCode === 404) {
        await updateRow(fakeid);
        throw new Error('同步任务已中断，请重新同步');
      }
      throw error;
    }

    if (!status) {
      await updateRow(fakeid);
      throw new Error('同步任务已中断，请重新同步');
    }

    if (pollSequence !== syncPollSequence) {
      return status;
    }

    applySyncStatus(status);
    await updateRow(fakeid);

    if (isTerminalManualSyncStage(status.stage)) {
      return status;
    }

    await sleep(MANUAL_SYNC_STATUS_POLL_INTERVAL_MS);
  }
}

async function restoreActiveManualSyncJob() {
  try {
    const status = await getManualSyncStatus();
    if (!status || isTerminalManualSyncStage(status.stage)) {
      clearSyncRuntimeState();
      return;
    }

    applySyncStatus(status);
    await updateRow(status.fakeid);

    void waitForManualSyncJob(status.fakeid, status.jobId)
      .catch(error => {
        console.warn('[sync] 恢复手动同步状态失败:', error);
      })
      .finally(async () => {
        clearSyncRuntimeState();
        await refresh();
      });
  } catch (error: any) {
    const statusCode = error?.statusCode || error?.data?.statusCode || error?.response?.status;
    if (statusCode === 404) {
      clearSyncRuntimeState();
      return;
    }

    console.warn('[sync] 获取当前手动同步任务失败:', error);
  }
}

async function cancelCurrentSync() {
  if (!currentSyncJobId.value) {
    return;
  }

  const status = await $fetch<ManualSyncJobStatus>('/api/web/worker/manual-sync-cancel', {
    method: 'POST',
    body: { jobId: currentSyncJobId.value },
  });
  applySyncStatus(status);
  await updateRow(status.fakeid);
}

function requestCancelCurrentSync() {
  cancelCurrentSync().catch((error: any) => {
    toast.error('取消同步失败', error?.data?.message || error?.message || '取消同步失败');
  });
}

async function loadAccountArticle(account: MpAccount) {
  syncToTimestamp = getSyncTimestamp();
  console.log(
    `[sync] 开始同步【${account.nickname}】，` +
    `同步范围: ${getSyncRangeLabel()}，` +
    `时间区间: ${getActualDateRange()}`
  );

  try {
    const { jobId, status } = await startManualSyncRequest(account);
    applySyncStatus(status);

    const finalStatus = await waitForManualSyncJob(account.fakeid, jobId);
    await updateRow(account.fakeid);

    if (finalStatus.stage === 'cancelled') {
      throw new Error('已取消同步');
    }

    if (finalStatus.stage === 'failed') {
      if (finalStatus.error === 'session expired' || finalStatus.error?.includes('未登录')) {
        modal.open(LoginModal);
      }
      throw new Error(finalStatus.error || '同步失败');
    }

    return finalStatus;
  } catch (error: any) {
    if (error?.data?.message) {
      throw new Error(error.data.message);
    }
    if (error?.message === 'session expired') {
      modal.open(LoginModal);
    }
    throw error;
  } finally {
    clearSyncRuntimeState();
  }
}

// 同步所有公众号
async function loadSelectedAccountArticle() {
  if (!checkLogin()) return;

  const rows = getSelectedRows();
  if (rows.length === 0) {
    return;
  }

  if (rows.some(account => !canSyncAccount(account))) {
    toast.warning('无法同步', '选中的公众号中包含不可同步项，请先取消选择或等待当前任务结束');
    return;
  }

  try {
    syncToTimestamp = getSyncTimestamp();

    let totalGenerated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const account of rows) {
      const status = await loadAccountArticle(account);
      totalGenerated += status.generated;
      totalSkipped += status.skipped;
      totalFailed += status.failed;
    }

    const rangeHint = isSyncAll() ? '' : `（同步范围：${getSyncRangeLabel()}）`;
    toast.success(
      '同步完成',
      `已成功同步 ${rows.length} 个公众号${rangeHint}，文档生成 ${totalGenerated} 篇，跳过 ${totalSkipped} 篇，失败 ${totalFailed} 篇`
    );
  } catch (e: any) {
    if (e.message === '已取消同步') {
      toast.warning('同步已取消', '当前同步任务已停止');
    } else {
      toast.error('同步失败', e.message);
    }
  }
}

let globalRowData: MpAccount[] = [];

const columnDefs = ref<ColDef[]>([
  {
    colId: 'fakeid',
    headerName: 'fakeid',
    field: 'fakeid',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    minWidth: 200,
    cellClass: 'font-mono',
    initialHide: true,
  },
  {
    colId: 'round_head_img',
    headerName: '头像',
    field: 'round_head_img',
    sortable: false,
    filter: false,
    cellRenderer: (params: ICellRendererParams) => {
      return `<img alt="" src="${IMAGE_PROXY + params.value}" style="height: 30px; width: 30px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 100%;" />`;
    },
    cellClass: 'flex justify-center items-center',
    minWidth: 80,
  },
  {
    colId: 'nickname',
    headerName: '名称',
    field: 'nickname',
    cellDataType: 'text',
    filter: 'agTextColumnFilter',
    tooltipField: 'nickname',
    minWidth: 200,
  },
  {
    colId: 'create_time',
    headerName: '添加时间',
    field: 'create_time',
    valueFormatter: p => (p.value ? formatTimeStamp(p.value) : ''),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('create_time') * 1000);
    },
    sort: 'desc',
    minWidth: 180,
    initialHide: true,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    colId: 'update_time',
    headerName: '最后数据更新时间',
    field: 'update_time',
    valueFormatter: p => (p.value ? formatTimeStamp(p.value) : ''),
    filter: 'agDateColumnFilter',
    filterParams: createDateColumnFilterParams(),
    filterValueGetter: (params: ValueGetterParams) => {
      return new Date(params.getValue('update_time') * 1000);
    },
    minWidth: 180,
    cellClass: 'flex justify-center items-center font-mono',
  },
  {
    colId: 'total_count',
    headerName: '消息总数',
    field: 'total_count',
    cellDataType: 'number',
    cellRenderer: 'agAnimateShowChangeCellRenderer',
    filter: 'agNumberColumnFilter',
    cellClass: 'flex justify-center items-center font-mono',
    minWidth: 150,
  },
  {
    colId: 'count',
    headerName: '已同步消息数',
    field: 'count',
    cellDataType: 'number',
    cellRenderer: 'agAnimateShowChangeCellRenderer',
    filter: 'agNumberColumnFilter',
    cellClass: 'flex justify-center items-center font-mono',
    minWidth: 180,
  },
  {
    colId: 'articles',
    headerName: '已同步文章数',
    field: 'articles',
    cellDataType: 'number',
    cellRenderer: 'agAnimateShowChangeCellRenderer',
    filter: 'agNumberColumnFilter',
    cellClass: 'flex justify-center items-center font-mono',
    minWidth: 180,
    initialHide: true,
  },
  {
    colId: 'status',
    headerName: '同步状态',
    field: 'status',
    cellRenderer: (params: ICellRendererParams) => {
      const label = getAccountSyncStatusLabel(params.value);
      return label ? `<span class="inline-flex items-center justify-center whitespace-nowrap">${label}</span>` : '';
    },
    tooltipValueGetter: () => null,
    filter: 'agSetColumnFilter',
    minWidth: 140,
    cellClass: 'flex justify-center items-center',
  },
  {
    colId: 'is_interface',
    headerName: '接口添加',
    field: 'is_interface',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('接口添加', '页面添加'),
    cellClass: 'flex justify-center items-center',
    headerClass: 'justify-center',
    minWidth: 140,
  },
  {
    colId: 'is_delete',
    headerName: '是否禁用',
    field: 'is_delete',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已禁用', '未禁用'),
    cellClass: 'flex justify-center items-center',
    headerClass: 'justify-center',
    minWidth: 140,
  },
  {
    colId: 'load_percent',
    headerName: '同步进度',
    valueGetter: params => (params.data.total_count === 0 ? 0 : params.data.count / params.data.total_count),
    cellDataType: 'number',
    cellRenderer: GridLoadProgress,
    autoHeight: true,
    cellRendererParams: {
      syncingRowId,
      syncStatus,
    },
    filter: 'agNumberColumnFilter',
    minWidth: 260,
  },
  {
    colId: 'completed',
    headerName: '是否同步完成',
    field: 'completed',
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',
    filterParams: createBooleanColumnFilterParams('已同步完成', '未同步完成'),
    cellClass: 'flex justify-center items-center',
    headerClass: 'justify-center',
    minWidth: 200,
  },
  {
    colId: 'action',
    headerName: '操作',
    field: 'fakeid',
    sortable: false,
    filter: false,
    cellRenderer: GridAccountActions,
    cellRendererParams: {
      onSync: (params: ICellRendererParams) => {
        if (!checkLogin()) return;

        loadAccountArticle(params.data)
          .then((status) => {
            const rangeHint = isSyncAll() ? '' : `（同步范围：${getSyncRangeLabel()}）`;
            const exportSummary = `生成 ${status.generated} 篇，跳过 ${status.skipped} 篇，失败 ${status.failed} 篇`;
            toast.success('同步完成', `公众号【${params.data.nickname}】已同步完毕${rangeHint}，${exportSummary}`);
          })
          .catch(e => {
            if (e.message === '已取消同步') {
              toast.warning('同步已取消', `公众号【${params.data.nickname}】的同步任务已停止`);
            } else {
              toast.error('同步失败', e.message);
            }
          });
      },
      onCancelSync: requestCancelCurrentSync,
      isDeleting: isDeleting,
      isSyncing,
      syncingRowId,
      syncStatus,
    },
    cellClass: 'flex justify-center items-center',
    minWidth: 140,
    maxWidth: 160,
    pinned: 'right',
  },
]);

// 注意，`defu`函数最左边的参数优先级最高
const gridOptions: GridOptions = defu(
  {
    getRowId: (params: GetRowIdParams) => String(params.data.fakeid),
    getRowHeight: (params: RowHeightParams) => (params.data?.fakeid === syncingRowId.value ? SYNC_PROGRESS_ROW_HEIGHT : undefined),
  },
  sharedGridOptions
);

const gridApi = shallowRef<GridApi | null>(null);
function onGridReady(params: GridReadyEvent) {
  gridApi.value = params.api;

  restoreColumnState();
  void refresh().then(() => restoreActiveManualSyncJob());
  if (!refreshTimer) {
    refreshTimer = window.setInterval(() => {
      if (!isSyncing.value) {
        void refresh();
      }
    }, ACCOUNT_PAGE_REFRESH_INTERVAL_MS);
  }
}

watch([syncingRowId, syncStatus], async () => {
  await nextTick();
  gridApi.value?.resetRowHeights();
}, { deep: true });

onUnmounted(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  syncPollSequence += 1;
});

function onColumnStateChange() {
  if (gridApi.value) {
    saveColumnState();
  }
}
function saveColumnState() {
  const state = gridApi.value?.getColumnState();
  localStorage.setItem('agGridColumnState-account', JSON.stringify(state));
}

function restoreColumnState() {
  const stateStr = localStorage.getItem('agGridColumnState-account');
  if (stateStr) {
    const state = JSON.parse(stateStr);
    gridApi.value?.applyColumnState({
      state,
      applyOrder: true,
    });
  }
}

async function refresh() {
  if (isRefreshingAccounts) {
    return;
  }

  isRefreshingAccounts = true;
  try {
    const accounts = await getAllInfo();
    globalRowData = accounts;
    gridApi.value?.setGridOption('rowData', globalRowData);
  } finally {
    isRefreshingAccounts = false;
  }
}

function onSelectionChanged(evt: SelectionChangedEvent) {
  selectedRows.value = (evt.selectedNodes?.map(node => node.data as MpAccount) || []);
}
function getSelectedRows() {
  const rows: MpAccount[] = [];
  gridApi.value?.forEachNodeAfterFilterAndSort(node => {
    if (node.isSelected()) {
      rows.push(node.data as MpAccount);
    }
  });
  return rows;
}

// 删除所选的公众号数据
function deleteSelectedAccounts() {
  const rows = getSelectedRows();
  const ids = rows.map(info => info.fakeid);
  modal.open(ConfirmModal, {
    title: '确定要删除所选公众号的数据吗？',
    description: '删除之后，该公众号的所有数据(包括已下载的文章和留言等)都将被清空。',
    async onConfirm() {
      try {
        isDeleting.value = true;
        await deleteAccountData(ids);
        // 通知 Credentials 面板这些公众号已被移除
        ids.forEach(fakeid => accountEventBus.emit('account-removed', { fakeid: fakeid }));
      } finally {
        isDeleting.value = false;
        await refresh();
      }
    },
  });
}

// 导入公众号
const fileRef = ref<HTMLInputElement | null>(null);
const importBtnLoading = ref(false);
function importAccount() {
  fileRef.value!.click();
}
async function handleFileChange(evt: Event) {
  const files = (evt.target as HTMLInputElement).files;
  if (files && files.length > 0) {
    const file = files[0];

    try {
      importBtnLoading.value = true;

      // 解析 JSON
      const jsonData = JSON.parse(await file.text());
      if (jsonData.usefor !== 'wechat-article-exporter') {
        // 文件格式不正确
        toast.error('导入公众号失败', '导入文件格式不正确，请选择该网站导出的文件进行导入。');
        return;
      }
      const infos = jsonData.accounts;
      if (!infos || infos.length <= 0) {
        // 文件格式不正确
        toast.error('导入公众号失败', '导入文件格式不正确，请选择该网站导出的文件进行导入。');
        return;
      }

      await importMpAccounts(infos);
      await refresh();
    } catch (error) {
      console.error('导入公众号时 JSON 解析失败:', error);
      toast.error('导入公众号', (error as Error).message);
    } finally {
      importBtnLoading.value = false;
    }
  }
}

// 导出公众号
const exportBtnLoading = ref(false);
function exportAccount() {
  exportBtnLoading.value = true;
  try {
    const rows = getSelectedRows();
    const data: AccountManifest = {
      version: '1.0',
      usefor: 'wechat-article-exporter',
      accounts: rows,
    };
    exportAccountJsonFile(data, '公众号');
    toast.success('导出公众号', `成功导出了 ${rows.length} 个公众号`);
  } finally {
    exportBtnLoading.value = false;
  }
}
</script>

<template>
  <div class="h-full">
    <Teleport defer to="#title">
      <h1 class="text-[28px] leading-[34px] text-slate-12 dark:text-slate-50 font-bold">公众号管理</h1>
    </Teleport>

    <div class="flex flex-col h-full divide-y divide-gray-200">
      <!-- 顶部操作区 -->
      <header class="flex items-stretch gap-3 px-3 py-3">
        <UButton icon="i-lucide:user-plus" color="blue" :disabled="isDeleting || addBtnLoading" @click="addAccount">
          {{ addBtnLoading ? '添加中...' : '添加' }}
        </UButton>
        <UButton icon="i-lucide:arrow-down-to-line" color="blue" :loading="importBtnLoading" @click="importAccount">
          批量导入
          <input ref="fileRef" type="file" accept=".json" class="hidden" @change="handleFileChange" />
        </UButton>
        <UButton
          icon="i-lucide:arrow-up-from-line"
          color="blue"
          :loading="exportBtnLoading"
          :disabled="!hasSelectedRows"
          @click="exportAccount"
        >
          批量导出
        </UButton>
        <UButton
          color="rose"
          icon="i-lucide:user-minus"
          class="disabled:opacity-35"
          :loading="isDeleting"
          :disabled="!hasSelectedRows"
          @click="deleteSelectedAccounts"
          >删除</UButton
        >
        <UButton
          color="black"
          icon="i-heroicons:arrow-path-rounded-square-20-solid"
          class="disabled:opacity-35"
          :disabled="isBatchSyncDisabled"
          @click="loadSelectedAccountArticle"
          >同步</UButton
        >
        <div class="hidden xl:flex flex-1 justify-end">
          <span class="self-end text-sm text-blue-500 font-medium">同步范围: {{ getActualDateRange() }}</span>
        </div>
      </header>

      <div v-if="syncStatusText" class="border-b border-gray-200 bg-slate-50 px-3 py-2">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span :class="syncStatusClass">{{ syncStatusText }}</span>
            <a
              v-if="syncStatusUrl"
              :href="syncStatusUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="break-all font-mono text-xs text-sky-600 underline hover:text-sky-700"
            >
              {{ syncStatusUrl }}
            </a>
          </div>
          <div class="flex justify-end">
            <UButton
              v-if="canCancelCurrentSync"
              color="rose"
              size="xs"
              variant="soft"
              :loading="syncStatus?.stage === 'cancelling'"
              @click="requestCancelCurrentSync"
            >
              {{ syncStatus?.stage === 'cancelling' ? '取消中' : '取消同步' }}
            </UButton>
          </div>
        </div>
      </div>

      <!-- 数据表格 -->
      <ag-grid-vue
        style="width: 100%; height: 100%"
        :rowData="globalRowData"
        :columnDefs="columnDefs"
        :gridOptions="gridOptions"
        @grid-ready="onGridReady"
        @selection-changed="onSelectionChanged"
        @column-moved="onColumnStateChange"
        @column-visible="onColumnStateChange"
        @column-pinned="onColumnStateChange"
        @column-resized="onColumnStateChange"
      ></ag-grid-vue>
    </div>

    <!-- 添加公众号弹框 -->
    <GlobalSearchAccountDialog ref="searchAccountDialogRef" @select:account="onSelectAccount" />
  </div>
</template>
