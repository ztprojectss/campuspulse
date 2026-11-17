# CampusPulse: Campus Events Board

CampusPulse is a full-stack web app where students find campus events (career fairs, games, workshops, open mics) and RSVP to them. Administrators manage the event calendar, read contact messages, and manage user accounts.

## Features

| Requirement | How CampusPulse meets it |
|---|---|
| **User login & authentication** | Sign up, log in and log out. Passwords are hashed with bcrypt. Sessions use signed, HTTP-only cookies. Every form has CSRF protection. Pages are restricted by role (`user` / `admin`). |
| **Admin features (add / edit / delete)** | The `/admin` dashboard lets admins create, edit and delete events, read and delete contact messages, and promote, demote or delete users. |
| **Contact information** | The `/contact` page shows email, phone, office location and hours, plus a contact form that saves messages to the database for admins to read. Contact info also appears in the footer of every page. |
| **Public preview page** | The home page and event listings are public. Visitors see each event's title, date, location and short summary. The full description and the RSVP button unlock after login. |
| **Responsive design** | Custom CSS grid and flexbox layout with a mobile hamburger menu. On phones, the admin tables turn into stacked cards. |

Members also get **search and category filters**, **RSVPs with capacity limits**, and a **My Events** page.

## Tech stack

- **Backend:** Node.js, Express
- **Database:** SQLite (Node's built-in `node:sqlite`)
- **Views:** EJS server-rendered templates
- **Auth:** bcryptjs + cookie-session
- **Hosting:** Render (configured in `render.yaml`)

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Local demo admin: `admin@campuspulse.test` / `ChangeMe!2026`. This default only works locally. In production you must set `ADMIN_PASSWORD`.

## Deploy (Render)

1. Sign in at https://render.com with GitHub.
2. Click **New → Blueprint**, then pick this repository.
3. When asked, enter an `ADMIN_PASSWORD`, then click **Apply**.

Note: Render's free tier sleeps after 15 minutes of inactivity, so the first visit can take about 30 seconds. Its disk is temporary, so the database resets to the sample data on each redeploy or restart.

## Project structure

```
server.js        Express routes: public pages, auth, RSVP, admin CRUD
db.js            SQLite schema and seed data
views/           EJS templates (partials/, admin/)
public/          CSS and images
render.yaml      Render deployment blueprint
```
