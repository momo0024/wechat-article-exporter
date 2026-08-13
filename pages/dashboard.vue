<template>
  <div class="flex flex-col h-screen">
    <!-- 全局提示（横跨侧边栏与顶部操作栏之上）-->
    <SiteNotice />

    <div class="flex flex-1 min-h-0">
      <!-- 左侧边栏 -->
      <SideBar />

      <USlideover
        v-model="sidebarOpen"
        side="left"
        :ui="{ width: 'max-w-[280px]' }"
      >
        <SideBar mobile @close="sidebarOpen = false" />
      </USlideover>

      <div class="flex flex-col flex-1 overflow-hidden h-full">
        <!-- 顶部操作栏 -->
        <div
          class="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-6 px-4 dark:border-slate-600 md:px-6"
        >
          <div class="flex min-w-0 items-center gap-3">
            <UButton
              class="md:hidden"
              color="gray"
              variant="ghost"
              square
              icon="i-lucide:panel-left-open"
              @click="sidebarOpen = true"
            />
            <div id="title" class="min-w-0"></div>
          </div>
          <GlobalActions />
        </div>

        <!-- 页面容器 -->
        <div class="flex-1 overflow-hidden">
          <NuxtPage />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import GlobalActions from '~/components/dashboard/Actions.vue';
import SideBar from '~/components/dashboard/SideBar.vue';
import SiteNotice from '~/components/global/SiteNotice.vue';

const sidebarOpen = ref(false);
const route = useRoute();

watch(() => route.fullPath, () => {
  sidebarOpen.value = false;
});
</script>
