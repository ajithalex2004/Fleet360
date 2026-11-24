import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  createRailwayContext,
  project as railwayProject,
  type ServiceNode,
} from 'railway/iac';
import railwayProgram from '../../.railway/railway';

async function evaluateEnv(environment: 'production' | 'staging') {
  const def = await railwayProgram(
    createRailwayContext({ environment }),
    railwayProject,
  );
  const resources = (def.resources ?? []).flat();
  const services = resources.filter(
    (resource): resource is ServiceNode => resource.type === 'service',
  );
  const byName = new Map(services.map((svc) => [svc.name, svc]));
  return { def, services, byName };
}

describe('Railway IaC Migration — Configuration Parity Checks (.railway/railway.ts)', () => {
  const root = process.cwd();

  it('removes legacy Config-as-Code files (railway.json / railway.toml) in favor of .railway/railway.ts', () => {
    expect(fs.existsSync(path.join(root, '.railway', 'railway.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'railway.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'railway.toml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'backend', 'railway.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'backend', 'railway.toml'))).toBe(false);
  });

  it('declares both fleet360-app and fleet360-backend in project fleet360-railway for production and staging', async () => {
    for (const env of ['staging', 'production'] as const) {
      const { def, services, byName } = await evaluateEnv(env);
      expect(def.name).toBe('fleet360-railway');
      expect(services).toHaveLength(2);
      expect(byName.has('fleet360-app')).toBe(true);
      expect(byName.has('fleet360-backend')).toBe(true);
    }
  });

  it('maintains full parity with legacy railway.json for fleet360-app across environments', async () => {
    for (const env of ['staging', 'production'] as const) {
      const { byName } = await evaluateEnv(env);
      const app = byName.get('fleet360-app')!;

      expect(app.source).toMatchObject({
        type: 'github',
        repo: 'ajithalex2004/Fleet360',
        branch: 'main',
        checkSuites: false,
      });
      expect(app.source?.rootDirectory).toBeUndefined();

      expect(app.build).toMatchObject({
        builder: 'RAILPACK',
        buildEnvironment: 'V3',
      });

      expect(app.deploy).toMatchObject({
        startCommand: 'npm start',
      });
      // Railway normalizes its ON_FAILURE / 10-retry default to omitted/null in IaC config.
      expect(app.deploy?.restartPolicyType ?? 'ON_FAILURE').toBe('ON_FAILURE');
      expect(app.deploy?.restartPolicyMaxRetries ?? 10).toBe(10);
      expect(app.deploy?.startCommand).not.toMatch(/prisma\s+migrate/i);

      const expectedRegion =
        env === 'production' ? 'asia-southeast1-eqsg3a' : 'us-east4-eqdc4a';
      expect(app.deploy?.multiRegionConfig).toEqual({
        [expectedRegion]: { numReplicas: 1 },
      });
    }
  });

  it('maintains full parity for fleet360-backend Docker build, /healthz probe, and region placement', async () => {
    for (const env of ['staging', 'production'] as const) {
      const { byName } = await evaluateEnv(env);
      const backend = byName.get('fleet360-backend')!;

      expect(backend.source).toMatchObject({
        type: 'github',
        repo: 'ajithalex2004/Fleet360',
        branch: 'main',
        rootDirectory: '/backend',
        checkSuites: false,
      });

      expect(backend.build).toMatchObject({
        builder: 'DOCKERFILE',
        buildEnvironment: 'V3',
        dockerfilePath: '/backend/Dockerfile',
      });

      expect(backend.deploy).toMatchObject({
        startCommand: '',
        healthcheckPath: '/healthz',
        healthcheckTimeout: 100,
      });
      expect(backend.deploy?.restartPolicyType ?? 'ON_FAILURE').toBe('ON_FAILURE');
      expect(backend.deploy?.restartPolicyMaxRetries ?? 10).toBe(10);

      const expectedRegion =
        env === 'production' ? 'asia-southeast1-eqsg3a' : 'us-east4-eqdc4a';
      expect(backend.deploy?.multiRegionConfig).toEqual({
        [expectedRegion]: { numReplicas: 1 },
      });
    }
  });

  it('preserves all declared environment variables without hardcoded literals or placeholder optional credentials', async () => {
    const optionalIntegrationVars = [
      'STRIPE_SECRET_KEY',
      'SENDGRID_API_KEY',
      'SENTRY_DSN',
      'NEXT_PUBLIC_SENTRY_DSN',
    ];

    for (const env of ['staging', 'production'] as const) {
      const { services, byName } = await evaluateEnv(env);

      for (const svc of services) {
        const vars = svc.variables ?? {};
        const entries = Object.entries(vars);
        expect(entries.length).toBeGreaterThan(0);

        for (const [key, val] of entries) {
          expect(val, `${env} ${svc.name}.${key} must use preserve()`).toEqual({
            type: 'preserve',
          });
        }

        for (const optKey of optionalIntegrationVars) {
          expect(
            Object.prototype.hasOwnProperty.call(vars, optKey),
            `${env} ${svc.name} must not declare unprovisioned optional key ${optKey}`,
          ).toBe(false);
        }
      }

      // Dormant one-time bootstrap secret must not remain in runtime environments post-bootstrap
      const appVars = byName.get('fleet360-app')!.variables ?? {};
      expect(appVars).not.toHaveProperty('SETUP_SECRET');

      // Production fleet360-app must never expose migration-owner database URLs
      if (env === 'production') {
        expect(appVars).not.toHaveProperty('DIRECT_URL');
        expect(appVars).not.toHaveProperty('DIRECT_DATABASE_URL');
        expect(appVars).not.toHaveProperty('MIGRATION_DATABASE_URL');
        expect(appVars).toHaveProperty('DATABASE_URL');
        expect(appVars).toHaveProperty('RUNTIME_DIRECT_DATABASE_URL');
      }
    }
  });
});
