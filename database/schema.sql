-- Auto-created schema for local XAMPP / phpMyAdmin
-- Database: itch_steam_local
-- На практике схему создаёт и мигрирует web/db.php — этот файл для справки
-- и ручного развёртывания через phpMyAdmin.

CREATE DATABASE IF NOT EXISTS itch_steam_local
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE itch_steam_local;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','developer','user') NOT NULL DEFAULT 'user',
  balance INT NOT NULL DEFAULT 0,
  avatar VARCHAR(10) NOT NULL DEFAULT '',
  avatar_color VARCHAR(7) NOT NULL DEFAULT '#ef5b2c',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Sessions (авторизация по куке catio_sid)
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  ip VARCHAR(45) NOT NULL,
  user_agent VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Games & asset packs (category: game | asset)
CREATE TABLE IF NOT EXISTS games (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL DEFAULT '',
  short_description VARCHAR(512) DEFAULT NULL,
  description TEXT,
  developer VARCHAR(255) NOT NULL DEFAULT '',
  developer_name VARCHAR(128) DEFAULT NULL,
  price DECIMAL(10,2) DEFAULT 0.00,          -- 0 = free
  category ENUM('game','asset') NOT NULL DEFAULT 'game',
  genre VARCHAR(100) NOT NULL DEFAULT '',
  tags VARCHAR(512) DEFAULT NULL,            -- comma-separated
  cover VARCHAR(255) NOT NULL DEFAULT '',
  cover_url VARCHAR(512) DEFAULT NULL,
  cover_emoji VARCHAR(8) NOT NULL DEFAULT '🎮',
  cover_color VARCHAR(7) NOT NULL DEFAULT '#ef5b2c',
  rating DECIMAL(3,1) NOT NULL DEFAULT 0.0,
  download_count INT UNSIGNED DEFAULT 0,
  is_published TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_genre (genre),
  INDEX idx_category (category),
  INDEX idx_published (is_published),
  INDEX idx_price (price)
) ENGINE=InnoDB;

-- User library (owned / claimed games and assets)
CREATE TABLE IF NOT EXISTS library (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  game_id INT UNSIGNED NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_played TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uniq_user_game (user_id, game_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Download links / builds
CREATE TABLE IF NOT EXISTS game_builds (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id INT UNSIGNED NOT NULL,
  platform ENUM('windows','linux','mac','web') DEFAULT 'windows',
  version VARCHAR(32) DEFAULT '1.0',
  file_url VARCHAR(512) NOT NULL,
  file_size_bytes BIGINT UNSIGNED DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Screenshots for game pages (itch.io style)
CREATE TABLE IF NOT EXISTS game_screenshots (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id INT UNSIGNED NOT NULL,
  image_url VARCHAR(512) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  INDEX idx_game (game_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Comments on game pages
CREATE TABLE IF NOT EXISTS comments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_game (game_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Ratings (1-5, one per user per game)
CREATE TABLE IF NOT EXISTS ratings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  game_id INT UNSIGNED NOT NULL,
  value TINYINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_game (user_id, game_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Purchase history
CREATE TABLE IF NOT EXISTS purchases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  game_id INT UNSIGNED NOT NULL,
  price_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;
