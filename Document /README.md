# 🏏 IPL Auction Management System

A full-stack, production-ready IPL Auction system built with **Flask + MySQL + Vanilla JS**.

---

## 📁 Project Structure

```
auction_app/
├── app.py               # Flask routes (HTTP layer only)
├── config.py            # Config via environment variables
├── requirements.txt
├── models/
│   ├── db.py            # Connection pool + context manager
│   └── auction.py       # All SQL / stored procedure calls
├── templates/
│   ├── index.html       # Main auction page
│   └── dashboard.html   # Team dashboard
├── static/
│   ├── css/style.css    # Full dark IPL theme
│   └── js/
│       ├── auction.js   # Sell / undo / reset logic
│       └── dashboard.js # Auto-refreshing team view
└── sql/
    └── schema.sql       # Full schema + stored procs + sample data
```

---

## ⚙️ Prerequisites

- Python 3.10+
- MySQL 8.0+
- pip

---

## 🚀 Setup

### 1. Create & seed the database

```bash
mysql -u root -p < sql/schema.sql
```

This creates:
- Database `ipl_auction`
- Tables: `teams`, `auction_players`, `bid_history`
- Stored procedures: `sell_player`, `undo_last_sale`, `reset_auction`
- 10 IPL teams (₹100 Cr purse each)
- 36 sample players (Indian + Overseas, all roles)

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure database credentials

**Option A — environment variables (recommended for production):**
```bash
export MYSQL_HOST=localhost
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=your_password
export MYSQL_DB=ipl_auction
export SECRET_KEY=change-me-in-production
```

**Option B — edit `config.py` directly** (quick dev setup):
```python
MYSQL_PASSWORD = 'your_password'
```

### 4. Run the server

```bash
cd auction_app
python app.py
```

Open **http://localhost:5000** in your browser.

---

## 🎯 Features

| Feature | Details |
|---|---|
| Live player card | Auto-advances after each sale |
| Bid controls | Manual input + ±0.25 Cr buttons + quick-select amounts |
| Frontend validation | Blocks sale if purse insufficient or overseas limit hit |
| Backend validation | Stored proc enforces same rules atomically |
| Undo | Reverses last sale: purse, counts, player status |
| Reset | Clears entire auction with confirmation dialog |
| Team panel | Live purse + stats (no reload) |
| Dashboard | All 10 teams + full squads, auto-refreshes every 10s |
| Sold animation | Overlay stamp + card glow |
| History feed | Scrollable log of recent sales |
| SQL injection safe | All queries use parameterized placeholders |
| Transaction safe | Stored procs use `START TRANSACTION` + rollback on error |

---

## 🔌 API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Main auction page |
| GET | `/dashboard` | Team dashboard page |
| GET | `/next-player` | JSON: next unsold player |
| POST | `/sell` | Sell player — body: `{player_id, team_name, bid_amount}` |
| POST | `/undo` | Undo last sale |
| POST | `/reset` | Reset entire auction |
| GET | `/teams` | JSON: all team stats |
| GET | `/teams/<name>` | JSON: team + their bought players |
| GET | `/history?limit=20` | JSON: recent bid history |

---

## 🏏 Business Rules Enforced

1. **Max 8 overseas players per team** — blocked at both frontend and stored proc level  
2. **Purse limit** — bid rejected if team can't afford it  
3. **Min 2 wicket-keepers** — shown as ⚠️ warning in dashboard  
4. **No duplicate sales** — player marked sold atomically; re-sale returns 409  
5. **Undo is single-step** — only the last sale can be reversed  
6. **Atomic transactions** — stored procs use transactions; partial failures rollback  

---

## 🛡️ Security

- All SQL uses `%s` parameterized queries — never string interpolation
- No raw SQL is accepted from the frontend
- Input validation on both frontend (JS) and backend (Flask)
- Decimal parsing validates bounds before passing to DB
- `SECRET_KEY` should be set via environment variable in production

---

## 🧪 Edge Cases Handled

| Scenario | Response |
|---|---|
| Sell already-sold player | 409 Conflict |
| Bid > team purse | 422 with message |
| Overseas limit reached | 422 with message |
| Undo with no history | 422 with message |
| Invalid JSON body | 400 |
| Non-existent team | 422 |
| Reset with active bids | Resets everything cleanly |

---

## 🐳 Optional: Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
```

```bash
docker build -t ipl-auction .
docker run -p 5000:5000 \
  -e MYSQL_HOST=host.docker.internal \
  -e MYSQL_PASSWORD=yourpassword \
  ipl-auction
```

---

## 📈 Scaling Notes

- The MySQL connection pool (`pool_size=5`) handles concurrent requests
- Stored procedures reduce round-trips and enforce atomicity
- For high load: add Redis caching for `/teams` and add Gunicorn workers
- Dashboard polls every 10s — for real-time, replace with WebSocket (Flask-SocketIO)

---

## 🏆 Sample Workflow

1. Open http://localhost:5000
2. You'll see the first player card (highest base price first)
3. Enter bid amount (or use +/- buttons)
4. Select a team from dropdown
5. Frontend validates purse & overseas constraints live
6. Click **🔨 SOLD!** — animation plays, next player loads automatically
7. Use **↩ Undo** to reverse the last sale if needed
8. Check **Dashboard** tab to see full team squads update in real time
9. **🔄 Reset Auction** to start over (confirmation required)
