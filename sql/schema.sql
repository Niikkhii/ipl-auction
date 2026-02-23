-- ============================================================
-- IPL Auction Management System - Complete MySQL Schema
-- ============================================================

DROP DATABASE IF EXISTS ipl_auction;
CREATE DATABASE ipl_auction CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ipl_auction;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE teams (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    short_code  VARCHAR(5)  NOT NULL UNIQUE,
    purse       DECIMAL(6,2) NOT NULL DEFAULT 100.00 COMMENT 'Remaining purse in Crores',
    overseas_count INT NOT NULL DEFAULT 0,
    wk_count    INT NOT NULL DEFAULT 0,
    total_players INT NOT NULL DEFAULT 0,
    INDEX idx_name (name)
) ENGINE=InnoDB;

CREATE TABLE auction_players (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(150) NOT NULL,
    role          ENUM('Batsman','Bowler','All-Rounder','Wicket-Keeper') NOT NULL,
    category      ENUM('Indian','Overseas') NOT NULL DEFAULT 'Indian',
    base_price    DECIMAL(5,2) NOT NULL COMMENT 'Base price in Crores',
    current_bid   DECIMAL(5,2) DEFAULT NULL,
    current_team  VARCHAR(100) DEFAULT NULL,
    is_sold       TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (current_team) REFERENCES teams(name) ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_is_sold (is_sold),
    INDEX idx_role (role)
) ENGINE=InnoDB;

CREATE TABLE bid_history (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id   INT UNSIGNED NOT NULL,
    team_name   VARCHAR(100) NOT NULL,
    bid_amount  DECIMAL(5,2) NOT NULL,
    timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES auction_players(id) ON DELETE CASCADE,
    INDEX idx_timestamp (timestamp DESC)
) ENGINE=InnoDB;

-- ============================================================
-- STORED PROCEDURES
-- ============================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS sell_player$$
CREATE PROCEDURE sell_player(
    IN p_player_id INT UNSIGNED,
    IN p_team_name VARCHAR(100),
    IN p_bid_amount DECIMAL(5,2),
    OUT p_success TINYINT,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_is_sold       TINYINT DEFAULT 0;
    DECLARE v_category      VARCHAR(20);
    DECLARE v_role          VARCHAR(30);
    DECLARE v_purse         DECIMAL(6,2);
    DECLARE v_overseas      INT;
    DECLARE v_base_price    DECIMAL(5,2);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_success = 0;
        SET p_message = 'Database error during sell operation';
    END;

    START TRANSACTION;

    SELECT is_sold, category, role, base_price
    INTO v_is_sold, v_category, v_role, v_base_price
    FROM auction_players WHERE id = p_player_id FOR UPDATE;

    SELECT purse, overseas_count
    INTO v_purse, v_overseas
    FROM teams WHERE name = p_team_name FOR UPDATE;

    IF v_is_sold = 1 THEN
        SET p_success = 0; SET p_message = 'Player is already sold'; ROLLBACK;
    ELSEIF p_bid_amount < v_base_price THEN
        SET p_success = 0; SET p_message = CONCAT('Bid must be >= base price of ', v_base_price, ' Cr'); ROLLBACK;
    ELSEIF p_bid_amount > v_purse THEN
        SET p_success = 0; SET p_message = CONCAT('Insufficient purse. Only ', v_purse, ' Cr left'); ROLLBACK;
    ELSEIF v_category = 'Overseas' AND v_overseas >= 8 THEN
        SET p_success = 0; SET p_message = 'Max 8 Overseas players reached'; ROLLBACK;
    ELSE
        UPDATE auction_players
        SET is_sold=1, current_bid=p_bid_amount, current_team=p_team_name
        WHERE id=p_player_id;

        UPDATE teams
        SET purse          = purse - p_bid_amount,
            overseas_count = overseas_count + IF(v_category='Overseas',1,0),
            wk_count       = wk_count + IF(v_role='Wicket-Keeper',1,0),
            total_players  = total_players + 1
        WHERE name=p_team_name;

        INSERT INTO bid_history (player_id, team_name, bid_amount)
        VALUES (p_player_id, p_team_name, p_bid_amount);

        COMMIT;
        SET p_success = 1; SET p_message = 'Player sold successfully';
    END IF;
END$$

DROP PROCEDURE IF EXISTS undo_last_bid$$
CREATE PROCEDURE undo_last_bid(
    OUT p_success TINYINT,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_bid_id     INT UNSIGNED DEFAULT NULL;
    DECLARE v_player_id  INT UNSIGNED;
    DECLARE v_team_name  VARCHAR(100);
    DECLARE v_bid_amount DECIMAL(5,2);
    DECLARE v_category   VARCHAR(20);
    DECLARE v_role       VARCHAR(30);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_success = 0; SET p_message = 'Database error during undo';
    END;

    START TRANSACTION;

    SELECT id, player_id, team_name, bid_amount
    INTO v_bid_id, v_player_id, v_team_name, v_bid_amount
    FROM bid_history ORDER BY timestamp DESC, id DESC LIMIT 1 FOR UPDATE;

    IF v_bid_id IS NULL THEN
        SET p_success = 0; SET p_message = 'No sales to undo'; ROLLBACK;
    ELSE
        SELECT category, role INTO v_category, v_role
        FROM auction_players WHERE id = v_player_id;

        UPDATE auction_players
        SET is_sold=0, current_bid=NULL, current_team=NULL
        WHERE id=v_player_id;

        UPDATE teams
        SET purse          = purse + v_bid_amount,
            overseas_count = GREATEST(0, overseas_count - IF(v_category='Overseas',1,0)),
            wk_count       = GREATEST(0, wk_count - IF(v_role='Wicket-Keeper',1,0)),
            total_players  = GREATEST(0, total_players - 1)
        WHERE name=v_team_name;

        DELETE FROM bid_history WHERE id=v_bid_id;
        COMMIT;
        SET p_success = 1; SET p_message = 'Last sale undone';
    END IF;
END$$

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
    UPDATE auction_players SET is_sold=0, current_bid=NULL, current_team=NULL;
    UPDATE teams SET purse=100.00, overseas_count=0, wk_count=0, total_players=0;
    DELETE FROM bid_history;
    COMMIT;
    SET p_success = 1; SET p_message = 'Auction reset successfully';
END$$

DELIMITER ;

-- ============================================================
-- SAMPLE DATA
-- ============================================================

INSERT INTO teams (name, short_code) VALUES
('Mumbai Indians',              'MI'),
('Chennai Super Kings',         'CSK'),
('Royal Challengers Bengaluru', 'RCB'),
('Kolkata Knight Riders',       'KKR'),
('Delhi Capitals',              'DC'),
('Sunrisers Hyderabad',         'SRH'),
('Rajasthan Royals',            'RR'),
('Punjab Kings',                'PBKS'),
('Lucknow Super Giants',        'LSG'),
('Gujarat Titans',              'GT');

INSERT INTO auction_players (name, role, category, base_price) VALUES
('Cameron Green','All-Rounder','Overseas',2.00),
('Virat Kohli','Batsman','Indian',2.00),
('Shubman Gill','Batsman','Indian',2.00),
('Rohit Sharma','Batsman','Indian',2.00),
('Yashasvi Jaiswal','Batsman','Indian',1.50),
('Suryakumar Yadav','Batsman','Indian',2.00),
('Ruturaj Gaikwad','Batsman','Indian',1.00),
('KL Rahul','Wicket-Keeper','Indian',2.00),
('Jos Buttler','Wicket-Keeper','Overseas',2.00),
('Faf du Plessis','Batsman','Overseas',2.00),
('David Warner','Batsman','Overseas',2.00),
('Devon Conway','Wicket-Keeper','Overseas',1.00),
('Travis Head','Batsman','Overseas',2.00),
('Rinku Singh','Batsman','Indian',1.00),
('Sai Sudharsan','Batsman','Indian',0.75),
('Tilak Varma','Batsman','Indian',0.50),
('Rishabh Pant','Wicket-Keeper','Indian',2.00),
('Ishan Kishan','Wicket-Keeper','Indian',2.00),
('Nicholas Pooran','Wicket-Keeper','Overseas',2.00),
('Heinrich Klaasen','Wicket-Keeper','Overseas',1.50),
('MS Dhoni','Wicket-Keeper','Indian',2.00),
('Phil Salt','Wicket-Keeper','Overseas',1.50),
('Jitesh Sharma','Wicket-Keeper','Indian',0.75),
('Jasprit Bumrah','Bowler','Indian',2.00),
('Mohammed Shami','Bowler','Indian',2.00),
('Mitchell Starc','Bowler','Overseas',2.00),
('Pat Cummins','Bowler','Overseas',2.00),
('Kagiso Rabada','Bowler','Overseas',2.00),
('Trent Boult','Bowler','Overseas',2.00),
('Josh Hazlewood','Bowler','Overseas',2.00),
('Bhuvneshwar Kumar','Bowler','Indian',1.00),
('Anrich Nortje','Bowler','Overseas',1.50),
('Jofra Archer','Bowler','Overseas',2.00),
('Arshdeep Singh','Bowler','Indian',1.00),
('Mohammed Siraj','Bowler','Indian',1.00),
('Harshal Patel','Bowler','Indian',1.00),
('Deepak Chahar','Bowler','Indian',1.00),
('Avesh Khan','Bowler','Indian',0.75),
('T Natarajan','Bowler','Indian',1.00),
('Rashid Khan','Bowler','Overseas',2.00),
('Yuzvendra Chahal','Bowler','Indian',1.50),
('Kuldeep Yadav','Bowler','Indian',1.50),
('Sunil Narine','Bowler','Overseas',1.00),
('Ravichandran Ashwin','Bowler','Indian',1.00),
('Wanindu Hasaranga','Bowler','Overseas',1.50),
('Ravi Bishnoi','Bowler','Indian',1.00),
('Varun Chakravarthy','Bowler','Indian',1.00),
('Maheesh Theekshana','Bowler','Overseas',0.75),
('Hardik Pandya','All-Rounder','Indian',2.00),
('Ravindra Jadeja','All-Rounder','Indian',2.00),
('Andre Russell','All-Rounder','Overseas',2.00),
('Glenn Maxwell','All-Rounder','Overseas',2.00),
('Marcus Stoinis','All-Rounder','Overseas',1.50),
('Mitchell Marsh','All-Rounder','Overseas',1.50),
('Moeen Ali','All-Rounder','Overseas',1.00),
('Sam Curran','All-Rounder','Overseas',2.00),
('Axar Patel','All-Rounder','Indian',1.00),
('Shivam Dube','All-Rounder','Indian',0.75),
('Krunal Pandya','All-Rounder','Indian',0.75),
('Nehal Wadhera','Batsman','Indian',0.30),
('Abhishek Sharma','All-Rounder','Indian',0.50),
('Rahul Tripathi','Batsman','Indian',0.75),
('Prithvi Shaw','Batsman','Indian',0.50),
('Mayank Agarwal','Batsman','Indian',1.00),
('Shardul Thakur','Bowler','Indian',1.00),
('Umran Malik','Bowler','Indian',0.75),
('Kuldeep Sen','Bowler','Indian',0.50),
('Mayank Markande','Bowler','Indian',0.50),
('Shreyas Gopal','Bowler','Indian',0.50),
('Washington Sundar','All-Rounder','Indian',0.75),
('Riyan Parag','All-Rounder','Indian',0.50),
('Quinton de Kock','Wicket-Keeper','Overseas',2.00),
('Kane Williamson','Batsman','Overseas',2.00),
('Shreyas Iyer','Batsman','Indian',2.00),
('Nitish Rana','Batsman','Indian',1.00),
('Angkrish Raghuvanshi','Batsman','Indian',0.30),
('Harry Brook','Batsman','Overseas',2.00),
('Aiden Markram','All-Rounder','Overseas',1.50),
('Shimron Hetmyer','Batsman','Overseas',1.50),
('Jake Fraser-McGurk','Batsman','Overseas',0.75),
('Devdutt Padikkal','Batsman','Indian',1.00),
('Manish Pandey','Batsman','Indian',0.50),
('Karun Nair','Batsman','Indian',0.30),
('Rahmanullah Gurbaz','Wicket-Keeper','Overseas',1.00),
('Dhruv Jurel','Wicket-Keeper','Indian',0.75),
('Tristan Stubbs','Wicket-Keeper','Overseas',1.00),
('Anuj Rawat','Wicket-Keeper','Indian',0.30),
('KS Bharat','Wicket-Keeper','Indian',0.30),
('Robin Minz','Wicket-Keeper','Indian',0.30),
('Lockie Ferguson','Bowler','Overseas',1.50),
('Gerald Coetzee','Bowler','Overseas',1.50),
('Reece Topley','Bowler','Overseas',0.75),
('Alzarri Joseph','Bowler','Overseas',1.50),
('Prasidh Krishna','Bowler','Indian',1.00),
('Mukesh Kumar','Bowler','Indian',0.75),
('Sandeep Sharma','Bowler','Indian',0.75),
('Umesh Yadav','Bowler','Indian',0.75),
('Jaydev Unadkat','Bowler','Indian',0.75),
('Chetan Sakariya','Bowler','Indian',0.50),
('Murugan Ashwin','Bowler','Indian',0.50),
('Kumar Kartikeya','Bowler','Indian',0.50),
('Shahbaz Ahmed','Bowler','Indian',0.50),
('Marco Jansen','All-Rounder','Overseas',1.00),
('Romario Shepherd','All-Rounder','Overseas',0.75),
('Vijay Shankar','All-Rounder','Indian',0.75),
('Abdul Samad','All-Rounder','Indian',0.50),
('Shahrukh Khan','All-Rounder','Indian',0.50),
('Raj Angad Bawa','All-Rounder','Indian',0.30),
('Odean Smith','All-Rounder','Overseas',0.75),
('Sarfaraz Khan','Batsman','Indian',0.50),
('Priyam Garg','Batsman','Indian',0.30),
('Abhinav Manohar','Batsman','Indian',0.30),
('Sameer Rizvi','Batsman','Indian',0.30),
('Ashutosh Sharma','Batsman','Indian',0.30),
('Harnoor Singh','Batsman','Indian',0.30),
('Musheer Khan','Batsman','Indian',0.30),
('Atharva Taide','Batsman','Indian',0.30),
('Subhranshu Senapati','Batsman','Indian',0.30),
('Anmolpreet Singh','Batsman','Indian',0.30),
('Rajat Patidar','Batsman','Indian',1.00),
('Nehal Wadhera','Batsman','Indian',0.30),
('Abhishek Sharma','All-Rounder','Indian',0.50),
('Rahul Tripathi','Batsman','Indian',0.75),
('Prithvi Shaw','Batsman','Indian',0.50),
('Mayank Agarwal','Batsman','Indian',1.00),
('Shardul Thakur','Bowler','Indian',1.00),
('Umran Malik','Bowler','Indian',0.75),
('Kuldeep Sen','Bowler','Indian',0.50),
('Mayank Markande','Bowler','Indian',0.50),
('Shreyas Gopal','Bowler','Indian',0.50),
('Washington Sundar','All-Rounder','Indian',0.75),
('Riyan Parag','All-Rounder','Indian',0.50),
('Quinton de Kock','Wicket-Keeper','Overseas',2.00),
('Kane Williamson','Batsman','Overseas',2.00),
('Shreyas Iyer','Batsman','Indian',2.00),
('Nitish Rana','Batsman','Indian',1.00),
('Angkrish Raghuvanshi','Batsman','Indian',0.30),
('Harry Brook','Batsman','Overseas',2.00),
('Aiden Markram','All-Rounder','Overseas',1.50),
('Shimron Hetmyer','Batsman','Overseas',1.50),
('Jake Fraser-McGurk','Batsman','Overseas',0.75),
('Devdutt Padikkal','Batsman','Indian',1.00),
('Manish Pandey','Batsman','Indian',0.50),
('Karun Nair','Batsman','Indian',0.30),
('Rahmanullah Gurbaz','Wicket-Keeper','Overseas',1.00),
('Dhruv Jurel','Wicket-Keeper','Indian',0.75),
('Tristan Stubbs','Wicket-Keeper','Overseas',1.00),
('Anuj Rawat','Wicket-Keeper','Indian',0.30),
('KS Bharat','Wicket-Keeper','Indian',0.30),
('Robin Minz','Wicket-Keeper','Indian',0.30),
('Lockie Ferguson','Bowler','Overseas',1.50),
('Gerald Coetzee','Bowler','Overseas',1.50),
('Reece Topley','Bowler','Overseas',0.75),
('Alzarri Joseph','Bowler','Overseas',1.50),
('Prasidh Krishna','Bowler','Indian',1.00),
('Mukesh Kumar','Bowler','Indian',0.75),
('Sandeep Sharma','Bowler','Indian',0.75),
('Umesh Yadav','Bowler','Indian',0.75),
('Jaydev Unadkat','Bowler','Indian',0.75),
('Chetan Sakariya','Bowler','Indian',0.50),
('Murugan Ashwin','Bowler','Indian',0.50),
('Kumar Kartikeya','Bowler','Indian',0.50),
('Shahbaz Ahmed','Bowler','Indian',0.50),
('Marco Jansen','All-Rounder','Overseas',1.00),
('Romario Shepherd','All-Rounder','Overseas',0.75),
('Vijay Shankar','All-Rounder','Indian',0.75),
('Abdul Samad','All-Rounder','Indian',0.50),
('Shahrukh Khan','All-Rounder','Indian',0.50),
('Raj Angad Bawa','All-Rounder','Indian',0.30),
('Odean Smith','All-Rounder','Overseas',0.75),
('Sarfaraz Khan','Batsman','Indian',0.50),
('Priyam Garg','Batsman','Indian',0.30),
('Abhinav Manohar','Batsman','Indian',0.30),
('Sameer Rizvi','Batsman','Indian',0.30),
('Ashutosh Sharma','Batsman','Indian',0.30),
('Harnoor Singh','Batsman','Indian',0.30),
('Musheer Khan','Batsman','Indian',0.30),
('Atharva Taide','Batsman','Indian',0.30),
('Subhranshu Senapati','Batsman','Indian',0.30),
('Anmolpreet Singh','Batsman','Indian',0.30),
('Rajat Patidar','Batsman','Indian',1.00),
('Shubham Dubey','Batsman','Indian',0.30),
('Nehal Wadhera','Batsman','Indian',0.30),
('Ramandeep Singh','Batsman','Indian',0.30),
('Harshit Rana','Batsman','Indian',0.30),
('Finn Allen','Batsman','Overseas',1.00),
('Rassie van der Dussen','Batsman','Overseas',1.50),
('Daryl Mitchell','Batsman','Overseas',1.50),
('Tom Kohler-Cadmore','Batsman','Overseas',0.75),
('Colin Munro','Batsman','Overseas',1.00),
('Alex Hales','Batsman','Overseas',1.50),
('Steve Smith','Batsman','Overseas',2.00),
('Joe Root','Batsman','Overseas',2.00),
('David Malan','Batsman','Overseas',1.50),
('Charith Asalanka','Batsman','Overseas',0.75),
('Ben Duckett','Wicket-Keeper','Overseas',1.00),
('Josh Inglis','Wicket-Keeper','Overseas',1.00),
('Matthew Wade','Wicket-Keeper','Overseas',1.00),
('Tim Seifert','Wicket-Keeper','Overseas',0.75),
('Tom Banton','Wicket-Keeper','Overseas',0.75),
('Narayan Jagadeesan','Wicket-Keeper','Indian',0.30),
('Luvnith Sisodia','Wicket-Keeper','Indian',0.30),
('Aryan Juyal','Wicket-Keeper','Indian',0.30),
('Prabhsimran Singh','Wicket-Keeper','Indian',0.30),
('Kumar Kushagra','Wicket-Keeper','Indian',0.30),
('Akash Deep','Bowler','Indian',0.50),
('Rajvardhan Hangargekar','Bowler','Indian',0.30),
('Vaibhav Arora','Bowler','Indian',0.30),
('Simarjeet Singh','Bowler','Indian',0.30),
('Yudhvir Singh','Bowler','Indian',0.30),
('Shivam Mavi','Bowler','Indian',0.75),
('Basil Thampi','Bowler','Indian',0.30),
('Arjun Tendulkar','Bowler','Indian',0.30),
('Vijaykumar Vyshak','Bowler','Indian',0.30),
('Kartik Tyagi','Bowler','Indian',0.50),
('Mustafizur Rahman','Bowler','Overseas',2.00),
('Naveen Ul Haq','Bowler','Overseas',2.00),
('Jason Behrendorff','Bowler','Overseas',1.00),
('Chris Jordan','Bowler','Overseas',1.50),
('Obed McCoy','Bowler','Overseas',1.00),
('Blessing Muzarabani','Bowler','Overseas',0.75),
('Josh Little','Bowler','Overseas',1.00),
('Dilshan Madushanka','Bowler','Overseas',1.00),
('Nuwan Thushara','Bowler','Overseas',0.75),
('Dushmantha Chameera','Bowler','Overseas',1.00),
('Piyush Chawla','Bowler','Indian',0.50),
('Sai Kishore','Bowler','Indian',0.75),
('Rahul Chahar','Bowler','Indian',1.00),
('Noor Ahmad','Bowler','Overseas',1.00),
('Manav Suthar','Bowler','Indian',0.30),
('Anukul Roy','Bowler','Indian',0.30),
('Mayank Dagar','Bowler','Indian',0.30),
('Tanveer Sangha','Bowler','Overseas',0.75),
('Mujeeb Ur Rahman','Bowler','Overseas',1.50),
('Nitish Kumar Reddy','All-Rounder','Indian',0.30),
('Washington Sundar','All-Rounder','Indian',0.75),
('Riyan Parag','All-Rounder','Indian',0.50),
('Deepak Hooda','All-Rounder','Indian',1.00),
('Ben Stokes','All-Rounder','Overseas',2.00),
('Jason Holder','All-Rounder','Overseas',1.50),
('Chris Woakes','All-Rounder','Overseas',1.50),
('Daniel Sams','All-Rounder','Overseas',0.75),
('Azmatullah Omarzai','All-Rounder','Overseas',0.75),
('Mohammad Nabi','All-Rounder','Overseas',1.00),
('Mitchell Santner','All-Rounder','Overseas',1.00),
('Dwaine Pretorius','All-Rounder','Overseas',0.75),
('Fabian Allen','All-Rounder','Overseas',0.75),
('Sherfane Rutherford','All-Rounder','Overseas',0.75),
('Abhimanyu Easwaran','Batsman','Indian',0.30),
('Rohan Kunnummal','Batsman','Indian',0.30),
('Priyansh Arya','Batsman','Indian',0.30),
('Smaran Ravichandran','Batsman','Indian',0.30),
('Shashwat Rawat','Batsman','Indian',0.30),
('Andre Siddarth','Batsman','Indian',0.30),
('Kedar Jadhav','Batsman','Indian',0.50),
('Murali Vijay','Batsman','Indian',0.50),
('Cheteshwar Pujara','Batsman','Indian',0.75),
('Hanuma Vihari','Batsman','Indian',0.50),
('Ravikumar Samarth','Batsman','Indian',0.30),
('Manan Vohra','Batsman','Indian',0.30),
('Siddhesh Lad','Batsman','Indian',0.30),
('Tanmay Agarwal','Batsman','Indian',0.30),
('James Vince','Batsman','Overseas',1.00),
('Martin Guptill','Batsman','Overseas',1.00),
('Aaron Finch','Batsman','Overseas',1.00),
('Temba Bavuma','Batsman','Overseas',1.00),
('Pathum Nissanka','Batsman','Overseas',0.75),
('Rahmat Shah','Batsman','Overseas',0.50),
('Litton Das','Wicket-Keeper','Overseas',1.00),
('Shai Hope','Wicket-Keeper','Overseas',1.00),
('Kyle Mayers','All-Rounder','Overseas',1.00),
('Upendra Yadav','Wicket-Keeper','Indian',0.30),
('Sheldon Jackson','Wicket-Keeper','Indian',0.30),
('Baba Indrajith','Wicket-Keeper','Indian',0.30),
('Vishnu Solanki','Wicket-Keeper','Indian',0.30),
('Ricky Bhui','Wicket-Keeper','Indian',0.30),
('Ishant Sharma','Bowler','Indian',0.75),
('Varun Aaron','Bowler','Indian',0.50),
('Siddarth Kaul','Bowler','Indian',0.50),
('Mohit Sharma','Bowler','Indian',0.75),
('Khaleel Ahmed','Bowler','Indian',0.75),
('Aniket Choudhary','Bowler','Indian',0.30),
('Sushant Mishra','Bowler','Indian',0.30),
('Arzan Nagwaswalla','Bowler','Indian',0.30),
('Rasikh Salam','Bowler','Indian',0.30),
('Kulwant Khejroliya','Bowler','Indian',0.30),
('Chama Milind','Bowler','Indian',0.30),
('Aman Khan','Bowler','Indian',0.30),
('Lalit Yadav','All-Rounder','Indian',0.30),
('Sean Abbott','Bowler','Overseas',1.00),
('Richard Gleeson','Bowler','Overseas',0.75),
('Tymal Mills','Bowler','Overseas',1.00),
('Adam Milne','Bowler','Overseas',1.00),
('Tim Southee','Bowler','Overseas',1.50),
('Kane Richardson','Bowler','Overseas',1.00),
('Scott Kuggeleijn','Bowler','Overseas',0.75),
('Taskin Ahmed','Bowler','Overseas',0.75),
('Matt Henry','Bowler','Overseas',1.00),
('Reece Meredith','Bowler','Overseas',0.75),
('Hrithik Shokeen','Bowler','Indian',0.30),
('Akash Singh','Bowler','Indian',0.30),
('Ankit Rajpoot','Bowler','Indian',0.50),
('Sandeep Warrier','Bowler','Indian',0.50),
('Vishnu Vinod','Wicket-Keeper','Indian',0.30),
('Suyash Sharma','Bowler','Indian',0.30),
('Harshit Bisht','Bowler','Indian',0.30),
('Shivank Vashisht','Bowler','Indian',0.30),
('Akash Madhwal','Bowler','Indian',0.50),
('Harvik Desai','Wicket-Keeper','Indian',0.30),
('Ankush Bains','Wicket-Keeper','Indian',0.30),
('Aayush Badoni','All-Rounder','Indian',0.30),
('Prince Yadav','Bowler','Indian',0.30),
('Mukhtar Hussain','Bowler','Indian',0.30),
('Arpit Guleria','Bowler','Indian',0.30),
('Rahul Shukla','Bowler','Indian',0.30),
('Chirag Jani','All-Rounder','Indian',0.30),
('Tanush Kotian','All-Rounder','Indian',0.30),
('Abid Mushtaq','Bowler','Indian',0.30),
('Mohit Avasthi','Bowler','Indian',0.30),
('Sanjay Yadav','All-Rounder','Indian',0.30),
('Hiten Dalal','Batsman','Indian',0.30),
('Vikrant Singh','Bowler','Indian',0.30)