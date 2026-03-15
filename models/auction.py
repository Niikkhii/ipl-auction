"""
Business logic layer - pure functions that interact with the DB layer.
"""
from models.db import query_one, query_all, call_procedure, get_connection


# ── Players ──────────────────────────────────────────────────────────────────

def get_next_player() -> dict | None:
    """Return the next player that is neither sold nor marked unsold."""
    return query_one(
        "SELECT id, name, role, category, base_price FROM auction_players "
        "WHERE is_sold = 0 AND is_marked_unsold = 0 ORDER BY id LIMIT 1"
    )


def get_all_unsold() -> list[dict]:
    """Players manually added to queue via Add to Queue tool, not yet sold."""
    return query_all(
        "SELECT id, name, role, category, base_price FROM auction_players "
        "WHERE is_sold = 0 AND is_marked_unsold = 0 AND manually_queued = 1 ORDER BY id"
    )


def get_marked_unsold() -> list[dict]:
    """Players explicitly marked as unsold by auctioneer."""
    return query_all(
        "SELECT id, name, role, category, base_price, unsold_at FROM auction_players "
        "WHERE is_marked_unsold = 1 ORDER BY unsold_at DESC, id"
    )


def get_sold_players() -> list[dict]:
    return query_all(
        "SELECT ap.id, ap.name, ap.role, ap.category, ap.current_bid, ap.current_team "
        "FROM auction_players ap WHERE ap.is_sold = 1 ORDER BY ap.current_team, ap.name"
    )


# ── Teams ─────────────────────────────────────────────────────────────────────

def get_all_teams() -> list[dict]:
    return query_all(
        "SELECT id, name, short_code, purse, overseas_count, wk_count, total_players "
        "FROM teams ORDER BY name"
    )


def get_team_squad(team_name: str) -> list[dict]:
    return query_all(
        "SELECT name, role, category, current_bid FROM auction_players "
        "WHERE current_team = %s AND is_sold = 1 ORDER BY role, name",
        (team_name,)
    )


def get_team_detail(team_name: str) -> dict | None:
    team = query_one(
        "SELECT name, short_code, purse, overseas_count, wk_count, total_players "
        "FROM teams WHERE name = %s",
        (team_name,)
    )
    if team:
        team['players'] = get_team_squad(team_name)
    return team


# ── Auction Actions ───────────────────────────────────────────────────────────

def sell_player(player_id: int, team_name: str, bid_amount: float) -> dict:
    return call_procedure('sell_player', (player_id, team_name, bid_amount))


def mark_player_unsold(player_id: int) -> dict:
    """ Mark a player as unsold (skip them for now)."""
    return call_procedure('mark_player_unsold', (player_id,))


def undo_last_bid() -> dict:
    return call_procedure('undo_last_bid')


def reset_auction() -> dict:
    return call_procedure('reset_auction')


def cancel_and_rebid(player_id: int) -> dict:
    """Cancel the last sale of a specific player and put them back up for auction."""
    conn = get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT id, name, current_team, current_bid, category, role "
            "FROM auction_players WHERE id = %s AND is_sold = 1",
            (player_id,)
        )
        player = cur.fetchone()
        if not player:
            return {'success': False, 'message': 'Player not found or not currently sold'}

        team_name = player['current_team']
        bid_amount = float(player['current_bid'])
        category = player['category']
        role = player['role']

        cur.execute(
            "DELETE FROM bid_history WHERE player_id = %s AND team_name = %s "
            "ORDER BY timestamp DESC, id DESC LIMIT 1",
            (player_id, team_name)
        )
        cur.execute(
            "UPDATE auction_players SET is_sold=0, current_bid=NULL, current_team=NULL, "
            "is_marked_unsold=0, unsold_at=NULL WHERE id = %s",
            (player_id,)
        )
        cur.execute(
            "UPDATE teams SET "
            "purse = purse + %s, "
            "overseas_count = GREATEST(0, overseas_count - IF(%s='Overseas', 1, 0)), "
            "wk_count = GREATEST(0, wk_count - IF(%s='Wicket-Keeper', 1, 0)), "
            "total_players = GREATEST(0, total_players - 1) "
            "WHERE name = %s",
            (bid_amount, category, role, team_name)
        )
        conn.commit()
        return {
            'success': True,
            'message': f"{player['name']} cancelled from {team_name} — back up for auction"
        }
    except Exception as e:
        conn.rollback()
        return {'success': False, 'message': str(e)}
    finally:
        conn.close()


def restore_unsold_player(player_id: int) -> dict:
    """Restore a marked-unsold player back into the auction queue."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE auction_players SET is_marked_unsold=0, unsold_at=NULL, manually_queued=1 WHERE id=%s AND is_sold=0",
            (player_id,)
        )
        cur.execute("DELETE FROM unsold_log WHERE player_id=%s", (player_id,))
        conn.commit()
        if cur.rowcount == 0:
            return {'success': False, 'message': 'Player not found or already sold'}
        return {'success': True, 'message': 'Player restored to auction queue'}
    except Exception as e:
        conn.rollback()
        return {'success': False, 'message': str(e)}
    finally:
        conn.close()


def deduct_team_budget(team_name: str, amount: float) -> dict:
    """Auctioneer manually deducts budget from a team."""
    return call_procedure('deduct_team_budget', (team_name, amount, ''))


def auctioneer_assign_player(player_name: str, role: str, category: str,
                              team_name: str, bid_amount: float) -> dict:
    """Auctioneer manually adds a player directly to a team."""
    valid_roles = ['Batsman', 'Bowler', 'All-Rounder', 'Wicket-Keeper']
    if role not in valid_roles:
        return {'success': False, 'message': f'Invalid role. Must be one of: {", ".join(valid_roles)}'}
    if category not in ['Indian', 'Overseas']:
        return {'success': False, 'message': 'Category must be Indian or Overseas'}
    return call_procedure('auctioneer_assign_player', (player_name, role, category, team_name, bid_amount))


# ── Bid History ───────────────────────────────────────────────────────────────

def get_bid_history(limit: int = 20) -> list[dict]:
    return query_all(
        "SELECT bh.id, ap.name AS player_name, ap.role, ap.category, "
        "       bh.team_name, bh.bid_amount, bh.timestamp "
        "FROM bid_history bh "
        "JOIN auction_players ap ON ap.id = bh.player_id "
        "ORDER BY bh.timestamp DESC, bh.id DESC LIMIT %s",
        (limit,)
    )


# ── Player Management ───────────────────────────────────────────────────────────

def add_player(name: str, role: str, category: str, base_price: float) -> dict:
    valid_roles = ['Batsman', 'Bowler', 'All-Rounder', 'Wicket-Keeper']
    if role not in valid_roles:
        return {'success': False, 'message': f'Invalid role. Must be one of: {", ".join(valid_roles)}'}
    if category not in ['Indian', 'Overseas']:
        return {'success': False, 'message': 'Category must be Indian or Overseas'}
    if base_price <= 0:
        return {'success': False, 'message': 'Base price must be greater than 0'}

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO auction_players (name, role, category, base_price, manually_queued) VALUES (%s, %s, %s, %s, 1)",
            (name.strip(), role, category, base_price)
        )
        conn.commit()
        player_id = cur.lastrowid
        return {'success': True, 'message': f'Player {name} added successfully', 'player_id': player_id}
    except Exception as e:
        conn.rollback()
        return {'success': False, 'message': f'Failed to add player: {str(e)}'}
    finally:
        conn.close()


def get_last_update_timestamp() -> dict | None:
    return query_one("SELECT MAX(timestamp) as last_update FROM bid_history")


def get_all_players(include_sold: bool = True) -> list[dict]:
    if include_sold:
        return query_all(
            "SELECT id, name, role, category, base_price, is_sold, is_marked_unsold, current_team, current_bid "
            "FROM auction_players ORDER BY id"
        )
    else:
        return query_all(
            "SELECT id, name, role, category, base_price, is_sold, is_marked_unsold, current_team, current_bid "
            "FROM auction_players WHERE is_sold = 0 AND is_marked_unsold = 0 ORDER BY id"
        )


# ── Sessions ──────────────────────────────────────────────────────────────────
def create_team_session(team_name: str) -> str | None:
    import secrets

    team = query_one("SELECT id FROM teams WHERE name=%s", (team_name,))
    if not team:
        return None

    team_id = team['id']
    token = secrets.token_hex(32)

    conn = get_connection()
    try:
        cur = conn.cursor()

        cur.execute("DELETE FROM team_sessions WHERE team_id = %s", (team_id,))
        cur.execute(
            "INSERT INTO team_sessions (team_id, session_token) VALUES (%s,%s)",
            (team_id, token)
        )

        conn.commit()
        return token
    except Exception:
        conn.rollback()
        return None
    finally:
        conn.close()


def get_team_by_token(token: str) -> str | None:
    row = query_one(
        "SELECT t.name FROM team_sessions ts "
        "JOIN teams t ON ts.team_id = t.id "
        "WHERE ts.session_token = %s",
        (token,)
    )
    return row['name'] if row else None


def get_auctioneer_token() -> str:
    import secrets
    row = query_one("SELECT token FROM auctioneer_session LIMIT 1")
    if row:
        return row['token']
    token = secrets.token_hex(32)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO auctioneer_session (token) VALUES (%s)", (token,))
        conn.commit()
        return token
    except Exception:
        conn.rollback()
        return token
    finally:
        conn.close()


def validate_auctioneer_token(token: str) -> bool:
    row = query_one("SELECT id FROM auctioneer_session WHERE token = %s", (token,))
    return row is not None


def get_connected_teams() -> list[dict]:
    return query_all(
        "SELECT t.name AS team_name, ts.created_at "
        "FROM team_sessions ts "
        "JOIN teams t ON ts.team_id = t.id "
        "ORDER BY t.name"
    )
