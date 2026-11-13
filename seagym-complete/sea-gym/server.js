'use strict';
/**
 * SEAGYM – pure Node.js HTTP server (no Express dependency required).
 * Same API and behaviour as the Express version.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const m = require('./members');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const COOKIE = 'seagym_session';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('=') || '');
  });
  return out;
}

function setCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': headers['Content-Type'] || 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { message: 'Not found.' });
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 50 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function getUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = m.getSession(cookies[COOKIE]);
  return session;
}

const PAGES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/dashboard': 'dashboard.html',
  '/member': 'member.html',
  '/about': 'about.html',
  '/memberships': 'memberships.html',
  '/facilities': 'facilities.html',
  '/contact': 'contact.html'
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = u.pathname;
    const method = req.method || 'GET';

    // Static files under /styles.css, /app.js etc.
    if (method === 'GET' && !pathname.startsWith('/api')) {
      if (PAGES[pathname]) {
        return sendFile(res, path.join(PUBLIC, PAGES[pathname]));
      }
      const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(PUBLIC, safe);
      if (filePath.startsWith(PUBLIC) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return sendFile(res, filePath);
      }
    }

    // API
    if (pathname.startsWith('/api')) {
      const user = await getUser(req);
      const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);

      // Auth
      if (pathname === '/api/login' && method === 'POST') {
        const { username, password } = body;
        if (!username || !password) return send(res, 400, { message: 'Username and password are required.' });
        const authUser = await m.authenticate(username, password);
        if (!authUser) return send(res, 401, { message: 'Invalid username or password.' });
        const session = m.createSession(authUser.id);
        setCookie(res, session.token, session.expires_at);
        const payload = { username: authUser.username, role: authUser.role, member_row_id: authUser.member_row_id };
        if (authUser.role === 'member' && authUser.member_row_id) payload.member = m.getMember(authUser.member_row_id);
        return send(res, 200, { ok: true, user: payload });
      }

      if (pathname === '/api/logout' && method === 'POST') {
        const cookies = parseCookies(req.headers.cookie);
        if (cookies[COOKIE]) m.destroySession(cookies[COOKIE]);
        clearCookie(res);
        return send(res, 200, { ok: true });
      }

      if (pathname === '/api/me' && method === 'GET') {
        if (!user) return send(res, 401, { message: 'Not signed in.' });
        const payload = { username: user.username, role: user.role, member_row_id: user.member_row_id };
        if (user.role === 'member' && user.member_row_id) payload.member = m.getMember(user.member_row_id);
        return send(res, 200, { user: payload });
      }

      if (pathname === '/api/plans' && method === 'GET') {
        return send(res, 200, Object.keys(m.MONTHS).map(t => ({ type: t, months: m.MONTHS[t], price: m.PLAN_PRICES[t] })));
      }

      // Member self
      if (pathname === '/api/my-membership' && method === 'GET') {
        if (!user) return send(res, 401, { message: 'Please sign in.' });
        if (user.role !== 'member') return send(res, 403, { message: 'Member access required.' });
        const mem = m.getMemberForUser(user);
        if (!mem) return send(res, 404, { message: 'No membership linked to this account.' });
        return send(res, 200, mem);
      }

      if (pathname === '/api/my-profile' && method === 'PUT') {
        if (!user) return send(res, 401, { message: 'Please sign in.' });
        if (user.role !== 'member') return send(res, 403, { message: 'Member access required.' });
        const mem = m.getMemberForUser(user);
        if (!mem) return send(res, 404, { message: 'No membership linked.' });
        const allowed = {
          full_name: body.full_name ?? mem.full_name,
          phone: body.phone ?? mem.phone,
          email: body.email ?? mem.email,
          national_id: mem.national_id,
          dob: mem.dob,
          gender: mem.gender,
          type: mem.type,
          ec_name: body.ec_name ?? mem.ec_name,
          ec_phone: body.ec_phone ?? mem.ec_phone,
          notes: mem.notes
        };
        const r = m.updateMember(mem.id, allowed);
        if (r.errors) return send(res, 422, { message: 'Please correct the highlighted fields.', errors: r.errors });
        return send(res, 200, r.member);
      }

      // Admin guards for the rest
      const requireAdmin = () => {
        if (!user) { send(res, 401, { message: 'Please sign in.' }); return false; }
        if (user.role !== 'admin') { send(res, 403, { message: 'Admin access required.' }); return false; }
        return true;
      };

      if (pathname === '/api/stats' && method === 'GET') {
        if (!requireAdmin()) return;
        return send(res, 200, m.stats());
      }

      if (pathname === '/api/members' && method === 'GET') {
        if (!requireAdmin()) return;
        return send(res, 200, m.listMembers(Object.fromEntries(u.searchParams)));
      }

      if (pathname === '/api/members' && method === 'POST') {
        if (!requireAdmin()) return;
        const r = m.createMember(body);
        if (r.errors) return send(res, 422, { message: 'Please correct the highlighted fields.', errors: r.errors });
        return send(res, 201, r.member);
      }

      const memMatch = pathname.match(/^\/api\/members\/(\d+)(\/(\w+))?$/);
      if (memMatch) {
        if (!requireAdmin()) return;
        const id = Number(memMatch[1]);
        const action = memMatch[3];

        if (!action && method === 'GET') {
          const r = m.getMember(id);
          return r ? send(res, 200, r) : send(res, 404, { message: 'Member not found.' });
        }
        if (!action && method === 'PUT') {
          const r = m.updateMember(id, body);
          if (r.notFound) return send(res, 404, { message: 'Member not found.' });
          if (r.errors) return send(res, 422, { message: 'Please correct the highlighted fields.', errors: r.errors });
          return send(res, 200, r.member);
        }
        if (!action && method === 'DELETE') {
          return m.removeMember(id) ? send(res, 200, { ok: true }) : send(res, 404, { message: 'Member not found.' });
        }
        if (action === 'renew' && method === 'POST') {
          const r = m.renew(id, body.type);
          return r ? send(res, 200, r) : send(res, 404, { message: 'Member not found.' });
        }
        if (action === 'freeze' && method === 'POST') {
          const mem = m.getMember(id);
          return mem ? send(res, 200, m.setFrozen(id, true)) : send(res, 404, { message: 'Member not found.' });
        }
        if (action === 'unfreeze' && method === 'POST') {
          const mem = m.getMember(id);
          return mem ? send(res, 200, m.setFrozen(id, false)) : send(res, 404, { message: 'Member not found.' });
        }
        if (action === 'deactivate' && method === 'POST') {
          const mem = m.getMember(id);
          return mem ? send(res, 200, m.setActive(id, false)) : send(res, 404, { message: 'Member not found.' });
        }
        if (action === 'activate' && method === 'POST') {
          const mem = m.getMember(id);
          return mem ? send(res, 200, m.setActive(id, true)) : send(res, 404, { message: 'Member not found.' });
        }
      }

      return send(res, 404, { message: 'Unknown API route.' });
    }

    send(res, 404, { message: 'Not found.' });
  } catch (err) {
    console.error(err);
    send(res, 500, { message: 'Server error. Please try again.' });
  }
});

(async () => {
  try { await m.seed(); } catch (e) { console.error('Seed error:', e); }
  server.listen(PORT, () => console.log(`SEAGYM running on http://localhost:${PORT}`));
})();
