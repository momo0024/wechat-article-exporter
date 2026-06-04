export const useAppAuth = () => {
  const isLoggedIn = ref(false);
  const username = ref('');

  const checkSession = async () => {
    try {
      const { data } = await useFetch('/api/app/session');
      if (data.value?.authenticated) {
        isLoggedIn.value = true;
        username.value = data.value.username || '';
      }
    } catch {
      isLoggedIn.value = false;
      username.value = '';
    }
  };

  const login = async (loginUsername: string, loginPassword: string) => {
    try {
      const { data, error } = await useFetch('/api/app/login', {
        method: 'POST',
        body: { username: loginUsername, password: loginPassword },
      });

      if (error.value) {
        throw error.value;
      }

      isLoggedIn.value = true;
      username.value = loginUsername;
      return data.value;
    } catch (err) {
      isLoggedIn.value = false;
      throw err;
    }
  };

  const logout = async () => {
    await $fetch('/api/app/logout', { method: 'POST' }).catch(() => {});
    isLoggedIn.value = false;
    username.value = '';
  };

  return {
    isLoggedIn,
    username,
    checkSession,
    login,
    logout,
  };
};
