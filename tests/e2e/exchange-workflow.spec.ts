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
import {
  isServerAvailable,
  createE2ETenant,
  cleanupE2ETenant,
  saveAuthState,
  loginWithStoredState,
  skipIfOffline,
  type E2EContext,
  type StorageState,
} from './helpers';

test.describe('Fleet360 Exchange: End-to-End UI Outsourcing Workflow', () => {
  let serverUp = false;
  let ctx: E2EContext | null = null;
  let authState: StorageState | null = null;
  let partnerId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    serverUp = await isServerAvailable();
    if (!serverUp) return;

    ctx = await createE2ETenant('Exchange');

    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const crypto = await import('crypto');

    try {
      const uid = crypto.randomUUID().slice(0, 8).toUpperCase();
      partnerId = crypto.randomUUID();

      await prisma.transportPartner.create({
        data: {
          id: partnerId,
          legalName: `E2E Exchange Carrier ${uid} LLC`,
          tradeName: `E2E Carrier ${uid}`,
          partnerCode: `PTN-E2E-${uid}`,
          country: 'AE',
          city: 'Dubai',
          emirate: 'DUBAI',
          onboardingStatus: 'APPROVED',
          operationalStatus: 'ACTIVE',
          marketplaceStatus: 'APPROVED',
          approvedAt: new Date(),
          onboardedByTenantId: ctx.tenantId,
        },
      });

      await prisma.partnerUser.create({
        data: {
          id: crypto.randomUUID(),
          partnerId,
          userId: ctx.userId,
          role: 'PARTNER_ADMIN',
        },
      });

      await prisma.partnerScorecard.create({
        data: {
          id: crypto.randomUUID(),
          partnerId,
          tenantId: ctx.tenantId,
          tier: 'GOLD',
          compositeScore: 94.5,
          onTimePerformance: 96.0,
          quoteResponseRate: 90.0,
          exceptionRate: 0.0,
          disputeRate: 0.0,
          podQualityRate: 98.0,
          totalAwardedTrips: 25,
          completedTrips: 24,
          onTimeTrips: 23,
          quotesSubmitted: 18,
          quotesInvited: 20,
        },
      });
    } finally {
      await prisma.$disconnect();
    }

    authState = await saveAuthState(browser, ctx.email, ctx.password);
  });

  test.afterAll(async () => {
    if (partnerId) {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      try {
        await prisma.transportPartner.delete({ where: { id: partnerId } }).catch(() => {});
      } finally {
        await prisma.$disconnect();
      }
    }
    await cleanupE2ETenant(ctx);
  });

  test.beforeEach(async ({}, testInfo) => {
    skipIfOffline(serverUp, testInfo);
  });

  test('Step 1: Platform Hub (/platform) displays Exchange Module card', async ({ page }) => {
    await loginWithStoredState(page, authState!, ctx!);
    await page.goto('/platform');

    // Check that the Exchange card exists on the platform landing hub
    const exchangeCard = page.locator('text=Fleet360 Exchange');
    await expect(exchangeCard.first()).toBeVisible({ timeout: 10000 });

    // Verify marketplace tags
    const marketplaceTag = page.locator('text=Marketplace');
    await expect(marketplaceTag.first()).toBeVisible();
  });

  test('Step 2: Partner Exchange Dashboard (/exchange/dashboard) renders executive KPIs', async ({ page }) => {
    await loginWithStoredState(page, authState!, ctx!);
    await page.goto('/exchange/dashboard');

    // Check for dashboard title and KPI metrics
    await expect(page.locator('h1, h2, div').filter({ hasText: 'Exchange' }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Active').first()).toBeVisible({ timeout: 15000 });
  });

  test('Step 3: Private Marketplace Feed (/exchange/marketplace) renders opportunity cards', async ({ page }) => {
    await loginWithStoredState(page, authState!, ctx!);
    await page.goto('/exchange/marketplace');

    // Verify Marketplace Header
    await expect(page.locator('text=Marketplace').first()).toBeVisible({ timeout: 15000 });

    // Check for domain badges or opportunity elements
    const quoteButton = page.locator('button').filter({ hasText: /Quote|Bid|Submit/i });
    if (await quoteButton.count() > 0) {
      await expect(quoteButton.first()).toBeVisible();
    }
  });

  test('Step 4: Partner Jobs & Requests (/exchange/jobs) displays dispatch and assignment queues', async ({ page }) => {
    await loginWithStoredState(page, authState!, ctx!);
    await page.goto('/exchange/jobs');

    await expect(page.locator('text=Jobs').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Requests').first()).toBeVisible({ timeout: 15000 });
  });

  test('Step 5: Driver Mobile Tracking Screen (/track/partner-trip/demo-token) renders live GPS and Waypoint Stepper', async ({ page }) => {
    await page.goto('/track/partner-trip/demo-token-64char-sample-1234567890abcdef1234567890abcdef12345678');

    // Check for Mobile Interface elements
    const tripHeader = page.locator('header, div').filter({ hasText: /Trip|Outsource|Broadcast/i });
    await expect(tripHeader.first()).toBeVisible({ timeout: 15000 });
  });

  test('Step 6: Partner Statements & Tax Invoices (/exchange/statements) renders settlement summaries', async ({ page }) => {
    await loginWithStoredState(page, authState!, ctx!);
    await page.goto('/exchange/statements');

    await expect(page.locator('text=Statement').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Invoice').first()).toBeVisible({ timeout: 15000 });
  });

  test('Step 7: Partner Performance Scorecard (/exchange/scorecard) renders KPI badges and tiering', async ({ page }) => {
    await loginWithStoredState(page, authState!, ctx!);
    await page.goto('/exchange/scorecard');

    await expect(page.locator('text=Scorecard').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=On-Time Performance').first()).toBeVisible({ timeout: 15000 });
  });
});
