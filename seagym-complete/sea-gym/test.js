'use strict';
// Data-layer tests (run with: npm test). Uses a throw-away in-memory database.
process.env.DB_FILE = ':memory:';
const assert = require('node:assert');
const m = require('./members');

(async () => {
  // Seed must run after require (tables created)
  await m.seed();

  // Admin exists
  const admin = await m.authenticate('Admin01', 'Admin001');
  assert.ok(admin, 'admin login works');
  assert.equal(admin.role, 'admin');

  // Wrong password fails
  assert.equal(await m.authenticate('Admin01', 'wrong'), null);

  // Demo members
  const d1 = await m.authenticate('demo1', 'Demo@12345');
  assert.ok(d1 && d1.role === 'member');
  const mem1 = m.getMemberForUser(d1);
  assert.ok(mem1 && mem1.full_name === 'Alex Rivera');

  // Member CRUD
  const d = {
    full_name: 'Test One', national_id: 'AB12345', phone: '01012345678',
    dob: '1990-01-01', gender: 'Male', type: '3 Months',
    start_date: new Date().toISOString().slice(0, 10)
  };
  assert.equal(m.addMonths('2026-01-31', 1), '2026-02-28');
  const r = m.createMember(d);
  assert.equal(r.member.member_id, 'SEA-00003'); // after two demos
  assert.equal(r.member.status, 'Active');
  assert.ok(m.createMember(d).errors.national_id, 'duplicate ID blocked');
  assert.ok(m.createMember({ ...d, national_id: 'X', phone: 'abc' }).errors.phone);

  assert.equal(m.setFrozen(r.member.id, true).status, 'Frozen');
  assert.equal(m.setFrozen(r.member.id, false).status, 'Active');

  assert.ok(m.listMembers({ q: 'sea-' }).total >= 1);
  const e = m.renew(r.member.id, 'Yearly');
  assert.ok(e.end_date > r.member.end_date);

  assert.ok(m.stats().total >= 3);
  assert.ok(m.removeMember(r.member.id));
  console.log('All data-layer tests passed');
})().catch(err => { console.error(err); process.exit(1); });
