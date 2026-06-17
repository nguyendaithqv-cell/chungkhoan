import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Mock data - VN30
  const stocks = [
      { symbol: "VCB", name: "Vietcombank", price: 95000, change: 0, history: [{time: '0s', price: 95000}] },
      { symbol: "VIC", name: "Vingroup", price: 42000, change: 0, history: [{time: '0s', price: 42000}] },
      { symbol: "HPG", name: "Hoa Phat Group", price: 27000, change: 0, history: [{time: '0s', price: 27000}] },
      { symbol: "TCB", name: "Techcombank", price: 25000, change: 0, history: [{time: '0s', price: 25000}] },
      { symbol: "VHM", name: "Vinhomes", price: 40000, change: 0, history: [{time: '0s', price: 40000}] },
      { symbol: "MWG", name: "Mobile World", price: 45000, change: 0, history: [{time: '0s', price: 45000}] },
  ];

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/stocks", (req, res) => {
      stocks.forEach(s => {
          const priceChange = (Math.random() * 2000 - 1000);
          const oldPrice = s.price;
          const newPrice = oldPrice + priceChange;
          
          s.change = (priceChange / oldPrice) * 100;
          s.price = newPrice;
          s.history.push({time: `${s.history.length * 3}s`, price: Math.round(newPrice)});
          if (s.history.length > 20) s.history.shift();
      });
      res.json(stocks);
  });

  // Mock endpoint for stock price - dynamic change
  app.get("/api/stock/:symbol", (req, res) => {
      const symbol = req.params.symbol.toUpperCase();
      const stock = stocks.find(s => s.symbol === symbol);
      
      if (!stock) {
          return res.status(404).json({ error: "Stock not found" });
      }

      // Simulate price fluctuation
      const priceVariation = (Math.random() * 2 - 1);
      const newPrice = stock.price + priceVariation;
      
      res.json({ ...stock, price: newPrice.toFixed(2), change: priceVariation.toFixed(2) });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
