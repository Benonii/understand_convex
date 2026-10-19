import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="pt-api" title="Your functions ARE your API: validate and authorize everything">
      <p>
        Every exported <C>query</C>, <C>mutation</C> and <C>action</C> can be called by anyone holding your deployment URL,
        with any arguments. There's no API gateway and no RLS policy layer between the client and your code. That keeps the
        security model simple: <strong>each public function is an endpoint, and its handler is the policy</strong>.
      </p>
      <Code
        title="❌ Spot the bug"
        code={`
export const deleteNote = mutation({
  handler: async (ctx, args: { id: Id<"notes"> }) => {
    await ctx.db.delete(args.id);
  },
});
`}
        note={<>
          Three bugs. (1) No <C>args</C> validator: the TypeScript type is erased at runtime, so a caller can send any value,
          even an ID from another table. (2) No authentication. (3) No ownership check, so anyone can delete anyone's note.
        </>}
      />
      <Code
        title="✅ Fixed"
        code={`
export const deleteNote = mutation({
  args: { id: v.id("notes") },              // runtime-validated + typed
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);     // throws if unauthenticated
    const note = await ctx.db.get(id);
    if (!note || note.ownerId !== user._id) throw new ConvexError("Not found");
    await ctx.db.delete(id);
    return null;
  },
});
`}
      />
      <Callout kind="rule" title="The three-line rule">
        Every public function starts with: <strong>args validator</strong> → <strong>identity</strong> →{' '}
        <strong>authorization on the specific documents</strong>. Anything only your backend should call is an{' '}
        <C>internalQuery</C> / <C>internalMutation</C> / <C>internalAction</C>. Those are only reachable through{' '}
        <C>internal.*</C> refs from other functions, the scheduler, crons or the CLI/dashboard.
      </Callout>
      <Callout kind="insight" title="ConvexError vs Error">
        Throw <C>new ConvexError(data)</C> for expected, user-facing failures. Its <C>data</C> is sent to the client intact.
        A plain <C>Error</C> in production is redacted to a generic "Server Error" (with a request ID), so internals don't
        leak.
      </Callout>
    </Section>

    <Section id="pt-helpers" title="convex-helpers: custom functions, RLS, relationships, Zod">
      <p>
        <C>convex-helpers</C> is the semi-official utility library. The most important piece is{' '}
        <strong>custom functions</strong>: wrap <C>query</C>/<C>mutation</C> once so every function gets auth, a{' '}
        <C>user</C> on <C>ctx</C>, and optionally a row-level-security wrapped <C>ctx.db</C>.
      </p>
      <Code
        title="convex/lib/functions.ts"
        code={`
import { customQuery, customMutation, customCtx } from "convex-helpers/server/customFunctions";
import { wrapDatabaseReader, wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
import { query, mutation } from "../_generated/server";

async function getUserOrThrow(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Unauthenticated");
  const user = await ctx.db.query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError("User not found");
  return user;
}

const rules = (user: Doc<"users">) => ({
  notes: {
    read: async (_ctx, note) => note.ownerId === user._id || note.public,
    modify: async (_ctx, note) => note.ownerId === user._id,
  },
});

export const userQuery = customQuery(query, customCtx(async (ctx) => {
  const user = await getUserOrThrow(ctx);
  return { user, db: wrapDatabaseReader(ctx, ctx.db, rules(user)) };
}));

export const userMutation = customMutation(mutation, customCtx(async (ctx) => {
  const user = await getUserOrThrow(ctx);
  return { user, db: wrapDatabaseWriter(ctx, ctx.db, rules(user)) };
}));

// usage: export const mine = userQuery({ args: {}, handler: (ctx) => ctx.db.query("notes")... })
`}
      />
      <ul>
        <li><strong>Relationships</strong>: <C>getOneFrom</C>, <C>getManyFrom</C>, <C>getManyVia</C> for 1:N and N:M lookups over indexes.</li>
        <li><strong>Zod</strong>: <C>zCustomQuery</C> / <C>zodToConvex</C> if you prefer Zod schemas (refinements are checked in your handler, not by the backend validator).</li>
        <li><strong>Triggers</strong>: run code whenever a table is written through a wrapped <C>ctx.db</C>. Good for denormalized counts and aggregates. It's a code-level wrapper, not a database trigger, so writes that bypass the wrapper don't fire.</li>
        <li><strong>Others</strong>: <C>paginator</C>/<C>stream</C> helpers (merge/filter streams over indexes), <C>asyncMap</C>, CORS router, sessions, hono integration, <C>crud</C> generator.</li>
      </ul>
      <Callout kind="warn" title="RLS wrappers aren't magic">
        The row-level-security wrapper checks rules on every document read through the wrapped <C>db</C>. Reads that a rule
        filters out still count against scan limits and cost. Use indexes to narrow first. The rules are a safety net for
        data you shouldn't see, not a query planner.
      </Callout>
    </Section>

    <Section id="pt-indexes" title="Read patterns: indexes, bounds, and the cost of .filter()">
      <p>
        The backend has no query planner. <C>.filter()</C> is a predicate applied to every document the scan visits. Every
        document read counts toward the transaction's read limits and goes into the read set, which means it's a potential
        cause of invalidation and conflicts. <C>withIndex</C> turns "scan and discard" into "seek a range".
      </p>
      <Code
        title="❌ Spot the bug"
        code={`
export const unreadForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const all = await ctx.db.query("notifications").collect();   // full table scan
    return all.filter((n) => n.userId === userId && !n.read);   // JS filter after the fact
  },
});
`}
        note={<>
          This reads every notification in the system. It's fine at 100 rows, hits the transaction scan limit at tens of
          thousands, and the read set covers <em>the whole table</em>. Any write by any user invalidates this query for{' '}
          <em>every</em> subscriber.
        </>}
      />
      <Code
        title="✅ Fixed — compound index + bounded read"
        code={`
// schema.ts
notifications: defineTable({ userId: v.id("users"), read: v.boolean(), body: v.string() })
  .index("by_user_read", ["userId", "read"]),

// notifications.ts
export const unreadForUser = query({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) =>
    ctx.db.query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", userId).eq("read", false))
      .order("desc")
      .take(50),
});
`}
        note={<>The read set is now the index range <C>[userId, false, *]</C>. Only writes inside that range invalidate this subscription.</>}
      />
      <Compare
        caption="Pick the right read"
        head={['Pattern', 'When', 'Risk']}
        rows={[
          [<C>.withIndex(...).unique()</C>, 'Exactly one match expected', 'Throws if more than one: good for invariants'],
          [<C>.withIndex(...).first()</C>, 'Latest / any one match', 'None'],
          [<C>.withIndex(...).take(n)</C>, 'Bounded lists', 'None'],
          [<C>.withIndex(...).paginate(opts)</C>, 'Unbounded lists in UI', 'Pages are reactive and can grow or shrink'],
          [<C>.withIndex(...).collect()</C>, 'Small bounded sets (≈ under 1000)', 'Unbounded growth → hits limits later'],
          [<><C>.filter(...)</C> after withIndex</>, 'Residual predicate on a small range', 'Scans whatever the range holds'],
          [<C>.query(t).collect()</C>, 'Admin / migration only', 'Full scan, whole-table read set'],
        ]}
      />
      <Callout kind="rule" title="Index design heuristics">
        Put equality fields first and the range/sort field last (<C>["channel", "_creationTime"]</C> is implicit, since every
        index ends with <C>_creationTime</C> then <C>_id</C>). One index can serve many prefixes: <C>by_a_b_c</C> also serves
        queries on <C>a</C> and on <C>a,b</C>, so you rarely need <C>by_a</C> too. Each index adds write cost and storage. A
        field you only display doesn't need indexing.
      </Callout>
    </Section>

    <Section id="pt-pagination" title="Pagination done right">
      <Code
        title="Reactive cursor pagination"
        code={`
// server
export const list = query({
  args: { channel: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: (ctx, { channel, paginationOpts }) =>
    ctx.db.query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .order("desc")
      .paginate(paginationOpts),
});

// client
const { results, status, loadMore } = usePaginatedQuery(
  api.messages.list,
  { channel },
  { initialNumItems: 25 },
);
// status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"
`}
      />
      <Callout kind="deep" title="Why pages don't drift">
        Each page is its own subscription over a key range [cursor, endCursor]. When a page is first loaded, its end cursor
        gets pinned: the client re-subscribes with <C>endCursor</C> so the page keeps covering the same key range as items
        are inserted or deleted. New messages make the first page grow instead of shifting every page by one. No duplicates,
        no gaps, fully reactive.
      </Callout>
      <Callout kind="warn" title="Offset pagination & counts">
        There's no <C>OFFSET</C> and no cheap <C>count()</C>. "Page 37 of 120" or "1,204 results" needs an aggregate (the
        aggregate component gives O(log n) count/offset), or a denormalized counter you maintain in your mutations.
      </Callout>
    </Section>

    <Section id="pt-contention" title="Write patterns: denormalization, counters, hot documents">
      <p>
        OCC makes conflicts cheap to detect but expensive when they happen often. Two mutations conflict when one writes
        something the other <strong>read</strong>. A single document that every mutation reads and writes (a global counter,
        a "last updated" field on a parent) serializes all your traffic. Retries pile up, and past a certain rate the
        mutation fails with a write-conflict error.
      </p>
      <Flow
        title="Hot-document contention vs sharding"
        height={340}
        nodes={[
          { id: 'm1', label: 'like #1', sub: 'mutation', x: 20, y: 20, w: 140, tone: 'yellow', code: ['server.dbWriter', 'application.mutation'] },
          { id: 'm2', label: 'like #2', sub: 'mutation', x: 20, y: 130, w: 140, tone: 'yellow', code: ['server.dbWriter', 'application.mutation'] },
          { id: 'm3', label: 'like #3', sub: 'mutation', x: 20, y: 240, w: 140, tone: 'yellow', code: ['server.dbWriter', 'application.mutation'] },
          { id: 'hot', label: 'post.likes', sub: 'one hot doc', x: 330, y: 130, tone: 'red', code: ['db.occ', 'db.commitConflict', 'application.mutation'] },
          { id: 's1', label: 'shard 0', sub: 'counter doc', x: 640, y: 20, w: 140, tone: 'purple', code: ['db.occ', 'db.readSet'] },
          { id: 's2', label: 'shard 1', sub: 'counter doc', x: 640, y: 130, w: 140, tone: 'purple', code: ['db.occ', 'db.readSet'] },
          { id: 's3', label: 'shard 2', sub: 'counter doc', x: 640, y: 240, w: 140, tone: 'purple', code: ['db.occ', 'db.readSet'] },
          { id: 'read', label: 'count query', sub: 'sum shards', x: 830, y: 130, w: 150, tone: 'plain', code: ['server.dbReader', 'db.readSet'] },
        ]}
        edges={[
          { id: 'a', from: 'm1', to: 'hot', code: ['db.commitConflict', 'application.mutation'] },
          { id: 'b', from: 'm2', to: 'hot', code: ['db.commitConflict', 'application.mutation'] },
          { id: 'c', from: 'm3', to: 'hot', code: ['db.commitConflict', 'application.mutation'] },
          { id: 'd', from: 'm1', to: 's1', curve: -0.05, code: ['server.dbWriter', 'db.writes'] },
          { id: 'e', from: 'm2', to: 's3', curve: 0.1, code: ['server.dbWriter', 'db.writes'] },
          { id: 'f', from: 'm3', to: 's2', curve: 0.1, code: ['server.dbWriter', 'db.writes'] },
          { id: 'g', from: 's1', to: 'read', code: ['server.dbReader', 'db.indexRange'] },
          { id: 'h', from: 's2', to: 'read', code: ['server.dbReader', 'db.indexRange'] },
          { id: 'i', from: 's3', to: 'read', code: ['server.dbReader', 'db.indexRange'] },
        ]}
        steps={[
          { title: 'Naive: read-modify-write one doc', text: "Each like does const p = await ctx.db.get(postId); ctx.db.patch(postId, { likes: p.likes + 1 }). Every mutation reads and writes the same document.", nodes: ['m1', 'm2', 'm3', 'hot'], edges: ['a', 'b', 'c'] },
          { title: 'OCC conflicts', text: "Three run concurrently at the same begin timestamp. The first commits. The other two find that their read set (post.likes) was written after they began, so they abort and retry. Throughput collapses to one commit at a time on that doc.", nodes: ['hot'], edges: ['a', 'b', 'c'] },
          { title: 'Shard the write', text: 'Each increment picks a random shard (0..N-1) and only reads and writes that shard document. Concurrent likes mostly touch different documents, so they rarely conflict.', nodes: ['m1', 'm2', 'm3', 's1', 's2', 's3'], edges: ['d', 'e', 'f'] },
          { title: 'Pay on read', text: 'The count query reads all N shards and sums them. Reads never conflict with each other; the query re-runs when any shard changes.', nodes: ['s1', 's2', 's3', 'read'], edges: ['g', 'h', 'i'] },
          { title: 'Or use the component', text: '@convex-dev/sharded-counter packages this. @convex-dev/aggregate goes further, with sums, ranks and offsets in O(log n) using a B-tree whose nodes are documents.', nodes: ['read'], edges: [] },
        ]}
      />
      <Code
        title="Denormalize deliberately, in the same mutation"
        code={`
export const addComment = mutation({
  args: { postId: v.id("posts"), body: v.string() },
  handler: async (ctx, { postId, body }) => {
    const user = await requireUser(ctx);
    await ctx.db.insert("comments", { postId, body, author: user._id });
    // Atomic with the insert — the count can never drift.
    // (Fine for moderate write rates on a single post; shard if it's hot.)
    const post = await ctx.db.get(postId);
    if (!post) throw new ConvexError("No post");
    await ctx.db.patch(postId, { commentCount: post.commentCount + 1 });
  },
});
`}
      />
      <Callout kind="insight" title="Reads cause conflicts, not just writes">
        A mutation that does <C>.collect()</C> on a large range has a large read set. <em>Any</em> concurrent insert into that
        range conflicts with it. Keep mutation read sets narrow (index-bounded, <C>take</C>/<C>first</C>), and move "scan
        everything" work into paginated background jobs.
      </Callout>
      <Callout kind="rule" title="Keep high-churn fields out of widely-read documents">
        If <C>users</C> holds both <C>name</C> (read by every message list) and <C>lastSeen</C> (written every 10 s), every
        heartbeat invalidates every query that read that user. Split volatile fields into their own table (e.g.{' '}
        <C>presence</C>) so the invalidation scope matches the data.
      </Callout>
    </Section>

    <Section id="pt-actions" title="Actions: thin shells around mutations">
      <p>
        Actions aren't transactional. Each <C>ctx.runQuery</C>/<C>ctx.runMutation</C> inside one is its <em>own</em>{' '}
        transaction at its <em>own</em> timestamp. Two sequential <C>runQuery</C> calls can see different database states,
        and data can change between a <C>runQuery</C> and the following <C>runMutation</C>.
      </p>
      <Code
        title="❌ Spot the bug — check-then-act across transactions"
        code={`
export const redeem = action({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const coupon = await ctx.runQuery(internal.coupons.get, { code });
    if (coupon.used) throw new Error("Already used");
    // ⚠ another request can redeem it right here
    await ctx.runMutation(internal.coupons.markUsed, { code });
    await ctx.runMutation(internal.wallet.credit, { amount: coupon.value });
  },
});
`}
        note={<>Race: two concurrent calls both read <C>used=false</C>, and both credit the wallet. The coupon check and the credit are also separate transactions, so a crash between them leaves a half-done state.</>}
      />
      <Code
        title="✅ Fixed — one mutation owns the invariant"
        code={`
export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    const coupon = await ctx.db.query("coupons")
      .withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!coupon || coupon.used) throw new ConvexError("Invalid coupon");
    await ctx.db.patch(coupon._id, { used: true, usedBy: user._id });
    await creditWallet(ctx, user._id, coupon.value);   // plain TS helper, same txn
    // Need a side effect (send email)? Schedule it — it commits with this txn:
    await ctx.scheduler.runAfter(0, internal.email.couponRedeemed, { userId: user._id });
  },
});
`}
        note={<>Serializable OCC guarantees only one of two concurrent redeems commits; the other retries, sees <C>used=true</C>, and throws.</>}
      />
      <Callout kind="rule" title="Helpers, not ctx.runQuery, inside mutations and queries">
        Inside a query or mutation, share logic as plain TypeScript functions that take <C>ctx</C> (e.g.{' '}
        <C>{'async function creditWallet(ctx: MutationCtx, ...)'}</C>). <C>ctx.runQuery</C>/<C>ctx.runMutation</C> from a
        mutation work, but they add overhead (a separate function invocation with its own arg validation) and buy you
        nothing. Use <C>ctx.runMutation</C> from actions, and use sub-transactions only when you want a partial rollback
        boundary.
      </Callout>
      <Callout kind="analogy" title="The action sandwich">
        Mutation (record intent, schedule) → action (talk to the outside world) → mutation (record the result). Put all
        decisions that depend on database state in the mutations. The action is a thin, idempotent pipe. If an action needs
        several pieces of data, fetch them with <strong>one</strong> internal query, so you get one consistent snapshot.
      </Callout>
    </Section>

    <Section id="pt-migrations" title="Schema evolution & migrations">
      <p>
        Convex enforces the schema on push: if existing data doesn't match a new <C>defineSchema</C>, the deploy fails. That
        makes changes a three-phase process, <strong>widen → migrate → narrow</strong>:
      </p>
      <Flow
        title="Widen → migrate → narrow (renaming a field)"
        height={260}
        nodes={[
          { id: 'w', label: '1. Widen schema', sub: 'v.optional(new field)', x: 20, y: 90, w: 200, tone: 'yellow', code: ['values.validators', 'cli.push'] },
          { id: 'c', label: '2. Dual-write code', sub: 'write both shapes', x: 270, y: 90, w: 200, tone: 'plain', code: ['server.dbWriter'] },
          { id: 'm', label: '3. Backfill', sub: 'migrations component', x: 520, y: 90, w: 200, tone: 'purple' },
          { id: 'n', label: '4. Narrow schema', sub: 'drop old field', x: 770, y: 90, w: 210, tone: 'red', code: ['values.validators', 'cli.push'] },
        ]}
        edges={[
          { id: 'a', from: 'w', to: 'c', label: 'deploy', code: ['cli.push'] },
          { id: 'b', from: 'c', to: 'm', label: 'run' },
          { id: 'd', from: 'm', to: 'n', label: 'verify', code: ['values.validators'] },
        ]}
        steps={[
          { title: 'Widen', text: 'Add the new field as v.optional(...), or make the type a v.union(old, new). The push succeeds because all existing documents still validate.', nodes: ['w'], edges: [] },
          { title: 'Make code handle both', text: 'Deploy readers that accept both shapes, and writers that write the new shape. New documents are now correct.', nodes: ['w', 'c'], edges: ['a'] },
          { title: 'Backfill in batches', text: "Run a paginated internalMutation (or @convex-dev/migrations) that converts N docs per transaction and schedules the next batch. It's resumable, stays within transaction limits, and doesn't hold locks.", nodes: ['c', 'm'], edges: ['b'] },
          { title: 'Narrow', text: 'Once every document is migrated, make the field required and remove the old one. The push validates all existing data against the schema, so it fails safely if you missed any.', nodes: ['m', 'n'], edges: ['d'] },
        ]}
      />
      <Code
        title="@convex-dev/migrations"
        code={`
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
export const migrations = new Migrations<DataModel>(components.migrations);

export const setDefaultRole = migrations.define({
  table: "users",
  migrateOne: async (ctx, user) => {
    if (user.role === undefined) await ctx.db.patch(user._id, { role: "member" });
  },
});
// npx convex run migrations:run '{"fn": "migrations:setDefaultRole"}'
`}
      />
    </Section>

    <Section id="pt-testing" title="Testing with convex-test">
      <p>
        <C>convex-test</C> runs your functions against an in-memory mock of the Convex backend in Vitest (use the{' '}
        <C>edge-runtime</C> environment). It enforces the schema, supports auth via <C>withIdentity</C>, and runs scheduled
        functions with fake timers. For end-to-end fidelity you can also test against a local open-source backend.
      </p>
      <Code
        title="convex/notes.test.ts"
        code={`
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

test("only the owner can delete", async () => {
  const t = convexTest(schema);
  const alice = t.withIdentity({ subject: "alice", tokenIdentifier: "x|alice" });
  const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "x|bob" });

  await alice.mutation(api.users.store, {});
  await bob.mutation(api.users.store, {});
  const id = await alice.mutation(api.notes.create, { body: "hi" });

  await expect(bob.mutation(api.notes.deleteNote, { id })).rejects.toThrow();
  await alice.mutation(api.notes.deleteNote, { id });
  expect(await alice.query(api.notes.mine, {})).toEqual([]);
});

test("scheduled email", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema);
  await t.mutation(api.orders.placeOrder, { items: [] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  // assert on side-effect tables...
});
`}
      />
    </Section>

    <Section id="pt-types" title="TypeScript power moves">
      <Code
        title="Types you'll use daily"
        code={`
import { Doc, Id, DataModel } from "./_generated/dataModel";
import { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import { FunctionReturnType, FunctionArgs } from "convex/server";
import { Infer, v } from "convex/values";

type Message = Doc<"messages">;               // full doc incl. _id, _creationTime
type MessageId = Id<"messages">;               // branded string, table-checked

// Share validators between schema, args and the client:
export const status = v.union(v.literal("todo"), v.literal("doing"), v.literal("done"));
export type Status = Infer<typeof status>;     // "todo" | "doing" | "done"

// Client-side types derived from server functions:
type ListResult = FunctionReturnType<typeof api.messages.list>;
type ListArgs = FunctionArgs<typeof api.messages.list>;

// Helpers typed by ctx:
export async function requireUser(ctx: QueryCtx | MutationCtx) { /* ... */ }
`}
      />
      <Callout kind="insight" title="End-to-end types without codegen drift">
        <C>npx convex dev</C> regenerates <C>_generated/api.d.ts</C> and <C>dataModel.d.ts</C> from your actual function
        exports and schema. Rename an argument and every client call site fails typechecking immediately. The validators
        enforce the same contract at runtime.
      </Callout>
      <Callout kind="warn" title="Circular inference">
        An action that returns the result of <C>ctx.runQuery(internal.x.y)</C> from the same module can produce "implicitly
        has type any" errors, because TypeScript can't infer through the generated <C>api</C> cycle. Add an explicit return
        type annotation (or a <C>returns</C> validator) to the handler.
      </Callout>
    </Section>

    <Section id="pt-perf" title="Performance budgeting">
      <Compare
        caption="Approximate limits to design around (check docs — they evolve)"
        head={['Resource', 'Approx. limit', 'Design implication']}
        rows={[
          ['Query/mutation user-code time', '~1 s', 'Do heavy compute in actions; keep transactions small'],
          ['Action duration', '~10 min', 'Chunk long work; checkpoint progress in the DB'],
          ['Docs scanned per transaction', '~32k', 'Index-bound every read; paginate'],
          ['Data read per transaction', '~16 MiB', "Don't .collect() blobs; store files in _storage"],
          ['Docs written per transaction', '~16k (approx.)', 'Batch migrations across transactions'],
          ['Document size', '1 MiB', 'Split large payloads; arrays ≤ 8192 elements'],
          ['Function args / return', '~16 MiB / ~8 MiB', 'Upload URLs for files'],
        ]}
      />
      <ul>
        <li><strong>Cache-friendly queries</strong>: keep args stable (don't pass <C>Date.now()</C> as an arg every render; round it, or use a scheduled "tick" document). Every distinct args tuple is a separate cache entry and subscription.</li>
        <li><strong>Don't read time in queries</strong> for "expired" filtering. <C>Date.now()</C> in a query is frozen per execution and isn't tracked, so the result won't update when time passes. Store an <C>expired</C> flag via a scheduled mutation instead.</li>
        <li><strong>Parallelize reads</strong> in one function: <C>await Promise.all(ids.map(id =&gt; ctx.db.get(id)))</C>.</li>
        <li><strong>Skip queries</strong> client-side with <C>useQuery(api.x, cond ? args : "skip")</C> instead of returning early on the server.</li>
        <li><strong>Watch the dashboard</strong>: per-function execution time, documents read and cache hit rate show you where to add an index.</li>
      </ul>
      <Code
        title="❌ Spot the bug — a query that never updates"
        code={`
export const activeSessions = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return (await ctx.db.query("sessions").collect())
      .filter((s) => s.expiresAt > now);
  },
});
`}
        note={<>The result only changes when a <C>sessions</C> document changes, not as time passes, because time isn't part of the read set. It's also a full scan. Fix: index on <C>expiresAt</C>, have a scheduled mutation flip <C>active=false</C> at expiry, and query <C>withIndex("by_active", q =&gt; q.eq("active", true))</C>.</>}
      />
    </Section>

    <Section id="pt-checklist" title="Production checklist">
      <ol>
        <li>Every public function has <C>args</C> (and ideally <C>returns</C>) validators.</li>
        <li>Every public function checks identity and ownership. Server-only work is <C>internal*</C>.</li>
        <li>No <C>.filter()</C> on large tables, no unbounded <C>.collect()</C>. Indexes match your query shapes.</li>
        <li>Hot counters are sharded or use aggregate. Volatile fields live in separate documents.</li>
        <li>External side effects only in actions, kicked off by <C>scheduler.runAfter</C> from mutations, and idempotent.</li>
        <li>Webhooks verify signatures and upsert idempotently by event ID.</li>
        <li>The schema is defined and strict. Migrations follow widen → migrate → narrow.</li>
        <li>Secrets are in env vars (separate dev/prod values). The prod deploy key lives only in CI.</li>
        <li><C>convex-test</C> suites cover authz edge cases, plus a CI step that runs <C>npx convex deploy --cmd ...</C>.</li>
        <li>Backups scheduled, log streaming / exception reporting configured, preview deployments for PRs.</li>
      </ol>
    </Section>

    <Section id="pt-quiz" title="Patterns — terms & checks">
      <KeyTerms
        terms={[
          { term: 'internal function', def: 'internalQuery/Mutation/Action. Not exposed to clients; callable only via internal.* refs, the scheduler, crons or the CLI.' },
          { term: 'ConvexError', def: 'Error whose data is delivered to the client intact. Plain Errors are redacted in prod.' },
          { term: 'customQuery / customMutation', def: 'convex-helpers wrappers that inject ctx (user, RLS db) and args into many functions.' },
          { term: 'Hot document', def: 'A doc read and written by many concurrent mutations, which causes OCC retries and conflicts.' },
          { term: 'Sharded counter', def: 'A counter split over N docs; writes pick a shard, reads sum all of them.' },
          { term: 'Aggregate component', def: 'Document-backed B-tree giving O(log n) count, sum, rank and offset.' },
          { term: 'Widen → migrate → narrow', def: 'Safe schema evolution sequence enforced by schema validation on push.' },
          { term: 'convex-test', def: 'In-memory Convex mock for Vitest, with auth and scheduled-function support.' },
          { term: 'Infer<typeof v>', def: "Derive a TS type from a validator, giving one source of truth." },
          { term: '"skip"', def: 'Pass instead of args to useQuery to not subscribe at all.' },
        ]}
      />
      <Check
        q="An action does runQuery(getBalance), checks balance ≥ 10, then runMutation(debit 10). What's wrong?"
        options={["Nothing, actions are transactional", 'The check and the debit are separate transactions, so concurrent calls can overdraw', 'runMutation cannot be called from actions', 'It will deadlock']}
        answer={1}
        explain="Each runQuery/runMutation in an action is its own transaction. Put the check and the debit in one mutation; OCC then serializes concurrent debits."
      />
      <Check
        q="A 'likes' counter on a viral post gets thousands of writes per second and mutations start failing. Best fix?"
        options={['Increase the mutation timeout', 'Move the increment into an action', 'Shard the counter across N docs (or use the sharded-counter component)', 'Use .filter() instead of withIndex']}
        answer={2}
        explain="The failures are OCC conflicts on one hot document. Spreading writes across shards removes most conflicts. Actions would lose atomicity, and timeouts don't affect conflicts."
      />
      <Check
        q="Which query result updates automatically when a matching new row is inserted, but NOT when the wall-clock time passes?"
        options={['One that filters with Date.now()', 'None, Convex tracks time', 'Both cases update automatically', 'Only paginated queries update']}
        answer={0}
        explain="Read sets are made of index ranges over data. Date.now() is frozen per execution and isn't tracked. Model time-dependent state as data written by scheduled mutations."
      />
      <Check
        q="You need to rename field `title` to `name` on 2M documents. Correct sequence?"
        options={['Edit schema to `name`, deploy, done', 'Widen (optional name), dual-write, batched backfill, then narrow (required name, drop title)', 'Export, edit JSON, re-import in prod', 'One mutation that patches all 2M docs']}
        answer={1}
        explain="Schema validation rejects the direct change, and one mutation would blow transaction limits. Widen → migrate in batches → narrow is the safe, online path."
      />
      <Check
        q="Inside a mutation, how should you reuse logic from another mutation?"
        options={['ctx.runMutation(api.other.fn) always', 'Call a plain TS helper that takes ctx', 'Schedule it with runAfter(0)', 'Use an HTTP action']}
        answer={1}
        explain="Plain helpers run in the same transaction with no extra invocation overhead. Scheduling would make it non-atomic. ctx.runMutation works but adds overhead; save it for actions."
      />
    </Section>

    <Section id="pt-cheatsheet" title="Expert cheat sheet — the whole course on one page">
      <Callout kind="analogy" title="The one-sentence model">
        Convex is a transaction log with indexes, plus deterministic TypeScript functions that read it at a snapshot. Every
        query's read set is recorded as index ranges, so the server knows exactly which results each commit invalidates and
        pushes new ones over a WebSocket.
      </Callout>
      <Compare
        caption="Function types"
        head={['', 'query', 'mutation', 'action', 'httpAction']}
        rows={[
          ['DB access', 'read (ctx.db)', 'read + write (ctx.db)', 'via runQuery/runMutation', 'via runQuery/runMutation'],
          ['Transaction', 'snapshot read', 'serializable OCC, auto-retry', 'none', 'none'],
          ['Deterministic', 'yes', 'yes', 'no', 'no'],
          ['fetch / side effects', 'no', 'no', 'yes', 'yes'],
          ['Reactive / cached', 'yes / yes', 'n/a', 'no', 'no'],
          ['Runtime', 'V8 isolate', 'V8 isolate', "V8 or Node ('use node')", 'V8'],
          ['Called from', 'client, runQuery', 'client, runMutation, scheduler', 'client, runAction, scheduler', 'HTTP on .convex.site'],
          ['Retries', 'n/a', 'exactly-once semantics', 'at most once', 'n/a'],
        ]}
      />
      <Compare
        caption="Core internals"
        head={['Concept', 'What to remember']}
        rows={[
          ['Storage', 'Append-only log of document revisions + index entries keyed by (index, key, ts) in a persistence layer (SQLite / Postgres / MySQL). MVCC, so reads happen at a timestamp.'],
          ['Documents', '_id (encodes table) + _creationTime; JSON-like values incl. int64, bytes; ≤ 1 MiB.'],
          ['Indexes', 'Ordered keys; every index implicitly ends with _creationTime, _id. withIndex = range seek; filter = scan.'],
          ['Transactions', 'Begin timestamp → record read set (index ranges) + write set → committer checks for conflicting writes since begin → commit at new ts or retry.'],
          ['Isolation', 'Serializable (strictly). Queries see one consistent snapshot.'],
          ['Determinism', 'Seeded Math.random, frozen Date.now, no fetch in queries/mutations, so safe to retry and cache.'],
          ['Subscriptions', 'Each active query has a read set; each commit write set is intersected; overlaps → re-run → push diff in a Transition.'],
          ['Client', 'One WebSocket; query set versioned; Transition messages move all queries to a new timestamp atomically.'],
          ['Read-your-writes', 'A mutation promise resolves only after the client has received a Transition at or after the mutation commit ts.'],
          ['Optimistic updates', 'Local overlay on the query cache, dropped and replaced when the server result arrives.'],
          ['Ordering', "A single client's mutations execute in the order sent."],
          ['Caching', 'Results keyed by (fn, args, identity), valid until a write intersects their read set.'],
        ]}
      />
      <Compare
        caption="Feature → mechanism"
        head={['Feature', 'Built from']}
        rows={[
          ['Scheduler / crons', 'Rows in _scheduled_functions written transactionally; executor runs due jobs'],
          ['File storage', 'Blob store + _storage metadata rows; upload URLs bypass functions'],
          ['Auth', 'OIDC JWT verified on the socket; identity in ctx.auth and in the cache key'],
          ['Text search', 'Transactional inverted index (searchIndex); reactive'],
          ['Vector search', 'ANN index queried in actions; docs fetched via query'],
          ['HTTP', 'httpRouter on .convex.site → httpAction → runMutation'],
          ['Components', 'Namespaced tables/functions inside the same transaction log'],
          ['Pagination', 'Per-page subscriptions with pinned end cursors'],
        ]}
      />
      <Code
        title="Golden template"
        code={`
export const doThing = mutation({
  args: { id: v.id("things"), value: v.string() },   // 1. validate
  returns: v.null(),
  handler: async (ctx, { id, value }) => {
    const user = await requireUser(ctx);              // 2. authenticate
    const thing = await ctx.db.get(id);
    if (thing?.ownerId !== user._id) throw new ConvexError("Forbidden"); // 3. authorize
    await ctx.db.patch(id, { value });                // 4. narrow, index-bound writes
    await ctx.scheduler.runAfter(0, internal.side.effect, { id }); // 5. side effects after commit
    return null;
  },
});
`}
      />
      <Callout kind="rule" title="Ten commandments">
        1. Validate args. 2. Auth in every public fn. 3. internal* for server-only. 4. withIndex, not filter. 5. Bound every
        read. 6. Invariants live in one mutation. 7. Side effects in actions, scheduled from mutations. 8. Shard hot writes.
        9. Model time as data. 10. Widen → migrate → narrow.
      </Callout>
    </Section>
  </>
);

const mod: Module = {
  id: 'patterns',
  n: 8,
  title: 'Patterns & pitfalls',
  kicker: 'Security · performance · contention · migrations · testing',
  minutes: 40,
  summary: 'How experts structure Convex apps: validation and authz, index-bound reads, contention-free writes, the action sandwich, migrations, testing, types, plus a one-page cheat sheet of the whole course.',
  Component,
};
export default mod;
