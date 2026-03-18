export interface ECashNetworkInfo {
  messagePrefix: string;
  bech32: string;
  bip32: {
    public: number;
    private: number;
  };
  pubKeyHash: number;
  scriptHash: number;
  wif: number;
  cashAddrPrefix: string;
}

export type {
  Tx as ChronikTx,
  TxInput,
  TxOutput,
  Token as ChronikToken,
  TokenType,
  ScriptUtxo as ChronikUtxo,
  GenesisInfo,
} from 'chronik-client';
