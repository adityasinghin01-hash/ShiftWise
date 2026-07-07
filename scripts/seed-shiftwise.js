// scripts/seed-shiftwise.js
// Seeds a realistic ShiftWise dev dataset: 1 business, 2 locations, 8 staff,
// varied availability, and some prior metrics to exercise fairness scoring.
// §9 Phase 0 — Foundation
//
// Usage: node scripts/seed-shiftwise.js
// Safe to re-run — wipes existing seed data by owner email before re-seeding.
// NEVER runs in production (throws immediately if NODE_ENV === 'production').

'use strict';

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed-shiftwise.js must NOT run in production');
}

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Business = require('../models/Business');
const Location = require('../models/Location');
const StaffMember = require('../models/StaffMember');
const Availability = require('../models/Availability');
const StaffMetrics = require('../models/StaffMetrics');

// ── Seed config ───────────────────────────────────────────
const OWNER_EMAIL = 'seed-owner@shiftwise.dev';
const OWNER_PASSWORD = 'Seeder@ShiftWise1';

const run = async () => {
  let failed = false;
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI not set');
    console.log('Connecting…');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected');

    // ── 1. Clean up previous seed run ────────────────────
    // Sequential + scoped: avoid the race of querying ids while deleting their
    // parents, and never wipe availability/metrics belonging to other dev data.
    const oldOwner = await User.findOne({ email: OWNER_EMAIL });
    if (oldOwner) {
      const oldBiz = await Business.findOne({ ownerId: oldOwner._id });
      if (oldBiz) {
        const bizId = oldBiz._id;
        // Collect the ids we are about to remove so child records can be scoped.
        const locationIds = await Location.find({ businessId: bizId }).distinct('_id');
        const staffIds = await StaffMember.find({ businessId: bizId }).distinct('_id');

        // Delete children first (scoped to this business's staff/locations only)
        await StaffMetrics.deleteMany({
          $or: [{ staffId: { $in: staffIds } }, { locationId: { $in: locationIds } }],
        });
        await Availability.deleteMany({ staffId: { $in: staffIds } });
        await StaffMember.deleteMany({ businessId: bizId });
        await Location.deleteMany({ businessId: bizId });
        await Business.deleteOne({ _id: bizId });
      }
      await User.deleteOne({ _id: oldOwner._id });
      console.log('🧹 Previous seed data cleaned');
    }

    // ── 2. Owner user ─────────────────────────────────────
    // Pass PLAINTEXT password — the User model's pre('save') hook hashes it once.
    // Pre-hashing here would double-hash and silently break login.
    const owner = await User.create({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      name: 'Sam Owner',
      isVerified: true,
      role: 'user',
    });

    // ── 3. Business ───────────────────────────────────────
    const business = await Business.create({
      name: 'The Green Cup',
      ownerId: owner._id,
      settings: { timezone: 'Asia/Kolkata', currency: 'INR', weekStartsOn: 0 },
      onboarding: { completed: true },
    });
    const bizId = business._id;
    console.log(`✅ Business: ${business.name}`);

    // ── 4. Locations ──────────────────────────────────────
    const shiftTypes = [
      { name: 'Morning', startTime: '07:00', endTime: '13:00', color: '#f59e0b' },
      { name: 'Afternoon', startTime: '13:00', endTime: '19:00', color: '#4ea864' },
      { name: 'Evening', startTime: '19:00', endTime: '23:00', color: '#7c3aed' },
    ];

    const [locA, locB] = await Location.insertMany([
      {
        businessId: bizId,
        name: 'Main Branch',
        address: '12 MG Road, Bangalore',
        timezone: 'Asia/Kolkata',
        settings: {
          shiftTypes,
          minStaffPerShift: 2,
          maxStaffPerShift: 4,
          maxHoursPerWeek: 40,
          minRestHours: 8,
          maxDaysConsecutive: 5,
        },
      },
      {
        businessId: bizId,
        name: 'Airport Kiosk',
        address: 'T2 Terminal, BIAL',
        timezone: 'Asia/Kolkata',
        settings: { shiftTypes, minStaffPerShift: 1, maxStaffPerShift: 2, maxHoursPerWeek: 40 },
      },
    ]);
    console.log(`✅ Locations: ${locA.name}, ${locB.name}`);

    // ── 5. Staff members ──────────────────────────────────
    // Mix of account statuses, employment types, and history for realistic testing
    const staffData = [
      {
        name: 'Alex Barista',
        email: 'alex@shiftwise.dev',
        role: 'barista',
        hourlyRate: 250,
        accountStatus: 'active',
        employmentType: 'full-time',
        maxHoursPerWeek: 40,
      },
      {
        name: 'Priya Shift',
        email: 'priya@shiftwise.dev',
        role: 'barista',
        hourlyRate: 250,
        accountStatus: 'active',
        employmentType: 'part-time',
        maxHoursPerWeek: 20,
      },
      {
        name: 'Ravi Manager',
        email: 'ravi@shiftwise.dev',
        role: 'supervisor',
        hourlyRate: 350,
        accountStatus: 'active',
        employmentType: 'full-time',
        maxHoursPerWeek: 40,
      },
      {
        name: 'Noor Casual',
        email: 'noor@shiftwise.dev',
        role: 'barista',
        hourlyRate: 200,
        accountStatus: 'active',
        employmentType: 'casual',
        maxHoursPerWeek: 24,
      },
      {
        name: 'Dev Invited',
        email: 'dev@shiftwise.dev',
        role: 'barista',
        hourlyRate: 200,
        accountStatus: 'invited',
        employmentType: 'casual',
        maxHoursPerWeek: 24,
      },
      {
        name: 'Sam Record',
        email: 'samr@shiftwise.dev',
        role: 'cashier',
        hourlyRate: 200,
        accountStatus: 'none',
        employmentType: 'casual',
        maxHoursPerWeek: 20,
        manuallyManaged: true,
      },
      {
        name: 'Tina Weekend',
        email: 'tina@shiftwise.dev',
        role: 'barista',
        hourlyRate: 220,
        accountStatus: 'active',
        employmentType: 'part-time',
        maxHoursPerWeek: 16,
      },
      {
        name: 'Omar Cover',
        email: 'omar@shiftwise.dev',
        role: 'barista',
        hourlyRate: 230,
        accountStatus: 'active',
        employmentType: 'full-time',
        maxHoursPerWeek: 40,
      },
    ];

    const staff = await StaffMember.insertMany(
      staffData.map((s) => ({ ...s, businessId: bizId, locationIds: [locA._id] }))
    );
    console.log(`✅ ${staff.length} staff members seeded`);

    // ── 6. Availability (for active staff) ────────────────
    // dayOfWeek: 0=Mon … 6=Sun
    const availSlotsFull = [0, 1, 2, 3, 4].map((d) => ({
      dayOfWeek: d,
      available: true,
      preferredStart: '07:00',
      preferredEnd: '19:00',
    }));
    const availSlotsPartTime = [1, 3, 5].map((d) => ({ dayOfWeek: d, available: true }));
    const availSlotsTina = [5, 6].map((d) => ({ dayOfWeek: d, available: true })); // weekends only

    const activeStaff = staff.filter((s) => s.accountStatus === 'active');
    const availDocs = activeStaff.map((s, i) => ({
      staffId: s._id,
      locationId: locA._id,
      recurring: {
        slots:
          i % 3 === 0
            ? availSlotsPartTime
            : s.name.includes('Tina')
              ? availSlotsTina
              : availSlotsFull,
      },
    }));
    await Availability.insertMany(availDocs);
    console.log(`✅ Availability seeded for ${availDocs.length} staff`);

    // ── 7. Prior metrics (gives the algorithm history to score with) ──
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // Omar has high reliability (cover hero); Alex has average; Tina has a no-show
    const metricsSeed = [
      {
        staffId: staff[0]._id,
        locationId: locA._id,
        totalHours: 160,
        weekendHours: 20,
        nightHours: 8,
        noShows: 0,
        lateArrivals: 1,
        coversCompleted: 1,
        reliabilityScore: 93,
      },
      {
        staffId: staff[7]._id,
        locationId: locA._id,
        totalHours: 155,
        weekendHours: 10,
        nightHours: 18,
        noShows: 0,
        lateArrivals: 0,
        coversCompleted: 4,
        reliabilityScore: 100,
      },
      {
        staffId: staff[6]._id,
        locationId: locA._id,
        totalHours: 60,
        weekendHours: 45,
        nightHours: 5,
        noShows: 1,
        lateArrivals: 0,
        coversCompleted: 0,
        reliabilityScore: 80,
      },
    ];

    await StaffMetrics.insertMany(metricsSeed.map((m) => ({ ...m, period: { year, month } })));
    console.log(`✅ Prior metrics seeded`);

    console.log(`\n✅ Seed complete!`);
    console.log(`   Owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
    console.log(`   Business: ${business.name} (id: ${bizId})`);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    failed = true;
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected');
    process.exit(failed ? 1 : 0);
  }
};

run();
