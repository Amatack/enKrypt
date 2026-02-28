import { EnkryptAccount } from '@enkryptcom/types';

export type ECashSignParams = {
  toAddress: string;
  amount: string;
  account: EnkryptAccount;
  networkName: string;
  tokenId?: string;
};
