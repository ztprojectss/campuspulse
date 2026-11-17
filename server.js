const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

const CATEGORIES = ['Academic', 'Arts', 'Athletics', 'Career', 'Social', 'Wellness', 'Workshop'];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieSession({
  name: 'cp_session',
  keys: [process.env.SESSION_SECRET || 'dev-only-secret-change-me'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd,
}));

// Basic security headers
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Current user, flash messages, CSRF token and helpers for every view
app.use((req, res, next) => {
  const s = req.session;
  if (!s.csrf) s.csrf = crypto.randomBytes(24).toString('hex');

  req.user = s.userId
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(s.userId)
    : null;
  if (s.userId && !req.user) s.userId = null;

  res.locals.user = req.user;
  res.locals.csrf = s.csrf;
  res.locals.flash = s.flash || null;
  s.flash = null;
  res.locals.path = req.path;
  res.locals.categories = CATEGORIES;
  res.locals.fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US',
    { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  res.locals.fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
  next();
});

// CSRF check on every form POST
app.use((req, res, next) => {
  if (req.method === 'POST' && req.body._csrf !== req.session.csrf) {
    return res.status(403).render('error', { title: 'Form expired', message: 'Your form session expired. Go back, refresh the page and try again.' });
  }
  next();
});

const flash = (req, type, text) => { req.session.flash = { type, text }; };

function requireLogin(req, res, next) {
  if (!req.user) {
    flash(req, 'info', 'Please log in to continue.');
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Admins only', message: 'You need an admin account to view this page.' });
  }
  next();
}

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/events');
const nowIso = () => new Date().toISOString().slice(0, 16);

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

// Public preview page: anyone can see upcoming event highlights without logging in.
app.get('/', (req, res) => {
  const featured = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvp_count
    FROM events e WHERE starts_at >= ? ORDER BY starts_at LIMIT 3`).all(nowIso());
  const stats = {
    events: db.prepare('SELECT COUNT(*) AS n FROM events WHERE starts_at >= ?').get(nowIso()).n,
    members: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    rsvps: db.prepare('SELECT COUNT(*) AS n FROM rsvps').get().n,
  };
  res.render('index', { title: 'Home', featured, stats });
});

app.get('/events', (req, res) => {
  const q = (req.query.q || '').trim();
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
  const showPast = req.query.past === '1';

  const where = [showPast ? 'starts_at < ?' : 'starts_at >= ?'];
  const params = [nowIso()];
  if (q) { where.push('(title LIKE ? OR summary LIKE ? OR location LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { where.push('category = ?'); params.push(category); }

  const events = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvp_count
    FROM events e WHERE ${where.join(' AND ')} ORDER BY starts_at ${showPast ? 'DESC' : 'ASC'}`).all(...params);
  res.render('events', { title: 'Events', events, q, category, showPast });
});

app.get('/events/:id', (req, res, next) => {
  const event = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvp_count
    FROM events e WHERE id = ?`).get(Number(req.params.id));
  if (!event) return next();
  const going = req.user
    ? !!db.prepare('SELECT 1 FROM rsvps WHERE user_id = ? AND event_id = ?').get(req.user.id, event.id)
    : false;
  res.render('event', { title: event.title, event, going, isPast: event.starts_at < nowIso() });
});

app.post('/events/:id/rsvp', requireLogin, (req, res, next) => {
  const event = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvp_count
    FROM events e WHERE id = ?`).get(Number(req.params.id));
  if (!event) return next();
  const going = db.prepare('SELECT 1 FROM rsvps WHERE user_id = ? AND event_id = ?').get(req.user.id, event.id);
  if (going) {
    db.prepare('DELETE FROM rsvps WHERE user_id = ? AND event_id = ?').run(req.user.id, event.id);
    flash(req, 'info', 'Your RSVP was cancelled.');
  } else if (event.capacity && event.rsvp_count >= event.capacity) {
    flash(req, 'error', 'Sorry, this event is full.');
  } else if (event.starts_at < nowIso()) {
    flash(req, 'error', 'This event has already happened.');
  } else {
    db.prepare('INSERT INTO rsvps (user_id, event_id) VALUES (?, ?)').run(req.user.id, event.id);
    flash(req, 'success', "You're going! See it under My Events.");
  }
  res.redirect(`/events/${event.id}`);
});

app.get('/contact', (req, res) => res.render('contact', { title: 'Contact', form: {}, errors: [] }));

app.post('/contact', (req, res) => {
  const form = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim(),
    subject: (req.body.subject || '').trim(),
    body: (req.body.body || '').trim(),
  };
  const errors = [];
  if (!form.name) errors.push('Name is required.');
  if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.push('A valid email is required.');
  if (!form.subject) errors.push('Subject is required.');
  if (form.body.length < 10) errors.push('Message must be at least 10 characters.');
  if (form.body.length > 3000) errors.push('Message must be under 3000 characters.');
  if (errors.length) return res.status(400).render('contact', { title: 'Contact', form, errors });

  db.prepare('INSERT INTO messages (name, email, subject, body) VALUES (?, ?, ?, ?)')
    .run(form.name, form.email, form.subject, form.body);
  flash(req, 'success', 'Thanks! Your message was sent to the CampusPulse team.');
  res.redirect('/contact');
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/events');
  res.render('register', { title: 'Sign up', form: {}, errors: [] });
});

app.post('/register', (req, res) => {
  const form = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
  };
  const password = req.body.password || '';
  const errors = [];
  if (!form.name) errors.push('Name is required.');
  if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.push('A valid email is required.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== req.body.confirm) errors.push('Passwords do not match.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(form.email)) {
    errors.push('An account with that email already exists.');
  }
  if (errors.length) return res.status(400).render('register', { title: 'Sign up', form, errors });

  const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(form.name, form.email, bcrypt.hashSync(password, 10));
  req.session.userId = Number(result.lastInsertRowid);
  flash(req, 'success', `Welcome to CampusPulse, ${form.name}!`);
  res.redirect('/events');
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/events');
  res.render('login', { title: 'Log in', email: '', error: null, next: safeNext(req.query.next) });
});

app.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const next = safeNext(req.body.next);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    return res.status(401).render('login', { title: 'Log in', email, error: 'Incorrect email or password.', next });
  }
  req.session.userId = user.id;
  flash(req, 'success', `Welcome back, ${user.name}!`);
  res.redirect(user.role === 'admin' && next === '/events' ? '/admin' : next);
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

app.get('/my-events', requireLogin, (req, res) => {
  const events = db.prepare(`SELECT e.* FROM events e JOIN rsvps r ON r.event_id = e.id
    WHERE r.user_id = ? ORDER BY e.starts_at`).all(req.user.id);
  res.render('my-events', { title: 'My Events', events, now: nowIso() });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

app.get('/admin', requireAdmin, (req, res) => {
  const events = db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id) AS rsvp_count
    FROM events e ORDER BY starts_at DESC`).all();
  const messages = db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
  const users = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.created_at,
    (SELECT COUNT(*) FROM rsvps r WHERE r.user_id = u.id) AS rsvp_count FROM users u ORDER BY u.created_at`).all();
  res.render('admin/dashboard', { title: 'Admin', events, messages, users, now: nowIso() });
});

function readEventForm(body) {
  const form = {
    title: (body.title || '').trim(),
    category: body.category,
    location: (body.location || '').trim(),
    starts_at: (body.starts_at || '').trim(),
    summary: (body.summary || '').trim(),
    description: (body.description || '').trim(),
    image_url: (body.image_url || '').trim(),
    capacity: (body.capacity || '').trim(),
  };
  const errors = [];
  if (!form.title) errors.push('Title is required.');
  if (!CATEGORIES.includes(form.category)) errors.push('Choose a category.');
  if (!form.location) errors.push('Location is required.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.starts_at)) errors.push('Date and time are required.');
  if (!form.summary || form.summary.length > 160) errors.push('Summary is required (160 characters max).');
  if (!form.description) errors.push('Description is required.');
  if (form.image_url && !/^https?:\/\/\S+$/.test(form.image_url)) errors.push('Image URL must start with http:// or https://');
  if (form.capacity && !(Number.isInteger(Number(form.capacity)) && Number(form.capacity) > 0)) errors.push('Capacity must be a positive whole number.');
  const values = [form.title, form.category, form.location, form.starts_at, form.summary,
    form.description, form.image_url || null, form.capacity ? Number(form.capacity) : null];
  return { form, errors, values };
}

app.get('/admin/events/new', requireAdmin, (req, res) => {
  res.render('admin/event-form', { title: 'New event', form: {}, errors: [], action: '/admin/events' });
});

app.post('/admin/events', requireAdmin, (req, res) => {
  const { form, errors, values } = readEventForm(req.body);
  if (errors.length) return res.status(400).render('admin/event-form', { title: 'New event', form, errors, action: '/admin/events' });
  db.prepare(`INSERT INTO events (title, category, location, starts_at, summary, description, image_url, capacity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...values);
  flash(req, 'success', `Created "${form.title}".`);
  res.redirect('/admin');
});

app.get('/admin/events/:id/edit', requireAdmin, (req, res, next) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) return next();
  res.render('admin/event-form', { title: 'Edit event', form: event, errors: [], action: `/admin/events/${event.id}` });
});

app.post('/admin/events/:id', requireAdmin, (req, res, next) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id)) return next();
  const { form, errors, values } = readEventForm(req.body);
  if (errors.length) return res.status(400).render('admin/event-form', { title: 'Edit event', form, errors, action: `/admin/events/${id}` });
  db.prepare(`UPDATE events SET title = ?, category = ?, location = ?, starts_at = ?, summary = ?,
    description = ?, image_url = ?, capacity = ?, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  flash(req, 'success', `Saved changes to "${form.title}".`);
  res.redirect('/admin');
});

app.post('/admin/events/:id/delete', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT title FROM events WHERE id = ?').get(Number(req.params.id));
  if (event) {
    db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
    flash(req, 'success', `Deleted "${event.title}".`);
  }
  res.redirect('/admin');
});

app.post('/admin/messages/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(Number(req.params.id));
  flash(req, 'success', 'Message deleted.');
  res.redirect('/admin#messages');
});

app.post('/admin/users/:id/role', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    flash(req, 'error', "You can't change your own role.");
  } else {
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    flash(req, 'success', `User role updated to ${role}.`);
  }
  res.redirect('/admin#users');
});

app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    flash(req, 'error', "You can't delete your own account.");
  } else {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    flash(req, 'success', 'User deleted.');
  }
  res.redirect('/admin#users');
});

// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: "We couldn't find that page." });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
});

app.listen(PORT, () => console.log(`CampusPulse running on http://localhost:${PORT}`));
