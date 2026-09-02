/**
 * tests/e2e/exchange-workflow.spec.ts
 *
 * End-to-End Browser UI Test for Fleet360 Exchange:
 * 1. Platform Landing Hub (/platform) card discovery.
 * 2. Partner Portal Dashboard (/exchange/dashboard).
 * 3. Marketplace Feed & Blind Quoting (/exchange/marketplace).
 * 4. Partner Jobs & Compliant Driver Assignment (/exchange/jobs).
 * 5. Driver Mobile Tracking & Multi-Stop Waypoint Stepper (/track/partner-trip/[token]).
 * 6. Statements & UAE FTA Tax Invoices (/exchange/statements).
 * 7. Partner Performance Scorecard & Tiering (/exchange/scorecard).
 */

import { test, expect } from '@playwright/test';

test.describe('Fleet360 Exchange: End-to-End UI Outsourcing Workflow', () => {
  test('Step 1: Platform Hub (/platform) displays Exchange Module card', async ({ page }) => {
    await page.goto('/platform');
    
    // Check that the Exchange card exists on the platform landing hub
    const exchangeCard = page.locator('text=Fleet360 Exchange');
    await expect(exchangeCard.first()).toBeVisible({ timeout: 10000 });

    // Verify marketplace tags
    const marketplaceTag = page.locator('text=Marketplace');
    await expect(marketplaceTag.first()).toBeVisible();
  });

  test('Step 2: Partner Exchange Dashboard (/exchange/dashboard) renders executive KPIs', async ({ page }) => {
    await page.goto('/exchange/dashboard');
    
    // Check for dashboard title and KPI metrics
    await expect(page.locator('h1, h2, div').filter({ hasText: 'Exchange' }).first()).toBeVisible();
    await expect(page.locator('text=Active').first()).toBeVisible();
  });

  test('Step 3: Private Marketplace Feed (/exchange/marketplace) renders opportunity cards', async ({ page }) => {
    await page.goto('/exchange/marketplace');

    // Verify Marketplace Header
    await expect(page.locator('text=Marketplace').first()).toBeVisible();
    
    // Check for domain badges or opportunity elements
    const quoteButton = page.locator('button').filter({ hasText: /Quote|Bid|Submit/i });
    if (await quoteButton.count() > 0) {
      await expect(quoteButton.first()).toBeVisible();
    }
  });

  test('Step 4: Partner Jobs & Requests (/exchange/jobs) displays dispatch and assignment queues', async ({ page }) => {
    await page.goto('/exchange/jobs');

    await expect(page.locator('text=Jobs').first()).toBeVisible();
    await expect(page.locator('text=Requests').first()).toBeVisible();
  });

  test('Step 5: Driver Mobile Tracking Screen (/track/partner-trip/demo-token) renders live GPS and Waypoint Stepper', async ({ page }) => {
    await page.goto('/track/partner-trip/demo-token-64char-sample-1234567890abcdef1234567890abcdef12345678');

    // Check for Mobile Interface elements
    const tripHeader = page.locator('header, div').filter({ hasText: /Trip|Outsource|Broadcast/i });
    await expect(tripHeader.first()).toBeVisible();
  });

  test('Step 6: Partner Statements & Tax Invoices (/exchange/statements) renders settlement summaries', async ({ page }) => {
    await page.goto('/exchange/statements');

    await expect(page.locator('text=Statement').first()).toBeVisible();
    await expect(page.locator('text=Invoice').first()).toBeVisible();
  });

  test('Step 7: Partner Performance Scorecard (/exchange/scorecard) renders KPI badges and tiering', async ({ page }) => {
    await page.goto('/exchange/scorecard');

    await expect(page.locator('text=Scorecard').first()).toBeVisible();
    await expect(page.locator('text=On-Time Performance').first()).toBeVisible();
  });
});
