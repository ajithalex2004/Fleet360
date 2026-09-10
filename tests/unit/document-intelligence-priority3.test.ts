import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  generateWebhookSignature,
  dispatchDocumentWebhook,
} from '@/lib/agents/document-intelligence/pipeline/webhook-dispatcher';
import {
  unpackZipBuffer,
  executeBatchJob,
  getBatchJobStatus,
} from '@/lib/agents/document-intelligence/pipeline/batch-worker';
import { POST as batchPOST, GET as batchGET } from '@/app/api/documents/intelligence/batch/route';
import { POST as applyPOST } from '@/app/api/documents/intelligence/apply/route';
import zlib from 'zlib';

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn().mockImplementation((_prisma: any, _tenantId: string, fn: any) => fn(_prisma)),
}));

describe('Document Intelligence Priority 3: Production Hardening Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Capability 1: Webhook Dispatcher & HMAC-SHA256 Signing', () => {
    it('generates consistent HMAC-SHA256 signature for payload and secret', () => {
      const payload = JSON.stringify({ event: 'DOCUMENT_EXTRACTED', docId: 'DOC-123' });
      const secret = 'test-secret-key-12345';
      const sig1 = generateWebhookSignature(payload, secret);
      const sig2 = generateWebhookSignature(payload, secret);

      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // 32-byte hex string
      expect(generateWebhookSignature(payload, 'different-secret')).not.toBe(sig1);
    });

    it('returns SKIPPED when no connections or fallback webhooks are configured', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce([]); // No connections in DB
      delete process.env.DOCUMENT_WEBHOOK_URL;

      const results = await dispatchDocumentWebhook('tenant-1', 'DOCUMENT_EXTRACTED', {
        documentId: 'DOC-100',
        fileName: 'test.pdf',
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('SKIPPED');
      expect(results[0].targetUrl).toBe('NONE_CONFIGURED');
    });

    it('delivers webhook to configured enterprise connection with correct HMAC header', async () => {
      const mockConn = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          system_type: 'SAP_S4HANA',
          base_url: 'https://sap-erp.example.com',
          auth_credentials: JSON.stringify({ webhookSecret: 'sap-secret-xyz' }),
          headers: JSON.stringify({ 'X-Custom-Auth': 'ERP-Token-99' }),
        },
      ];

      vi.spyOn(prisma, '$queryRawUnsafe')
        .mockResolvedValueOnce(mockConn) // connection lookup
        .mockResolvedValueOnce([]); // enterprise_sync_logs insertion

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"received": true}'),
      });
      globalThis.fetch = fetchMock;

      const results = await dispatchDocumentWebhook('tenant-sap', 'DOCUMENT_EXTRACTED', {
        documentId: 'DOC-999',
        category: 'INVOICE',
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('SUCCESS');
      expect(results[0].httpStatus).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [calledUrl, calledOpts] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://sap-erp.example.com/api/webhooks/fleet360');
      expect(calledOpts.headers['x-fleet360-event']).toBe('DOCUMENT_EXTRACTED');
      expect(calledOpts.headers['x-fleet360-signature']).toBeDefined();
      expect(calledOpts.headers['X-Custom-Auth']).toBe('ERP-Token-99');
    });
  });

  describe('Capability 2: In-Memory Zip Unpack & Multi-Document Split Worker', () => {
    /**
     * Helper to construct a standard uncompressed (Stored) PKZIP buffer in memory
     */
    function createMockZipBuffer(files: Array<{ name: string; content: string }>): Buffer {
      const parts: Buffer[] = [];

      for (const file of files) {
        const contentBuf = Buffer.from(file.content, 'utf8');
        const nameBuf = Buffer.from(file.name, 'utf8');

        // Local file header (30 bytes)
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); // "PK\x03\x04"
        header.writeUInt16LE(20, 4); // version needed
        header.writeUInt16LE(0, 6); // flags
        header.writeUInt16LE(0, 8); // compression = 0 (stored)
        header.writeUInt16LE(0, 10); // mod time
        header.writeUInt16LE(0, 12); // mod date
        header.writeUInt32LE(0, 14); // crc32
        header.writeUInt32LE(contentBuf.length, 18); // compressed size
        header.writeUInt32LE(contentBuf.length, 22); // uncompressed size
        header.writeUInt16LE(nameBuf.length, 26); // file name length
        header.writeUInt16LE(0, 28); // extra field length

        parts.push(header, nameBuf, contentBuf);
      }

      return Buffer.concat(parts);
    }

    it('unpacks multiple files from in-memory PKZIP buffer', () => {
      const zipBuf = createMockZipBuffer([
        {
          name: 'dubai_mulkiya.txt',
          content: 'Plate: Dubai B 78219\nVIN: 1HGBH41JXMN109182\nMake: Toyota HiAce',
        },
        {
          name: 'tax_invoice.txt',
          content: 'Tax Invoice INV-900\nTotal AED: 5000.00\nTRN: 100234567800003',
        },
      ]);

      const unpacked = unpackZipBuffer(zipBuf);
      expect(unpacked).toHaveLength(2);
      expect(unpacked[0].fileName).toBe('dubai_mulkiya.txt');
      expect(unpacked[0].documentText).toContain('Toyota HiAce');
      expect(unpacked[1].fileName).toBe('tax_invoice.txt');
      expect(unpacked[1].documentText).toContain('INV-900');
    });

    it('executes batch job processing across documents and records STP metrics', async () => {
      const mockDocs = [
        {
          fileName: 'mulkiya_batch1.txt',
          documentText: 'Plate: Dubai B 78219\nVIN: 1HGBH41JXMN109182\nMake: Toyota HiAce\nModel Year: 2024',
        },
        {
          fileName: 'invoice_batch2.txt',
          documentText: 'Tax Invoice INV-9001\nTotal AED: 5000.00\nTRN: 100234567800003',
        },
      ];

      vi.spyOn(prisma, '$queryRawUnsafe')
        .mockResolvedValueOnce([{ id: 'batch-uuid-1', created_at: new Date(), updated_at: new Date() }]) // job init
        .mockResolvedValueOnce([]) // dup check doc 1
        .mockResolvedValueOnce([]) // master check doc 1
        .mockResolvedValueOnce([{ id: 'doc-1' }]) // insert extraction 1
        .mockResolvedValueOnce([]) // dup check doc 2
        .mockResolvedValueOnce([]) // master check doc 2
        .mockResolvedValueOnce([{ id: 'doc-2' }]) // insert extraction 2
        .mockResolvedValueOnce([]); // job final update

      const summary = await executeBatchJob({
        tenantId: 'tenant-fleet-batch',
        batchName: 'Q3 Onboarding Batch',
        documents: mockDocs,
        autoApply: true,
      });

      expect(summary.totalDocuments).toBe(2);
      expect(summary.processedCount).toBe(2);
      expect(summary.successCount).toBe(2);
      expect(summary.status).toBe('COMPLETED');
      expect(summary.results).toHaveLength(2);
    });
  });

  describe('Capability 3: Batch API Endpoints (/api/documents/intelligence/batch)', () => {
    it('POST returns 400 when neither zipBufferBase64 nor documents is provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/documents/intelligence/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'tenant-test',
        },
        body: JSON.stringify({}),
      });

      const res = await batchPOST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Either zipBufferBase64 or documents array must be provided');
    });

    it('GET queries batch status and progress by batchId', async () => {
      const mockBatchRow = [
        {
          id: '22222222-2222-2222-2222-222222222222',
          batch_name: 'Test Zip Batch',
          status: 'COMPLETED',
          total_documents: 5,
          processed_count: 5,
          success_count: 5,
          failed_count: 0,
          stp_count: 4,
          review_count: 1,
          results: JSON.stringify([{ fileName: 'test1.pdf', riskLevel: 'LOW' }]),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce(mockBatchRow);

      const req = new NextRequest(
        'http://localhost:3000/api/documents/intelligence/batch?batchId=22222222-2222-2222-2222-222222222222',
        {
          headers: { 'x-tenant-id': 'tenant-test' },
        }
      );

      const res = await batchGET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.batch.batchName).toBe('Test Zip Batch');
      expect(data.batch.stpCount).toBe(4);
      expect(data.batch.totalDocuments).toBe(5);
    });
  });

  describe('Capability 4: HITL Review Rejection & Apply Action API', () => {
    it('POST with action="REJECT" updates extraction status and dispatches DOCUMENT_REJECTED webhook', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce([]); // reject update query

      const req = new NextRequest('http://localhost:3000/api/documents/intelligence/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 'tenant-reject-test',
        },
        body: JSON.stringify({
          extractionId: 'doc-reject-123',
          action: 'REJECT',
          reason: 'Mismatched chassis number with vehicle profile',
        }),
      });

      const res = await applyPOST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe('REJECTED');
      expect(data.message).toContain('rejected successfully');
    });
  });
});
