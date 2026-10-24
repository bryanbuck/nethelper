<template>
  <v-container class="fill-height" fluid>
    <v-row justify="center" align="center" class="fill-height">
      <v-col cols="12" sm="8" md="6" class="text-center">
        <v-card class="elevation-8 rounded-lg pa-8">
          <v-card-text>
            <v-icon
              size="120"
              color="primary"
              class="mb-6"
            >
              mdi-compass-off
            </v-icon>
            
            <h1 class="text-h2 font-weight-bold mb-4">404</h1>
            <h2 class="text-h5 text-medium-emphasis mb-6">
              Page Not Found
            </h2>
            
            <p class="text-body-1 mb-8">
              The page you're looking for doesn't exist or has been moved.
            </p>
            
            <v-btn
              color="primary"
              size="large"
              class="mr-4"
              @click="goHome"
            >
              <v-icon start>mdi-home</v-icon>
              Go Home
            </v-btn>
            
            <v-btn
              variant="outlined"
              size="large"
              @click="goBack"
            >
              <v-icon start>mdi-arrow-left</v-icon>
              Go Back
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

const goHome = () => {
  router.push('/dashboard')
}

const goBack = () => {
  router.go(-1)
}
</script>

<style scoped>
.fill-height {
  min-height: 100vh;
  background: linear-gradient(
    135deg,
    rgb(var(--v-theme-primary)) 0%,
    color-mix(in srgb, rgb(var(--v-theme-primary)) 80%, black) 100%
  );
}

.v-card {
  border-radius: 16px !important;
}
</style>