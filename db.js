// Database layer: SQLite via Node's built-in node:sqlite module (no native build step needed).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'campuspulse.db'));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    capacity INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rsvps (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---- Seed data -------------------------------------------------------------

// Demo admin account. Override with ADMIN_EMAIL / ADMIN_PASSWORD environment variables.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@campuspulse.test').trim().toLowerCase();
// The built-in demo password is only used locally; production must set ADMIN_PASSWORD.
const isProd = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim() || (isProd ? null : 'ChangeMe!2026');
if (ADMIN_PASSWORD) {
  console.log(`Admin account: ${ADMIN_EMAIL} (password is ${ADMIN_PASSWORD.length} characters)`);
}

const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
if (!ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD is not set: no admin account was created.');
} else if (existingAdmin) {
  // Keep the admin password in sync with the environment variable.
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?")
    .run(bcrypt.hashSync(ADMIN_PASSWORD, 10), existingAdmin.id);
} else {
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Site Admin', ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin');
}

// Sample events, dated relative to today so the board always has upcoming events.
const eventCount = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
if (eventCount === 0) {
  const daysFromNow = (d, time) => {
    const dt = new Date();
    dt.setDate(dt.getDate() + d);
    const ymd = dt.toISOString().slice(0, 10);
    return `${ymd}T${time}`;
  };
  const samples = [
    ['Fall Career Fair', 'Career', 'University Student Union Ballroom', daysFromNow(3, '10:00'),
      'Meet 60+ employers hiring for internships and full-time roles.',
      'Bring printed resumes and dress business casual. Employers from tech, healthcare, finance and government will be on site. Career Center staff will run a resume review table from 10 to noon. Free LinkedIn headshots all day.',
      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=70', 400],
    ['Intro to Python Workshop', 'Workshop', 'Kellogg Library, Room 3010', daysFromNow(5, '15:00'),
      'A hands-on beginner workshop. No coding experience needed.',
      'Learn variables, loops and functions while building a small data project. Bring a laptop; we will use a browser-based editor so there is nothing to install. Snacks provided by the MIS Club.',
      'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=1200&q=70', 40],
    ['Cougars Basketball Home Opener', 'Athletics', 'The Sports Center', daysFromNow(8, '19:00'),
      'Pack the stands for the first home game of the season.',
      'Free entry with student ID. The first 300 students get a free t-shirt. Doors open at 6:15 PM; the student section is first come, first served.',
      'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=1200&q=70', 1400],
    ['Open Mic Night', 'Arts', 'The Dome Terrace', daysFromNow(11, '18:30'),
      'Music, poetry and comedy from fellow students.',
      'Sign up at the door for a 5-minute slot, or just come to watch. A sound system and acoustic guitar are provided. Hot cocoa bar while supplies last.',
      'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=70', 150],
    ['Finals Week De-Stress Fest', 'Wellness', 'Student Health & Counseling Lawn', daysFromNow(20, '11:00'),
      'Therapy dogs, chair massages and free snacks before finals.',
      'Take a break from studying. Counseling staff will share study and sleep tips, and there will be free healthy snacks, coloring stations and therapy dogs from 11 AM to 2 PM.',
      'https://images.unsplash.com/photo-1544568100-847a948585b9?w=1200&q=70', 300],
    ['Startup Pitch Night', 'Career', 'Markstein Hall 125', daysFromNow(14, '17:30'),
      'Student founders pitch to local investors for $5,000 in prizes.',
      'Eight student teams have five minutes each to pitch. Audience voting picks the People\'s Choice award. Networking reception with local founders follows the pitches.',
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1200&q=70', 120],
  ];
  const insert = db.prepare(`INSERT INTO events
    (title, category, location, starts_at, summary, description, image_url, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const s of samples) insert.run(...s);
}

module.exports = db;
