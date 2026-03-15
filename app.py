"""
IPL Auction Management System — Single-App (Railway deployment)

Routes:
  /                    → Landing page (choose role)
  /auctioneer/login    → Auctioneer password login
  /auction             → Auctioneer control panel (protected)
  /team/login          → Team selector
  /team                → Team live view (protected)
  /dashboard           → Public dashboard
  /api/*               → All API endpoints
"""
import sys, os, json, time, threading
from datetime import datetime
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, jsonify, request, render_template, Response, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
from config import Config
import models.auction as auction

app = Flask(__name__, template_folder='templates', static_folder='static')
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = Config.SECRET_KEY

# ── SSE Event Bus ─────────────────────────────────────────────────────────────
_subscribers = []
_subscribers_lock = threading.Lock()

def broadcast_event(event_type: str, data: dict):
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    with _subscribers_lock:
        dead = []
        for q in _subscribers:
            try: q.append(msg)
            except: dead.append(q)
        for d in dead: _subscribers.remove(d)

def subscribe():
    q = []
    with _subscribers_lock: _subscribers.append(q)
    return q

def unsubscribe(q):
    with _subscribers_lock:
        if q in _subscribers: _subscribers.remove(q)

# ── Helpers ───────────────────────────────────────────────────────────────────
def ok(data):
    data['status'] = 'ok'
    return jsonify(data), 200

def err(message, code=400):
    return jsonify({'status': 'error', 'message': message}), code

def validate_positive_number(value, field):
    try:
        f = float(value)
        if f <= 0: raise ValueError
        return f
    except (TypeError, ValueError):
        raise ValueError(f"'{field}' must be a positive number")

def decimal_to_float(obj):
    import decimal
    if isinstance(obj, list):  return [decimal_to_float(i) for i in obj]
    if isinstance(obj, dict):  return {k: decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, decimal.Decimal): return float(obj)
    if isinstance(obj, datetime): return obj.isoformat()
    return obj

def is_auctioneer():
    token = request.cookies.get('auctioneer_token') or request.headers.get('X-Auctioneer-Token')
    return bool(token and auction.validate_auctioneer_token(token))

def require_auctioneer_api():
    """Returns an error response if not authenticated, else None."""
    if not is_auctioneer():
        return err('Auctioneer authentication required', 401)
    return None

# ══════════════════════════════════════════════════════════════════════════════
# PAGES
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    teams = auction.get_all_teams()
    # Show auctioneer option only if logged in as auctioneer
    return render_template('landing.html',
                           teams=decimal_to_float(teams),
                           is_auctioneer=is_auctioneer())

@app.route('/favicon.ico')
def favicon(): return '', 204

# ── Auctioneer ────────────────────────────────────────────────────────────────

@app.route('/auctioneer/login', methods=['GET', 'POST'])
def auctioneer_login():
    if request.method == 'POST':
        if request.form.get('password') == Config.AUCTIONEER_PASSWORD:
            token = auction.get_auctioneer_token()
            resp = redirect(url_for('auction_page'))
            resp.set_cookie('auctioneer_token', token, httponly=True, samesite='Lax',
                            secure=Config.COOKIE_SECURE)
            return resp
        return render_template('auctioneer_login.html', error='Incorrect password')
    return render_template('auctioneer_login.html', error=None)

@app.route('/auctioneer/logout')
def auctioneer_logout():
    resp = redirect(url_for('index'))
    resp.delete_cookie('auctioneer_token')
    return resp

@app.route('/auction')
def auction_page():
    if not is_auctioneer():
        return redirect(url_for('auctioneer_login'))
    teams        = auction.get_all_teams()
    player       = auction.get_next_player()
    history      = auction.get_bid_history(10)
    sold_players = auction.get_sold_players()
    return render_template('index.html',
                           teams=decimal_to_float(teams),
                           current_player=decimal_to_float(player),
                           history=decimal_to_float(history),
                           sold_players=decimal_to_float(sold_players),
                           is_auctioneer=True)

# ── Team ──────────────────────────────────────────────────────────────────────

@app.route('/team/login', methods=['GET', 'POST'])
def team_login():
    teams = auction.get_all_teams()

    if request.method == 'POST':
        team_name = request.form.get('team_name', '').strip()
        valid = [t['name'] for t in teams]

        if team_name not in valid:
            return render_template(
                'team_login.html',
                teams=decimal_to_float(teams),
                error='Invalid team selected'
            )

        token = auction.create_team_session(team_name)

        if not token:
            return render_template(
                'team_login.html',
                teams=decimal_to_float(teams),
                error='Failed to create session'
            )

        resp = redirect(url_for('team_view'))

        resp.set_cookie(
            'team_token',
            token,
            httponly=True,
            samesite='Lax',
            secure=Config.COOKIE_SECURE,
            max_age=86400
        )

        return resp

    return render_template(
        'team_login.html',
        teams=decimal_to_float(teams),
        error=None
    )

@app.route('/team/logout')
def team_logout():
    resp = redirect(url_for('index'))
    resp.delete_cookie('team_token')
    return resp

@app.route('/team')
def team_view():
    token = request.cookies.get('team_token')
    if not token: return redirect(url_for('team_login'))
    team_name = auction.get_team_by_token(token)
    if not team_name: return redirect(url_for('team_login'))
    team_detail    = auction.get_team_detail(team_name)
    current_player = auction.get_next_player()
    teams          = auction.get_all_teams()
    return render_template('team_view.html',
                           team=decimal_to_float(team_detail),
                           current_player=decimal_to_float(current_player),
                           teams=decimal_to_float(teams),
                           team_name=team_name)

# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.route('/dashboard')
def dashboard():
    teams = auction.get_all_teams()
    return render_template('dashboard.html', teams=decimal_to_float(teams))

# ══════════════════════════════════════════════════════════════════════════════
# SSE
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/events')
def sse():
    def generate():
        q = subscribe()
        try:
            yield "event: ping\ndata: {}\n\n"
            t = 0
            while True:
                if q: yield q.pop(0)
                else:
                    time.sleep(0.5); t += 0.5
                    if t >= 30: yield "event: ping\ndata: {}\n\n"; t = 0
        except GeneratorExit: unsubscribe(q)
    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

# ══════════════════════════════════════════════════════════════════════════════
# AUCTIONEER WRITE APIs (protected)
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/sell', methods=['POST'])
def api_sell():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    player_id = data.get('player_id')
    team_name = data.get('team_name', '').strip()
    bid_raw   = data.get('bid_amount')
    if not player_id: return err('player_id is required')
    if not team_name: return err('team_name is required')
    try: player_id = int(player_id)
    except: return err('player_id must be integer')
    try: bid_amount = validate_positive_number(bid_raw, 'bid_amount')
    except ValueError as e2: return err(str(e2))
    result = auction.sell_player(player_id, team_name, bid_amount)
    if not result['success']: return err(result['message'])
    next_player = auction.get_next_player()
    teams = auction.get_all_teams()
    broadcast_event('sale', {'player_id': player_id, 'team_name': team_name,
                              'bid_amount': bid_amount,
                              'next_player': decimal_to_float(next_player),
                              'teams': decimal_to_float(teams)})
    return ok({'message': result['message'],
               'next_player': decimal_to_float(next_player),
               'teams': decimal_to_float(teams)})

@app.route('/api/mark-unsold', methods=['POST'])
def api_mark_unsold():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    try: player_id = int(data.get('player_id'))
    except: return err('player_id required')
    result = auction.mark_player_unsold(player_id)
    if not result['success']: return err(result['message'])
    next_player = auction.get_next_player()
    teams = auction.get_all_teams()
    broadcast_event('unsold', {'player_id': player_id,
                                'next_player': decimal_to_float(next_player),
                                'teams': decimal_to_float(teams)})
    return ok({'message': result['message'],
               'next_player': decimal_to_float(next_player),
               'teams': decimal_to_float(teams)})

@app.route('/api/restore-unsold', methods=['POST'])
def api_restore_unsold():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    try: player_id = int(data.get('player_id'))
    except: return err('player_id required')
    result = auction.restore_unsold_player(player_id)
    if not result['success']: return err(result['message'])
    next_player = auction.get_next_player()
    teams = auction.get_all_teams()
    broadcast_event('restore', {'player_id': player_id,
                                 'next_player': decimal_to_float(next_player),
                                 'teams': decimal_to_float(teams)})
    return ok({'message': result['message'],
               'next_player': decimal_to_float(next_player),
               'teams': decimal_to_float(teams)})

@app.route('/api/cancel-rebid', methods=['POST'])
def api_cancel_rebid():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    try: player_id = int(data.get('player_id'))
    except: return err('player_id required')
    result = auction.cancel_and_rebid(player_id)
    if not result['success']: return err(result['message'])
    next_player = auction.get_next_player()
    teams = auction.get_all_teams()
    broadcast_event('cancel_rebid', {'player_id': player_id,
                                      'next_player': decimal_to_float(next_player),
                                      'teams': decimal_to_float(teams)})
    return ok({'message': result['message'],
               'next_player': decimal_to_float(next_player),
               'teams': decimal_to_float(teams)})

@app.route('/api/undo', methods=['POST'])
def api_undo():
    if (e := require_auctioneer_api()): return e
    result = auction.undo_last_bid()
    if not result['success']: return err(result['message'])
    next_player = auction.get_next_player()
    teams = auction.get_all_teams()
    broadcast_event('undo', {'next_player': decimal_to_float(next_player),
                              'teams': decimal_to_float(teams)})
    return ok({'message': result['message'],
               'next_player': decimal_to_float(next_player),
               'teams': decimal_to_float(teams)})

@app.route('/api/reset', methods=['POST'])
def api_reset():
    if (e := require_auctioneer_api()): return e
    result = auction.reset_auction()
    if not result['success']: return err(result['message'])
    next_player = auction.get_next_player()
    teams = auction.get_all_teams()
    broadcast_event('reset', {'next_player': decimal_to_float(next_player),
                               'teams': decimal_to_float(teams)})
    return ok({'message': result['message'],
               'next_player': decimal_to_float(next_player),
               'teams': decimal_to_float(teams)})

@app.route('/api/deduct-budget', methods=['POST'])
def api_deduct():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    team_name = data.get('team_name', '').strip()
    try: amount = validate_positive_number(data.get('amount'), 'amount')
    except ValueError as e2: return err(str(e2))
    result = auction.deduct_team_budget(team_name, amount)
    if not result['success']: return err(result['message'])
    teams = auction.get_all_teams()
    broadcast_event('budget_deducted', {'team_name': team_name, 'amount': amount,
                                         'teams': decimal_to_float(teams)})
    return ok({'message': result['message'], 'teams': decimal_to_float(teams)})

@app.route('/api/assign-player', methods=['POST'])
def api_assign():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    player_name = data.get('player_name', '').strip()
    role        = data.get('role', '').strip()
    category    = data.get('category', '').strip()
    team_name   = data.get('team_name', '').strip()
    if not player_name: return err('player_name required')
    if not team_name:   return err('team_name required')
    try: bid_amount = validate_positive_number(data.get('bid_amount'), 'bid_amount')
    except ValueError as e2: return err(str(e2))
    result = auction.auctioneer_assign_player(player_name, role, category, team_name, bid_amount)
    if not result['success']: return err(result['message'])
    teams = auction.get_all_teams()
    broadcast_event('player_assigned', {'player_name': player_name, 'team_name': team_name,
                                         'bid_amount': bid_amount,
                                         'teams': decimal_to_float(teams)})
    return ok({'message': result['message'], 'teams': decimal_to_float(teams)})

@app.route('/api/players/add', methods=['POST'])
def api_add_player():
    if (e := require_auctioneer_api()): return e
    data = request.get_json(silent=True) or {}
    name     = data.get('name', '').strip()
    role     = data.get('role', '').strip()
    category = data.get('category', '').strip()
    if not name: return err('Player name required')
    if not role: return err('Role required')
    if not category: return err('Category required')
    try: base_price = validate_positive_number(data.get('base_price'), 'base_price')
    except ValueError as e2: return err(str(e2))
    result = auction.add_player(name, role, category, base_price)
    if not result['success']: return err(result['message'])
    return ok({'message': result['message'], 'player_id': result.get('player_id')})

# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC READ APIs
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/api/teams')
def api_teams():
    return ok({'teams': decimal_to_float(auction.get_all_teams())})

@app.route('/api/teams/<team_name>')
def api_team(team_name):
    team = auction.get_team_detail(team_name)
    if not team: return err('Team not found', 404)
    return ok({'team': decimal_to_float(team)})

@app.route('/api/next-player')
def api_next():
    return ok({'player': decimal_to_float(auction.get_next_player())})

@app.route('/api/unsold-players')
def api_unsold():
    return ok({'players': decimal_to_float(auction.get_all_unsold())})

@app.route('/api/marked-unsold')
def api_marked():
    return ok({'players': decimal_to_float(auction.get_marked_unsold())})

@app.route('/api/sold-players')
def api_sold():
    return ok({'players': decimal_to_float(auction.get_sold_players())})

@app.route('/api/history')
def api_history():
    return ok({'history': decimal_to_float(auction.get_bid_history(20))})

@app.route('/api/last-update')
def api_last_update():
    try:
        ts = auction.get_last_update_timestamp()
        if ts and ts.get('last_update'):
            t = ts['last_update']
            return ok({'timestamp': t.isoformat() if hasattr(t, 'isoformat') else str(t)})
    except: pass
    return ok({'timestamp': None})

# ══════════════════════════════════════════════════════════════════════════════
# RUN
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    print(f"🏏 IPL Auction → http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=Config.DEBUG, threaded=True)
