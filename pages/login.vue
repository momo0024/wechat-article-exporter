<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-900">
    <!-- 背景装饰 -->
    <div class="pointer-events-none absolute inset-0">
      <div class="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-blue-500/20 blur-3xl" />
      <div class="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-purple-500/20 blur-3xl" />
    </div>

    <div class="relative z-10 w-full max-w-sm px-4">
      <!-- Logo 区域 -->
      <div class="mb-8 text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/25">
          <UIcon name="i-lucide:message-square-quote" class="h-8 w-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-slate-100">{{ websiteName }}</h1>
        <p class="mt-1 text-sm text-slate-400">批量下载 & 导出公众号文章</p>
      </div>

      <!-- 登录卡片 -->
      <div class="rounded-2xl border border-slate-700/50 bg-slate-800/80 p-6 shadow-2xl backdrop-blur-sm">
        <form class="space-y-4" @submit.prevent="handleLogin">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">账号</label>
            <div class="relative">
              <UIcon
                name="i-lucide:user"
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              />
              <input
                v-model="formData.username"
                type="text"
                autocomplete="username"
                placeholder="请输入账号"
                class="w-full rounded-lg border border-slate-600 bg-slate-700/50 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">密码</label>
            <div class="relative">
              <UIcon
                name="i-lucide:lock"
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              />
              <input
                v-model="formData.password"
                type="password"
                autocomplete="current-password"
                placeholder="请输入密码"
                class="w-full rounded-lg border border-slate-600 bg-slate-700/50 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div
            v-if="errorMessage"
            class="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-400"
          >
            <UIcon name="i-lucide:alert-circle" class="h-4 w-4 flex-shrink-0" />
            <span>{{ errorMessage }}</span>
          </div>

          <button
            type="submit"
            :disabled="isLoading"
            class="relative flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/25 transition hover:shadow-blue-500/40 disabled:opacity-50"
          >
            <UIcon
              v-if="isLoading"
              name="i-lucide:loader"
              class="h-4 w-4 animate-spin"
            />
            <span v-else>
              登录
            </span>
          </button>
        </form>
      </div>

      <p class="mt-6 text-center text-xs text-slate-500">默认账号: admin / admin</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { websiteName } from '~/config';

useHead({
  title: `登录 | ${websiteName}`,
});

definePageMeta({
  layout: 'empty',
});

const formData = ref({
  username: '',
  password: '',
});
const errorMessage = ref('');
const isLoading = ref(false);

const handleLogin = async () => {
  if (!formData.value.username || !formData.value.password) {
    errorMessage.value = '请输入账号和密码';
    return;
  }

  errorMessage.value = '';
  isLoading.value = true;

  try {
    await $fetch('/api/app/login', {
      method: 'POST',
      body: {
        username: formData.value.username,
        password: formData.value.password,
      },
    });

    navigateTo('/');
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401) {
      errorMessage.value = '账号或密码错误';
    } else {
      errorMessage.value = '登录失败，请稍后重试';
    }
  } finally {
    isLoading.value = false;
  }
};
</script>
