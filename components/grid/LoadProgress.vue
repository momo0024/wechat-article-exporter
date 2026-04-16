<script setup lang="ts">
import type { ICellRendererParams } from 'ag-grid-community';
import type { Ref } from 'vue';
import { getManualSyncProgressClass, getManualSyncProgressText, type ManualSyncJobStatus } from '~/shared/utils/manual-sync';

interface Props {
  params: ICellRendererParams & {
    syncingRowId?: string | null | Ref<string | null>;
    syncStatus?: ManualSyncJobStatus | null | Ref<ManualSyncJobStatus | null>;
  };
}
const props = defineProps<Props>();

function unwrap<T>(value: T | Ref<T>): T {
  return isRef(value) ? value.value : value;
}

function resolveTotalCount(data: Record<string, any>, status: ManualSyncJobStatus | null): number {
  const totalCount = Number(data.total_count || 0) || Number(status?.totalCount || 0);
  return Math.max(totalCount, 1);
}

const count = ref(props.params.data.count);
const total = ref(resolveTotalCount(props.params.data, null));

const currentSyncStatus = computed(() => unwrap(props.params.syncStatus ?? null));
const isCurrentRowSyncing = computed(() => props.params.node.id === unwrap(props.params.syncingRowId ?? null));

const progressText = computed(() => {
  if (!isCurrentRowSyncing.value) {
    return '';
  }

  return getManualSyncProgressText(currentSyncStatus.value);
});

const progressTextClass = computed(() => getManualSyncProgressClass(currentSyncStatus.value));

function refresh(params: ICellRendererParams): boolean {
  count.value = params.data.count;
  total.value = resolveTotalCount(params.data, currentSyncStatus.value);
  return true;
}
</script>

<template>
  <div class="flex min-h-[48px] w-full flex-col justify-center gap-1 overflow-hidden py-1">
    <UProgress color="sky" :value="count" :max="total" indicator />
    <div
      v-if="progressText"
      class="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-4"
      :class="progressTextClass"
    >
      {{ progressText }}
    </div>
  </div>
</template>
