const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["page_view", "conversion", "cta_click", "scroll", "video_play"],
      index: true,
    },

    session_id: {
      type: String,
      required: true,
      index: true,
    },

    visitor_id: {
      type: String,
      index: true,
    },

    source: {
      type: String,
      enum: ["direct", "social", "search", "referral", "email", "paid"],
      default: "direct",
      index: true,
    },

    medium: {
      type: String,
      default: null,
      index: true,
    },

    campaign: {
      type: String,
      default: null,
      index: true,
    },

    path: {
      type: String,
      index: true,
    },

    referrer: String,
    user_agent: String,

    device: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "bot", "unknown"],
      default: "unknown",
      index: true,
    },

    browser: String,
    os: String,

    country: {
      type: String,
      index: true,
    },

    city: {
      type: String,
      index: true,
    },

    conversion_name: String,

    value: {
      type: Number,
      default: 0,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    ts: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { versionKey: false }
);

eventSchema.index({ ts: -1, type: 1 });
eventSchema.index({ session_id: 1, ts: -1 });
eventSchema.index({ source: 1, ts: -1 });

module.exports = mongoose.model("Event", eventSchema);