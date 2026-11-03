-- Auto-created schema for local XAMPP / phpMyAdmin
-- Database: itch_steam_local

CREATE DATABASE IF NOT EXISTS itch_steam_local
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE itch_steam_local;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) DEFAULT NULL,
  avatar_url VARCHAR(512) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Games (like itch.io games)
CREATE TABLE IF NOT EXISTS games (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  short_description VARCHAR(512) DEFAULT NULL,
  description TEXT,
  cover_url VARCHAR(512) DEFAULT NULL,
  price DECIMAL(10,2) DEFAULT 0.00,          -- 0 = free
  developer_name VARCHAR(128) DEFAULT NULL,
  tags VARCHAR(512) DEFAULT NULL,            -- comma-separated
  download_count INT UNSIGNED DEFAULT 0,
  is_published TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_published (is_published),
  INDEX idx_price (price)
) ENGINE=InnoDB;

-- User library (owned / claimed games)
CREATE TABLE IF NOT EXISTS library (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  game_id INT UNSIGNED NOT NULL,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_game (user_id, game_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Simple download links / builds
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

-- Seed some demo games (itch.io style)
INSERT IGNORE INTO games (title, slug, short_description, description, cover_url, price, developer_name, tags) VALUES
('Celeste Classic', 'celeste-classic', 'A challenging precision platformer', 'Climb a mountain and face your inner demons in this tight platformer.', 'https://img.itch.zone/aW1nLzM5NzU2MzEucG5n/original/placeholder.png', 0.00, 'Maddy Makes Games', 'platformer,indie,pixel'),
('Stardew Valley', 'stardew-valley', 'Relaxing farming RPG', 'Build the farm of your dreams and become part of the local community.', 'https://img.itch.zone/aW1nLzM5NzU2MzEucG5n/original/placeholder.png', 14.99, 'ConcernedApe', 'farming,rpg,simulation'),
('Hollow Knight', 'hollow-knight', 'Epic action-adventure', 'Explore a vast interconnected world of insects and heroes.', 'https://img.itch.zone/aW1nLzM5NzU2MzEucG5n/original/placeholder.png', 14.99, 'Team Cherry', 'metroidvania,action,indie'),
('A Short Hike', 'a-short-hike', 'Peaceful exploration', 'Hike, climb, and fly around a lovely mountain in this charming adventure.', 'https://img.itch.zone/aW1nLzM5NzU2MzEucG5n/original/placeholder.png', 7.99, 'adamgryu', 'exploration,relaxing,indie'),
('Undertale', 'undertale', 'The RPG where you don\'t have to kill anyone', 'A unique RPG with a heart.', 'https://img.itch.zone/aW1nLzM5NzU2MzEucG5n/original/placeholder.png', 9.99, 'tobyfox', 'rpg,indie,story'),
('Balatro', 'balatro', 'Poker roguelike', 'Combine poker hands with wild jokers in this addictive deckbuilder.', 'https://img.itch.zone/aW1nLzM5NzU2MzEucG5n/original/placeholder.png', 14.99, 'LocalThunk', 'roguelike,poker,indie');