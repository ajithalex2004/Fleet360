import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'.',testMatch:'*.spec.ts',workers:1,timeout:30000,retries:0,
 reporter:[['list']],outputDir:'../../../test-results/dispatcher-ui',
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',channel:process.env.CI?'chrome':undefined,timezoneId:'Asia/Dubai',screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'node tests/ui/dispatcher/build-css.mjs && npx vite --config tests/ui/dispatcher/vite.config.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:false,cwd:process.cwd(),timeout:60000},
});
