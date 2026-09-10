import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isArabic,
  normalizeArabicText,
  normalizeEnglishText,
  transliterateArabicToEnglish,
  calculateStringSimilarity,
  compareBilingualNames,
} from '@/lib/agents/document-intelligence/pipeline/bilingual-normalizer';
import { crossCheckWithMasterData } from '@/lib/agents/document-intelligence/pipeline/cross-checker';
import {
  getAssetDocumentDossier,
  AssetDocumentDossier,
} from '@/lib/agents/document-intelligence/pipeline/asset-dossier';
import { GET as assetDossierGET } from '@/app/api/documents/intelligence/dossier/route';
import {
  searchContractClauses,
  extractContractObligations,
} from '@/lib/agents/document-intelligence/pipeline/contract-intelligence';
import { withTenantRls } from '@/lib/rls';
import { DocumentExtractionResult } from '@/lib/agents/types';

vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn().mockImplementation((_prisma: any, _tenantId: string, fn: any) => fn(_prisma)),
}));

describe('Document Intelligence Priority 2: Intelligence & Q&A Suite', () => {
  describe('Capability 13: Bilingual English / Arabic Fuzzy Name Normalizer', () => {
    it('accurately identifies Arabic vs Latin script', () => {
      expect(isArabic('دبي')).toBe(true);
      expect(isArabic('محمد راشد')).toBe(true);
      expect(isArabic('Dubai Transport LLC')).toBe(false);
      expect(isArabic('Toyota HiAce 2026')).toBe(false);
    });

    it('normalizes Arabic script (diacritics, alef, taa marbouta, tatweel)', () => {
      // Strips harakat/tashkeel
      expect(normalizeArabicText('مُحَمَّدٌ')).toBe('محمد');
      // Unifies Alef variations (أ, إ, آ -> ا)
      expect(normalizeArabicText('أَحْمَدْ')).toBe('احمد');
      expect(normalizeArabicText('إِبْرَاهِيم')).toBe('ابراهيم');
      // Unifies Taa Marbouta (ة -> ه)
      expect(normalizeArabicText('الشارقة')).toBe('الشارقه');
    });

    it('transliterates common UAE geographical and person names', () => {
      expect(transliterateArabicToEnglish('دبي')).toBe('dubai');
      expect(transliterateArabicToEnglish('ابوظبي')).toBe('abu dhabi');
      expect(transliterateArabicToEnglish('الشارقة')).toBe('sharjah');
      expect(transliterateArabicToEnglish('محمد')).toBe('mohammed');
      expect(transliterateArabicToEnglish('راشد')).toBe('rashid');
      expect(transliterateArabicToEnglish('الفطيم')).toBe('al futtaim');
    });

    it('fuzzy matches transliterated English names with spelling variations (Mohammed vs Mohamed)', () => {
      const result = compareBilingualNames('Mohammed Rashid', 'Mohamed Rasheed');
      expect(result.match).toBe(true);
      expect(result.similarity).toBeGreaterThanOrEqual(0.85);

      const result2 = compareBilingualNames('Muhammad Abdullah', 'Mohamed Abdulla');
      expect(result2.match).toBe(true);
      expect(result2.similarity).toBeGreaterThanOrEqual(0.85);

      const result3 = compareBilingualNames('Al Futtaim Motors LLC', 'Alfuttaim Motors');
      expect(result3.match).toBe(true);
      expect(result3.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('matches cross-script Arabic vs English entities seamlessly', () => {
      const match1 = compareBilingualNames('دبي', 'Dubai');
      expect(match1.match).toBe(true);
      expect(match1.similarity).toBe(1.0);

      const match2 = compareBilingualNames('محمد راشد', 'Mohammed Rashid');
      expect(match2.match).toBe(true);
      expect(match2.similarity).toBeGreaterThanOrEqual(0.85);

      const match3 = compareBilingualNames('الفطيم', 'Al Futtaim');
      expect(match3.match).toBe(true);

      const nonMatch = compareBilingualNames('Mohammed Rashid', 'John Alexander');
      expect(nonMatch.match).toBe(false);
      expect(nonMatch.similarity).toBeLessThan(0.40);
    });
  });

  describe('Capability 14: Bilingual Integration in Master Data Cross-Checker', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('validates driver with transliterated name variation without false-positive error', async () => {
      // Master database stores "Mohammed Rashid"
      vi.spyOn(prisma.driver, 'findFirst').mockResolvedValue({
        id: 'drv-uuid-1',
        name: 'Mohammed Rashid',
        licenseNumber: 'DL-DXB-9912',
      } as any);

      // Document has "Mohamed Rasheed"
      const driverDoc: DocumentExtractionResult = {
        docCategory: 'DRIVER_LICENSE',
        suggestedTitle: 'UAE Driving License',
        confidence: 'HIGH',
        confidenceScore: 0.98,
        driver: {
          licenseNumber: 'DL-DXB-9912',
          driverName: 'Mohamed Rasheed',
        },
      };

      const result = await crossCheckWithMasterData('tenant-test', driverDoc);
      expect(result.passed).toBe(true);
      expect(result.entityType).toBe('DRIVER');
      expect(result.matchedEntityId).toBe('drv-uuid-1');
      // No critical mismatch should be raised for spelling variation
      expect(result.mismatches.some((m) => m.severity === 'CRITICAL')).toBe(false);
    });
  });

  describe('Capability 15: 360° Asset Knowledge Graph (Vehicle & Driver Document Dossier)', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('compiles comprehensive 360° vehicle dossier with active docs, expired docs, and total spend', async () => {
      vi.spyOn(prisma.vehicle, 'findFirst').mockResolvedValue({
        id: 'veh-101',
        make: 'Toyota',
        model: 'HiAce Commuter',
        year: 2024,
        vin: '1HGBH41JXMN109182',
        licensePlate: 'D 78219',
        status: 'AVAILABLE',
      } as any);

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 180);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);

      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([
        // Active registration card (Mulkiya)
        {
          id: 'doc-mulk-1',
          file_name: 'mulkiya_78219.pdf',
          doc_category: 'REGISTRATION_CARD',
          lifecycle_status: 'ACTIVE',
          reference_number: 'MULK-9901',
          expiry_date: futureDate.toISOString().split('T')[0],
          risk_score: 10,
          risk_level: 'LOW',
          extracted_data: JSON.stringify({ vehicle: { plateNumber: '78219' } }),
          source_grounding: { fields: { vin: {} } },
          created_at: new Date().toISOString(),
        },
        // Expired insurance policy
        {
          id: 'doc-ins-old',
          file_name: 'orient_insurance_2025.pdf',
          doc_category: 'INSURANCE_POLICY',
          lifecycle_status: 'EXPIRED',
          reference_number: 'POL-8819',
          expiry_date: pastDate.toISOString().split('T')[0],
          risk_score: 45,
          risk_level: 'HIGH',
          extracted_data: JSON.stringify({ financials: { totalAmount: 4200 } }),
          source_grounding: {},
          created_at: pastDate.toISOString(),
        },
        // Maintenance repair invoice
        {
          id: 'doc-inv-1',
          file_name: 'al_futtaim_brake_repair.pdf',
          doc_category: 'INVOICE',
          lifecycle_status: 'VALIDATED',
          reference_number: 'INV-4412',
          risk_score: 5,
          risk_level: 'LOW',
          extracted_data: JSON.stringify({ financials: { totalAmount: 1850.00 } }),
          source_grounding: {},
          created_at: new Date().toISOString(),
        },
      ] as any);

      const dossier = await getAssetDocumentDossier({
        tenantId: 'tenant-test',
        entityType: 'VEHICLE',
        plateNumber: 'D 78219',
      });

      expect(dossier).toBeDefined();
      expect(dossier?.entityType).toBe('VEHICLE');
      expect(dossier?.entityId).toBe('veh-101');
      expect(dossier?.complianceSummary.totalDocuments).toBe(3);
      expect(dossier?.complianceSummary.activeCount).toBeGreaterThanOrEqual(1);
      expect(dossier?.complianceSummary.expiredCount).toBe(1);
      expect(dossier?.complianceSummary.status).toBe('NON_COMPLIANT'); // Expired doc triggers non-compliant
      expect(dossier?.commercialLineage?.totalSpendAed).toBe(1850.00);
      expect(dossier?.commercialLineage?.invoicesCount).toBe(1);
    });

    it('serves 360° dossier through GET /api/documents/intelligence/dossier endpoint', async () => {
      vi.spyOn(prisma.vehicle, 'findFirst').mockResolvedValue({
        id: 'veh-102',
        make: 'Toyota',
        model: 'Coaster',
        vin: '2T1BR32E8FC298412',
        licensePlate: 'DXB-4819',
      } as any);

      vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/documents/intelligence/dossier?entityType=VEHICLE&plateNumber=DXB-4819', {
        method: 'GET',
        headers: { 'x-tenant-id': 'tenant-test' },
      });

      const res = await assetDossierGET(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.dossier).toBeDefined();
      expect(json.dossier.entityType).toBe('VEHICLE');
      expect(json.dossier.entityId).toBe('veh-102');
    });
  });

  describe('Capability 16: Contract Clause Search & Ops Assistant Tool Integration', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('indexes and searches clauses by query keyword (e.g. penalty, SLA, termination)', async () => {
      vi.spyOn(prisma, '$queryRawUnsafe')
        // 1st query: contract_clauses_index
        .mockResolvedValueOnce([
          {
            id: 'cls-1',
            documentId: 'doc-dpw-contract',
            clauseNumber: '8.4',
            title: 'Late Arrival SLA Penalty',
            content: 'AED 250 penalty shall be levied per bus arrival exceeding 15-minute window.',
            pageNumber: 8,
            obligationType: 'PENALTY',
            penaltyAed: 250,
          },
        ] as any)
        // 2nd query: contractDocs from document_intelligence_extractions
        .mockResolvedValueOnce([]);

      const clauses = await searchContractClauses('tenant-test', { query: 'penalty' });

      expect(clauses.length).toBeGreaterThanOrEqual(1);
      expect(clauses[0].obligationType).toBe('PENALTY');
      expect(clauses[0].penaltyAed).toBe(250);
      expect(clauses[0].clauseNumber).toBe('8.4');
    });

    it('extracts contract clauses with SLA penalties and termination notice automatically', () => {
      const contractSample = `COMMERCIAL PASSENGER TRANSPORT MASTER SERVICES AGREEMENT
Customer: DP World FZE
Contractor: Fleet360 Logistics LLC
Term Expiry: 2027-12-31
Notice period: written notice of 60 days required prior to expiry.
SLA penalty: AED 350 per occurrence for delayed bus arrival over 15 minutes.
Payment shall be made within Net 45 days.`;

      const analysis = extractContractObligations('doc-cnt-2026', contractSample, '2027-12-31');

      expect(analysis.terminationNoticeDays).toBe(60);
      expect(analysis.clauses.length).toBeGreaterThanOrEqual(3);
      
      const penaltyClause = analysis.clauses.find((c) => c.obligationType === 'PENALTY');
      expect(penaltyClause).toBeDefined();
      expect(penaltyClause?.penaltyAed).toBe(350);
    });
  });
});
