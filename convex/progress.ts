import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const get = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    return await ctx.db
      .query('progress')
      .withIndex('by_device', (q) => q.eq('deviceId', deviceId))
      .unique();
  },
});

export const save = mutation({
  args: {
    deviceId: v.string(),
    done: v.record(v.string(), v.boolean()),
    challenges: v.record(v.string(), v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('progress')
      .withIndex('by_device', (q) => q.eq('deviceId', args.deviceId))
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert('progress', doc);
  },
});
