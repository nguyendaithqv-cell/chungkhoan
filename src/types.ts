export interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  history: {time: string, price: number}[];
}

export interface PortfolioItem {
  stock: Stock;
  quantity: number;
}

export interface LogEntry {
  id: string;
  message: string;
  timestamp: number;
  type: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'system';
}

export interface TransactionEntry {
  id: string;
  type: 'deposit' | 'withdrawal';
  amount: number;
  timestamp: number;
  accountId: string;
  accountName: string;
}

export interface LimitOrder {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  targetPrice: number;
  quantity: number;
  status: 'pending' | 'filled' | 'cancelled';
  timestamp: number;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  ownerName: string;
  isDefault?: boolean;
}

export interface GameHistoryEntry {
  id: string;
  gameId: string;
  betAmount: number;
  multiplier: number;
  profit: number;
  timestamp: number;
}

export interface UserData {
  cash: number;
  portfolio: { symbol: string, quantity: number }[];
  logs: LogEntry[];
  transactions: TransactionEntry[];
  bankAccounts: BankAccount[];
  orders: LimitOrder[];
  gameBalances: { [gameId: string]: number };
  gameHistory: GameHistoryEntry[];
}
