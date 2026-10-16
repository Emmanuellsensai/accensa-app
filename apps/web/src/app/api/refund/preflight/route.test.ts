import { beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from './route';

const { mockGetMerchant, mockWithClient, mockIsAdmin, mockGetRefund, mockPreflightRefund } =
  vi.hoisted(() => ({
    mockGetMerchant: vi.fn(),
    mockWithClient: vi.fn(),
    mockIsAdmin: vi.fn(),
    mockGetRefund: vi.fn(),
    mockPreflightRefund: vi.fn(),
  }));

vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mockGetMerchant }));
vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
}));
vi.mock('@/lib/rbac', () => ({ isAdmin: mockIsAdmin }));
vi.mock('@/lib/refund-vault', () => ({
  REFUND_VAULT_ID: 'test-vault',
  getRefund: mockGetRefund,
  preflightRefund: mockPreflightRefund,
}));

function makeRequest(body?: unknown, options?: { raw?: string }) {
  return new Request('http://localhost/api/refund/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: options?.raw ?? (body !== undefined ? JSON.stringify(body) : 'not json'),
  });
}

const validBody = {
  txHash: 'abc123',
  recipient: 'GABCD',
  amount: '1000',
  paidAtLedger: 42,
  merchant: 'GMERCHANT',
};

describe('/api/refund/preflight POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithClient.mockImplementation((fn: (c: unknown) => unknown) => fn({}));
    mockGetMerchant.mockResolvedValue({ id: 'm1', refundVaultId: null });
    mockIsAdmin.mockReturnValue(true);
    mockGetRefund.mockResolvedValue(null);
    mockPreflightRefund.mockResolvedValue({ ok: true });
  });

  test('rejects non-JSON body with 400', async () => {
    const res = await POST(makeRequest(undefined, { raw: 'not json' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Request body must be JSON');
  });

  test('rejects missing txHash/recipient/merchant with 400', async () => {
    const res = await POST(makeRequest({ amount: '100', paidAtLedger: 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('txHash, recipient, and merchant are required');
  });

  test('rejects numeric amount with stroops message', async () => {
    const res = await POST(makeRequest({ ...validBody, amount: 1000 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('amount must be a positive integer string in stroops');
  });

  test('accepts string amount', async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
  });

  test('rejects amount "0"', async () => {
    const res = await POST(makeRequest({ ...validBody, amount: '0' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('amount must be a positive integer string in stroops');
  });

  test('accepts amount with leading zeros "0012" per the regex', async () => {
    const res = await POST(makeRequest({ ...validBody, amount: '0012' }));
    expect(res.status).toBe(200);
  });

  test('rejects non-integer paidAtLedger', async () => {
    const res = await POST(makeRequest({ ...validBody, paidAtLedger: 1.5 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('paidAtLedger must be a ledger number');
  });

  test('rejects negative paidAtLedger', async () => {
    const res = await POST(makeRequest({ ...validBody, paidAtLedger: -1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('paidAtLedger must be a ledger number');
  });

  test('returns 401 when caller cannot be resolved', async () => {
    mockGetMerchant.mockResolvedValue(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  test('success response contains contract, existing, and preflight keys', async () => {
    const mockPreflight = { tx: 'sim', minFee: '100' };
    mockPreflightRefund.mockResolvedValue(mockPreflight);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('contract', 'test-vault');
    expect(json).toHaveProperty('existing', null);
    expect(json).toHaveProperty('preflight', mockPreflight);
  });
});
