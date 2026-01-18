<template>
  <Layout>
    <template #layout-bottom>
      <CustomFooter />
    </template>
  </Layout>
</template>

<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import CustomFooter from './Footer.vue';

const Layout = DefaultTheme.Layout;
</script>
