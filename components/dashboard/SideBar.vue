<script setup lang="ts">
import BottomPanel from '~/components/dashboard/BottomPanel.vue';
import NavMenus from '~/components/dashboard/NavMenus.vue';
import { websiteName } from '~/config';

withDefaults(defineProps<{ mobile?: boolean }>(), {
  mobile: false,
});

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <aside
    :class="[
      'flex flex-col justify-between border-r border-slate-4 bg-slate-1 px-4 pb-6 dark:border-slate-700',
      mobile ? 'h-full w-full overflow-y-auto' : 'hidden h-screen w-[250px] flex-shrink-0 md:flex',
    ]"
  >
    <!-- 网站标题 & Logo -->
    <div class="flex h-[60px] items-center justify-between">
      <NuxtLink to="/" class="px-2 font-bold text-xl">{{ websiteName }}</NuxtLink>
      <UButton
        v-if="mobile"
        color="gray"
        variant="ghost"
        square
        icon="i-lucide:x"
        @click="emit('close')"
      />
    </div>

    <!-- 导航菜单 -->
    <NavMenus :mobile="mobile" />

    <!-- 底部视图 -->
    <BottomPanel />
  </aside>
</template>
