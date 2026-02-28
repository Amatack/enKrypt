import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityStatus, ActivityType } from '@/types/activity';
import { NetworkNames } from '@enkryptcom/types';

vi.mock('../libs/utils', () => ({
  scriptToAddress: vi.fn((script: string) => {
    const map: Record<string, string> = {
      script_addr_A: 'addrA',
      script_addr_B: 'addrB',
      script_addr_C: 'addrC',
    };
    return map[script] ?? 'unknown';
  }),
  calculateOnchainTxFee: vi.fn(() => 226),
  getTransactionAddresses: vi.fn(
    (_tx: any, _addr: string, isReceive: boolean, isSend: boolean) => {
      if (isReceive) return { fromAddress: 'addrB', toAddress: 'addrA' };
      if (isSend) return { fromAddress: 'addrA', toAddress: 'addrB' };
      return { fromAddress: 'unknown', toAddress: 'unknown' };
    },
  ),
  getTransactionTimestamp: vi.fn((tx: any) =>
    tx.block?.timestamp ? tx.block.timestamp * 1000 : Date.now(),
  ),
  getAddressWithoutPrefix: vi.fn((addr: string) => addr.replace(/^ecash:/, '')),
  calculateTransactionValue: vi.fn(
    (_outputs: any[], _addr: string, isReceive: boolean) =>
      isReceive ? '5000' : '3000',
  ),
  sumTokenOutputAtoms: vi.fn(() => '100000'),
}));

vi.mock('@/libs/market-data', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      getMarketData: vi.fn().mockResolvedValue([{ current_price: 0.00003 }]),
    })),
  };
});

vi.mock('../libs/api-chronik', () => ({
  ChronikAPI: vi.fn(),
}));

import { chronikHandler } from '../libs/activity-handlers';
import * as utils from '../libs/utils';
import MarketData from '@/libs/market-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTxOutput(
  scriptHex: string,
  sats: number,
  token?: { tokenId: string; atoms: bigint },
) {
  return {
    outputScript: scriptHex,
    sats,
    token: token ?? undefined,
  };
}

function makeTxInput(
  scriptHex: string,
  sats: number,
  token?: { tokenId: string; atoms: bigint },
) {
  return {
    outputScript: scriptHex,
    sats,
    token: token ?? undefined,
  };
}

function makeChronikTx(
  overrides: Record<string, any> = {},
): Record<string, any> {
  return {
    txid: 'abc123',
    block: { height: 800000, timestamp: 1700000000 },
    isFinal: true,
    timeFirstSeen: '1700000000',
    inputs: [makeTxInput('script_addr_B', 10000)],
    outputs: [makeTxOutput('script_addr_A', 5000)],
    ...overrides,
  };
}

function createMockNetwork(overrides: Record<string, any> = {}) {
  const mockApi = {
    getTransactionHistory: vi.fn().mockResolvedValue([]),
    getTokenMetadata: vi.fn().mockResolvedValue(null),
  };

  return {
    name: NetworkNames.ECash,
    decimals: 2,
    icon: 'ecash-icon.svg',
    currencyName: 'XEC',
    currencyNameLong: 'eCash',
    coingeckoID: 'ecash',
    api: vi.fn().mockResolvedValue(mockApi),
    __mockApi: mockApi, // expose for easy test access
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chronikHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when txHistory is empty', async () => {
    const network = createMockNetwork();
    const result = await chronikHandler(network, 'ecash:addrA');
    expect(result).toEqual([]);
  });

  it('should return empty array when txHistory is null/undefined', async () => {
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue(null);
    const result = await chronikHandler(network, 'ecash:addrA');
    expect(result).toEqual([]);
  });

  it('should return empty array on API error', async () => {
    const network = createMockNetwork();
    network.api.mockRejectedValue(new Error('network error'));
    const result = await chronikHandler(network, 'ecash:addrA');
    expect(result).toEqual([]);
  });

  it('should process a simple XEC receive transaction', async () => {
    const tx = makeChronikTx();
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    const activity = result[0];
    expect(activity.isIncoming).toBe(true);
    expect(activity.transactionHash).toBe('abc123');
    expect(activity.status).toBe(ActivityStatus.success);
    expect(activity.type).toBe(ActivityType.transaction);
    expect(activity.network).toBe(NetworkNames.ECash);
    expect(activity.value).toBe('5000');
    expect(activity.token.symbol).toBe('XEC');
    expect(activity.token.decimals).toBe(2);
  });

  it('should process a simple XEC send transaction', async () => {
    // addrA is in inputs (send), NOT in outputs
    const tx = makeChronikTx({
      inputs: [makeTxInput('script_addr_A', 10000)],
      outputs: [makeTxOutput('script_addr_B', 7000)],
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    const activity = result[0];
    expect(activity.isIncoming).toBe(false);
    expect(activity.value).toBe('3000');
    expect(activity.from).toBe('addrA');
    expect(activity.to).toBe('addrB');
  });

  it('should process a token receive transaction', async () => {
    const tokenId = 'tok111';
    const tx = makeChronikTx({
      inputs: [makeTxInput('script_addr_B', 1000)],
      outputs: [
        makeTxOutput('script_addr_A', 546, {
          tokenId,
          atoms: 100000n,
        }),
      ],
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);
    network.__mockApi.getTokenMetadata.mockResolvedValue({
      name: 'TestToken',
      ticker: 'TST',
      decimals: 4,
      icon: 'tst-icon.png',
    });

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    const activity = result[0];
    expect(activity.isIncoming).toBe(true);
    expect(activity.value).toBe('100000');
    expect(activity.token.symbol).toBe('TST');
    expect(activity.token.name).toBe('TestToken');
    expect(activity.token.decimals).toBe(4);
    expect(activity.token.icon).toBe('tst-icon.png');
  });

  it('should process a token send transaction', async () => {
    const tokenId = 'tok222';
    const tx = makeChronikTx({
      inputs: [
        makeTxInput('script_addr_A', 1000, {
          tokenId,
          atoms: 200000n,
        }),
      ],
      outputs: [
        makeTxOutput('script_addr_B', 546, {
          tokenId,
          atoms: 200000n,
        }),
      ],
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);
    network.__mockApi.getTokenMetadata.mockResolvedValue({
      name: 'CoolCoin',
      ticker: 'COOL',
      decimals: 8,
      icon: '',
    });

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    const activity = result[0];
    expect(activity.isIncoming).toBe(false);
    expect(activity.token.symbol).toBe('COOL');
    expect(activity.token.icon).toBe('ecash-icon.svg');
  });

  it('should use network token info when token metadata is not found', async () => {
    const tokenId = 'tok_missing';
    const tx = makeChronikTx({
      inputs: [makeTxInput('script_addr_B', 1000)],
      outputs: [makeTxOutput('script_addr_A', 546, { tokenId, atoms: 50n })],
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);
    network.__mockApi.getTokenMetadata.mockResolvedValue(null);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    expect(result[0].token.symbol).toBe('XEC');
  });

  it('should mark unconfirmed tx as pending when no block and not final', async () => {
    const tx = makeChronikTx({
      block: undefined,
      isFinal: false,
    });
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(ActivityStatus.pending);
  });

  it('should mark confirmed tx as success when block exists', async () => {
    const tx = makeChronikTx({
      block: { height: 800001, timestamp: 1700001000 },
    });
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(ActivityStatus.success);
  });

  it('should mark tx as success when isFinal is true even without block', async () => {
    const tx = makeChronikTx({
      block: undefined,
      isFinal: true,
    });
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(ActivityStatus.success);
  });

  it('should sort activities by timestamp descending', async () => {
    const tx1 = makeChronikTx({
      txid: 'older',
      block: { height: 100, timestamp: 1000 },
    });
    const tx2 = makeChronikTx({
      txid: 'newer',
      block: { height: 200, timestamp: 2000 },
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx1, tx2]);
    (utils.getTransactionTimestamp as any)
      .mockReturnValueOnce(1000000)
      .mockReturnValueOnce(2000000);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBeGreaterThan(result[1].timestamp);
  });

  it('should handle market price fetch failure gracefully', async () => {
    (MarketData as any).mockImplementation(() => ({
      getMarketData: vi.fn().mockRejectedValue(new Error('price error')),
    }));

    const tx = makeChronikTx();
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    expect(result[0].token.price).toBe('0');
  });

  it('should skip market data fetch when coingeckoID is not set', async () => {
    const tx = makeChronikTx();
    const network = createMockNetwork({ coingeckoID: undefined });
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    expect(result[0].token.price).toBe('0');
    expect(MarketData).not.toHaveBeenCalled();
  });

  it('should populate rawInfo correctly for a send tx', async () => {
    const tx = makeChronikTx({
      inputs: [makeTxInput('script_addr_A', 10000)],
      outputs: [makeTxOutput('script_addr_B', 9774)],
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result).toHaveLength(1);
    const raw = result[0].rawInfo as any;
    expect(raw.blockNumber).toBe(800000);
    expect(raw.transactionHash).toBe('abc123');
    expect(raw.fee).toBe(226);
    expect(raw.inputs).toHaveLength(1);
    expect(raw.outputs).toHaveLength(1);
  });

  it('should set fee to 0 for receive transactions', async () => {
    const tx = makeChronikTx();
    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([tx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    const raw = result[0].rawInfo as any;
    expect(raw.fee).toBe(0);
  });

  it('should continue processing remaining txs when one tx throws', async () => {
    const badTx = makeChronikTx({ txid: 'bad' });
    const goodTx = makeChronikTx({ txid: 'good' });

    let processingBadTx = true;
    (utils.scriptToAddress as any).mockImplementation((script: string) => {
      if (processingBadTx) {
        processingBadTx = false;
        throw new Error('parse error');
      }
      return script === 'script_addr_A' ? 'addrA' : 'addrB';
    });

    const network = createMockNetwork();
    network.__mockApi.getTransactionHistory.mockResolvedValue([badTx, goodTx]);

    const result = await chronikHandler(network, 'ecash:addrA');

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(a => a.transactionHash === 'good')).toBe(true);
  });
});
