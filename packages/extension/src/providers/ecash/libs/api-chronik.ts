import { ProviderAPIInterface } from '@/types/provider';
import { BTCRawInfo } from '@/types/activity';
import { ChronikClient } from 'chronik-client';
import { WatchOnlyWallet } from 'ecash-wallet';
import { getAddress } from '../types/ecash-network';
import {
  ECashNetworkInfo,
  ChronikTx,
  ChronikToken,
  GenesisInfo,
  ChronikUtxo,
} from '../types/ecash-chronik';
import { Script, Address } from 'ecash-lib';
import { NetworkNames } from '@enkryptcom/types';

export class ChronikAPI extends ProviderAPIInterface {
  private static tokenMetadataCache = new Map<
    string,
    {
      tokenId: string;
      name: string;
      ticker: string;
      decimals: number;
      icon: string;
      documentUrl: string;
      documentHash: string;
    }
  >();

  node: string;
  networkInfo: ECashNetworkInfo;
  private chronik: ChronikClient;

  public decimals: number;
  public name: NetworkNames;

  constructor(
    node: string,
    networkInfo: ECashNetworkInfo,
    decimals: number = 2,
    name: NetworkNames = NetworkNames.ECash,
  ) {
    super(node);
    this.node = node;
    this.networkInfo = networkInfo;
    this.chronik = new ChronikClient([node]);
    this.decimals = decimals;
    this.name = name;
  }

  async init(): Promise<void> {
    return this.withErrorHandling(
      'init',
      async () => {
        await this.chronik.chronikInfo();
      },
      () => {
        throw new Error('Failed to initialize Chronik API');
      },
    );
  }

  private ensurePrefix(address: string): string {
    if (address.includes(':')) {
      return address;
    }
    return `${this.networkInfo.cashAddrPrefix}:${address}`;
  }

  private async withErrorHandling<T>(
    method: string,
    operation: () => Promise<T>,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error(`[ChronikAPI:${method}]`, error);
      if (fallback) return await fallback();
      throw error;
    }
  }

  async getBalance(pubkey: string): Promise<string> {
    return this.withErrorHandling(
      'getBalance',
      async () => {
        const address = getAddress(pubkey);
        const wallet = WatchOnlyWallet.fromAddress(address, this.chronik);
        await wallet.sync();
        return wallet.balanceSats.toString();
      },
      () => '0',
    );
  }

  async getUTXOs(address: string): Promise<any[]> {
    return this.withErrorHandling(
      'getUTXOs',
      async () => {
        const addressWithPrefix = this.ensurePrefix(address);
        const utxoResponse = await this.chronik
          .address(addressWithPrefix)
          .utxos();
        return utxoResponse.utxos || [];
      },
      () => [],
    );
  }

  async getTransactionHistory(address: string): Promise<ChronikTx[]> {
    return this.withErrorHandling(
      'getTransactionHistory',
      async () => {
        const addressWithPrefix = this.ensurePrefix(address);

        const history = await this.chronik.address(addressWithPrefix).history();
        return history.txs || [];
      },
      () => [],
    );
  }

  async getTransactionStatus(hash: string): Promise<BTCRawInfo | null> {
    return this.withErrorHandling(
      'getTransactionStatus',
      async () => {
        const tx = await this.chronik.tx(hash);

        const rawInfo: BTCRawInfo = {
          blockNumber: tx.block?.height ?? 0,
          fee: this.calculateFee(tx as any),
          transactionHash: tx.txid,
          timestamp: tx.block?.timestamp ?? Math.floor(Date.now() / 1000),
          inputs: tx.inputs.map(input => ({
            address: this.scriptToAddress(input.outputScript ?? ''),
            value: Number(input.sats),
            pkscript: input.outputScript ?? '',
          })),
          outputs: tx.outputs.map(output => ({
            address: this.scriptToAddress(output.outputScript),
            value: Number(output.sats),
            pkscript: output.outputScript,
          })),
        };

        return rawInfo;
      },
      () => null,
    );
  }

  async getTokenMetadata(tokenId: string): Promise<{
    tokenId: string;
    name: string;
    ticker: string;
    decimals: number;
    icon: string;
    documentUrl: string;
    documentHash: string;
  } | null> {
    if (ChronikAPI.tokenMetadataCache.has(tokenId)) {
      return ChronikAPI.tokenMetadataCache.get(tokenId)!;
    }

    try {
      const tokenInfo = await this.chronik.token(tokenId);
      const genesisInfo: GenesisInfo = tokenInfo.genesisInfo;

      const name = genesisInfo.tokenName || 'Unknown Token';
      const ticker = genesisInfo.tokenTicker || '???';
      const decimals = genesisInfo.decimals ?? 0;
      const documentUrl = genesisInfo.url || '';
      const documentHash = genesisInfo.hash || '';

      let icon = '';
      if (documentUrl && documentUrl.includes('icon')) {
        icon = documentUrl;
      }

      const metadata = {
        tokenId,
        name,
        ticker,
        decimals,
        icon,
        documentUrl,
        documentHash,
      };

      ChronikAPI.tokenMetadataCache.set(tokenId, metadata);

      return metadata;
    } catch (error) {
      console.error(
        `[getTokenMetadata] Error fetching metadata for ${tokenId}:`,
        error,
      );
      return null;
    }
  }

  public static formatTokenBalance(
    rawBalance: string,
    decimals: number,
  ): string {
    if (decimals === 0) return rawBalance;

    const balanceStr = rawBalance.padStart(decimals + 1, '0');
    const integerPart = balanceStr.slice(0, -decimals) || '0';
    const decimalPart = balanceStr.slice(-decimals);

    const trimmedDecimal = decimalPart.replace(/0+$/, '');
    return trimmedDecimal ? `${integerPart}.${trimmedDecimal}` : integerPart;
  }

  async getTokenInfo(address: string): Promise<
    Array<{
      tokenId: string;
      name: string;
      ticker: string;
      decimals: number;
      balance: string;
      formattedBalance: string;
      documentUrl: string;
      documentHash: string;
      tokenType: {
        protocol: string;
        type: string;
        number: number;
      };
      icon: string;
    }>
  > {
    try {
      const addressWithPrefix = address.startsWith('ecash:')
        ? address
        : `${this.networkInfo.cashAddrPrefix}:${address}`;

      const utxoResponse = await this.chronik
        .address(addressWithPrefix)
        .utxos();
      const tokenUtxos = utxoResponse.utxos.filter(
        (utxo: ChronikUtxo) => utxo.token,
      );

      const tokenMap = new Map<
        string,
        {
          tokenId: string;
          amount: bigint;
          tokenType: ChronikToken['tokenType'];
        }
      >();

      for (const utxo of tokenUtxos) {
        if (utxo.token) {
          const tokenId = utxo.token.tokenId;
          const amount = utxo.token.atoms;

          if (tokenMap.has(tokenId)) {
            const existing = tokenMap.get(tokenId)!;
            existing.amount += amount;
          } else {
            tokenMap.set(tokenId, {
              tokenId,
              amount,
              tokenType: utxo.token.tokenType,
            });
          }
        }
      }

      const tokens = [];
      for (const [tokenId, tokenData] of tokenMap.entries()) {
        const metadata = await this.getTokenMetadata(tokenId);

        if (metadata) {
          const formattedBalance = ChronikAPI.formatTokenBalance(
            tokenData.amount.toString(),
            metadata.decimals,
          );

          const tokenEntry = {
            tokenId,
            name: metadata.name,
            ticker: metadata.ticker,
            decimals: metadata.decimals,
            balance: tokenData.amount.toString(),
            formattedBalance,
            documentUrl: metadata.documentUrl,
            documentHash: metadata.documentHash,
            tokenType: tokenData.tokenType || {
              protocol: 'SLP',
              type: 'SLP_TOKEN_TYPE_FUNGIBLE',
              number: 1,
            },
            icon: metadata.icon,
          };

          tokens.push(tokenEntry);
        } else {
          tokens.push({
            tokenId,
            name: 'Unknown Token',
            ticker: tokenId.slice(0, 6) + '...',
            decimals: 0,
            balance: tokenData.amount.toString(),
            formattedBalance: tokenData.amount.toString(),
            documentUrl: '',
            documentHash: '',
            tokenType: tokenData.tokenType || {
              protocol: 'SLP',
              type: 'SLP_TOKEN_TYPE_FUNGIBLE',
              number: 1,
            },
            icon: '',
          });
        }
      }
      return tokens;
    } catch (error) {
      console.error('Error fetching tokens:', error);
      return [];
    }
  }

  private calculateFee(tx: ChronikTx): number {
    const inputSum = tx.inputs.reduce((sum, input) => sum + input.sats, 0n);
    const outputSum = tx.outputs.reduce((sum, output) => sum + output.sats, 0n);
    return Number(inputSum - outputSum);
  }

  private scriptToAddress(scriptHex: string): string {
    if (!scriptHex) return '';

    try {
      const scriptBytes = Buffer.from(scriptHex, 'hex');
      const script = new Script(scriptBytes);
      const fullAddress = Address.fromScript(
        script,
        this.networkInfo.cashAddrPrefix,
      ).toString();

      return fullAddress.split(':')[1] || fullAddress;
    } catch (error) {
      console.error(
        '[scriptToAddress] Could not derive address from script, only p2pkh and p2sh are supported:',
        scriptHex.slice(0, 20),
        error,
      );
      return '';
    }
  }
}

export default ChronikAPI;
