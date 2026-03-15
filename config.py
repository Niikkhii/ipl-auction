import os

class Config:
    # Database
    MYSQL_HOST     = os.getenv('MYSQL_HOST',     'localhost')
    MYSQL_PORT     = int(os.getenv('MYSQL_PORT', 3306))
    MYSQL_USER     = os.getenv('MYSQL_USER',     'root')
    MYSQL_PASSWORD = os.getenv['MYSQL_PASSWORD']   # ← your local password
    MYSQL_DATABASE = os.getenv('MYSQL_DATABASE', 'ipl_auction')
    POOL_SIZE      = int(os.getenv('DB_POOL_SIZE', 5))
    POOL_TIMEOUT   = 30
    # App
    SECRET_KEY          = os.getenv('SECRET_KEY', 'ipl-auction-secret-change-in-prod')
    DEBUG               = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    AUCTIONEER_PASSWORD = os.getenv('AUCTIONEER_PASSWORD', 'auction2025')

    # True on Railway (HTTPS), False locally (HTTP)
    COOKIE_SECURE = os.getenv('RAILWAY_ENVIRONMENT') is not None
