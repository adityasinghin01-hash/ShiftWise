// utils/shiftType.js
// Single source of truth for mapping a free-form shift-type label to the
// Shift model enum. Unknown/blank labels fall back to 'custom'.

'use strict';

const SHIFT_ENUM = ['morning', 'afternoon', 'evening'];

/** @param {string} t @returns {'morning'|'afternoon'|'evening'|'custom'} */
function toShiftEnum(t) {
  const v = String(t || '').toLowerCase();
  return SHIFT_ENUM.includes(v) ? v : 'custom';
}

module.exports = { toShiftEnum, SHIFT_ENUM };
