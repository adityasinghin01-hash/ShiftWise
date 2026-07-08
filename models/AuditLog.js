// models/AuditLog.js
// M4 FIX: Audit log for admin/privileged actions.
// Immutable append-only — no updates, no deletes (TTL-managed cleanup only).

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: {
      type: String,
      required: true,
      enum: [
        'role_change',
        'ban_user',
        'unban_user',
        'view_stats',
        'view_users',
        'plan_change',
        'delete_user',
        'cover_override', // §6.7 — manager overrode the anti-favoritism / reliability cover pick
      ],
    },
    targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    meta: { type: mongoose.Schema.Types.Mixed }, // { from, to } for role changes etc.
    ip: { type: String },
  },
  {
    timestamps: true,
    // Never update audit log docs
    strict: true,
  }
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
// Auto-expire logs after 2 years (regulatory retention minimum)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 });

// Prevent updates AND deletes — audit log is append-only.
// TTL index above is the only legitimate way records leave the collection.
const BLOCK_MUTATION = function () {
  throw new Error('AuditLog is append-only — updates and deletes are not permitted');
};
auditLogSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], BLOCK_MUTATION);
auditLogSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], BLOCK_MUTATION);

module.exports = mongoose.model('AuditLog', auditLogSchema);
