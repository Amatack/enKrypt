import { BaseToken, BaseTokenOptions } from '@/types/base-token';
import { ChronikAPI } from '../libs/api-chronik';

type ECashTokenOptions = BaseTokenOptions & { contract?: string };

export class ECashToken extends BaseToken {
  public contract: string;
  constructor(options: ECashTokenOptions) {
    super(options);
    this.contract = options.contract || '';
  }

  public async getLatestUserBalance(api: any, pubkey: string): Promise<string> {
    return (api as ChronikAPI).getBalance(pubkey);
  }

  public async send(): Promise<any> {
    throw new Error('ECash-send is not implemented here');
  }
}
