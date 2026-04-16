<script setup lang="ts">
import type { ICellRendererParams } from 'ag-grid-community';
import { Loader } from 'lucide-vue-next';
import type { Ref } from 'vue';
import { getAccountSyncActionState, type ManualSyncJobStatus } from '~/shared/utils/manual-sync';

interface Props {
  params: ICellRendererParams & {
    onSync?: (params: ICellRendererParams) => void;
    onCancelSync?: (params: ICellRendererParams) => void;
    isDeleting: boolean | Ref<boolean>;
    isSyncing: boolean | Ref<boolean>;
    syncingRowId: string | null | Ref<string | null>;
    syncStatus?: ManualSyncJobStatus | null | Ref<ManualSyncJobStatus | null>;
  };
}
const props = defineProps<Props>();

function unwrap<T>(value: T | Ref<T>): T {
  return isRef(value) ? value.value : value;
}

function sync() {
  props.params.onSync && props.params.onSync(props.params);
}

function cancelSync() {
  props.params.onCancelSync && props.params.onCancelSync(props.params);
}

const currentSyncStatus = computed(() => unwrap(props.params.syncStatus ?? null));
const actionState = computed(() => getAccountSyncActionState({
  fakeid: props.params.data.fakeid,
  status: props.params.data.status,
  isDelete: props.params.data.is_delete,
  isDeleting: unwrap(props.params.isDeleting),
  isManualSyncing: unwrap(props.params.isSyncing),
  syncingFakeid: unwrap(props.params.syncingRowId),
  syncStatus: currentSyncStatus.value,
}));
</script>

<template>
  <div class="flex items-center justify-center gap-3">
    <UButton v-if="actionState.isDisabledAccount" color="gray" size="xs" variant="soft" disabled>
      已禁用
    </UButton>
    <UButton v-else-if="actionState.canCancel" color="rose" size="xs" variant="soft" :loading="actionState.isCancelling" @click="cancelSync">
      {{ actionState.isCancelling ? '取消中' : '取消' }}
    </UButton>
    <UButton v-else-if="actionState.isLoading" color="amber" size="xs" variant="soft" disabled>
      <Loader :size="14" class="animate-spin" />
      同步中</UButton
    >
    <UButton v-else-if="actionState.isQueued" icon="i-lucide:clock-3" color="gray" size="xs" variant="soft" disabled>
      排队中
    </UButton>
    <UButton
      v-else
      icon="i-heroicons:arrow-path-rounded-square-20-solid"
      color="blue"
      size="xs"
      :disabled="actionState.disableSync"
      @click="sync"
    ></UButton>
  </div>
</template>
