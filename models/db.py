"""
Database connection pool and query helpers.
All queries use parameterised statements to prevent SQL injection.
"""
import mysql.connector
from mysql.connector import pooling
from config import Config


_pool: pooling.MySQLConnectionPool | None = None


def get_pool() -> pooling.MySQLConnectionPool:
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="ipl_pool",
            pool_size=Config.POOL_SIZE,
            pool_reset_session=True,
            host=Config.MYSQL_HOST,
            port=Config.MYSQL_PORT,
            user=Config.MYSQL_USER,
            password=Config.MYSQL_PASSWORD,
            database=Config.MYSQL_DATABASE,
            charset='utf8mb4',
            autocommit=False,
        )
    return _pool


def get_connection():
    """Borrow a connection from the pool."""
    return get_pool().get_connection()


def query_one(sql: str, params: tuple = ()) -> dict | None:
    """Return a single row as a dict or None."""
    conn = get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params)
        return cur.fetchone()
    finally:
        conn.close()


def query_all(sql: str, params: tuple = ()) -> list[dict]:
    """Return all rows as a list of dicts."""
    conn = get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params)
        return cur.fetchall()
    finally:
        conn.close()


def call_procedure(proc_name: str, in_args: tuple = ()) -> dict:
    """
    Call a stored procedure that has OUT parameters.
    Returns {'success': bool, 'message': str}
    Convention: last two OUT params are always p_success (TINYINT) and p_message (VARCHAR).
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        # Build args list; placeholders for OUT params as None
        args = list(in_args) + [0, '']
        result_args = cur.callproc(proc_name, args)
        conn.commit()
        # OUT params come back in result_args positionally
        success = bool(result_args[-2])
        message = result_args[-1]
        return {'success': success, 'message': message}
    except Exception as e:
        conn.rollback()
        return {'success': False, 'message': str(e)}
    finally:
        conn.close()
