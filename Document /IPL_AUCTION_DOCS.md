# IPL Auction 2025 — Complete System Documentation

---

## 1. What This App Does

A live, multi-user IPL auction management system. The auctioneer runs the auction from a private port (5001) while all 10 team representatives watch and track budgets in real-time on a public port (5002). Every action by the auctioneer — selling a player, marking unsold, undoing — instantly updates every browser connected to the app via Server-Sent Events (SSE), no page refresh needed.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3 + Flask |
| Database | MySQL 8 with stored procedures |
| Real-time | Server-Sent Events (SSE) |
| Frontend | Vanilla JS + Jinja2 templates |
| Auth | Token-based sessions (HTTP-only cookies) |
| Fonts | Syne + DM Sans (Google Fonts) |

---

## 3. Project Structure

```
auction_final/
│
├── app.py                      ← Entry point. Runs two Flask servers simultaneously
├── config.py                   ← DB credentials, passwords, secret key
│
├── models/
│   ├── db.py                   ← MySQL connection pool + helper functions
│   └── auction.py              ← All business logic — queries, procedures, sessions
│
├── templates/
│   ├── base.html               ← Shared HTML shell with navbar
│   ├── landing.html            ← Port 5001 home (has Auctioneer link)
│   ├── public_landing.html     ← Port 5002 home (NO Auctioneer link)
│   ├── auctioneer_login.html   ← Password login for auctioneer
│   ├── team_login.html         ← Team selector login
│   ├── index.html              ← Auctioneer control panel (full auction UI)
│   ├── dashboard.html          ← Live public dashboard showing all teams
│   └── team_view.html          ← Individual team view (squad + live auction)
│
├── static/
│   ├── css/style.css           ← Complete dark theme stylesheet
│   └── js/
│       ├── auction.js          ← Auctioneer panel logic + SSE handler
│       └── dashboard.js        ← Dashboard live update logic
│
└── sql/
    ├── schema.sql              ← Core tables + stored procedures
    └── schema_additions.sql    ← Multi-user tables + unsold procedures
```

---

## 4. Database Schema

### Table: `teams`

Stores all IPL teams. Budget and counters are live — updated on every sale.

```sql
CREATE TABLE teams (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100) NOT NULL UNIQUE,   -- "Mumbai Indians"
    short_code     VARCHAR(5)   NOT NULL UNIQUE,   -- "MI"
    purse          DECIMAL(6,2) NOT NULL DEFAULT 100.00, -- ₹ Crores remaining
    overseas_count INT NOT NULL DEFAULT 0,          -- max 8
    wk_count       INT NOT NULL DEFAULT 0,          -- min 2 required
    total_players  INT NOT NULL DEFAULT 0           -- min 18 required
);
```

### Table: `auction_players`

Every player that can be auctioned. State is tracked via three boolean flags.

```sql
CREATE TABLE auction_players (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(150) NOT NULL,
    role             ENUM('Batsman','Bowler','All-Rounder','Wicket-Keeper') NOT NULL,
    category         ENUM('Indian','Overseas') NOT NULL DEFAULT 'Indian',
    base_price       DECIMAL(5,2) NOT NULL,   -- minimum bid in Crores
    current_bid      DECIMAL(5,2) DEFAULT NULL,
    current_team     VARCHAR(100) DEFAULT NULL, -- FK → teams.name
    is_sold          TINYINT(1) NOT NULL DEFAULT 0,
    is_marked_unsold TINYINT(1) NOT NULL DEFAULT 0,
    unsold_at        DATETIME DEFAULT NULL,
    manually_queued  TINYINT(1) NOT NULL DEFAULT 0
);
```

**Player state machine:**

| is_sold | is_marked_unsold | manually_queued | State |
|---------|-----------------|----------------|-------|
| 0 | 0 | 0 | Waiting in normal auction queue |
| 0 | 0 | 1 | In the "Unsold" tab queue (added manually) |
| 0 | 1 | 0 | Marked Unsold tab (can be re-queued) |
| 1 | 0 | 0 | Sold ✅ |

### Table: `bid_history`

Immutable log of every completed sale. Used for Undo and the Recent Sales panel.

```sql
CREATE TABLE bid_history (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id   INT UNSIGNED NOT NULL,  -- FK → auction_players.id
    team_name   VARCHAR(100) NOT NULL,
    bid_amount  DECIMAL(5,2) NOT NULL,
    timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `team_sessions`

One row per logged-in team. Token stored as HTTP-only cookie in the browser.

```sql
CREATE TABLE team_sessions (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    team_name  VARCHAR(100) NOT NULL,
    token      VARCHAR(64)  NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `auctioneer_session`

Single active session for the auctioneer. Only one token exists at a time.

```sql
CREATE TABLE auctioneer_session (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token      VARCHAR(64) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `unsold_log`

Audit trail of when players were marked unsold.

```sql
CREATE TABLE unsold_log (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id  INT UNSIGNED NOT NULL,
    marked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Stored Procedures

All critical auction operations run inside MySQL stored procedures — fully atomic with transaction rollback on error.

### `sell_player(player_id, team_name, bid_amount)`

The most important procedure. Sells a player to a team.

**Validations:**
- Player must not already be sold
- Bid must be ≥ base price
- Team purse must be ≥ bid amount
- If Overseas player: team overseas_count must be < 8

**On success:**
1. Sets `auction_players.is_sold = 1`, records bid and team
2. Clears `is_marked_unsold` and `unsold_at` (in case re-queued)
3. Deducts bid from `teams.purse`
4. Increments `teams.total_players`
5. Increments `teams.overseas_count` if Overseas
6. Increments `teams.wk_count` if Wicket-Keeper
7. Inserts row into `bid_history`
8. Deletes from `unsold_log`

### `mark_player_unsold(player_id)`

Marks current player as skipped/unsold.

**On success:**
1. Sets `is_marked_unsold = 1` and `unsold_at = NOW()`
2. Inserts into `unsold_log`

### `undo_last_bid()`

Reverses the most recent sale in `bid_history`.

1. Finds most recent row in `bid_history`
2. Resets `auction_players` flags back to unsold
3. Refunds purse to team, decrements all counters
4. Deletes the `bid_history` row

### `reset_auction()`

Full wipe — resets everything to starting state.

1. Clears all `auction_players` sold/unsold flags
2. Resets all teams to `purse = 100.00`, all counters to 0
3. Deletes all `bid_history` rows
4. Deletes all `unsold_log` rows

### `deduct_team_budget(team_name, amount)`

Manually deducts funds from a team purse.

1. Validates team has enough purse
2. Deducts amount

### `auctioneer_assign_player(player_name, role, category, team_name, bid_amount)`

Creates a brand-new player row already marked as sold and assigned.

---

## 6. Python Business Logic (`models/auction.py`)

Key functions called by Flask routes:

| Function | What it does |
|----------|-------------|
| `get_next_player()` | Returns the next unsold, un-queued player (lowest id) |
| `get_all_unsold()` | Returns players with `manually_queued=1` (the queue tab) |
| `get_marked_unsold()` | Returns players with `is_marked_unsold=1` |
| `get_sold_players()` | Returns all sold players including their `id` for cancel/rebid |
| `sell_player()` | Calls `sell_player` stored procedure |
| `mark_player_unsold()` | Calls `mark_player_unsold` stored procedure |
| `cancel_and_rebid(player_id)` | Pure Python — reverses a specific player's sale (not just the latest), restores team budget |
| `restore_unsold_player(player_id)` | Clears `is_marked_unsold`, sets `manually_queued=1` so they appear in Unsold tab |
| `add_player()` | Inserts new player with `manually_queued=1` |
| `create_team_session()` | Generates token, saves to `team_sessions`, returns token for cookie |
| `validate_auctioneer_token()` | Checks if auctioneer cookie token matches `auctioneer_session` row |

---

## 7. Dual-Port Architecture

The app runs **two completely separate Flask apps** inside `app.py`, started in parallel threads:

```
Port 5001 — auctioneer_app
  /               → landing with Auctioneer button
  /auction        → full auctioneer control panel (requires auth cookie)
  /auctioneer/login → password login
  /api/*          → ALL API endpoints (read + write)

Port 5002 — public_app  
  /               → public landing (NO Auctioneer button)
  /team/login     → team selector
  /team           → team view (requires team cookie)
  /dashboard      → public dashboard
  /api/*          → READ-ONLY API endpoints only
```

Both apps connect to the same MySQL database. Both share the same SSE subscriber list via a shared Python list — so a sale on port 5001 instantly pushes to browsers on port 5002.

---

## 8. Real-Time Updates (SSE)

Server-Sent Events keep all connected browsers in sync without polling or WebSockets.

**How a sale flows:**
1. Auctioneer clicks "Sell Player" on port 5001
2. `auction.js` sends `POST /api/sell`
3. Flask calls `sell_player()` stored procedure
4. Flask calls `broadcast_event('sale', {...})` 
5. Event pushed to all open `/api/events` streams (both ports share the list)
6. Every connected browser's `EventSource` receives the event
7. `auction.js` and `dashboard.js` update the UI instantly

**Events and their data:**

| Event type | Triggered when | Data sent |
|-----------|---------------|-----------|
| `sale` | Player sold | `next_player`, `teams` array |
| `unsold` | Marked unsold | `next_player`, `teams` |
| `undo` | Sale undone | `next_player`, `teams` |
| `reset` | Auction reset | `next_player`, `teams` |
| `cancel_rebid` | Sale voided | `next_player`, `teams` |
| `budget_deducted` | Manual deduction | `team_name`, `amount`, `teams` |
| `player_assigned` | Assign tool used | `player_name`, `team_name`, `teams` |
| `restore` | Player re-queued | `next_player`, `teams` |

---

## 9. Authentication

**Auctioneer:**
- Password set in `config.py → AUCTIONEER_PASSWORD` (default: `auction2025`)
- Login generates a `secrets.token_hex(32)` stored in `auctioneer_session` table
- Token saved as `HttpOnly` cookie named `auctioneer_token`
- Every write API endpoint calls `validate_auctioneer_token()` before executing

**Teams:**
- No password — just select team name from dropdown
- Login generates token stored in `team_sessions` table
- Token saved as `HttpOnly` cookie named `team_token`
- `last_seen` timestamp updated on every request
- Sessions active for 30+ minutes used in "connected teams" display

---

## 10. Auctioneer Tools Reference

| Tool | Tab/Location | How it works |
|------|-------------|-------------|
| **Sell Player** | Current Player tab | Selects team + amount → calls `sell_player` procedure |
| **Mark Unsold** | Current Player tab | Calls `mark_player_unsold` → player moves to Marked Unsold tab |
| **Undo Last** | Current Player tab | Calls `undo_last_bid` → reverses most recent sale |
| **Reset Auction** | Current Player tab | Calls `reset_auction` → full wipe |
| **Re-queue** | Marked Unsold tab | Sets `manually_queued=1`, clears unsold flags → player appears in Unsold tab |
| **Cancel & Rebid** | Sold tab | Calls `cancel_and_rebid(id)` → specific sale voided, budget restored, player back in queue |
| **Assign Player** | Tools panel | Picks from unsold/marked list → calls `/api/sell` to assign at set price |
| **Deduct Budget** | Tools panel | Calls `deduct_team_budget` procedure directly |
| **Add to Queue** | Tools panel | Creates new player row with `manually_queued=1` → appears in Unsold tab |

---

## 11. Squad Rules

Enforced at the database level and displayed live on the dashboard:

| Rule | Enforcement | Display |
|------|------------|---------|
| Max 8 Overseas players | Hard block in `sell_player` procedure | 🌍 X/8 |
| Min 2 Wicket-Keepers | Warning only (displayed) | 🧤 X/2 with ⚠️ |
| Min 18 players total | Warning only (displayed) | 👥 X/18 with ⚠️ |

---

## 12. API Endpoints

### Write (Port 5001 only, auctioneer cookie required)
```
POST /api/sell              Sell current player
POST /api/mark-unsold       Mark current player unsold
POST /api/restore-unsold    Re-queue a marked-unsold player
POST /api/cancel-rebid      Void a completed sale
POST /api/undo              Undo last sale
POST /api/reset             Full reset
POST /api/deduct-budget     Manual budget deduction
POST /api/assign-player     Direct player assignment
POST /api/players/add       Add new player to queue
```

### Read (Both ports)
```
GET /api/events             SSE stream for live updates
GET /api/teams              All teams with live stats
GET /api/teams/<name>       Single team + full squad
GET /api/next-player        Current player up for auction
GET /api/sold-players       All sold players (with id for cancel/rebid)
GET /api/marked-unsold      Players in marked unsold list
GET /api/unsold-players     Players in manual queue tab
GET /api/history            Recent bid history (last 20)
```

---

## 13. Running the App

```bash
# 1. Make sure MySQL is running
brew services start mysql        # macOS
# sudo systemctl start mysql    # Linux

# 2. First-time setup
mysql -u root -p < sql/schema.sql
mysql -u root -p ipl_auction < sql/schema_additions.sql

# 3. Add the manually_queued column (if upgrading)
mysql -u root -p ipl_auction -e \
  "ALTER TABLE auction_players ADD COLUMN IF NOT EXISTS manually_queued TINYINT(1) NOT NULL DEFAULT 0;"

# 4. Start the app
cd /path/to/auction_final
python3 app.py
```

**Output:**
```
🎤 Auctioneer panel  → http://localhost:5001   (password: auction2025)
🏟️  Teams & Dashboard → http://localhost:5002   (no password)
✅ Both servers running. Press Ctrl+C to stop.
```

---

## 14. config.py Reference

```python
AUCTIONEER_PASSWORD = 'auction2025'   # ← Change before real use!
SECRET_KEY          = 'your-secret'   # ← Change to random string
DB_HOST     = 'localhost'
DB_USER     = 'root'
DB_PASSWORD = 'yourpassword'
DB_NAME     = 'ipl_auction'
```

---

*Stack: Python 3 · Flask · MySQL · SSE · Vanilla JS · No WebSockets · No Redis · No external queue*
