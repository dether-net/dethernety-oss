<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()
const message = ref('Logging you out...')

onMounted(async () => {
  try {
    const isValid = await authStore.checkSessionValidity()
    await authStore.logout(isValid)
    message.value = 'You have been successfully logged out.'
    
    // Auto-redirect to login after 3 seconds
    setTimeout(() => {
      goToLogin()
    }, 3000)
  } catch (error) {
    console.error('Post-logout cleanup error:', error)
    message.value = 'Logout completed with some issues. Please clear your browser cache.'
    await authStore.logout(false)
  }
})

const goToLogin = () => {
  router.push('/login')
}
</script>

<template>
  <div class="logout-container">
    <div class="logout-content">
      <h1>You have been logged out</h1>
      <p>{{ message }}</p>
      <button @click="goToLogin" class="login-button">
        Return to Login
      </button>
    </div>
  </div>
</template>

<style scoped>
.logout-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f5f5f5;
}

.logout-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  text-align: center;
}

.login-button {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
</style>
