import {defineConfig} from '@playwright/test';
export default defineConfig({
    testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1,
    use: {baseURL: 'http://127.0.0.1:8766', channel: 'chrome', viewport: {width: 1000, height: 900}},
    webServer: {command: 'node tests/serve.mjs', url: 'http://127.0.0.1:8766', reuseExistingServer: false},
});
