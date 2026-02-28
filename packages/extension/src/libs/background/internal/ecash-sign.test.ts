import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NetworkNames, SignerType, WalletType } from '@enkryptcom/types';
import type { RPCRequestType, EnkryptAccount } from '@enkryptcom/types';

const {
  mockBroadcast,
  mockBuild,
  mockAction,
  mockSync,
  mockUtxos,
  mockSpendableSatsOnlyUtxos,
  mockGetNetworkByName,
} = vi.hoisted(() => {
  const mockBroadcast = vi.fn();
  const mockBuild = vi.fn().mockReturnValue({ broadcast: mockBroadcast });
  const mockAction = vi.fn().mockReturnValue({ build: mockBuild });
  const mockSync = vi.fn();
  const mockUtxos: any[] = [];
  const mockSpendableSatsOnlyUtxos = vi.fn().mockReturnValue([]);
  const mockGetNetworkByName = vi.fn();
  return {
    mockBroadcast,
    mockBuild,
    mockAction,
    mockSync,
    mockUtxos,
    mockSpendableSatsOnlyUtxos,
    mockGetNetworkByName,
  };
});

vi.mock('ecash-wallet', () => ({
  Wallet: {
    fromSk: vi.fn().mockReturnValue({
      sync: mockSync,
      get utxos() {
        return mockUtxos;
      },
      spendableSatsOnlyUtxos: mockSpendableSatsOnlyUtxos,
      action: mockAction,
    }),
  },
}));

vi.mock('chronik-client', () => ({
  ChronikClient: class MockChronikClient {
    constructor() {}
  },
}));

vi.mock('@/libs/utils/networks', () => ({
  getNetworkByName: mockGetNetworkByName,
}));

import ecashSign from './ecash-sign';

const fakePrivateKey = Buffer.from(
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'hex',
);

const baseAccount: EnkryptAccount = {
  name: 'eCash Account',
  address: 'ecash:qq42tdgdvx5np0pgpjd9x9jupkaugmdw7sjp5dqa63',
  basePath: "m/44'/1899'/0'/0",
  pathIndex: 0,
  publicKey:
    '0x031c6d8a90254cc6dda7012c184bcde32e8d53f6fd6c882b2b12bd3fca1bd7372f',
  signerType: SignerType.secp256k1ecash,
  walletType: WalletType.mnemonic,
  isHardware: false,
};

const makeMessage = (params?: any[]): RPCRequestType => ({
  method: 'enkrypt_ecash_sign',
  params,
});

const createKeyring = (overrides: Record<string, any> = {}) =>
  ({
    isLocked: vi.fn().mockReturnValue(false),
    getPrivateKeyForECash: vi.fn().mockResolvedValue(fakePrivateKey),
    ...overrides,
  }) as any;

const TEST_TOKEN_ID =
  'aabbccddee00112233445566778899aabbccddee00112233445566778899aabb';

const pushTokenUtxos = (
  tokenId: string,
  atoms: bigint,
  count = 1,
  protocol = 'SLP',
  type = 'SLP_TOKEN_TYPE_FUNGIBLE',
  number = 1,
) => {
  for (let i = 0; i < count; i++) {
    mockUtxos.push({
      sats: 546n,
      token: {
        tokenId,
        atoms: atoms / BigInt(count),
        tokenType: { protocol, type, number },
      },
    });
  }
};

describe('ecashSign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUtxos.length = 0;
    mockSpendableSatsOnlyUtxos.mockReturnValue([]);
    mockBroadcast.mockResolvedValue({
      success: true,
      broadcasted: ['abc123txid'],
    });
    mockGetNetworkByName.mockResolvedValue({
      node: 'https://chronik-native1.fabien.cash',
      name: NetworkNames.ECash,
    });
  });

  // ===================================================================
  // XEC transaction tests (existing)
  // ===================================================================

  it('should return error when params is undefined', async () => {
    const keyring = createKeyring();
    const result = await ecashSign(keyring, makeMessage(undefined));

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('invalid params');
  });

  it('should return error when toAddress is missing', async () => {
    const keyring = createKeyring();
    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          amount: '1000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('missing required parameters');
  });

  it('should return error when keyring is locked', async () => {
    const keyring = createKeyring({
      isLocked: vi.fn().mockReturnValue(true),
    });
    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('keyring is locked');
  });

  it('should return error when network is not found', async () => {
    const keyring = createKeyring();
    mockGetNetworkByName.mockResolvedValue(undefined);

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: baseAccount,
          networkName: 'fake_network',
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('unknown network');
  });

  it('should return error for hardware wallet (isHardware flag)', async () => {
    const keyring = createKeyring();
    const hwAccount = { ...baseAccount, isHardware: true };
    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: hwAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain(
      'hardware wallets not yet supported',
    );
  });

  it('should build and broadcast a successful XEC transaction', async () => {
    const keyring = createKeyring();
    mockSpendableSatsOnlyUtxos.mockReturnValue([{ sats: 50000n }]);
    mockBroadcast.mockResolvedValue({
      success: true,
      broadcasted: ['txid_xec_success'],
    });

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '10000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBeDefined();
    const parsed = JSON.parse(result.result!);
    expect(parsed.txid).toBe('txid_xec_success');

    expect(mockSync).toHaveBeenCalled();
    expect(mockAction).toHaveBeenCalledWith({
      outputs: [
        {
          address: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          sats: 10000n,
        },
      ],
    });
    expect(mockBuild).toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalled();
  });

  it('should return error when XEC balance is insufficient', async () => {
    const keyring = createKeyring();
    mockSpendableSatsOnlyUtxos.mockReturnValue([{ sats: 500n }]);

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '10000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Insufficient balance');
  });

  it('should return error when broadcast fails with errors array', async () => {
    const keyring = createKeyring();
    mockSpendableSatsOnlyUtxos.mockReturnValue([{ sats: 50000n }]);
    mockBroadcast.mockResolvedValue({
      success: false,
      errors: ['tx-mempool-conflict', 'bad-txns-inputs-missingorspent'],
    });

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('tx-mempool-conflict');
    expect(result.error!.message).toContain('bad-txns-inputs-missingorspent');
  });

  it('should return generic error when broadcast fails without errors', async () => {
    const keyring = createKeyring();
    mockSpendableSatsOnlyUtxos.mockReturnValue([{ sats: 50000n }]);
    mockBroadcast.mockResolvedValue({
      success: false,
      errors: [],
    });

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Broadcast failed');
  });

  it('should return error when wallet.sync() throws', async () => {
    const keyring = createKeyring();
    mockSync.mockRejectedValueOnce(new Error('Network unreachable'));

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Network unreachable');
  });

  it('should return error when getPrivateKeyForECash throws', async () => {
    const keyring = createKeyring({
      getPrivateKeyForECash: vi
        .fn()
        .mockRejectedValue(new Error('Keyring error')),
    });

    const result = await ecashSign(
      keyring,
      makeMessage([
        {
          toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
          amount: '1000',
          account: baseAccount,
          networkName: NetworkNames.ECash,
        },
      ]),
    );

    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('Keyring error');
  });

  // ===================================================================
  // eToken (SLP / ALP) transaction tests
  // ===================================================================

  describe('eToken transactions', () => {
    it('should build and broadcast a successful SLP token send', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(TEST_TOKEN_ID, 500000n);
      mockBroadcast.mockResolvedValue({
        success: true,
        broadcasted: ['txid_token_slp'],
      });

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '100000',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeUndefined();
      const parsed = JSON.parse(result.result!);
      expect(parsed.txid).toBe('txid_token_slp');

      expect(mockSync).toHaveBeenCalled();
      expect(mockAction).toHaveBeenCalledWith({
        outputs: [
          { sats: 0n },
          {
            address: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            sats: 546n,
            tokenId: TEST_TOKEN_ID,
            atoms: 100000n,
          },
        ],
        tokenActions: [
          {
            type: 'SEND',
            tokenId: TEST_TOKEN_ID,
            tokenType: {
              protocol: 'SLP',
              type: 'SLP_TOKEN_TYPE_FUNGIBLE',
              number: 1,
            },
          },
        ],
      });
    });

    it('should build and broadcast a successful ALP token send', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(
        TEST_TOKEN_ID,
        200000n,
        1,
        'ALP',
        'ALP_TOKEN_TYPE_STANDARD',
        0,
      );
      mockBroadcast.mockResolvedValue({
        success: true,
        broadcasted: ['txid_token_alp'],
      });

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '50000',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeUndefined();
      const parsed = JSON.parse(result.result!);
      expect(parsed.txid).toBe('txid_token_alp');

      expect(mockAction).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenActions: [
            {
              type: 'SEND',
              tokenId: TEST_TOKEN_ID,
              tokenType: {
                protocol: 'ALP',
                type: 'ALP_TOKEN_TYPE_STANDARD',
                number: 0,
              },
            },
          ],
        }),
      );
    });

    it('should return error when token balance is insufficient', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(TEST_TOKEN_ID, 500n);

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '10000',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('Insufficient token balance');
      expect(result.error!.message).toContain('10000');
      expect(result.error!.message).toContain('500');
    });

    it('should aggregate atoms across multiple token UTXOs', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(TEST_TOKEN_ID, 3000n, 3);
      mockBroadcast.mockResolvedValue({
        success: true,
        broadcasted: ['txid_multi_utxo'],
      });

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '2500',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeUndefined();
      const parsed = JSON.parse(result.result!);
      expect(parsed.txid).toBe('txid_multi_utxo');
    });

    it('should only count UTXOs matching the requested tokenId', async () => {
      const keyring = createKeyring();
      const OTHER_TOKEN_ID =
        '1111111111111111111111111111111111111111111111111111111111111111';

      pushTokenUtxos(TEST_TOKEN_ID, 100n);
      pushTokenUtxos(OTHER_TOKEN_ID, 999999n);

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '500',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('Insufficient token balance');
    });

    it('should handle zero token UTXOs (no UTXOs for requested token)', async () => {
      const keyring = createKeyring();

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '1',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('Insufficient token balance');
    });

    it('should use default SLP token type when UTXO has no tokenType', async () => {
      const keyring = createKeyring();
      mockUtxos.push({
        sats: 546n,
        token: {
          tokenId: TEST_TOKEN_ID,
          atoms: 10000n,
        },
      });
      mockBroadcast.mockResolvedValue({
        success: true,
        broadcasted: ['txid_default_type'],
      });

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '5000',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeUndefined();
      expect(mockAction).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenActions: [
            {
              type: 'SEND',
              tokenId: TEST_TOKEN_ID,
              tokenType: {
                protocol: 'SLP',
                type: 'SLP_TOKEN_TYPE_FUNGIBLE',
                number: 1,
              },
            },
          ],
        }),
      );
    });

    it('should return error when token broadcast fails', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(TEST_TOKEN_ID, 10000n);
      mockBroadcast.mockResolvedValue({
        success: false,
        errors: ['slp-invalid: bad token inputs'],
      });

      const result = await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '5000',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('slp-invalid: bad token inputs');
    });

    it('should include dust output (sats: 0n) as first output for token tx', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(TEST_TOKEN_ID, 10000n);
      mockBroadcast.mockResolvedValue({
        success: true,
        broadcasted: ['txid_dust_check'],
      });

      await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '1000',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      const actionCall = mockAction.mock.calls[0][0];
      expect(actionCall.outputs[0]).toEqual({ sats: 0n });
      expect(actionCall.outputs[1].sats).toBe(546n);
      expect(actionCall.outputs[1].tokenId).toBe(TEST_TOKEN_ID);
    });

    it('should send the exact requested atom amount in the output', async () => {
      const keyring = createKeyring();
      pushTokenUtxos(TEST_TOKEN_ID, 999999n);
      mockBroadcast.mockResolvedValue({
        success: true,
        broadcasted: ['txid_exact_atoms'],
      });

      await ecashSign(
        keyring,
        makeMessage([
          {
            toAddress: 'ecash:qqq9wk7vze4dc4hk7mweafpyxh7d8sjr3ghh0wtn04',
            amount: '123456',
            account: baseAccount,
            networkName: NetworkNames.ECash,
            tokenId: TEST_TOKEN_ID,
          },
        ]),
      );

      const actionCall = mockAction.mock.calls[0][0];
      expect(actionCall.outputs[1].atoms).toBe(123456n);
    });
  });
});
