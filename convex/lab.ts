import { internalMutation, mutation, query } from './_generated/server';
import { ConvexError, v } from 'convex/values';

// Public demo endpoints: keep inputs small and bounded.
const ROOMS = ['general', 'random'];
const COUNTERS = ['hot'];
const room = v.union(...ROOMS.map((r) => v.literal(r)));

export const listMessages = query({
  args: { room },
  handler: async (ctx, { room }) => {
    // Read set = the index range by_room == room. Only writes into this
    // range invalidate this subscription.
    return await ctx.db
      .query('messages')
      .withIndex('by_room', (q) => q.eq('room', room))
      .order('desc')
      .take(30);
  },
});

export const send = mutation({
  args: { room, author: v.string(), body: v.string() },
  handler: async (ctx, { room, author, body }) => {
    const text = body.trim();
    if (!text || text.length > 280) throw new ConvexError('Messages must be 1–280 characters.');
    if (author.length > 32) throw new ConvexError('Author name too long.');
    await ctx.db.insert('messages', { room, author, body: text });
  },
});

export const getCounter = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const c = await ctx.db
      .query('counters')
      .withIndex('by_name', (q) => q.eq('name', name))
      .unique();
    return c?.value ?? 0;
  },
});

export const increment = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    if (!COUNTERS.includes(name)) throw new ConvexError('Unknown counter.');
    // Read-modify-write on one document: concurrent calls conflict under OCC
    // and Convex transparently retries them, so no increment is ever lost.
    const c = await ctx.db
      .query('counters')
      .withIndex('by_name', (q) => q.eq('name', name))
      .unique();
    if (c) await ctx.db.patch(c._id, { value: c.value + 1 });
    else await ctx.db.insert('counters', { name, value: 1 });
  },
});

/** Cron: keep the demo chat small by deleting messages older than a day. */
export const pruneMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query('messages')
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', cutoff))
      .take(500);
    for (const m of old) await ctx.db.delete(m._id);
  },
});
