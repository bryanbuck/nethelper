<template>
  <v-card>
    <v-card-title>API Connection Test</v-card-title>
    <v-card-text>
      <v-btn :loading="testing" color="primary" @click="testConnection">
        Test API Connection
      </v-btn>
      
      <v-alert v-if="result" :type="result.success ? 'success' : 'error'" class="mt-4">
        <div><strong>Status:</strong> {{ result.status }}</div>
        <div><strong>Message:</strong> {{ result.message }}</div>
        <div v-if="result.data"><strong>Data:</strong> {{ JSON.stringify(result.data, null, 2) }}</div>
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref } from 'vue'
import api from '@/services/api'

const testing = ref(false)
const result = ref(null)

const testConnection = async () => {
  testing.value = true
  result.value = null
  
  try {
    console.log('🔄 Testing API connection...')
    const response = await api.get('/health')
    
    result.value = {
      success: true,
      status: response.status,
      message: 'API connection successful',
      data: response.data
    }
    
    console.log('✅ API test successful:', response)
  } catch (error) {
    console.error('❌ API test failed:', error)
    
    result.value = {
      success: false,
      status: error.response?.status || 'Network Error',
      message: error.response?.data?.message || error.message || 'Unknown error',
      data: error.response?.data
    }
  } finally {
    testing.value = false
  }
}
</script>