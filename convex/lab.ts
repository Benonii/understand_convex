import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listMessages = query({
  args: { room: v.string() },
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
  args: { room: v.string(), author: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    if (args.body.length > 500) throw new Error('Message too long');
    await ctx.db.insert('messages', args);
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
