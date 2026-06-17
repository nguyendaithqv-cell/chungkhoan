/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


import { useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Stock, PortfolioItem, LogEntry, TransactionEntry, BankAccount, UserData, LimitOrder, GameHistoryEntry } from './types';
import { TrendingUp, TrendingDown, DollarSign, Briefcase, User as UserIcon, LogOut, Wallet, Plus, ArrowUpRight, ArrowDownLeft, X, Check, CreditCard, Clock, Activity, History, ListChecks, ArrowRightLeft, Plane, Gamepad2, MoreHorizontal, ChevronDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from './context/AuthContext';
import { doc, setDoc, onSnapshot, getDoc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import { motion, AnimatePresence } from 'motion/react';

const STOCK_COLORS = ['#34d399', '#f87171', '#60a5fa', '#a78bfa', '#fbbf24', '#f472b6'];

export default function App() {
  const { user, signIn, signOut } = useAuth();
  const [view, setView] = useState<'dashboard' | 'profile' | 'orders' | 'spribe'>('dashboard');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [cash, setCash] = useState(10000000); 
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [transactions, setTransactions] = useState<TransactionEntry[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [gameBalances, setGameBalances] = useState<{ [gameId: string]: number }>({});
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [visibleStocks, setVisibleStocks] = useState<string[]>([]);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [saving, setSaving] = useState(false);

  const ITEMS_PER_PAGE = 10;

  // Sync data with Firestore
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    
    // Initial fetch and setup
    const initData = async () => {
        try {
            const snap = await getDoc(userRef);
            if (!snap.exists()) {
                await setDoc(userRef, {
                    cash: 10000000,
                    portfolio: [],
                    logs: [],
                    transactions: [],
                    bankAccounts: [],
                    orders: [],
                    gameBalances: {},
                    gameHistory: []
                });
            }
        } catch (error) {
            handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
    };

    initData();

    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
          const data = snapshot.data() as UserData;
          setCash(data.cash || 0);
          setLogs(data.logs || []);
          setTransactions(data.transactions || []);
          setBankAccounts(data.bankAccounts || []);
          setOrders(data.orders || []);
          setGameBalances(data.gameBalances || {});
          setGameHistory(data.gameHistory || []);
      }
    }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  // Handle portfolio rebuilding when stocks or firestore data changes
  useEffect(() => {
    if (!user || stocks.length === 0) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
             const data = snap.data() as UserData;
             if (data.portfolio) {
                  const mapped = data.portfolio.map(p => {
                      const stock = stocks.find(s => s.symbol === p.symbol);
                      return stock ? { stock, quantity: p.quantity } : null;
                  }).filter(Boolean) as PortfolioItem[];
                  setPortfolio(mapped);
             }
        }
    }, (error) => {
        // Silent error for portfolio sync to avoid spamming
        console.warn("Portfolio sync error", error);
    });
    return () => unsubscribe();
  }, [user, stocks.length]);

  // Regular stocks update
  useEffect(() => {
    const fetchStocks = () => {
      fetch('/api/stocks')
        .then(res => res.json())
        .then(data => {
          setStocks(data);
          setSelectedStock(prev => {
            if (prev) {
                const updated = data.find((s: Stock) => s.symbol === prev.symbol);
                return updated || prev;
            }
            return data[0] || null;
          });
          if (visibleStocks.length === 0) {
              setVisibleStocks(data.map((s: Stock) => s.symbol));
          }
        });
    };
    
    fetchStocks();
    const interval = setInterval(fetchStocks, 3000);
    return () => clearInterval(interval);
  }, [visibleStocks.length]);

  // Match Engine Logic (Khớp lệnh)
  useEffect(() => {
    if (!user || orders.length === 0 || stocks.length === 0) return;

    const pendingOrders = orders.filter(o => o.status === 'pending');
    if (pendingOrders.length === 0) return;

    let hasChanges = false;
    let newCash = cash;
    let newPortfolio = [...portfolio];
    let newOrders = [...orders];
    let newLogs = [...logs];

    pendingOrders.forEach(order => {
        const stock = stocks.find(s => s.symbol === order.symbol);
        if (!stock) return;

        let isMatch = false;
        if (order.type === 'buy' && stock.price <= order.targetPrice) {
            isMatch = true;
        } else if (order.type === 'sell' && stock.price >= order.targetPrice) {
            isMatch = true;
        }

        if (isMatch) {
            hasChanges = true;
            const orderIdx = newOrders.findIndex(o => o.id === order.id);
            if (orderIdx !== -1) {
                newOrders[orderIdx] = { ...newOrders[orderIdx], status: 'filled' };
            }

            const totalAmount = stock.price * order.quantity;

            if (order.type === 'buy') {
                // Cash was already "locked" or we check here? 
                // Traditional brokers usually lock cash when placing buy order.
                // For simplicity, we just debit now if enough, or cancel if not.
                if (newCash >= totalAmount) {
                    newCash -= totalAmount;
                    const existing = newPortfolio.find(p => p.stock.symbol === order.symbol);
                    if (existing) {
                        existing.quantity += order.quantity;
                    } else {
                        newPortfolio.push({ stock, quantity: order.quantity });
                    }
                    newLogs.unshift({
                        id: Math.random().toString(36).substring(7),
                        message: `Khớp lệnh MUA ${order.quantity} ${order.symbol} giá ${stock.price.toLocaleString()} VND (Lệnh đặt ${order.targetPrice.toLocaleString()})`,
                        timestamp: Date.now(),
                        type: 'buy'
                    });
                } else {
                    // Not enough money now - should we fail the order?
                    if (orderIdx !== -1) {
                      newOrders[orderIdx] = { ...newOrders[orderIdx], status: 'cancelled' };
                    }
                }
            } else {
                // Sell order
                const existing = newPortfolio.find(p => p.stock.symbol === order.symbol);
                if (existing && existing.quantity >= order.quantity) {
                    newCash += totalAmount;
                    existing.quantity -= order.quantity;
                    if (existing.quantity === 0) {
                        newPortfolio = newPortfolio.filter(p => p.stock.symbol !== order.symbol);
                    }
                    newLogs.unshift({
                        id: Math.random().toString(36).substring(7),
                        message: `Khớp lệnh BÁN ${order.quantity} ${order.symbol} giá ${stock.price.toLocaleString()} VND (Lệnh đặt ${order.targetPrice.toLocaleString()})`,
                        timestamp: Date.now(),
                        type: 'sell'
                    });
                } else {
                    // Not enough stock left
                    if (orderIdx !== -1) {
                      newOrders[orderIdx] = { ...newOrders[orderIdx], status: 'cancelled' };
                    }
                }
            }
        }
    });

    if (hasChanges) {
        setCash(newCash);
        setPortfolio(newPortfolio);
        setOrders(newOrders);
        setLogs(newLogs.slice(0, 200));
        saveToFirebase({ 
            cash: newCash, 
            portfolio: newPortfolio.map(p => ({ symbol: p.stock.symbol, quantity: p.quantity })), 
            orders: newOrders,
            logs: newLogs.slice(0, 200)
        });
    }
  }, [stocks, user, orders.length]); // Check against stocks updates

  const saveToFirebase = useCallback(async (updates: Partial<UserData>) => {
      if (!user) return;
      setSaving(true);
      const userPath = `users/${user.uid}`;
      try {
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, updates, { merge: true });
      } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, userPath);
      } finally {
          setTimeout(() => setSaving(false), 800);
      }
  }, [user]);

  const addLog = (message: string, type: 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'system') => {
      const newLog: LogEntry = {
          id: Math.random().toString(36).substring(7),
          message,
          timestamp: Date.now(),
          type
      };
      const updatedLogs = [newLog, ...logs].slice(0, 200);
      setLogs(updatedLogs);
      setCurrentPage(1);
      saveToFirebase({ logs: updatedLogs });
  }

  const buyStock = (stock: Stock) => {
    if (cash >= stock.price) {
      const newCash = cash - stock.price;
      const newPortfolio = [...portfolio];
      const existing = newPortfolio.find(item => item.stock.symbol === stock.symbol);
      if (existing) {
          existing.quantity += 1;
      } else {
          newPortfolio.push({ stock, quantity: 1 });
      }
      
      const firestorePortfolio = newPortfolio.map(p => ({ symbol: p.stock.symbol, quantity: p.quantity }));
      
      setCash(newCash);
      setPortfolio(newPortfolio);
      addLog(`Mua ${stock.symbol} giá ${stock.price.toLocaleString()} VND`, 'buy');
      saveToFirebase({ cash: newCash, portfolio: firestorePortfolio });
    }
  };

  const sellStock = (item: PortfolioItem) => {
    const currentStock = stocks.find(s => s.symbol === item.stock.symbol);
    const priceToSell = currentStock ? currentStock.price : item.stock.price;
    const newCash = cash + priceToSell;
    
    let newPortfolio = [...portfolio];
    const target = newPortfolio.find(p => p.stock.symbol === item.stock.symbol);
    if (target) {
        if (target.quantity > 1) {
            target.quantity -= 1;
        } else {
            newPortfolio = newPortfolio.filter(p => p.stock.symbol !== item.stock.symbol);
        }
    }

    const firestorePortfolio = newPortfolio.map(p => ({ symbol: p.stock.symbol, quantity: p.quantity }));

    setCash(newCash);
    setPortfolio(newPortfolio);
    addLog(`Bán ${item.stock.symbol} giá ${priceToSell.toLocaleString()} VND`, 'sell');
    saveToFirebase({ cash: newCash, portfolio: firestorePortfolio });
  };

  const addTransaction = (amount: number, type: 'deposit' | 'withdrawal', account: BankAccount) => {
      const newTx: TransactionEntry = {
          id: Math.random().toString(36).substring(7),
          amount,
          type,
          timestamp: Date.now(),
          accountId: account.id,
          accountName: `${account.bankName} - ${account.accountNumber}`
      };
      const newCash = type === 'deposit' ? cash + amount : cash - amount;
      const updatedTxs = [newTx, ...transactions].slice(0, 100);
      
      setCash(newCash);
      setTransactions(updatedTxs);
      saveToFirebase({ cash: newCash, transactions: updatedTxs });
  };

  const addBankAccount = (bank: BankAccount) => {
      const isFirst = bankAccounts.length === 0;
      const updated = [...bankAccounts, { ...bank, isDefault: isFirst || bank.isDefault }];
      setBankAccounts(updated);
      saveToFirebase({ bankAccounts: updated });
  };

  const deleteBankAccount = (id: string) => {
      const updated = bankAccounts.filter(a => a.id !== id);
      setBankAccounts(updated);
      saveToFirebase({ bankAccounts: updated });
  };

  const setDefaultAccount = (id: string) => {
      const updated = bankAccounts.map(a => ({...a, isDefault: a.id === id}));
      setBankAccounts(updated);
      saveToFirebase({ bankAccounts: updated });
  };

  const cancelOrder = (orderId: string) => {
    const updated = orders.map(o => o.id === orderId ? { ...o, status: 'cancelled' } as LimitOrder : o);
    setOrders(updated);
    saveToFirebase({ orders: updated });
  };

  const placeOrder = (symbol: string, type: 'buy' | 'sell', targetPrice: number, quantity: number) => {
    const newOrder: LimitOrder = {
      id: Math.random().toString(36).substring(7),
      symbol,
      type,
      targetPrice,
      quantity,
      status: 'pending',
      timestamp: Date.now()
    };
    const updated = [newOrder, ...orders];
    setOrders(updated);
    saveToFirebase({ orders: updated });
    
    // Add log
    const msg = `Đặt lệnh ${type === 'buy' ? 'MUA' : 'BÁN'} ${quantity} ${symbol} tại giá ${targetPrice.toLocaleString()} VND`;
    addLog(msg, type);
  };

  const getMergedChartData = (stocks: Stock[], visibleSymbols: string[]) => {
      const allTimes = new Set<string>();
      stocks.forEach(s => s.history.forEach(h => allTimes.add(h.time)));
      
      return Array.from(allTimes).sort().map(time => {
          const entry: any = { time };
          stocks.forEach(s => {
              if (visibleSymbols.includes(s.symbol)) {
                  const h = s.history.find(h => h.time === time);
                  entry[s.symbol] = h ? h.price : null;
              }
          });
          return entry;
      });
  };

  if (!user) {
    return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-white px-4">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center"
            >
                <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-emerald-500/20">
                    <Activity className="text-white w-10 h-10" />
                </div>
                <h1 className="text-5xl font-bold mb-4 tracking-tight">VN30 Trader Pro</h1>
                <p className="text-zinc-400 text-lg mb-8 max-w-md mx-auto">Trải nghiệm giao dịch chứng khoán ảo với dữ liệu thời gian thực và quản lý tài chính chuyên nghiệp.</p>
                <button 
                    onClick={signIn} 
                    className="bg-white text-zinc-950 font-semibold px-10 py-4 rounded-2xl hover:bg-zinc-200 transition-all active:scale-95 flex items-center gap-3 mx-auto shadow-xl"
                >
                    <img src="https://www.google.com/favicon.ico" className="w-5 h-5 font-bold" alt="Google" />
                    Đăng nhập với Google
                </button>
            </motion.div>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-10 font-sans text-zinc-100">
      <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">VN30 Trader Pro</h1>
          <p className="text-zinc-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Thị trường rực lửa
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
             <button 
                onClick={() => setView('dashboard')} 
                className={`px-4 py-2 rounded-xl transition-all font-bold ${view === 'dashboard' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
             >
                 Thị trường
             </button>
             <button 
                onClick={() => setView('orders')} 
                className={`px-4 py-2 rounded-xl transition-all font-bold ${view === 'orders' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
             >
                 Giao dịch
             </button>
             <div className="relative">
                <button 
                  onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
                  className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 font-bold ${view === 'spribe' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
                >
                    Thêm <ChevronDown size={14} className={`transition-transform ${isMoreMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {isMoreMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-2xl p-2 shadow-2xl z-50 overflow-hidden">
                    <button 
                      onClick={() => { setView('spribe'); setIsMoreMenuOpen(false); }}
                      className="w-full text-left px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 hover:text-white flex items-center gap-3 transition-colors text-sm font-bold"
                    >
                      <Plane size={16} className="text-rose-500" />
                      Spribe Aviator
                    </button>
                    <div className="px-4 py-2 text-[10px] text-zinc-600 font-black uppercase tracking-widest border-t border-zinc-800 mt-2 pt-2">
                        Sắp ra mắt
                    </div>
                    <button disabled className="w-full text-left px-4 py-3 rounded-xl opacity-30 text-zinc-500 flex items-center gap-3 text-sm font-bold cursor-not-allowed">
                      <Gamepad2 size={16} />
                      Poker Pro
                    </button>
                  </div>
                )}
             </div>
             <button 
                onClick={() => setView('profile')} 
                className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 font-bold ${view === 'profile' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
             >
                 <UserIcon size={18} />
                 {user.displayName?.split(' ').pop()}
             </button>
             <div className="h-8 w-[1px] bg-zinc-800 mx-2 hidden md:block" />
             <div className="bg-zinc-900 px-4 py-2 rounded-xl border border-zinc-800 flex items-center gap-3">
                 <Wallet size={16} className="text-emerald-400" />
                 <span className="font-mono text-sm font-semibold">{cash.toLocaleString()} VND</span>
                 {saving && <span className="text-[10px] text-zinc-600 animate-pulse ml-2 font-bold italic">SAVING</span>}
             </div>
             <button onClick={signOut} className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-rose-400 hover:bg-rose-900/20 transition-all"><LogOut size={18}/></button>
        </div>
      </header>
      
      <AnimatePresence mode="wait">
        {view === 'dashboard' ? (
          <motion.div 
            key="dashboard"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="grid grid-cols-1 lg:grid-cols-4 gap-6"
          >
            <section className="lg:col-span-1 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl space-y-8 flex flex-col max-h-[850px]">
              <div className="flex-grow overflow-auto space-y-8 pr-2 custom-scrollbar">
                  <div>
                      <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-white uppercase tracking-wider">
                        <Briefcase size={20} className="text-zinc-500" />
                        Danh mục đầu tư
                      </h2>
                      {portfolio.length === 0 ? (
                        <p className="text-sm text-zinc-500 italic">Chưa có cổ phiếu nào.</p>
                      ) : (
                        <ul className="space-y-4">
                          {portfolio.map(item => (
                            <li key={item.stock.symbol} className="flex items-center justify-between border-b border-zinc-800 pb-3">
                              <div>
                                <p className="font-semibold text-zinc-100">{item.stock.symbol} <span className="text-xs text-zinc-500 font-mono">x{item.quantity}</span></p>
                                <p className="text-sm text-zinc-400 font-mono">{(item.stock.price * item.quantity).toLocaleString()} VND</p>
                              </div>
                                <button 
                                    onClick={() => {
                                        setSelectedStock(item.stock);
                                        setTradeType('sell');
                                        setIsTradeModalOpen(true);
                                    }} 
                                    className="rounded-lg bg-red-950/50 px-4 py-1.5 text-xs text-red-200 hover:bg-red-900 transition font-bold"
                                >
                                    BÁN
                                </button>
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                  
                  <div>
                      <h3 className="mb-4 font-semibold text-zinc-300 border-t border-zinc-800 pt-6 uppercase tracking-wider">Lịch sử trading</h3>
                      <ul className="space-y-4">
                        {logs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((log) => (
                            <li key={log.id} className="flex flex-col gap-1">
                                <div className={`text-xs font-mono font-medium ${log.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {log.message}
                                </div>
                                <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 opacity-60">
                                    <Clock size={10} />
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </div>
                            </li>
                        ))}
                      </ul>
                      {logs.length > ITEMS_PER_PAGE && (
                        <div className="flex justify-between items-center mt-6 pt-4 border-t border-zinc-800">
                            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="text-[11px] font-bold text-zinc-500 hover:text-white disabled:opacity-30">TRƯỚC</button>
                            <span className="text-[11px] text-zinc-500 font-mono">{currentPage} / {Math.ceil(logs.length / ITEMS_PER_PAGE)}</span>
                            <button disabled={currentPage === Math.ceil(logs.length / ITEMS_PER_PAGE)} onClick={() => setCurrentPage(p => p + 1)} className="text-[11px] font-bold text-zinc-500 hover:text-white disabled:opacity-30">SAU</button>
                        </div>
                      )}
                  </div>
              </div>
            </section>
    
            <section className="lg:col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl space-y-8">
                <h2 className="text-xl font-semibold text-white">Bảng giá VN30</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <ul className="space-y-3 md:col-span-1 max-h-[300px] md:max-h-[500px] overflow-auto pr-2 custom-scrollbar">
                        {stocks.map(stock => (
                        <li 
                            key={stock.symbol} 
                            className={`group flex items-center justify-between rounded-xl p-3 cursor-pointer transition-all border ${selectedStock?.symbol === stock.symbol ? 'bg-zinc-800 border-zinc-700' : 'hover:bg-zinc-800/50 border-transparent'}`} 
                            onClick={() => setSelectedStock(stock)}
                        >
                            <div>
                            <p className="font-semibold text-zinc-100">{stock.symbol}</p>
                            <p className="text-sm text-zinc-400 font-mono">{stock.price.toLocaleString()} VND</p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className={`flex items-center gap-1 text-xs font-mono ${stock.change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                    {stock.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                    {Math.abs(stock.change).toFixed(2)}%
                                </span>
                                <button 
                                    onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setSelectedStock(stock);
                                        setTradeType('buy');
                                        setIsTradeModalOpen(true);
                                    }} 
                                    className="rounded-md bg-emerald-950/50 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-900 transition font-bold"
                                >
                                    MUA
                                </button>
                            </div>
                        </li>
                        ))}
                    </ul>
                    <div className="md:col-span-2 h-72 lg:h-[500px]">
                        {selectedStock && (
                            <div className="h-full bg-zinc-950 rounded-2xl p-6 border border-zinc-800 flex flex-col">
                                <div className="flex justify-between items-center mb-6">
                                    <div>
                                        <h3 className="font-bold text-xl">{selectedStock.symbol}</h3>
                                        <p className="text-xs text-zinc-500 uppercase tracking-widest leading-none">{selectedStock.name}</p>
                                    </div>
                                    <div className="text-[10px] text-zinc-600 bg-black px-3 py-1.5 rounded-full border border-zinc-800 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                                        LIVE MARKET
                                    </div>
                                </div>
                                <div className="flex-grow">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={selectedStock.history}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                                            <XAxis dataKey="time" stroke="#52525b" fontSize={10} axisLine={false} tickLine={false} />
                                            <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={10} axisLine={false} tickLine={false} />
                                            <Tooltip 
                                                contentStyle={{ backgroundColor: '#000', border: '1px solid #27272a', borderRadius: '12px', fontSize: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                                itemStyle={{ color: '#34d399' }}
                                                cursor={{ stroke: '#27272a' }}
                                            />
                                            <Line type="monotone" dataKey="price" stroke="#34d399" strokeWidth={3} dot={false} animationDuration={300} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
    
            <section className="lg:col-span-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h2 className="text-xl font-semibold text-white">Biểu đồ tổng quan VN30</h2>
                    <div className="flex flex-wrap gap-2">
                        {stocks.map((stock, i) => {
                            const color = STOCK_COLORS[i % STOCK_COLORS.length];
                            const isVisible = visibleStocks.includes(stock.symbol);
                            return (
                                <label key={stock.symbol} 
                                       className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono cursor-pointer border transition-all ${isVisible ? 'border-transparent shadow-lg' : 'border-zinc-800 text-zinc-500'}`}
                                       style={isVisible ? { backgroundColor: color, color: '#000', fontWeight: 'bold' } : { backgroundColor: 'transparent' }}>
                                    <input 
                                        type="checkbox" 
                                        checked={isVisible} 
                                        onChange={() => setVisibleStocks(prev => prev.includes(stock.symbol) ? prev.filter(s => s !== stock.symbol) : [...prev, stock.symbol])}
                                        className="accent-black w-3 h-3 hidden"
                                    />
                                    {stock.symbol}
                                </label>
                            );
                        })}
                    </div>
                </div>
                
                <div className="h-[400px] bg-zinc-950/30 rounded-2xl p-6 border border-zinc-800/50">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={getMergedChartData(stocks, visibleStocks)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#09090b" vertical={false} />
                            <XAxis dataKey="time" stroke="#52525b" fontSize={10} axisLine={false} tickLine={false} />
                            <YAxis stroke="#52525b" fontSize={10} domain={['auto', 'auto']} axisLine={false} tickLine={false} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#000', border: '1px solid #27272a', borderRadius: '12px', fontSize: '10px' }}
                                cursor={{ stroke: '#27272a' }}
                            />
                            {stocks.map((stock, i) => {
                                if (!visibleStocks.includes(stock.symbol)) return null;
                                return (
                                    <Line 
                                        key={stock.symbol} 
                                        type="monotone" 
                                        dataKey={stock.symbol} 
                                        stroke={STOCK_COLORS[i % STOCK_COLORS.length]} 
                                        strokeWidth={2} 
                                        dot={false} 
                                        activeDot={{ r: 4, strokeWidth: 0 }}
                                    />
                                );
                            })}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </section>
          </motion.div>
        ) : view === 'orders' ? (
          <OrdersView 
            orders={orders} 
            onCancel={cancelOrder} 
            stocks={stocks}
          />
        ) : view === 'spribe' ? (
          <SpribeView 
            balance={gameBalances['aviator'] || 0}
            cash={cash}
            gameHistory={gameHistory.filter(h => h.gameId === 'aviator')}
            onMainTransfer={(amount) => {
              if (cash >= amount) {
                const newCash = cash - amount;
                setCash(newCash);
                setGameBalances(prev => {
                  const updated = { ...prev, aviator: (prev['aviator'] || 0) + amount };
                  saveToFirebase({ cash: newCash, gameBalances: updated });
                  return updated;
                });
                addLog(`Chuyển ${amount.toLocaleString()} VND vào ví Spribe`, 'withdrawal');
              }
            }}
            onGameWithdraw={(amount) => {
              const current = gameBalances['aviator'] || 0;
              if (current >= amount) {
                const newCash = cash + amount;
                setCash(newCash);
                setGameBalances(prev => {
                  const updated = { ...prev, aviator: Math.max(0, (prev['aviator'] || 0) - amount) };
                  saveToFirebase({ cash: newCash, gameBalances: updated });
                  return updated;
                });
                addLog(`Rút ${amount.toLocaleString()} VND từ ví Spribe`, 'deposit');
              }
            }}
            onBetPlaced={(amount) => {
                setGameBalances(prev => {
                  const updated = { ...prev, aviator: Math.max(0, (prev['aviator'] || 0) - amount) };
                  saveToFirebase({ gameBalances: updated });
                  return updated;
                });
            }}
            onGameResult={(result) => {
              const { amount, multiplier, profit } = result;
              
              const historyEntry: GameHistoryEntry = {
                  id: Math.random().toString(36).substring(7),
                  gameId: 'aviator',
                  betAmount: amount,
                  multiplier,
                  profit,
                  timestamp: Date.now()
              };

              setGameHistory(prev => {
                  const updated = [historyEntry, ...prev].slice(0, 50);
                  saveToFirebase({ gameHistory: updated });
                  return updated;
              });

              if (profit > 0) {
                  const totalReturn = amount + profit;
                  setGameBalances(prev => {
                      const updated = { ...prev, aviator: (prev['aviator'] || 0) + totalReturn };
                      saveToFirebase({ gameBalances: updated });
                      return updated;
                  });
                  addLog(`Aviator: Thắng +${totalReturn.toLocaleString()} VND (X${multiplier.toFixed(2)})`, 'buy');
              } else {
                  addLog(`Aviator: Bay mất (X${multiplier.toFixed(2)})`, 'sell');
              }
            }}
          />
        ) : (
          <motion.div 
            key="profile"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8"
          >
              <div className="lg:col-span-4 space-y-6">
                  {/* Account Overview */}
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
                      <div className="flex flex-col items-center text-center mb-8">
                        <div className="relative w-28 h-28 mb-4">
                            <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-full h-full rounded-2xl border-4 border-emerald-500/10 object-cover" />
                            <div className="absolute -bottom-1 -right-1 bg-emerald-500 w-8 h-8 rounded-xl border-4 border-zinc-900 flex items-center justify-center">
                                <Check size={14} className="text-zinc-950 font-bold" />
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-white">{user.displayName}</h2>
                        <p className="text-zinc-500 text-sm font-medium opacity-60 tracking-tight">{user.email}</p>
                      </div>

                      <div className="space-y-4 mb-8">
                          <div className="bg-black p-6 rounded-3xl border border-zinc-800 relative overflow-hidden">
                              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 blur-3xl -mr-8 -mt-8" />
                              <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest mb-1.5">Số dư khả dụng</p>
                              <div className="text-3xl font-mono font-bold text-white flex items-baseline gap-2">
                                  {cash.toLocaleString()}
                                  <span className="text-xs font-medium text-zinc-600">VND</span>
                              </div>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                          <button 
                            onClick={() => { setTxType('deposit'); setIsTxModalOpen(true); }}
                            className="bg-emerald-500 text-zinc-950 font-bold py-4 rounded-2xl hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 active:scale-95 shadow-lg shadow-emerald-500/20"
                          >
                              <ArrowDownLeft size={18} />
                              NẠP TIỀN
                          </button>
                          <button 
                            onClick={() => { setTxType('withdrawal'); setIsTxModalOpen(true); }}
                            className="bg-zinc-800 text-white font-bold py-4 rounded-2xl hover:bg-zinc-700 transition-all flex items-center justify-center gap-2 active:scale-95"
                          >
                              <ArrowUpRight size={18} />
                              RÚT TIỀN
                          </button>
                      </div>
                  </div>

                   {/* External Accounts */}
                   <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
                      <div className="flex justify-between items-center mb-6">
                          <h3 className="font-bold text-lg flex items-center gap-2">
                              <CreditCard size={20} className="text-zinc-500" />
                              Quản lý ngân hàng
                          </h3>
                          <button 
                            onClick={() => setIsAccountModalOpen(true)}
                            className="w-10 h-10 rounded-xl bg-zinc-800 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center border border-zinc-700/50"
                          >
                              <Plus size={20} />
                          </button>
                      </div>
                      <div className="space-y-3">
                          {bankAccounts.length === 0 ? (
                              <div className="text-center py-10 rounded-3xl border border-dashed border-zinc-800">
                                  <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest">Chưa có liên kết</p>
                              </div>
                          ) : (
                              bankAccounts.map(account => (
                                  <div 
                                    key={account.id} 
                                    className={`p-5 rounded-2xl border transition-all relative group cursor-pointer ${account.isDefault ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-black/40 hover:bg-zinc-800'}`}
                                    onClick={() => setDefaultAccount(account.id)}
                                  >
                                      {account.isDefault && (
                                          <div className="absolute top-4 right-4 text-emerald-500">
                                              <Check size={16} />
                                          </div>
                                      )}
                                      <div className="flex justify-between items-start mb-3">
                                          <div>
                                              <p className="font-bold text-sm text-zinc-100">{account.bankName}</p>
                                              <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter mt-1">{account.ownerName}</p>
                                          </div>
                                          <button 
                                            onClick={(e) => { e.stopPropagation(); deleteBankAccount(account.id); }}
                                            className="opacity-0 group-hover:opacity-100 transition-all text-zinc-600 hover:text-rose-500"
                                          >
                                              <X size={16} />
                                          </button>
                                      </div>
                                      <p className="font-mono text-zinc-400 text-sm tracking-[0.25em]">{account.accountNumber.replace(/.(?=.{4})/g, '*')}</p>
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
              </div>

              <div className="lg:col-span-8">
                  {/* Ledger */}
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl h-full flex flex-col">
                      <div className="flex items-center justify-between mb-8">
                          <h3 className="font-bold text-xl uppercase tracking-wider">Nhật ký nạp & rút</h3>
                          <div className="flex items-center gap-1.5 bg-black p-1.5 rounded-xl border border-zinc-800">
                              <button className="px-5 py-2 text-[10px] font-bold bg-zinc-800 text-white rounded-lg uppercase tracking-wider">Tất cả</button>
                              <button className="px-5 py-2 text-[10px] font-bold text-zinc-600 uppercase tracking-wider">Tháng này</button>
                          </div>
                      </div>

                      <div className="flex-grow overflow-auto custom-scrollbar pr-4">
                          {transactions.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full py-40 opacity-10">
                                  <Clock size={64} className="mb-4" />
                                  <p className="font-bold uppercase tracking-widest text-xs">Trống dữ liệu</p>
                              </div>
                          ) : (
                              <table className="w-full">
                                  <thead>
                                      <tr className="text-zinc-600 text-[10px] font-bold uppercase tracking-[0.2em] border-b border-zinc-800">
                                          <th className="px-2 py-4 text-left">Thời gian</th>
                                          <th className="px-2 py-4 text-left">Giao dịch</th>
                                          <th className="px-2 py-4 text-right">Số lượng</th>
                                          <th className="px-2 py-4 text-right">TK Đích/Nguồn</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-800/40">
                                      {transactions.map(tx => (
                                          <tr key={tx.id} className="group hover:bg-white/5 transition-all">
                                              <td className="px-2 py-6">
                                                  <div className="text-sm font-bold text-zinc-300">
                                                      {new Date(tx.timestamp).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                  </div>
                                                  <div className="text-[10px] text-zinc-600 font-mono mt-1 opacity-60">
                                                      {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                  </div>
                                              </td>
                                              <td className="px-2 py-6">
                                                  <div className="flex items-center gap-3">
                                                      <div className={`w-2 h-2 rounded-full ${tx.type === 'deposit' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                      <span className={`text-[11px] font-extrabold uppercase tracking-widest ${tx.type === 'deposit' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                          {tx.type === 'deposit' ? 'Nạp vào' : 'Rút ra'}
                                                      </span>
                                                  </div>
                                              </td>
                                              <td className="px-2 py-6 text-right">
                                                  <div className={`font-mono font-bold text-sm ${tx.type === 'deposit' ? 'text-white' : 'text-zinc-400'}`}>
                                                      {tx.type === 'deposit' ? '+' : '-'}{tx.amount.toLocaleString()}
                                                  </div>
                                                  <div className="text-[9px] text-zinc-700 font-bold mt-0.5 tracking-widest">VND</div>
                                              </td>
                                              <td className="px-2 py-6 text-right">
                                                  <div className="text-xs text-zinc-400 font-medium">{tx.accountName}</div>
                                              </td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          )}
                      </div>
                  </div>
              </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transaction Modal */}
      <Modal isOpen={isTxModalOpen} onClose={() => setIsTxModalOpen(false)} title={txType === 'deposit' ? 'Nạp tiền PRO' : 'Yêu cầu rút tiền'}>
          <TransactionFlow 
            type={txType} 
            accounts={bankAccounts} 
            maxAmount={txType === 'withdrawal' ? cash : Infinity}
            onComplete={(amount, account) => {
                addTransaction(amount, txType, account);
                setIsTxModalOpen(false);
            }} 
          />
      </Modal>

      {/* Account Modal */}
      <Modal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} title="Liên kết ngân hàng">
          <AddAccountForm onAdd={(acc) => {
              addBankAccount(acc);
              setIsAccountModalOpen(false);
          }} />
      </Modal>

      {/* Trade Modal */}
      <Modal 
        isOpen={isTradeModalOpen} 
        onClose={() => setIsTradeModalOpen(false)} 
        title={tradeType === 'buy' ? `Mua ${selectedStock?.symbol}` : `Bán ${selectedStock?.symbol}`}
      >
          {selectedStock && (
              <TradeForm 
                stock={selectedStock}
                type={tradeType}
                cash={cash}
                portfolio={portfolio}
                onExecute={(qty) => {
                    if (tradeType === 'buy') {
                        for(let i=0; i<qty; i++) buyStock(selectedStock);
                    } else {
                        const item = portfolio.find(p => p.stock.symbol === selectedStock.symbol);
                        if (item) {
                            for(let i=0; i<qty; i++) sellStock(item);
                        }
                    }
                    setIsTradeModalOpen(false);
                }}
                onPlaceLimit={(price, qty) => {
                    placeOrder(selectedStock.symbol, tradeType, price, qty);
                    setIsTradeModalOpen(false);
                }}
              />
          )}
      </Modal>

      <style>{`
          .custom-scrollbar::-webkit-scrollbar {
              width: 5px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
              background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
              background: #27272a;
              border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
              background: #3f3f46;
          }
      `}</style>
    </div>
  );
}

function TradeForm({ stock, type, cash, portfolio, onExecute, onPlaceLimit }: { 
    stock: Stock, 
    type: 'buy' | 'sell', 
    cash: number, 
    portfolio: PortfolioItem[],
    onExecute: (qty: number) => void,
    onPlaceLimit: (price: number, qty: number) => void
}) {
    const [mode, setMode] = useState<'market' | 'limit'>('market');
    const [quantity, setQuantity] = useState(1);
    const [limitPrice, setLimitPrice] = useState(stock.price);

    const portfolioItem = portfolio.find(p => p.stock.symbol === stock.symbol);
    const maxQty = type === 'buy' ? Math.floor(cash / stock.price) : (portfolioItem?.quantity || 0);

    return (
        <div className="space-y-6">
            <div className="flex p-1 bg-black rounded-2xl border border-zinc-800">
                <button 
                    onClick={() => setMode('market')}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${mode === 'market' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-600 hover:text-zinc-300'}`}
                >
                    KHỚP NGAY
                </button>
                <button 
                    onClick={() => setMode('limit')}
                    className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all ${mode === 'limit' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-600 hover:text-zinc-300'}`}
                >
                    ĐẶT GIÁ
                </button>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                        <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Số lượng</label>
                        <span className="text-[10px] text-zinc-500 font-bold italic">Tối đa: {maxQty}</span>
                    </div>
                    <div className="relative">
                        <input 
                            type="number"
                            min="1"
                            max={maxQty}
                            value={quantity}
                            onChange={(e) => setQuantity(Number(e.target.value))}
                            className="w-full bg-black border border-zinc-800 rounded-2xl p-4 font-mono font-bold text-white focus:border-emerald-500/50 outline-none"
                        />
                    </div>
                </div>

                {mode === 'limit' && (
                    <div className="space-y-2">
                        <div className="flex justify-between items-center px-1">
                            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Giá đặt ({stock.symbol})</label>
                            <span className="text-[10px] text-zinc-500 font-bold italic">Hiện tại: {stock.price.toLocaleString()}</span>
                        </div>
                        <div className="relative">
                            <input 
                                type="number"
                                value={limitPrice}
                                onChange={(e) => setLimitPrice(Number(e.target.value))}
                                className="w-full bg-black border border-zinc-800 rounded-2xl p-4 font-mono font-bold text-white focus:border-emerald-500/50 outline-none"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-700">VND</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-black/40 rounded-2xl p-5 border border-zinc-800/50 border-dashed">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-zinc-500 font-medium tracking-tight">Tổng giá trị dự kiến</span>
                    <span className="text-sm font-mono font-bold text-white">{( (mode === 'limit' ? limitPrice : stock.price) * quantity).toLocaleString()} VND</span>
                </div>
            </div>

            <button 
                disabled={quantity <= 0 || quantity > maxQty || (mode === 'limit' && limitPrice <= 0)}
                onClick={() => {
                    if (mode === 'market') onExecute(quantity);
                    else onPlaceLimit(limitPrice, quantity);
                }}
                className={`w-full py-5 rounded-[2rem] font-black tracking-[0.2em] transition-all active:scale-95 shadow-xl disabled:opacity-20 disabled:grayscale ${type === 'buy' ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}
            >
                {mode === 'market' ? 'XÁC NHẬN KHỚP' : 'XÁC NHẬN ĐẶT LỆNH'}
            </button>
        </div>
    );
}

function OrdersView({ orders, onCancel, stocks }: { orders: LimitOrder[], onCancel: (id: string) => void, stocks: Stock[] }) {
    const pendingOrders = orders.filter(o => o.status === 'pending');
    const filledOrders = orders.filter(o => o.status === 'filled');

    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-6xl mx-auto space-y-8"
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
                    <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                        <Clock className="text-emerald-400" size={24} />
                        Lệnh đang chờ
                    </h3>
                    <div className="space-y-4 max-h-[500px] overflow-auto pr-2 custom-scrollbar">
                        {pendingOrders.length === 0 ? (
                            <div className="text-center py-20 bg-black/20 rounded-3xl border border-dashed border-zinc-800">
                                <p className="text-[10px] text-zinc-700 font-black uppercase tracking-widest">Không có lệnh chờ</p>
                            </div>
                        ) : (
                            pendingOrders.map(order => {
                                const currentStock = stocks.find(s => s.symbol === order.symbol);
                                const priceDiff = currentStock ? (order.type === 'buy' ? currentStock.price - order.targetPrice : order.targetPrice - currentStock.price) : 0;
                                
                                return (
                                    <div key={order.id} className="relative bg-black/40 border border-zinc-800 p-6 rounded-2xl group overflow-hidden">
                                        <div className={`absolute top-0 right-0 px-4 py-1 text-[8px] font-black uppercase tracking-widest ${order.type === 'buy' ? 'bg-emerald-500 text-zinc-950' : 'bg-rose-500 text-white'}`}>
                                            {order.type === 'buy' ? 'MUA' : 'BÁN'}
                                        </div>
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h4 className="text-2xl font-black">{order.symbol}</h4>
                                                <p className="text-[10px] text-zinc-500 font-mono tracking-tighter uppercase">{new Date(order.timestamp).toLocaleString()}</p>
                                            </div>
                                            <button 
                                                onClick={() => onCancel(order.id)}
                                                className="text-[10px] font-black text-rose-500 hover:text-rose-400 p-2 cursor-pointer transition-all"
                                            >
                                                HỦY LỆNH
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-6">
                                            <div>
                                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">Số lượng</p>
                                                <p className="font-mono font-bold text-white text-lg">{order.quantity}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">Giá đặt</p>
                                                <p className="font-mono font-bold text-white text-lg">{order.targetPrice.toLocaleString()}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-zinc-800/50 flex justify-between items-center">
                                            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Giá hiện tại: {currentStock?.price.toLocaleString() || '...'}</span>
                                            {currentStock && (
                                                <span className={`text-[10px] font-bold ${priceDiff > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                    {priceDiff > 0 ? `Lệch: +${priceDiff.toLocaleString()}` : `Lệch: ${priceDiff.toLocaleString()}`}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
                    <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
                        <History className="text-zinc-500" size={24} />
                        Lịch sử khớp lệnh
                    </h3>
                    <div className="space-y-4 max-h-[500px] overflow-auto pr-2 custom-scrollbar">
                        {filledOrders.length === 0 ? (
                            <div className="text-center py-20 bg-black/20 rounded-3xl border border-dashed border-zinc-800">
                                <p className="text-[10px] text-zinc-700 font-black uppercase tracking-widest">Chưa có lệnh khớp</p>
                            </div>
                        ) : (
                            filledOrders.map(order => (
                                <div key={order.id} className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-black/20 opacity-70">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${order.type === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                            {order.type === 'buy' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                                        </div>
                                        <div>
                                            <p className="font-bold flex items-center gap-2">
                                                {order.symbol}
                                                <span className="text-[10px] text-zinc-600 font-mono tracking-tighter">X{order.quantity}</span>
                                            </p>
                                            <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">{new Date(order.timestamp).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-mono font-bold text-white tracking-tight">{order.targetPrice.toLocaleString()} VND</p>
                                        <span className="text-[8px] font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded shadow-sm">FILLED</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function SpribeView({ balance, cash, gameHistory, onMainTransfer, onGameWithdraw, onBetPlaced, onGameResult }: { 
    balance: number, 
    cash: number,
    gameHistory: GameHistoryEntry[],
    onMainTransfer: (amount: number) => void, 
    onGameWithdraw: (amount: number) => void,
    onBetPlaced: (amount: number) => void,
    onGameResult: (res: { amount: number, multiplier: number, profit: number }) => void
}) {
    const [multiplier, setMultiplier] = useState(1.0);
    const multiplierRef = useRef(1.0);
    const gameStateRef = useRef<'idle' | 'waiting' | 'flying' | 'crashed'>('idle');
    const [gameState, _setGameState] = useState<'idle' | 'waiting' | 'flying' | 'crashed'>('idle');

    const setGameState = (s: 'idle' | 'waiting' | 'flying' | 'crashed') => {
        gameStateRef.current = s;
        _setGameState(s);
    };

    const [betAmount, setBetAmount] = useState(100000);
    const activeBetRef = useRef<{ amount: number } | null>(null);
    const [activeBet, _setActiveBet] = useState<{ amount: number } | null>(null);

    const setActiveBet = (bet: { amount: number } | null) => {
        activeBetRef.current = bet;
        _setActiveBet(bet);
    };

    const [historyIndices, setHistoryIndices] = useState<number[]>([]);
    const [transferAmount, setTransferAmount] = useState(1000000);
    const [isWalletOpen, setIsWalletOpen] = useState(false);
    const [winMessage, setWinMessage] = useState<{ amount: number, id: string } | null>(null);

    // Multiplier Logic (Slowed down)
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (gameState === 'flying') {
            const startTime = Date.now();
            // Higher prob for lower multipliers to be realistic
            const crashPoint = 1.01 + Math.random() * (Math.random() > 0.9 ? 12 : 3); 

            interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                // Slower growth: Math.pow(1.06, elapsed * 1.5) instead of 1.15
                const newMultiplier = Math.pow(1.07, elapsed * 1.5); 
                
                if (newMultiplier >= crashPoint) {
                    multiplierRef.current = crashPoint;
                    setMultiplier(crashPoint);
                    setGameState('crashed');
                    
                    if (activeBetRef.current) {
                        onGameResult({ 
                            amount: activeBetRef.current.amount, 
                            multiplier: crashPoint, 
                            profit: -activeBetRef.current.amount 
                        });
                        setActiveBet(null);
                    }
                    setHistoryIndices(prev => [crashPoint, ...prev].slice(0, 10));
                    clearInterval(interval);
                    
                    setTimeout(() => {
                        setGameState('waiting');
                        setMultiplier(1.0);
                        multiplierRef.current = 1.0;
                    }, 3000);
                } else {
                    multiplierRef.current = newMultiplier;
                    setMultiplier(newMultiplier);
                }
            }, 50); 
        } else if (gameState === 'waiting') {
            const timer = setTimeout(() => setGameState('flying'), 5000);
            return () => clearTimeout(timer);
        } else if (gameState === 'idle') {
            setGameState('waiting');
        }
        return () => clearInterval(interval);
    }, [gameState]);

    const handleCashOut = () => {
        // Use ref for immediate state check to fix "late" cash out issues
        if (activeBetRef.current && gameStateRef.current === 'flying') {
            const currentMultiplier = multiplierRef.current;
            const betAmount = activeBetRef.current.amount;
            const profit = Math.floor(betAmount * currentMultiplier - betAmount);
            
            // Immediately clear active bet to prevent double processing
            setActiveBet(null);

            onGameResult({ 
                amount: betAmount, 
                multiplier: currentMultiplier, 
                profit: profit 
            });

            // Set win message for floating effect
            const msgId = Math.random().toString(36).substring(7);
            setWinMessage({ amount: profit + betAmount, id: msgId });
            setTimeout(() => setWinMessage(prev => prev?.id === msgId ? null : prev), 2500);
        }
    };

    const placeBet = () => {
        if (balance >= betAmount && gameState === 'waiting' && !activeBet) {
            onBetPlaced(betAmount);
            setActiveBet({ amount: betAmount });
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-4">
            <div className="relative group overflow-hidden bg-zinc-900 border border-zinc-800 p-4 rounded-2xl shadow-xl">
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 blur-2xl -mr-12 -mt-12 rounded-full" />
                <div className="relative flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <div className="bg-rose-500 p-1.5 rounded-lg">
                                <Plane className="text-white" size={14} />
                            </div>
                            <h2 className="text-lg font-black italic tracking-tighter text-white uppercase">AVIATOR</h2>
                        </div>
                        <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-[0.2em] ml-9">Spribe Engine</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mb-0.5">Số dư</p>
                            <p className="text-xl font-mono font-black text-emerald-400">{balance.toLocaleString()} <span className="text-[9px]">VND</span></p>
                        </div>
                        <button 
                            onClick={() => setIsWalletOpen(true)}
                            className="bg-black/40 p-3 rounded-xl hover:bg-zinc-800 transition-all border border-zinc-800"
                        >
                            <Wallet size={20} className="text-zinc-500" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="relative bg-black border border-zinc-900 rounded-[2rem] h-[280px] overflow-hidden">
                <div className="absolute inset-0 opacity-5" 
                     style={{ backgroundImage: 'radial-gradient(circle at 1.5px 1.5px, #3f3f46 1px, transparent 0)', backgroundSize: '30px 30px' }} />
                
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
                    <motion.div
                        key={multiplier}
                        initial={{ scale: 0.98, opacity: 0.9 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="text-center"
                    >
                        <h1 className={`text-[70px] font-black font-mono leading-none tracking-tighter sm:text-[90px] ${gameState === 'crashed' ? 'text-rose-600' : 'text-white'}`}>
                            {multiplier.toFixed(2)}x
                        </h1>
                    </motion.div>

                    {/* Floating Win Message */}
                    <AnimatePresence>
                        {winMessage && (
                            <motion.div
                                key={winMessage.id}
                                initial={{ y: 50, opacity: 0, scale: 0.5 }}
                                animate={{ y: -120, opacity: 1, scale: 1.5 }}
                                exit={{ y: -180, opacity: 0 }}
                                className="absolute bg-emerald-500 text-zinc-950 px-8 py-3 rounded-2xl font-black text-2xl shadow-[0_0_50px_rgba(16,185,129,0.6)] z-[100]"
                            >
                                +{winMessage.amount.toLocaleString()} VND
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="absolute inset-0">
                    {gameState === 'flying' && (
                        <motion.div 
                            initial={{ x: -80, y: 300 }}
                            animate={{ 
                                x: [0, 600], 
                                y: [300, 40],
                                rotate: [-8, -30]
                            }}
                            transition={{ duration: 18, ease: "linear" }}
                            className="absolute z-20"
                        >
                            <div className="relative">
                                <Plane size={44} className="text-rose-500 fill-rose-500 drop-shadow-[0_0_20px_rgba(244,63,94,0.5)]" />
                                <div className="absolute top-1/2 right-1/2 w-40 h-1 bg-gradient-to-l from-rose-500/20 via-rose-500/0 to-transparent -translate-y-1/2 -rotate-1 skew-x-12 blur-[2px] origin-right" />
                            </div>
                        </motion.div>
                    )}
                    
                    {gameState === 'waiting' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/40 backdrop-blur-[2px] z-30">
                            <div className="w-16 h-1 rounded-full bg-zinc-800 mb-6 overflow-hidden">
                                <motion.div 
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 5, ease: "linear" }}
                                    className="h-full bg-rose-500"
                                />
                            </div>
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.4em] animate-pulse">Cất cánh trong 5 giây...</p>
                        </div>
                    )}

                    {gameState === 'crashed' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-950/10 backdrop-blur-sm z-30">
                            <motion.div 
                                initial={{ scale: 2, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-rose-600/20 p-6 rounded-full border border-rose-500/20 mb-4"
                            >
                                <X className="text-rose-500" size={48} />
                            </motion.div>
                            <p className="text-[10px] font-black text-rose-500 uppercase tracking-[0.6em]">FLEW AWAY!</p>
                        </div>
                    )}
                </div>

                <div className="absolute top-8 left-0 right-0 flex justify-center gap-2 px-8 z-20 overflow-hidden">
                    <AnimatePresence mode='popLayout'>
                        {historyIndices.map((h, i) => (
                            <motion.span 
                                key={`idx-${i}-${h}`}
                                layout
                                initial={{ x: -20, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{ x: 20, opacity: 0 }}
                                className={`px-4 py-1.5 rounded-full text-[10px] font-black border transition-all ${h > 3 ? 'bg-indigo-950 text-indigo-400 border-indigo-500/30' : h > 2 ? 'bg-zinc-800 text-zinc-100 border-zinc-700' : 'bg-black text-zinc-600 border-zinc-900 opacity-60'}`}
                            >
                                {h.toFixed(2)}x
                            </motion.span>
                        ))}
                    </AnimatePresence>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-[2rem] shadow-xl space-y-3">
                    <div className="flex justify-between items-center mb-1 px-1">
                        <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Tiền cược</label>
                        <div className="flex gap-1">
                            {[100000, 500000, 1000000, 2000000].map(amt => (
                                <button 
                                    key={amt} 
                                    onClick={() => setBetAmount(amt)} 
                                    className={`px-2.5 py-1 rounded-lg text-[8px] font-bold transition-all ${betAmount === amt ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white'}`}
                                >
                                    {amt/1000}K
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="relative">
                        <input 
                            type="number" 
                            step={50000}
                            value={betAmount}
                            onChange={(e) => setBetAmount(Math.max(0, Number(e.target.value)))}
                            className="w-full bg-black border border-zinc-800 rounded-xl p-3.5 font-mono font-black text-white text-xl focus:border-emerald-500/50 outline-none transition-all shadow-inner"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-zinc-700 tracking-widest">VND</span>
                    </div>
                    <button 
                        disabled={balance < betAmount || gameState !== 'waiting' || !!activeBet}
                        onClick={placeBet}
                        className={`w-full py-4 rounded-2xl font-black tracking-[0.2em] uppercase transition-all shadow-lg active:scale-95 disabled:opacity-10 disabled:grayscale ${!!activeBet ? 'bg-zinc-800 text-zinc-500 cursor-default' : 'bg-emerald-600 text-zinc-950 hover:bg-emerald-500'}`}
                    >
                        {!!activeBet ? 'ĐÃ ĐẶT' : 'ĐẶT CƯỢC'}
                    </button>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-[2rem] shadow-xl flex flex-col justify-center">
                    {activeBet && gameState === 'flying' ? (
                        <motion.button 
                            initial={{ scale: 0.98 }}
                            animate={{ scale: 1 }}
                            whileTap={{ scale: 0.94 }}
                            onClick={handleCashOut}
                            className="relative group h-full bg-amber-500 hover:bg-amber-400 transition-all rounded-[1.5rem] p-6 flex flex-col items-center justify-center gap-1 shadow-[0_15px_30px_rgba(245,158,11,0.15)] overflow-hidden"
                        >
                            <span className="text-[10px] font-black tracking-[0.3em] text-amber-950 uppercase">RÚT TIỀN</span>
                            <span className="text-3xl font-mono font-black text-zinc-950 tracking-tighter">{(activeBet.amount * multiplier).toLocaleString()} <span className="text-[10px]">VND</span></span>
                        </motion.button>
                    ) : (
                        <div className="flex-1 border border-dashed border-zinc-800 rounded-[1.5rem] flex flex-col items-center justify-center gap-2 bg-black/5">
                             <p className="text-[9px] text-zinc-700 font-black uppercase tracking-[0.2em]">Chờ lượt bay...</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-xl">
                 <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-2 flex items-center gap-2 px-1">
                    <History size={10} />
                    LỊCH SỬ CƯỢC
                 </h3>
                 <div className="max-h-[200px] overflow-auto custom-scrollbar border border-zinc-800/20 rounded-lg bg-black/40">
                    {gameHistory.length === 0 ? (
                        <div className="text-center py-8 opacity-10">
                            <p className="text-[8px] font-bold uppercase tracking-widest">Trống</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-800/20">
                            {gameHistory.map(entry => {
                                const isWin = entry.profit > 0;
                                const totalDisplay = isWin ? entry.betAmount + entry.profit : entry.betAmount;
                                
                                return (
                                    <div key={entry.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.01] transition-colors">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-1 h-1 rounded-full ${isWin ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-[10px] font-mono font-bold ${isWin ? 'text-zinc-100' : 'text-zinc-500'}`}>
                                                        {entry.betAmount.toLocaleString()}
                                                    </span>
                                                    <span className={`text-[8px] font-mono ${isWin ? 'text-zinc-400' : 'text-zinc-600'}`}>@{entry.multiplier.toFixed(2)}x</span>
                                                </div>
                                                <span className="text-[7px] text-zinc-700 font-bold tabular-nums">
                                                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {isWin ? (
                                                <div className="flex flex-col items-end">
                                                    <p className="text-[10px] font-mono font-black text-emerald-400">
                                                        +{totalDisplay.toLocaleString()}
                                                    </p>
                                                    <span className="text-[6px] font-black text-emerald-500/40 uppercase tracking-tighter leading-none">WIN</span>
                                                </div>
                                            ) : (
                                                <span className="text-[7px] font-bold text-zinc-700 uppercase tracking-widest px-1 py-0.5 rounded border border-zinc-900/50">
                                                    LOSS
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                 </div>
            </div>

            <Modal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} title="QUẢN LÝ VÍ SPRIBE">
                <div className="space-y-8">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-black border border-zinc-800 p-6 rounded-3xl text-center">
                            <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-2">Ví Tổng</p>
                            <p className="text-xl font-mono font-black text-white italic">{cash.toLocaleString()} VND</p>
                        </div>
                        <div className="bg-black border border-emerald-500/20 p-6 rounded-3xl text-center">
                            <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mb-2">Ví Spribe</p>
                            <p className="text-xl font-mono font-black text-emerald-400 italic">{balance.toLocaleString()} VND</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-zinc-950 p-6 rounded-[2rem] border border-zinc-800 border-dashed relative group">
                             <div className="space-y-3">
                                <div className="flex justify-between items-center px-2">
                                    <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">SỐ TIỀN THAY ĐỔI</label>
                                    <div className="flex gap-2">
                                        {[1000000, 5000000].map(v => (
                                            <button key={v} onClick={() => setTransferAmount(v)} className="text-[9px] font-bold text-zinc-500 hover:text-white transition-colors underline decoration-dotted">{v/1000000}M</button>
                                        ))}
                                    </div>
                                </div>
                                <input 
                                    type="number"
                                    value={transferAmount}
                                    onChange={(e) => setTransferAmount(Number(e.target.value))}
                                    className="w-full bg-black border border-zinc-800 rounded-2xl p-5 font-mono font-black text-white text-3xl focus:border-emerald-500/50 outline-none transition-all shadow-inner"
                                />
                             </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <button 
                                onClick={() => { onMainTransfer(transferAmount); setIsWalletOpen(false); }}
                                className="w-full py-5 bg-emerald-500 text-zinc-950 rounded-[2rem] font-black tracking-widest uppercase hover:bg-emerald-400 transition-all shadow-xl active:scale-98"
                            >
                                CHUYỂN VÀO VÍ GAME
                            </button>
                            <div className="grid grid-cols-2 gap-3">
                                <button 
                                    onClick={() => { onGameWithdraw(transferAmount); setIsWalletOpen(false); }}
                                    className="py-4 bg-zinc-800 text-white rounded-2xl font-black tracking-widest uppercase hover:bg-zinc-700 transition-all text-xs"
                                >
                                    RÚT THEO LƯỢNG
                                </button>
                                <button 
                                    onClick={() => { onGameWithdraw(balance); setIsWalletOpen(false); }}
                                    className="py-4 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-2xl font-black tracking-widest uppercase hover:text-white transition-all text-xs"
                                >
                                    RÚT TẤT CẢ
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

// Reusable Modal Component
function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: ReactNode }) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-zinc-950/90 backdrop-blur-md"
                    />
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className="relative bg-zinc-900 border border-zinc-800 rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden"
                    >
                        <div className="p-8 border-b border-zinc-800 flex justify-between items-center bg-black/20">
                            <h3 className="text-xl font-black uppercase tracking-widest">{title}</h3>
                            <button onClick={onClose} className="w-10 h-10 rounded-2xl hover:bg-zinc-800 transition-all text-zinc-500 flex items-center justify-center border border-transparent hover:border-zinc-800">
                                <X size={20}/>
                            </button>
                        </div>
                        <div className="p-8 overflow-y-auto max-h-[80vh] custom-scrollbar">
                            {children}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}

function TransactionFlow({ type, accounts, onComplete, maxAmount }: { type: 'deposit' | 'withdrawal', accounts: BankAccount[], onComplete: (val: number, acc: BankAccount) => void, maxAmount: number }) {
    const [amount, setAmount] = useState(0);
    const [selectedAccId, setSelectedAccId] = useState(accounts.find(a => a.isDefault)?.id || accounts[0]?.id || '');
    const [step, setStep] = useState(accounts.length > 0 && accounts.find(a => a.isDefault) ? 2 : 1);
    
    if (accounts.length === 0) {
        return <div className="text-center py-10">
            <div className="w-20 h-20 bg-zinc-800/50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-zinc-700">
                <CreditCard size={32} />
            </div>
            <p className="text-zinc-500 mb-8 font-bold uppercase tracking-wider text-[10px]">Thiếu thông tin thanh toán</p>
            <p className="text-zinc-400 text-sm leading-relaxed mb-8">Vui lòng liên kết tài khoản ngân hàng trước khi thực hiện giao dịch.</p>
        </div>
    }

    const selectedAcc = accounts.find(a => a.id === selectedAccId);

    return (
        <div className="space-y-8">
            {step === 1 ? (
                <div className="space-y-6">
                    <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Nguồn thanh toán</p>
                    <div className="space-y-3">
                        {accounts.map(acc => (
                            <div 
                                key={acc.id} 
                                onClick={() => setSelectedAccId(acc.id)}
                                className={`p-5 rounded-[1.5rem] border transition-all cursor-pointer flex items-center justify-between ${selectedAccId === acc.id ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-800 hover:border-zinc-700 bg-black/20'}`}
                            >
                                <div>
                                    <p className="font-bold text-zinc-100 text-sm italic uppercase">{acc.bankName}</p>
                                    <p className="text-[10px] text-zinc-600 font-mono tracking-widest mt-1">**** {acc.accountNumber.slice(-4)}</p>
                                </div>
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedAccId === acc.id ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-800'}`}>
                                    {selectedAccId === acc.id && <Check size={12} className="text-black font-bold" />}
                                </div>
                            </div>
                        ))}
                    </div>
                    <button 
                        onClick={() => setStep(2)} 
                        className="w-full bg-white text-zinc-950 font-black py-5 rounded-[2rem] hover:bg-emerald-400 transition-all active:scale-98 shadow-xl uppercase tracking-widest text-xs"
                    >
                        TIẾP TỤC
                    </button>
                </div>
            ) : (
                <div className="space-y-8">
                    <div>
                        <div className="flex items-center justify-between mb-4 pl-1">
                            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Hạn mức giao dịch</p>
                            <button onClick={() => setStep(1)} className="text-[10px] text-emerald-400 font-black uppercase tracking-widest hover:opacity-70">Đổi thẻ</button>
                        </div>
                        <div className="relative group">
                            <input 
                                type="number" 
                                autoFocus
                                placeholder="0"
                                className="w-full bg-black border-2 border-zinc-800 rounded-[2rem] p-8 text-4xl font-mono font-bold text-white focus:border-emerald-500/50 outline-none transition-all pr-24"
                                value={amount || ''}
                                onChange={(e) => setAmount(Number(e.target.value))}
                            />
                            <span className="absolute right-10 top-1/2 -translate-y-1/2 text-zinc-700 font-black text-xs tracking-widest">VND</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {[1000000, 5000000, 20000000, 100000000].map(val => (
                            <button 
                                key={val}
                                onClick={() => setAmount(val)} 
                                className="bg-zinc-800/30 border border-zinc-800 py-3.5 rounded-[1.25rem] text-[10px] font-mono font-bold hover:bg-zinc-800 hover:border-zinc-600 transition-all"
                            >
                                {val.toLocaleString()}
                            </button>
                        ))}
                    </div>

                    <div className="p-5 rounded-[1.5rem] bg-black border border-zinc-800 flex items-center justify-between">
                         <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10">
                                 <Wallet size={18} />
                             </div>
                             <div>
                                 <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">Đích đến</p>
                                 <p className="text-xs font-bold text-zinc-300 mt-0.5">{selectedAcc?.bankName}</p>
                             </div>
                         </div>
                         <p className="text-[10px] font-mono text-zinc-600 tracking-tighter">**** {selectedAcc?.accountNumber.slice(-4)}</p>
                    </div>

                    {type === 'withdrawal' && amount > maxAmount && (
                         <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center gap-3">
                             <X size={16} className="text-rose-500" />
                             <p className="text-rose-500 text-[10px] font-black uppercase tracking-[0.2em]">Số dư trong ví không đủ</p>
                         </div>
                    )}

                    <button 
                        disabled={amount <= 0 || (type === 'withdrawal' && amount > maxAmount)}
                        onClick={() => onComplete(amount, selectedAcc!)} 
                        className="w-full bg-emerald-500 text-zinc-950 font-black py-5 rounded-[2rem] hover:bg-emerald-400 transition-all disabled:opacity-10 active:scale-98 shadow-xl shadow-emerald-500/10 uppercase tracking-[0.2em] text-xs"
                    >
                        XÁC NHẬN GIAO DỊCH
                    </button>
                </div>
            )}
        </div>
    )
}

function AddAccountForm({ onAdd }: { onAdd: (acc: BankAccount) => void }) {
    const [form, setForm] = useState({
        bankName: '',
        accountNumber: '',
        ownerName: ''
    });

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] pl-1">TỔ CHỨC TÍN DỤNG</label>
                <input 
                    placeholder="VD: VIETCOMBANK"
                    className="w-full bg-black border border-zinc-800 rounded-[1.5rem] p-5 text-sm font-black focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-800 uppercase"
                    value={form.bankName}
                    onChange={(e) => setForm({...form, bankName: e.target.value})}
                />
            </div>
            <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] pl-1">SỐ TÀI KHOẢN GIAO DỊCH</label>
                <input 
                    placeholder="VD: 1022340056"
                    className="w-full bg-black border border-zinc-800 rounded-[1.5rem] p-5 text-sm font-mono tracking-[0.3em] focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-800"
                    value={form.accountNumber}
                    onChange={(e) => setForm({...form, accountNumber: e.target.value})}
                />
            </div>
            <div className="space-y-3">
                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] pl-1">HỌ VÀ TÊN CHỦ SỞ HỮU</label>
                <input 
                    placeholder="VD: NGUYEN VAN A"
                    className="w-full bg-black border border-zinc-800 rounded-[1.5rem] p-5 text-sm font-black uppercase tracking-wider focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-800"
                    value={form.ownerName}
                    onChange={(e) => setForm({...form, ownerName: e.target.value})}
                />
            </div>
            <button 
                disabled={!form.bankName || !form.accountNumber || !form.ownerName}
                onClick={() => onAdd({
                    id: Math.random().toString(36).substring(7),
                    ...form
                })}
                className="w-full bg-white text-zinc-950 font-black py-5 rounded-[2rem] hover:bg-emerald-400 transition-all mt-8 disabled:opacity-10 active:scale-98 shadow-2xl uppercase tracking-[0.2em] text-xs"
            >
                KẾT NỐI TÀI KHOẢN
            </button>
        </div>
    )
}
