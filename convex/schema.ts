import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Course progress, keyed by an anonymous per-browser id.
  progress: defineTable({
    deviceId: v.string(),
    done: v.record(v.string(), v.boolean()),
    challenges: v.record(v.string(), v.boolean()),
    updatedAt: v.number(),
  }).index('by_device', ['deviceId']),

  // Live lab: a tiny chat used to watch the sync protocol in action.
  messages: defineTable({
    room: v.string(),
    author: v.string(),
    body: v.string(),
  }).index('by_room', ['room']),

  // Live lab: a single hot counter document to provoke OCC conflicts.
  counters: defineTable({ name: v.string(), value: v.number() }).index('by_name', ['name']),
});
