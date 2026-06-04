export default defineNuxtRouteMiddleware(async (to) => {
  const loginPage = '/login';

  // 如果已经在登录页，直接放行
  if (to.path === loginPage) {
    return;
  }

  const { data: session } = await useFetch('/api/app/session');

  // 未登录则跳转登录页
  if (!session.value?.authenticated) {
    return navigateTo(loginPage);
  }

  // 已登录访问登录页则跳转首页
  if (to.path === loginPage) {
    return navigateTo('/');
  }
});
