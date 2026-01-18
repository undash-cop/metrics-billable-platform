<template>
  <footer class="VPFooter">
    <div class="footer-content">
      <div class="footer-message">
        <a href="/" class="logo-link">
          <img src="/assets/logo.svg" alt="Undash-cop Logo" class="logo-image" />
        </a>
        <p>{{ message }}</p>
      </div>
      <div class="footer-links">
        <a href="/legal/" class="footer-link">Legal</a>
        <span class="footer-separator">•</span>
        <a href="/legal/terms-of-service" class="footer-link">Terms of Service</a>
        <span class="footer-separator">•</span>
        <a href="/legal/privacy-policy" class="footer-link">Privacy Policy</a>
        <span class="footer-separator">•</span>
        <a href="/legal/license" class="footer-link">License</a>
        <span class="footer-separator">•</span>
        <a href="/legal/disclaimer" class="footer-link">Disclaimer</a>
      </div>
      <div class="footer-copyright">
        <p>{{ copyright }}</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const message = 'Undash-cop Metrics Billing Platform Documentation'
const copyright = 'Copyright © 2026 Undash-cop Private Limited. All rights reserved.'
</script>

<style scoped>
.VPFooter {
  border-top: 1px solid var(--vp-c-divider);
  padding: 32px 24px;
  background-color: var(--vp-c-bg);
  margin-top: 48px;
}

.footer-content {
  max-width: 1152px;
  margin: 0 auto;
  text-align: center;
}

.footer-message {
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.footer-message p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 24px;
}

.logo-link {
  display: inline-block;
  text-decoration: none;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.logo-link:hover {
  opacity: 0.8;
}

.logo-image {
  height: 32px;
  width: auto;
  display: block;
  vertical-align: middle;
}

.footer-links {
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.footer-link {
  color: var(--vp-c-text-2);
  text-decoration: none;
  font-size: 14px;
  transition: color 0.2s;
}

.footer-link:hover {
  color: var(--vp-c-brand);
  text-decoration: underline;
}

.footer-separator {
  color: var(--vp-c-divider);
  margin: 0 4px;
  font-size: 14px;
}

.footer-copyright {
  margin-top: 12px;
}

.footer-copyright p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 20px;
}

@media (max-width: 768px) {
  .VPFooter {
    padding: 24px 16px;
  }
  
  .footer-links {
    flex-direction: column;
    gap: 4px;
  }
  
  .footer-separator {
    display: none;
  }
}
</style>
