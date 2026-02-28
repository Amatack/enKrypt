import type { Activity, BTCRawInfo } from '@/types/activity';
import { ActivityStatus, ActivityType } from '@/types/activity';
import type { ActivityHandlerType } from '@/libs/activity-state/types';
import type { TxOutput, TxInput } from 'chronik-client';
import { ChronikAPI } from './api-chronik';
import MarketData from '@/libs/market-data';
import {
  scriptToAddress,
  calculateOnchainTxFee,
  getTransactionAddresses,
  getTransactionTimestamp,
  getAddressWithoutPrefix,
  calculateTransactionValue,
  sumTokenOutputAtoms,
} from './utils';

export const chronikHandler: ActivityHandlerType = async (
  network,
  address,
): Promise<Activity[]> => {
  try {
    const cashAddrPrefix = (network as any).cashAddrPrefix ?? 'ecash';
    const normalizedAddress = getAddressWithoutPrefix(address);

    const api = (await network.api()) as unknown as ChronikAPI;

    const txHistory = await api.getTransactionHistory(normalizedAddress);

    if (!txHistory || txHistory.length === 0) {
      return [];
    }

    let currentPrice = 0;
    if (network.coingeckoID) {
      try {
        const market = new MarketData();
        const marketData = await market.getMarketData([network.coingeckoID]);
        currentPrice = marketData[0]?.current_price ?? 0;
      } catch (priceError) {
        console.error('[chronikHandler] Error getting price:', priceError);
      }
    }

    const activities: Activity[] = [];

    for (const tx of txHistory) {
      try {
        const hasTokenOutputs = tx.outputs.some(
          (output: TxOutput) => output.token,
        );
        const hasTokenInputs = tx.inputs.some((input: TxInput) => input.token);
        const isTokenTx = hasTokenOutputs || hasTokenInputs;

        // Compute isReceive/isSend with fewer conversions
        const outputAddresses = new Set(
          tx.outputs.map((o: TxOutput) =>
            scriptToAddress(o.outputScript, cashAddrPrefix),
          ),
        );
        const inputAddresses = new Set(
          tx.inputs.map((i: TxInput) =>
            scriptToAddress(i.outputScript ?? '', cashAddrPrefix),
          ),
        );

        const isReceive = outputAddresses.has(normalizedAddress);
        const isSend = inputAddresses.has(normalizedAddress);

        let tokenId: string | null = null;
        let tokenMetadata: {
          name: string;
          ticker: string;
          decimals: number;
          icon: string;
        } | null = null;

        let value = '0';

        if (isTokenTx) {
          if (isReceive) {
            const tokenOutputsToUs = tx.outputs.filter((output: TxOutput) => {
              const outputAddress = scriptToAddress(
                output.outputScript,
                cashAddrPrefix,
              );
              return outputAddress === normalizedAddress && output.token;
            });

            if (tokenOutputsToUs.length > 0) {
              tokenId = tokenOutputsToUs[0].token?.tokenId ?? null;
              value = sumTokenOutputAtoms(tokenOutputsToUs);
            }
          } else if (isSend) {
            const tokenOutputsToOthers = tx.outputs.filter(
              (output: TxOutput) => {
                const outputAddress = scriptToAddress(
                  output.outputScript,
                  cashAddrPrefix,
                );
                return outputAddress !== normalizedAddress && output.token;
              },
            );

            if (tokenOutputsToOthers.length > 0) {
              tokenId = tokenOutputsToOthers[0].token?.tokenId ?? null;
              value = sumTokenOutputAtoms(tokenOutputsToOthers);
            }
          }
        }

        // Single calculateTransactionValue call (for non-token OR token txs without resolved tokenId)
        if (!tokenId) {
          if (isReceive || isSend) {
            value = calculateTransactionValue(
              tx.outputs,
              normalizedAddress,
              isReceive,
              cashAddrPrefix,
            );
          }
        }

        if (tokenId) {
          const metadata = await api.getTokenMetadata(tokenId);
          if (metadata) {
            tokenMetadata = {
              name: metadata.name,
              ticker: metadata.ticker,
              decimals: metadata.decimals,
              icon: metadata.icon,
            };
          }
        }

        const { fromAddress, toAddress } = getTransactionAddresses(
          tx,
          normalizedAddress,
          isReceive,
          isSend,
          cashAddrPrefix,
        );

        const fee = isSend ? calculateOnchainTxFee(tx) : 0;

        const status =
          tx.block || tx.isFinal
            ? ActivityStatus.success
            : ActivityStatus.pending;

        const timestamp = getTransactionTimestamp(tx);

        const rawInfo: BTCRawInfo = {
          blockNumber: tx.block?.height || 0,
          fee,
          transactionHash: tx.txid,
          timestamp,
          inputs: tx.inputs.map((input: TxInput) => ({
            address: scriptToAddress(input.outputScript ?? '', cashAddrPrefix),
            value: Number(input.sats),
          })),
          outputs: tx.outputs.map((output: TxOutput) => ({
            address: scriptToAddress(output.outputScript, cashAddrPrefix),
            value: Number(output.sats),
            pkscript: output.outputScript,
          })),
        };

        const tokenInfo = tokenMetadata
          ? {
              decimals: tokenMetadata.decimals,
              icon: tokenMetadata.icon || network.icon,
              symbol: tokenMetadata.ticker,
              name: tokenMetadata.name,
              price: '0',
            }
          : {
              decimals: network.decimals,
              icon: network.icon,
              symbol: network.currencyName,
              name: network.currencyNameLong,
              price: currentPrice.toString(),
            };

        const activity: Activity = {
          from: fromAddress,
          to: toAddress,
          isIncoming: isReceive,
          network: network.name,
          status,
          type: ActivityType.transaction,
          value,
          transactionHash: tx.txid,
          timestamp: timestamp * 1000,
          token: tokenInfo,
          rawInfo,
        };

        activities.push(activity);
      } catch (txError) {
        console.error(`Error parsing transaction ${tx.txid}:`, txError);
      }
    }

    activities.sort((a, b) => b.timestamp - a.timestamp);

    return activities;
  } catch (error) {
    console.error('Error in chronikHandler:', error);
    return [];
  }
};

export default chronikHandler;
