-- ============================================================
-- ADDITIONS TO EXISTING SCHEMA
-- Run these after the main schema.sql
-- ============================================================
USE ipl_auction;

-- Add is_marked_unsold column to auction_players (separate from is_sold)
ALTER TABLE auction_players 
  ADD COLUMN IF NOT EXISTS is_marked_unsold TINYINT(1) NOT NULL DEFAULT 0 AFTER is_sold,
  ADD COLUMN IF NOT EXISTS unsold_at DATETIME DEFAULT NULL AFTER is_marked_unsold;

-- Table for team sessions (who is logged in as which team)
CREATE TABLE IF NOT EXISTS team_sessions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    team_name   VARCHAR(100) NOT NULL,
    token       VARCHAR(64) NOT NULL UNIQUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (team_name) REFERENCES teams(name) ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_team (team_name)
) ENGINE=InnoDB;

-- Table for auctioneer session
CREATE TABLE IF NOT EXISTS auctioneer_session (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token       VARCHAR(64) NOT NULL UNIQUE,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Unsold players log (for historical tracking)
CREATE TABLE IF NOT EXISTS unsold_log (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id   INT UNSIGNED NOT NULL,
    marked_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES auction_players(id) ON DELETE CASCADE,
    INDEX idx_player (player_id)
) ENGINE=InnoDB;

-- ============================================================
-- STORED PROCEDURE: mark_player_unsold
-- ============================================================
DELIMITER $$

DROP PROCEDURE IF EXISTS mark_player_unsold$$
CREATE PROCEDURE mark_player_unsold(
    IN p_player_id INT UNSIGNED,
    OUT p_success TINYINT,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_is_sold TINYINT DEFAULT 0;
    DECLARE v_is_marked_unsold TINYINT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_success = 0; SET p_message = 'Database error during mark unsold';
    END;

    START TRANSACTION;

    SELECT is_sold, is_marked_unsold INTO v_is_sold, v_is_marked_unsold
    FROM auction_players WHERE id = p_player_id FOR UPDATE;

    IF v_is_sold = 1 THEN
        SET p_success = 0; SET p_message = 'Player is already sold'; ROLLBACK;
    ELSE
        UPDATE auction_players
        SET is_marked_unsold = 1, unsold_at = NOW()
        WHERE id = p_player_id;

        INSERT INTO unsold_log (player_id) VALUES (p_player_id);

        COMMIT;
        SET p_success = 1; SET p_message = 'Player marked as unsold';
    END IF;
END$$

-- ============================================================
-- STORED PROCEDURE: deduct_team_budget
-- ============================================================
DROP PROCEDURE IF EXISTS deduct_team_budget$$
CREATE PROCEDURE deduct_team_budget(
    IN p_team_name VARCHAR(100),
    IN p_amount DECIMAL(6,2),
    IN p_reason VARCHAR(255),
    OUT p_success TINYINT,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_purse DECIMAL(6,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_success = 0; SET p_message = 'Database error during deduction';
    END;

    START TRANSACTION;

    SELECT purse INTO v_purse FROM teams WHERE name = p_team_name FOR UPDATE;

    IF v_purse IS NULL THEN
        SET p_success = 0; SET p_message = 'Team not found'; ROLLBACK;
    ELSEIF p_amount > v_purse THEN
        SET p_success = 0; SET p_message = CONCAT('Insufficient purse. Only ', v_purse, ' Cr left'); ROLLBACK;
    ELSE
        UPDATE teams SET purse = purse - p_amount WHERE name = p_team_name;
        COMMIT;
        SET p_success = 1; SET p_message = CONCAT('Deducted ₹', p_amount, ' Cr from ', p_team_name);
    END IF;
END$$

-- ============================================================
-- STORED PROCEDURE: manually_add_player_to_team (auctioneer override)
-- ============================================================
DROP PROCEDURE IF EXISTS auctioneer_assign_player$$
CREATE PROCEDURE auctioneer_assign_player(
    IN p_player_name VARCHAR(150),
    IN p_role ENUM('Batsman','Bowler','All-Rounder','Wicket-Keeper'),
    IN p_category ENUM('Indian','Overseas'),
    IN p_team_name VARCHAR(100),
    IN p_bid_amount DECIMAL(5,2),
    OUT p_success TINYINT,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_player_id INT UNSIGNED;
    DECLARE v_purse DECIMAL(6,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_success = 0; SET p_message = 'Database error during assignment';
    END;

    START TRANSACTION;

    -- Insert player
    INSERT INTO auction_players (name, role, category, base_price, is_sold, current_bid, current_team)
    VALUES (p_player_name, p_role, p_category, p_bid_amount, 1, p_bid_amount, p_team_name);
    SET v_player_id = LAST_INSERT_ID();

    -- Get team purse
    SELECT purse INTO v_purse FROM teams WHERE name = p_team_name FOR UPDATE;

    IF v_purse IS NULL THEN
        SET p_success = 0; SET p_message = 'Team not found'; ROLLBACK;
    ELSE
        -- Update team stats
        UPDATE teams
        SET purse = purse - p_bid_amount,
            overseas_count = overseas_count + IF(p_category='Overseas',1,0),
            wk_count = wk_count + IF(p_role='Wicket-Keeper',1,0),
            total_players = total_players + 1
        WHERE name = p_team_name;

        -- Log to bid history
        INSERT INTO bid_history (player_id, team_name, bid_amount) VALUES (v_player_id, p_team_name, p_bid_amount);

        COMMIT;
        SET p_success = 1; SET p_message = CONCAT(p_player_name, ' assigned to ', p_team_name);
    END IF;
END$$

-- ============================================================
-- UPDATED reset_auction (also resets unsold markings)
-- ============================================================
DROP PROCEDURE IF EXISTS reset_auction$$
CREATE PROCEDURE reset_auction(
    OUT p_success TINYINT,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_success = 0; SET p_message = 'Reset failed';
    END;

    START TRANSACTION;
    UPDATE auction_players SET is_sold=0, current_bid=NULL, current_team=NULL, is_marked_unsold=0, unsold_at=NULL;
    UPDATE teams SET purse=100.00, overseas_count=0, wk_count=0, total_players=0;
    DELETE FROM bid_history;
    DELETE FROM unsold_log;
    COMMIT;
    SET p_success = 1; SET p_message = 'Auction reset successfully';
END$$

DELIMITER ;
