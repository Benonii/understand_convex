export type Topic = 'mental-model' | 'functions' | 'database' | 'transactions' | 'sync' | 'internals' | 'platform' | 'patterns';

export const TOPIC_LABEL: Record<Topic, string> = {
  'mental-model': 'Mental model',
  functions: 'Functions',
  database: 'Database & indexes',
  transactions: 'Transactions & OCC',
  sync: 'Sync engine',
  internals: 'Backend internals',
  platform: 'Platform features',
  patterns: 'Patterns & security',
};

type Base = { id: string; topic: Topic; difficulty: 1 | 2 | 3; title: string; boss?: boolean };
export type ChoiceChallenge = Base & { kind: 'mcq' | 'predict' | 'bug'; q: string; code?: string; options: string[]; answer: number; explain: string };
export type OrderChallenge = Base & { kind: 'order'; q: string; items: string[]; explain: string };
export type Challenge = ChoiceChallenge | OrderChallenge;

export const challenges: Challenge[] = [
  /* ---------------- Mental model ---------------- */
  {
    id: 'mm-1', topic: 'mental-model', difficulty: 1, kind: 'mcq', title: 'What is Convex, really?',
    q: 'Which description is most accurate?',
    options: [
      'A hosted Postgres with a REST layer and a websocket add-on',
      'A transactional document database whose TypeScript server functions run inside the database, with query results pushed reactively to clients',
      'A client-side cache (like React Query) that syncs to any backend',
      'A serverless functions platform that you connect to your own database',
    ],
    answer: 1,
    explain: 'Convex is the database and the function runtime in one backend. Queries and mutations run next to the data inside transactions; the backend tracks what each query read and pushes new results over a WebSocket when that data changes.',
  },
  {
    id: 'mm-2', topic: 'mental-model', difficulty: 1, kind: 'mcq', title: 'Where does query code run?',
    q: 'Where does the code inside `export const list = query({...})` execute?',
    options: ['In the browser, against a local replica', 'In a Node.js server you deploy', 'In the Convex backend, in a V8 isolate co-located with the database', 'In a Postgres stored procedure'],
    answer: 2,
    explain: 'Queries and mutations run in the Convex backend\'s own V8-based JavaScript runtime, right next to the database. That is why many small `ctx.db` calls are cheap — there is no network hop per read.',
  },
  {
    id: 'mm-3', topic: 'mental-model', difficulty: 2, kind: 'mcq', title: 'Why no cache invalidation code?',
    q: 'Why don\'t you write cache invalidation logic in a Convex app?',
    options: [
      'Convex polls every query every second',
      'Convex records each query\'s read set and reruns only the queries whose read sets overlap a committed write',
      'Convex invalidates all queries for a table whenever the table changes',
      'Convex never caches query results',
    ],
    answer: 1,
    explain: 'Every query execution records the index ranges it read. On every commit, the subscription manager intersects the write set with live read sets and reruns only the overlapping queries. Invalidation is precise and automatic.',
  },
  {
    id: 'mm-4', topic: 'mental-model', difficulty: 2, kind: 'order', title: 'Life of a useQuery',
    q: 'Put the lifecycle of a reactive query in order.',
    items: [
      'Component calls useQuery(api.messages.list, { channel })',
      'Client adds the query to its query set and sends ModifyQuerySet over the WebSocket',
      'Server runs the query at a snapshot timestamp and records its read set',
      'Server sends a Transition containing the result; component renders',
      'A mutation commits a write that overlaps the read set',
      'Subscription is invalidated; query reruns and a new Transition is pushed',
    ],
    explain: 'Subscribe → execute at a timestamp with read set → push → (some later write overlaps) → invalidate → rerun → push again. The client never asks "is this stale?" — the server tells it.',
  },
  {
    id: 'mm-5', topic: 'mental-model', difficulty: 1, kind: 'mcq', title: 'The three function types',
    q: 'Which pairing is correct?',
    options: [
      'query: read-only, reactive, deterministic · mutation: transactional read/write · action: arbitrary side effects, not transactional',
      'query: can write if small · mutation: can call fetch · action: transactional',
      'query: runs on the client · mutation: runs on the server · action: runs on the edge',
      'All three are transactional; they differ only in timeout',
    ],
    answer: 0,
    explain: 'Queries read and are cached/reactive; mutations are serializable transactions; actions can talk to the outside world (fetch, SDKs, Node) but are not transactions — they read/write the DB only by calling queries/mutations.',
  },

  /* ---------------- Functions ---------------- */
  {
    id: 'fn-1', topic: 'functions', difficulty: 1, kind: 'mcq', title: 'Who can call fetch()?',
    q: 'Which Convex function type may call `fetch()` to a third-party API?',
    options: ['query', 'mutation', 'action', 'all of them'],
    answer: 2,
    explain: 'Queries and mutations must be deterministic so they can be cached and retried; network calls would break that. Actions are where side effects live.',
  },
  {
    id: 'fn-2', topic: 'functions', difficulty: 2, kind: 'predict', title: 'Date.now() in a query',
    q: 'A component subscribes to this query. 10 minutes pass with no writes to `tasks`. What does the UI show?',
    code: `export const overdue = query({
  handler: async (ctx) => {
    const now = Date.now();
    const tasks = await ctx.db.query("tasks").collect();
    return tasks.filter((t) => t.dueAt < now);
  },
});`,
    options: [
      'The list updates every minute as tasks become overdue',
      'The result stays as it was; queries only rerun when data in their read set changes, and time passing is not a write',
      'It throws because Date.now() is banned in queries',
      'It updates on every render because Date.now() disables caching',
    ],
    answer: 1,
    explain: 'Date.now() inside a function is fixed for that execution, and time is not part of the read set. Pass a coarse time (e.g. rounded to the minute) as an argument from the client, or store status flags updated by a scheduled function.',
  },
  {
    id: 'fn-3', topic: 'functions', difficulty: 1, kind: 'bug', title: 'Action writes to the DB',
    q: 'What is wrong with this action?',
    code: `export const importUser = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const res = await fetch(url);
    const user = await res.json();
    await ctx.db.insert("users", user);
  },
});`,
    options: [
      'fetch is not available in actions',
      'Actions have no ctx.db — writes must go through ctx.runMutation(internal.users.insert, ...)',
      'args must use v.url()',
      'Actions cannot be async',
    ],
    answer: 1,
    explain: 'Actions aren\'t transactions, so they get no direct database handle. They call ctx.runQuery / ctx.runMutation (usually internal functions), each of which is its own transaction.',
  },
  {
    id: 'fn-4', topic: 'functions', difficulty: 2, kind: 'predict', title: 'Two runMutation calls',
    q: 'The second runMutation throws. What is the state of the database?',
    code: `export const checkout = action({
  handler: async (ctx, { orderId }) => {
    await ctx.runMutation(internal.orders.markPaid, { orderId });
    await ctx.runMutation(internal.inventory.decrement, { orderId }); // throws
  },
});`,
    options: [
      'Nothing changed — the action is rolled back as a unit',
      'The order is marked paid; inventory is not decremented. Each runMutation is its own transaction.',
      'Both changes are applied because the action caught the error',
      'Convex retries the whole action automatically until it succeeds',
    ],
    answer: 1,
    explain: 'Actions are not atomic. If two writes must succeed together, do them in ONE mutation. Use actions only for the external part, and call a single mutation with the result.',
  },
  {
    id: 'fn-5', topic: 'functions', difficulty: 1, kind: 'mcq', title: 'internal vs public',
    q: 'What does `internalMutation` change compared to `mutation`?',
    options: [
      'It runs faster because it skips validation',
      'It cannot be called from clients — only from other functions (ctx.run*), the scheduler, crons, or the CLI/dashboard',
      'It runs in Node.js instead of V8',
      'It is not transactional',
    ],
    answer: 1,
    explain: 'Internal functions are referenced via `internal.*` instead of `api.*` and are not exposed to the public API. Use them for anything a client must not trigger directly.',
  },
  {
    id: 'fn-6', topic: 'functions', difficulty: 2, kind: 'mcq', title: '"use node"',
    q: 'What does putting `"use node";` at the top of a file in convex/ do?',
    options: [
      'Runs every function in the file in Node.js, including queries',
      'Makes the file\'s actions run in a Node.js runtime (npm packages needing Node APIs work); the file may only define actions',
      'Enables CommonJS imports in queries',
      'Nothing — it is ignored',
    ],
    answer: 1,
    explain: 'The default runtime is Convex\'s V8 isolate runtime (fast cold starts, web-standard APIs). "use node" opts a file\'s actions into Node.js. Queries and mutations always run in the Convex runtime, so they cannot live in a "use node" file.',
  },
  {
    id: 'fn-7', topic: 'functions', difficulty: 2, kind: 'mcq', title: 'Math.random in a mutation',
    q: 'What happens with `Math.random()` inside a mutation?',
    options: [
      'It throws — randomness is forbidden',
      'It works; the runtime controls the seed so the function remains deterministic for the execution',
      'It returns 0 always',
      'It makes the mutation non-retryable',
    ],
    answer: 1,
    explain: 'Convex\'s runtime makes Math.random and Date.now safe by controlling them per execution, preserving determinism. True external nondeterminism (network, real clocks) is what is disallowed.',
  },

  /* ---------------- Database ---------------- */
  {
    id: 'db-1', topic: 'database', difficulty: 1, kind: 'mcq', title: '.filter() cost',
    q: 'What does `.filter()` on a Convex query do for performance?',
    options: [
      'Uses an index automatically if one matches',
      'Nothing different from withIndex',
      'Reads every document in the range being scanned and discards non-matching ones — it does not narrow the scan',
      'Pushes the filter into SQL WHERE',
    ],
    answer: 2,
    explain: 'There is no query planner. Only withIndex (or search indexes) narrows what is read. filter() is convenient for small tables or after an index has narrowed the range.',
  },
  {
    id: 'db-2', topic: 'database', difficulty: 2, kind: 'bug', title: 'Skipping an index field',
    q: 'Schema: `.index("by_team_status", ["team", "status"])`. What is the bug?',
    code: `const done = await ctx.db
  .query("tasks")
  .withIndex("by_team_status", (q) => q.eq("status", "done"))
  .collect();`,
    options: [
      'collect() should be take()',
      'Index ranges must constrain fields in index order; you cannot eq("status") without first eq("team")',
      'withIndex needs an order("desc")',
      'Nothing — Convex reorders the fields',
    ],
    answer: 1,
    explain: 'An index is a sorted list of [team, status, _creationTime]. A valid range is equality on a prefix, then optionally a bound on the next field. For "all done tasks" you need an index starting with status.',
  },
  {
    id: 'db-3', topic: 'database', difficulty: 2, kind: 'mcq', title: 'The hidden index suffix',
    q: 'What does Convex implicitly append to every index you define?',
    options: ['Nothing', '_creationTime (with _id as the final tiebreaker)', 'A hash of the document', 'The table name'],
    answer: 1,
    explain: 'Every index is ordered by your fields, then _creationTime. That is why results within an equal prefix come back in creation order, and why order("desc") gives "newest first".',
  },
  {
    id: 'db-4', topic: 'database', difficulty: 1, kind: 'mcq', title: 'Document IDs',
    q: 'Which is true about `_id`?',
    options: [
      'You choose it on insert',
      'It is an auto-increment integer',
      'It is generated by Convex, encodes which table it belongs to, and v.id("table") validates it',
      'It is a UUID v4 you can generate client-side',
    ],
    answer: 2,
    explain: 'IDs are opaque strings created by Convex. Because the table is encoded, ctx.db.get(id) knows where to look, and v.id("tasks") rejects IDs from other tables.',
  },
  {
    id: 'db-5', topic: 'database', difficulty: 2, kind: 'predict', title: 'Schema push vs existing data',
    q: 'You change `age: v.optional(v.number())` to `age: v.number()` while 500 docs lack `age`. You run `npx convex dev`. What happens?',
    options: [
      'Push succeeds; old docs get age = 0',
      'Push succeeds; old docs are deleted',
      'Push fails with a schema validation error; nothing changes until data matches',
      'Push succeeds; validation only applies to new writes',
    ],
    answer: 2,
    explain: 'Convex validates existing documents against a new schema before accepting it. Migrate in steps: keep the field optional, backfill, then tighten the schema.',
  },
  {
    id: 'db-6', topic: 'database', difficulty: 2, kind: 'mcq', title: 'Joins',
    q: 'How do you "join" users onto messages in Convex?',
    options: [
      'Use ctx.db.join()',
      'In the query function: load messages via an index, then ctx.db.get(m.authorId) for each — cheap because code runs next to the data, and every read is tracked for reactivity',
      'Denormalize everything; joins are impossible',
      'Write SQL in a raw query',
    ],
    answer: 1,
    explain: 'Joins are just code. Promise.all over ctx.db.get calls is the idiomatic pattern. Each get adds a point read to the read set, so the result rerenders if a user renames themselves.',
  },
  {
    id: 'db-7', topic: 'database', difficulty: 3, kind: 'mcq', title: 'Reactive pagination',
    q: 'With usePaginatedQuery, a new item is inserted into the middle of page 1 after page 2 is loaded. What happens?',
    options: [
      'Page 2 shifts by one item and one item appears twice',
      'Page 1 grows by one item; page boundaries are pinned by cursors, so no gaps or duplicates',
      'Nothing until you refresh',
      'All pages are refetched from scratch with offsets',
    ],
    answer: 1,
    explain: 'Each loaded page is a reactive query over a fixed index range (between cursors). Once its end cursor is fixed, inserts land inside the correct page instead of shifting items across page boundaries.',
  },
  {
    id: 'db-8', topic: 'database', difficulty: 2, kind: 'predict', title: 'collect() on a huge table',
    q: 'A query calls `ctx.db.query("events").collect()` on a table with 2 million documents. What happens?',
    options: [
      'Returns all 2M docs, just slowly',
      'Convex streams them in pages automatically',
      'The function fails once it exceeds per-transaction read limits',
      'Convex returns the first 1000 silently',
    ],
    answer: 2,
    explain: 'Transactions have read limits (documents scanned and bytes read). Unbounded collect() is a scaling bug: use an index range, .take(n), pagination, or a precomputed aggregate.',
  },

  /* ---------------- Transactions ---------------- */
  {
    id: 'tx-1', topic: 'transactions', difficulty: 1, kind: 'mcq', title: 'Isolation level',
    q: 'What isolation do Convex mutations get?',
    options: ['Read committed', 'Snapshot isolation only', 'Serializable — as if mutations ran one at a time', 'None; last write wins'],
    answer: 2,
    explain: 'Convex mutations are serializable (and the ordering respects real time). You get it with no locks and no isolation-level knobs, via OCC.',
  },
  {
    id: 'tx-2', topic: 'transactions', difficulty: 2, kind: 'predict', title: 'Concurrent increments',
    q: 'Two clients call this at the exact same moment with count = 0. Final count?',
    code: `export const inc = mutation({
  handler: async (ctx) => {
    const c = (await ctx.db.query("counter").first())!;
    await ctx.db.patch(c._id, { n: c.n + 1 });
  },
});`,
    options: ['1 — one update is lost', '2 — the committer detects the conflict and retries one mutation', 'Either 1 or 2 depending on timing', 'An error is thrown to one client'],
    answer: 1,
    explain: 'Both read n = 0 at their snapshot. The first commits n = 1. The second\'s read set contains the counter, which was written after its snapshot — conflict. It is re-executed transparently, reads 1, writes 2.',
  },
  {
    id: 'tx-3', topic: 'transactions', difficulty: 2, kind: 'mcq', title: 'What is in a read set?',
    q: 'A query uses withIndex("by_channel", eq channel "general") then .filter(author == "ada"). What is its read set?',
    options: [
      'Only the docs by ada that were returned',
      'The whole index range channel == "general" — every doc scanned, including those filtered out',
      'The entire messages table',
      'Nothing; queries have no read sets',
    ],
    answer: 1,
    explain: 'Read sets are recorded at the index-range level, for what was scanned. A new message in general by anyone overlaps it and causes a rerun, even if filter() discards it.',
  },
  {
    id: 'tx-4', topic: 'transactions', difficulty: 2, kind: 'mcq', title: 'Why determinism?',
    q: 'Why must mutations be deterministic?',
    options: [
      'For TypeScript type inference',
      'Because OCC may re-execute them from scratch after a conflict — a retry must be safe and produce no external side effects',
      'To make them run on the client',
      'Because V8 cannot run nondeterministic code',
    ],
    answer: 1,
    explain: 'A conflicting mutation is simply run again against a newer snapshot. That is only correct if running it has no effects outside the transaction. (Queries need determinism for caching too.)',
  },
  {
    id: 'tx-5', topic: 'transactions', difficulty: 2, kind: 'predict', title: 'Schedule, then throw',
    q: 'What happens?',
    code: `export const signup = mutation({
  handler: async (ctx, { email }) => {
    await ctx.db.insert("users", { email });
    await ctx.scheduler.runAfter(0, internal.emails.welcome, { email });
    throw new Error("oops");
  },
});`,
    options: [
      'User inserted, email sent',
      'User not inserted, but email sent',
      'Nothing persists and no email is scheduled — scheduling from a mutation is part of the transaction',
      'Email sent twice due to retry',
    ],
    answer: 2,
    explain: 'Scheduled functions are written to a system table in the same transaction. Throwing rolls everything back, including the schedule — exactly the atomicity you want.',
  },
  {
    id: 'tx-6', topic: 'transactions', difficulty: 3, kind: 'mcq', title: 'Hot document',
    q: 'A global "likes" counter doc is patched by 2,000 mutations/second. What will you observe and how do you fix it?',
    options: [
      'Nothing — Convex locks rows',
      'Many OCC conflicts and retries (high latency, possible failures); shard the counter across N docs or use an aggregate component',
      'Writes are silently dropped',
      'Convex auto-shards the document',
    ],
    answer: 1,
    explain: 'Every increment reads and writes the same doc, so concurrent ones conflict. Spread writes (sharded counter), batch them, or use a purpose-built component (e.g. @convex-dev/sharded-counter, aggregate).',
  },
  {
    id: 'tx-7', topic: 'transactions', difficulty: 3, kind: 'order', title: 'Commit path of a mutation',
    q: 'Order the steps of a mutation commit.',
    items: [
      'Mutation begins at a snapshot timestamp',
      'Reads are served from the snapshot and recorded as a read set; writes are buffered',
      'Handler returns; the transaction (read set + write set) is sent to the committer',
      'Committer checks commits after the snapshot ts for writes that overlap the read set',
      'No conflict: assign a commit ts, persist to the log, publish to subscriptions',
    ],
    explain: 'Classic OCC: execute optimistically against a snapshot, validate at commit time, then persist and fan out. On conflict the mutation is re-run from step 1.',
  },

  /* ---------------- Sync ---------------- */
  {
    id: 'sy-1', topic: 'sync', difficulty: 1, kind: 'mcq', title: 'Transport',
    q: 'How does the Convex React client talk to the backend?',
    options: ['One HTTP request per query, polling', 'Server-sent events per query', 'A single WebSocket per client multiplexing all queries, mutations, actions and auth', 'GraphQL subscriptions'],
    answer: 2,
    explain: 'One persistent WebSocket carries everything. (ConvexHttpClient exists for non-reactive server/script use.)',
  },
  {
    id: 'sy-2', topic: 'sync', difficulty: 2, kind: 'mcq', title: 'Consistent snapshots',
    q: 'A page has two queries: unreadCount and messageList. A new message arrives. Which is guaranteed?',
    options: [
      'unreadCount may update before messageList — they are independent',
      'Both are updated in the same Transition, reflecting the same database timestamp; you never see one without the other',
      'Only the query that was subscribed first updates',
      'Neither updates until refresh',
    ],
    answer: 1,
    explain: 'The client\'s whole query set advances together from one timestamp to the next. All results the client sees are a consistent snapshot of the database.',
  },
  {
    id: 'sy-3', topic: 'sync', difficulty: 3, kind: 'mcq', title: 'When does a mutation promise resolve?',
    q: 'With ConvexReactClient, when does `await sendMessage(...)` resolve?',
    options: [
      'As soon as the request is written to the socket',
      'When the server commits, before queries update',
      'After the server commits AND the client has received query results at or after the commit timestamp — so subscribed queries already reflect the write',
      'After all clients have received the update',
    ],
    answer: 2,
    explain: 'The client holds the mutation result until a Transition reaches the mutation\'s commit ts. That gives read-your-own-writes: after await, your UI already shows the change.',
  },
  {
    id: 'sy-4', topic: 'sync', difficulty: 2, kind: 'mcq', title: 'Optimistic updates',
    q: 'When is an optimistic update discarded?',
    options: [
      'After a fixed 5s timeout',
      'When the mutation is sent',
      'When the server state that includes the mutation arrives (or the mutation fails, which rolls it back)',
      'Never; it becomes the real data',
    ],
    answer: 2,
    explain: 'Optimistic updates are local edits to cached query results. They are replayed on top of each new server snapshot until the snapshot includes the real write, then dropped — no flicker.',
  },
  {
    id: 'sy-5', topic: 'sync', difficulty: 3, kind: 'order', title: 'Write → every screen',
    q: 'Order: how a write reaches other users\' screens.',
    items: [
      'Mutation commits writes at timestamp T',
      'Subscription manager intersects the write set with all live read sets',
      'Overlapping queries rerun at T (others keep cached results)',
      'Each affected connection\'s sync worker builds a Transition ending at T',
      'Clients apply all query updates atomically and React re-renders',
    ],
    explain: 'Commit → match → rerun → push → apply. Only affected subscriptions do work.',
  },
  {
    id: 'sy-6', topic: 'sync', difficulty: 2, kind: 'mcq', title: 'Reconnect',
    q: 'A phone loses connection for 30 seconds, then reconnects. What does the client do?',
    options: [
      'Shows an error until reload',
      'Opens a new WebSocket and re-sends its full query set (and auth); the server reruns the queries and sends fresh results',
      'Replays all missed Transitions from a server-side queue',
      'Falls back to polling permanently',
    ],
    answer: 1,
    explain: 'Query subscriptions are client-held state; on reconnect the client re-establishes them and receives a fresh consistent snapshot. It does not need every intermediate change, just the latest state.',
  },
  {
    id: 'sy-7', topic: 'sync', difficulty: 3, kind: 'mcq', title: 'Shared query cache',
    q: 'Two users run api.posts.list({ page: "home" }). The query never calls ctx.auth. What can Convex do?',
    options: [
      'Must execute separately for each user',
      'Can serve both from the same cached result, because the result depends only on function + args (+ the data in the read set)',
      'Caching is only client-side',
      'Merge their WebSockets',
    ],
    answer: 1,
    explain: 'Query results are cached keyed by function and arguments (and identity when auth is used). Deterministic queries make this safe. Calling ctx.auth makes the result identity-specific.',
  },

  /* ---------------- Internals ---------------- */
  {
    id: 'in-1', topic: 'internals', difficulty: 1, kind: 'mcq', title: 'Implementation language',
    q: 'What is the Convex backend primarily written in?',
    options: ['Go', 'Rust, embedding V8 to run your JavaScript/TypeScript', 'Elixir', 'Node.js'],
    answer: 1,
    explain: 'The open-source convex-backend is a Rust codebase. Your functions run in V8 isolates driven from Rust; Node actions run in a separate Node.js environment.',
  },
  {
    id: 'in-2', topic: 'internals', difficulty: 2, kind: 'mcq', title: 'Persistence when self-hosting',
    q: 'Self-hosted Convex stores its data in…',
    options: ['Only in memory', 'SQLite by default, or Postgres/MySQL', 'MongoDB', 'Redis'],
    answer: 1,
    explain: 'Convex implements its own transactional document layer (log, MVCC, indexes, read sets) on top of a pluggable persistence layer. Self-hosting defaults to SQLite; Postgres or MySQL are supported for production.',
  },
  {
    id: 'in-3', topic: 'internals', difficulty: 3, kind: 'mcq', title: 'How reads at a timestamp work',
    q: 'How can a query read a consistent snapshot while writes keep committing?',
    options: [
      'It takes a table lock',
      'Documents and index entries are versioned by commit timestamp (MVCC); a read at ts T sees the latest version ≤ T',
      'It copies the table first',
      'It retries until no writes happen',
    ],
    answer: 1,
    explain: 'Every commit appends new versions at a monotonically increasing timestamp. Readers pick a ts and read "as of" it, so readers never block writers and vice versa.',
  },
  {
    id: 'in-4', topic: 'internals', difficulty: 2, kind: 'mcq', title: 'Search',
    q: 'Which is true of Convex full-text search indexes?',
    options: [
      'Queries against them are not reactive',
      'They are reactive and transactional like other queries, and can have filter fields for equality pre-filtering',
      'They require Elasticsearch',
      'They can only be used from actions',
    ],
    answer: 1,
    explain: 'withSearchIndex queries run inside queries, participate in subscriptions, and see consistent data. (Vector search, by contrast, is called from actions.)',
  },
  {
    id: 'in-5', topic: 'internals', difficulty: 3, kind: 'mcq', title: 'Why a single committer?',
    q: 'Why does a deployment funnel commits through one committer?',
    options: [
      'Cost savings',
      'It defines a single total order of commit timestamps, which makes OCC validation, the write log and subscription fan-out simple and serializable',
      'JavaScript is single-threaded',
      'It is a temporary limitation with no benefit',
    ],
    answer: 1,
    explain: 'A single serialization point assigns monotonically increasing timestamps. Validation is "did anything after my snapshot touch my read set?", and subscribers consume one ordered log.',
  },

  /* ---------------- Platform ---------------- */
  {
    id: 'pf-1', topic: 'platform', difficulty: 2, kind: 'mcq', title: 'Scheduled function guarantees',
    q: 'Which execution guarantees does the scheduler provide?',
    options: [
      'Both mutations and actions: exactly once',
      'Scheduled mutations: exactly once · scheduled actions: at most once (not automatically retried)',
      'Both: at least once',
      'No guarantees',
    ],
    answer: 1,
    explain: 'Mutations are transactional and safe to retry, so Convex can guarantee exactly-once. Actions may have side effects, so they run at most once; make them idempotent and handle retries yourself if needed.',
  },
  {
    id: 'pf-2', topic: 'platform', difficulty: 1, kind: 'order', title: 'File upload',
    q: 'Order the standard upload flow.',
    items: [
      'Client calls a mutation that returns ctx.storage.generateUploadUrl()',
      'Client POSTs the file bytes to that URL',
      'Upload response returns a storageId',
      'Client calls a mutation that saves the storageId in a document',
      'Queries use ctx.storage.getUrl(storageId) to serve it',
    ],
    explain: 'Bytes go straight to storage, not through your function. Your DB just holds the Id<"_storage">.',
  },
  {
    id: 'pf-3', topic: 'platform', difficulty: 2, kind: 'mcq', title: 'Auth',
    q: 'How does a Convex function know who the user is?',
    options: [
      'Reads a session cookie',
      'The client sends a JWT (from Clerk, Auth0, Convex Auth, …) over the WebSocket; the backend validates it against providers in auth.config.ts; ctx.auth.getUserIdentity() returns the identity or null',
      'From the args object',
      'Convex requires its own user table only',
    ],
    answer: 1,
    explain: 'Convex is an OIDC/JWT consumer. Identity is verified server-side; you still must check it in every public function that needs it.',
  },
  {
    id: 'pf-4', topic: 'platform', difficulty: 2, kind: 'mcq', title: 'Vector search',
    q: 'Where can you call vector search?',
    options: ['In queries (reactive)', 'In actions via ctx.vectorSearch, then load docs with a query', 'Only from the client', 'In mutations'],
    answer: 1,
    explain: 'ctx.vectorSearch is available in actions; it returns ids + scores, which you then hydrate with a runQuery.',
  },
  {
    id: 'pf-5', topic: 'platform', difficulty: 3, kind: 'mcq', title: 'Components',
    q: 'What is a Convex component?',
    options: [
      'A React component that wraps useQuery',
      'An isolated backend module (own tables, functions, schema) installed into your app; you access its data only through its API and calls stay inside your transactions',
      'A microservice running on separate infrastructure',
      'A UI kit',
    ],
    answer: 1,
    explain: 'Components (e.g. rate limiter, aggregate, workpool, migrations) are sandboxed: they can\'t read your tables and you can\'t read theirs directly. Mutation calls into a component are still part of one transaction.',
  },
  {
    id: 'pf-6', topic: 'platform', difficulty: 1, kind: 'mcq', title: 'HTTP actions',
    q: 'You need to receive a Stripe webhook. What do you use?',
    options: ['A query', 'An httpAction routed in convex/http.ts, served on your deployment\'s .convex.site domain', 'A cron job', 'A mutation with args: v.any()'],
    answer: 1,
    explain: 'httpAction handles raw Request → Response (verify signatures there), then calls ctx.runMutation to record the event.',
  },

  /* ---------------- Patterns / security ---------------- */
  {
    id: 'pt-1', topic: 'patterns', difficulty: 2, kind: 'bug', title: 'The open delete',
    q: 'What is the security problem?',
    code: `export const deleteDoc = mutation({
  handler: async (ctx, { id }: { id: any }) => {
    await ctx.db.delete(id);
  },
});`,
    options: [
      'delete is not awaited properly',
      'It is a public function with no argument validation and no auth/ownership check: any client can delete any document in any table',
      'mutations cannot delete',
      'id should be a number',
    ],
    answer: 1,
    explain: 'Every public function is an API endpoint on the internet. Validate args (v.id("docs")), get the identity, and verify ownership before writing. Use internal functions for anything privileged.',
  },
  {
    id: 'pt-2', topic: 'patterns', difficulty: 2, kind: 'bug', title: 'Scan instead of index',
    q: 'This query gets slower and re-runs too often as the app grows. Why?',
    code: `export const forChannel = query({
  args: { channel: v.string() },
  handler: (ctx, { channel }) =>
    ctx.db.query("messages")
      .filter((q) => q.eq(q.field("channel"), channel))
      .collect(),
});`,
    options: [
      'collect() is deprecated',
      'filter scans the whole table: cost grows with ALL messages, and since the read set is the whole table, every new message in any channel reruns every channel\'s subscription',
      'channel should be v.id',
      'Nothing is wrong',
    ],
    answer: 1,
    explain: 'Add .index("by_channel", ["channel"]) and use withIndex. Cost becomes proportional to that channel, and the read set shrinks to that channel\'s range.',
  },
  {
    id: 'pt-3', topic: 'patterns', difficulty: 1, kind: 'mcq', title: 'Testing',
    q: 'What is the standard way to unit-test Convex functions?',
    options: ['Only manual testing in the dashboard', 'convex-test with Vitest: an in-memory mock backend that runs your functions with your schema', 'Jest snapshot of _generated', 'Deploy to prod and watch logs'],
    answer: 1,
    explain: 'convex-test lets you call t.query / t.mutation / t.action against a fake backend, including scheduled functions and auth identities.',
  },
  {
    id: 'pt-4', topic: 'patterns', difficulty: 3, kind: 'mcq', title: 'Where business logic lives',
    q: 'Your teammate puts all permission checks in React (hiding buttons). Why is this insufficient?',
    options: [
      'React is slower',
      'Clients can call any public function directly with any args; authorization must be enforced inside the server function',
      'Convex strips UI checks',
      'It is fine',
    ],
    answer: 1,
    explain: 'The client is untrusted. A common pattern is custom function wrappers (e.g. convex-helpers customQuery/customMutation) that load the user and enforce rules for every endpoint.',
  },

  /* ---------------- Boss level ---------------- */
  {
    id: 'boss-1', topic: 'patterns', difficulty: 3, boss: true, kind: 'mcq', title: 'The jittery chat app',
    q: 'A chat app with 500 channels uses `.filter(channel == X)` for messages. Under load, CPU is high and every client re-renders whenever anyone posts in any channel. The root cause and fix?',
    options: [
      'React re-rendering — add React.memo',
      'Read set = whole table, so every insert invalidates every channel subscription and each rerun scans all messages. Add a by_channel index and query withIndex — the read set shrinks to one channel and scan cost to that channel\'s size',
      'WebSocket is too chatty — switch to polling',
      'Increase function timeout',
    ],
    answer: 1,
    explain: 'This combines read sets, invalidation and scan cost. Indexing fixes both CPU (fewer docs scanned) and fan-out (fewer subscriptions invalidated).',
  },
  {
    id: 'boss-2', topic: 'transactions', difficulty: 3, boss: true, kind: 'mcq', title: 'Leaderboard under fire',
    q: 'A game updates a single `leaderboard` doc (top 100 array) from every score submission (~500/s). Mutations time out with conflict errors. Best redesign?',
    options: [
      'Retry harder from the client',
      'Write each score as its own doc into a scores table with an index on score; the leaderboard query reads the top 100 via withIndex(...).order("desc").take(100). (Or use the aggregate component for ranks/counts.)',
      'Move scoring to an action so it isn\'t transactional',
      'Put the leaderboard in localStorage',
    ],
    answer: 1,
    explain: 'Inserts of distinct docs don\'t conflict with each other. The index keeps scores sorted, so "top N" is a cheap range read — and it\'s reactive. Actions would trade conflicts for lost updates.',
  },
  {
    id: 'boss-3', topic: 'platform', difficulty: 3, boss: true, kind: 'mcq', title: 'Payments without double charging',
    q: 'You charge a card via Stripe and record the order. Which design is safest?',
    options: [
      'Client calls an action that charges Stripe, then the client calls a mutation to record it',
      'A mutation creates order{status:"pending"} and schedules an internal action (runAfter 0). The action calls Stripe with an idempotency key = orderId, then runs an internal mutation to set status "paid"/"failed". A Stripe webhook (httpAction) reconciles too.',
      'A mutation calls fetch to Stripe directly',
      'A query charges the card when the page loads',
    ],
    answer: 1,
    explain: 'The intent is committed atomically with scheduling (no orphaned charge intent). Actions are at-most-once, so the idempotency key + webhook reconciliation cover crashes. Mutations can\'t fetch; queries must be side-effect free.',
  },
  {
    id: 'boss-4', topic: 'functions', difficulty: 3, boss: true, kind: 'mcq', title: '"Online now" never changes',
    q: 'A presence query returns users with `lastSeen > Date.now() - 60_000`. Users who go idle never disappear from the list until someone else heartbeats. Why, and what\'s a correct fix?',
    options: [
      'Bug in Convex caching — disable it',
      'Time passing isn\'t a write, so the query isn\'t invalidated. Fix: have heartbeats write, and either pass a coarse "now" bucket as an argument from the client (changing args = new subscription) or have a scheduled function mark users offline (a write that invalidates).',
      'Use Math.random to bust the cache',
      'Run the query in an action',
    ],
    answer: 1,
    explain: 'Reactivity is driven by data changes in the read set. Make time explicit: as an argument, or as data written by the scheduler. (The @convex-dev/presence component packages this.)',
  },
  {
    id: 'boss-5', topic: 'database', difficulty: 3, boss: true, kind: 'mcq', title: 'Zero-downtime required field',
    q: 'You need `teamId` to be required on 3M existing `tasks`. What sequence works?',
    options: [
      'Change the schema to v.id("teams") and push',
      'Add teamId as v.optional, deploy code that writes it on new docs, run a batched migration (paginated internal mutations, e.g. via the migrations component) to backfill, then make it required and push',
      'Delete all tasks and re-import',
      'One mutation that patches all 3M docs',
    ],
    answer: 1,
    explain: 'Schema pushes validate existing data, and single transactions have limits. Widen → dual-write → backfill in batches → narrow.',
  },
  {
    id: 'boss-6', topic: 'sync', difficulty: 3, boss: true, kind: 'mcq', title: 'Read-your-writes across navigation',
    q: 'User submits a form (`await createPost()`), then you navigate to /posts which subscribes to posts:list. Can they briefly see a list WITHOUT their new post?',
    options: [
      'Yes, always — eventual consistency',
      'No for queries on the same ConvexReactClient: the mutation promise resolves only after the client\'s state reached the commit ts, and new subscriptions are answered at a ts ≥ the client\'s current one',
      'Only if they are on Wi-Fi',
      'Yes, unless you add a sleep',
    ],
    answer: 1,
    explain: 'The client maintains a monotonic timestamp: by the time await returns, it\'s at or past the commit, and later results never go back in time. (A different client — e.g. ConvexHttpClient on a server render — doesn\'t share that guarantee.)',
  },
];
