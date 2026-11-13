# SEAGYM – Gym Website & Membership Management

Professional gym website with public pages and a working staff/member portal.

**Stack:** Node.js 22.5+ · built-in Node.js HTTP server · `node:sqlite` · vanilla HTML/CSS/JS  
**Auth:** Passwords hashed with `crypto.scrypt`. Sessions stored in SQLite (HttpOnly cookie).

## Quick start

```bash
cd sea-gym
npm install          # no external dependencies required
npm start            # http://localhost:3000
```

The database file `seagym.db` is created automatically on first start and persists across restarts.  
Admin and demo accounts are seeded on every start if they do not already exist.

## Logins

| Role   | Username | Password    |
|--------|----------|-------------|
| Admin  | Admin01  | Admin001    |
| Member | demo1    | Demo@12345  |
| Member | demo2    | Demo@12345  |

- **Admin** → `/dashboard` – full member management, registration, stats, renew/freeze/deactivate.
- **Members** → `/member` – view own membership, update contact details only.

Demo credentials are also shown on the login page.

## Public pages

- `/` – Home  
- `/about` – About  
- `/memberships` – Plans & pricing  
- `/facilities` – Facilities overview  
- `/contact` – Contact & hours (placeholders)  
- `/login` – Sign-in  

## Admin capabilities

- Register new members (validated, unique national ID, auto member ID `SEA-XXXXX`, auto end-date calculation)
- Search / filter / sort / paginate members
- Edit member details
- Renew membership (extends from later of today or current end)
- Freeze / unfreeze
- Activate / deactivate
- Delete member
- Live statistics from the database

## Member capabilities

- View member ID, plan, status, expiration
- Update phone, email, emergency contact
- Cannot change plan, status, or access admin routes

## Security notes

- Passwords never stored in plaintext
- Admin API routes require authenticated admin session
- Member routes require authenticated member session
- Session cookie is HttpOnly + SameSite=Lax

## Testing

```bash
npm test             # data-layer unit tests (in-memory DB)
```

Manual checks after `npm start`:

1. Open http://localhost:3000 – public site loads  
2. Login as Admin01 / Admin001 → dashboard stats & member list  
3. Register a new member → appears in list with correct end date  
4. Login as demo1 / Demo@12345 → member portal shows Alex Rivera  
5. Logout → session cleared  
6. Wrong password rejected  
7. Member cannot open `/dashboard` (redirected or 403 on API)

## Project layout

```
sea-gym/
  server.js          Express app, auth middleware, routes
  members.js         SQLite schema, validation, auth, member CRUD
  public/
    index.html       Home
    about.html …     Public pages
    login.html
    dashboard.html   Admin SPA shell
    member.html      Member portal
    styles.css
    app.js           Admin front-end logic
  seagym.db          Created at runtime
```

## Remaining limitations

- Contact details and opening hours on the public site are placeholders (intentionally not invented as real business data).
- No email/SMS notifications.
- No online payment or self-service membership purchase (registration is staff-only, as stated).
- Session store is SQLite (fine for single-instance deployment).
- No rate limiting on login (add in production if exposed publicly).

## Bugs fixed from original project

- Simulated “any password works” login → real scrypt-hashed auth + sessions
- No public website → full public pages with consistent design
- No member accounts or member dashboard → two demo members + personal portal
- No admin credential protection → role-based route guards
- Hardcoded/fake stats → all stats from live queries
- Missing deactivate flow → added activate/deactivate
- Search only name/ID → also email, phone, national ID
