// scripts/seed-browsertest.js
// One-shot data for MANUAL browser testing of Phase 5 (time-off/swaps via API)
// and Phase 6 (My Shifts UI). Idempotent — safe to re-run.
//
//   node scripts/seed-browsertest.js
//
// Creates (or refreshes):
//   • Owner  seed-owner@shiftwise.dev / Seeder@ShiftWise1
//   • Business "The Green Cup" + location "Main Branch"
//   • Staff login  staff@shiftwise.dev    / Staff@ShiftWise1  (Alex)
//   • Staff login  coworker@shiftwise.dev / Staff@ShiftWise1  (Bella)
//   • A PUBLISHED schedule for THIS week: Alex Mon+Wed, Bella Mon (same shift)
//   • Metrics for Alex so the reliability strip shows real numbers

'use strict';

if (process.env.NODE_ENV === 'production') throw new Error('do not run in production');
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Business = require('../models/Business');
const Location = require('../models/Location');
const StaffMember = require('../models/StaffMember');
const Availability = require('../models/Availability');
const Schedule = require('../models/Schedule');
const Shift = require('../models/Shift');
const StaffMetrics = require('../models/StaffMetrics');

const OWNER = {
  email: 'seed-owner@shiftwise.dev',
  password: 'Seeder@ShiftWise1',
  name: 'Sam Owner',
};
const STAFF = [
  {
    email: 'staff@shiftwise.dev',
    password: 'Staff@ShiftWise1',
    name: 'Alex Barista',
    role: 'barista',
  },
  {
    email: 'coworker@shiftwise.dev',
    password: 'Staff@ShiftWise1',
    name: 'Bella Barista',
    role: 'barista',
  },
];

async function upsertUser({ email, password, name }) {
  let u = await User.findOne({ email });
  if (!u) u = await User.create({ email, password, name, isVerified: true, role: 'user' });
  return u;
}

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI not set');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected');

    const ownerUser = await upsertUser(OWNER);
    let business = await Business.findOne({ ownerId: ownerUser._id });
    if (!business) {
      business = await Business.create({
        name: 'The Green Cup',
        ownerId: ownerUser._id,
        settings: { timezone: 'Asia/Kolkata', currency: 'INR', weekStartsOn: 0 },
        onboarding: { completed: true },
      });
    }
    let location = await Location.findOne({ businessId: business._id, name: 'Main Branch' });
    if (!location) {
      location = await Location.create({
        businessId: business._id,
        name: 'Main Branch',
        timezone: 'Asia/Kolkata',
        settings: {
          shiftTypes: [
            { name: 'Morning', startTime: '07:00', endTime: '13:00' },
            { name: 'Afternoon', startTime: '13:00', endTime: '19:00' },
          ],
          minStaffPerShift: 1,
          maxStaffPerShift: 4,
        },
      });
    }

    // Staff with real logins, linked to StaffMember records
    const staffMembers = [];
    for (const s of STAFF) {
      const u = await upsertUser(s);
      let sm = await StaffMember.findOne({ businessId: business._id, userId: u._id });
      if (!sm) {
        sm = await StaffMember.create({
          businessId: business._id,
          name: s.name,
          email: s.email,
          userId: u._id,
          role: s.role,
          accountStatus: 'active',
          isActive: true,
          locationIds: [location._id],
        });
      }
      staffMembers.push(sm);
    }
    const [alex, bella] = staffMembers;

    // Full-week availability for both (so the engine passes on swap approval).
    const allDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      available: true,
      preferredStart: '07:00',
      preferredEnd: '19:00',
    }));
    for (const sm of staffMembers) {
      await Availability.deleteMany({ staffId: sm._id, locationId: location._id });
      await Availability.create({
        staffId: sm._id,
        locationId: location._id,
        recurring: { slots: allDays },
      });
    }

    // THIS week's Sunday → Monday/Wednesday (business weekStartsOn = 0)
    const now = new Date();
    const sun = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay())
    );
    const mon = new Date(sun.getTime() + 1 * 86400000);
    const wed = new Date(sun.getTime() + 3 * 86400000);

    // Fresh published schedule for this week (wipe any prior browsertest one)
    await Schedule.deleteMany({ businessId: business._id, periodStart: sun });
    const schedule = await Schedule.create({
      businessId: business._id,
      locationId: location._id,
      periodStart: sun,
      periodEnd: new Date(sun.getTime() + 7 * 86400000 - 1),
      status: 'published',
    });
    await Shift.deleteMany({ scheduleId: schedule._id });
    const mk = (staffId, date, startTime, endTime, shiftType) => ({
      scheduleId: schedule._id,
      businessId: business._id,
      locationId: location._id,
      staffId,
      date,
      startTime,
      endTime,
      shiftType,
    });
    await Shift.insertMany([
      mk(alex._id, mon, '07:00', '13:00', 'morning'), // Alex + Bella together
      mk(bella._id, mon, '07:00', '13:00', 'morning'),
      mk(alex._id, wed, '13:00', '19:00', 'afternoon'), // Alex solo
    ]);

    // Metrics so Alex's reliability strip isn't blank (100 - 5*1 = 95)
    const period = { year: now.getFullYear(), month: now.getMonth() + 1 };
    await StaffMetrics.updateOne(
      {
        staffId: alex._id,
        locationId: location._id,
        'period.year': period.year,
        'period.month': period.month,
      },
      {
        $set: {
          totalHours: 120,
          coversCompleted: 2,
          lateArrivals: 1,
          noShows: 0,
          reliabilityScore: 95,
        },
      },
      { upsert: true }
    );

    console.log('\n✅ Browser-test data ready');
    console.log('   OWNER : seed-owner@shiftwise.dev / Seeder@ShiftWise1');
    console.log(
      '   STAFF : staff@shiftwise.dev      / Staff@ShiftWise1  (Alex — has Mon+Wed shifts)'
    );
    console.log(
      '   STAFF : coworker@shiftwise.dev   / Staff@ShiftWise1  (Bella — Mon shift with Alex)'
    );
    console.log(`   Week of ${sun.toISOString().slice(0, 10)} · Alex staffId ${alex._id}`);
    console.log(`   Shift IDs for API testing: run GET /my/shifts as Alex to see them.`);
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
})();
