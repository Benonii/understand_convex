import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Diagram, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="why" title="Why transactions are the whole game">
      <p>
        Every Convex <C>mutation</C> is a single ACID transaction. You never write <C>BEGIN</C>, <C>COMMIT</C>,
        <C>SELECT … FOR UPDATE</C>, or take a lock. The function body <em>is</em> the transaction: everything it reads comes
        from one consistent snapshot, and everything it writes either commits atomically or not at all.
      </p>
      <p>
        Convex gets this without locks by combining two classic ideas: <strong>MVCC</strong> (multi-version concurrency
        control: every write creates a new version stamped with a commit timestamp, and readers read “as of” a timestamp)
        and <strong>OCC</strong> (optimistic concurrency control: run the transaction without locking, then validate at
        commit time that nothing you read has changed; if it did, throw the work away and run it again).
      </p>
      <Callout kind="analogy" title="Git rebase, but automatic">
        A mutation is like a branch cut from <C>main</C> at commit <em>T₀</em>. You do your work locally. When you try to merge,
        the server checks: did anyone push to <C>main</C> a change that touches a file you <em>read</em>? If not, fast-forward.
        If so, Convex throws your branch away and replays your function on the new <C>main</C> — automatically, without
        bothering you.
      </Callout>
      <KeyTerms
        terms={[
          { term: 'Timestamp (ts)', def: 'A monotonically increasing 64-bit logical/physical time assigned to each commit. Every document version is tagged with the ts of the commit that wrote it.' },
          { term: 'Snapshot / begin ts', def: 'The timestamp a function reads at. All reads see exactly the database as of that ts — no torn reads, no partial writes from others.' },
          { term: 'Read set', def: 'The set of index ranges (not just documents!) the function read. Includes ranges that returned nothing.' },
          { term: 'Write set', def: 'The documents the function inserted, patched, replaced or deleted, buffered in memory until commit.' },
          { term: 'Committer', def: 'A single serialized component in the backend that validates and applies transactions in timestamp order.' },
          { term: 'OCC conflict', def: 'A commit between your begin ts and your commit ts wrote something inside your read set. Your transaction is rejected and retried.' },
        ]}
      />
    </Section>

    <Section id="mvcc" title="MVCC: every write is a new version at a timestamp">
      <p>
        Convex never updates a document “in place” at the logical level. A <C>ctx.db.patch(id, …)</C> produces a new
        <em> revision</em> of that document, keyed by <C>(id, ts)</C>. Index entries are versioned the same way:
        <C>(indexId, indexKey, ts)</C>. To read “the database at ts = 1000” you take, for each key, the latest version with
        <C>ts ≤ 1000</C>. Deletes are tombstone versions.
      </p>
      <Diagram
        title="One document, many versions"
        height={250}
        describe={'A document "user:42" has versions at ts=100 {credits:10}, ts=180 {credits:7}, ts=240 tombstone/deleted. A reader at snapshot ts=200 sees credits:7. A reader at ts=150 sees credits:10. A reader at ts=260 sees nothing (deleted). New writes never disturb readers at older timestamps.'}
        caption="A reader at snapshot ts=200 sees the version written at ts=180, regardless of what commits after."
      >
        <line x1="60" y1="130" x2="940" y2="130" stroke="var(--line)" strokeWidth="2" />
        {[
          { x: 200, ts: 100, t: '{ credits: 10 }', c: 'var(--yellow)' },
          { x: 460, ts: 180, t: '{ credits: 7 }', c: 'var(--yellow)' },
          { x: 760, ts: 240, t: 'tombstone', c: 'var(--red)' },
        ].map((v) => (
          <g key={v.ts}>
            <circle cx={v.x} cy={130} r={9} fill={v.c} />
            <text x={v.x} y={105} textAnchor="middle" fill="var(--fg)" fontSize="15" fontFamily="JetBrains Mono">ts={v.ts}</text>
            <text x={v.x} y={165} textAnchor="middle" fill="var(--muted)" fontSize="14" fontFamily="JetBrains Mono">{v.t}</text>
          </g>
        ))}
        <line x1="580" y1="40" x2="580" y2="220" stroke="var(--purple)" strokeWidth="2" strokeDasharray="6 6" />
        <text x="580" y="235" textAnchor="middle" fill="var(--purple)" fontSize="14" fontFamily="JetBrains Mono">reader @ ts=200 → credits: 7</text>
        <text x="60" y="40" fill="var(--muted)" fontSize="14" fontFamily="JetBrains Mono">document user:42 — revisions over time →</text>
      </Diagram>
      <p>
        This is what makes reads cheap and safe: a query at ts=200 can keep reading while ten other mutations commit,
        and it will never see any of them. It also means a <em>whole function</em> sees one frozen world — there is no
        “read committed” weirdness where two reads in the same function disagree.
      </p>
      <Callout kind="deep" title="Retention">
        Old versions can’t live forever. The backend keeps a bounded window of history (on the order of minutes, approximately)
        and garbage-collects older revisions. That window is what lets in-flight transactions keep reading their snapshot
        and lets the committer check for conflicts.
      </Callout>
    </Section>

    <Section id="read-sets" title="Read sets are index ranges, not just rows">
      <p>
        When your function calls <C>ctx.db.query('messages').withIndex('by_channel', q =&gt; q.eq('channel', c))</C>, the
        backend doesn’t just remember the documents it returned. It records the <strong>interval of the index</strong> that
        was scanned: <C>by_channel ∈ [ (c), (c, +∞) )</C>. This is crucial for correctness:
      </p>
      <ul>
        <li>If someone <em>inserts</em> a new message into channel <C>c</C>, it lands inside that interval — a conflict (or, for queries, an invalidation), even though you never “read” that document. This is how Convex prevents <strong>phantoms</strong>.</li>
        <li>If someone inserts into channel <C>d</C>, it’s outside the interval — no conflict.</li>
        <li><C>ctx.db.get(id)</C> records a point range on the by-id index.</li>
        <li><C>.take(10)</C> on an ordered index records only the range actually traversed (up to the 10th key), so it’s narrower than <C>.collect()</C>.</li>
        <li><C>.filter(…)</C> does <em>not</em> narrow the read set: the filter runs in JS over documents the index scan already read. Filtering a full-table scan means your read set is the whole table.</li>
      </ul>
      <Code
        title="convex/messages.ts — what goes into the read set"
        code={`
export const sendAndCount = mutation({
  args: { channel: v.id("channels"), body: v.string() },
  handler: async (ctx, { channel, body }) => {
    // READ: point range on channels.by_id = [channel]
    const ch = await ctx.db.get(channel);
    if (!ch) throw new Error("no channel");

    // READ: range on messages.by_channel = [(channel, -inf), (channel, +inf)]
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .order("desc")
      .take(50); // only the traversed prefix of the range is recorded

    // WRITE: buffered in the write set, invisible to others until commit
    await ctx.db.insert("messages", { channel, body });
    await ctx.db.patch(channel, { lastMessageAt: Date.now() });
    return recent.length;
  },
});`}
      />
      <Callout kind="insight" title="Same mechanism, two jobs">
        The exact same read-set data structure is used twice: by the <strong>committer</strong> to detect OCC conflicts for
        mutations, and by the <strong>subscription manager</strong> to decide which live queries to re-run. Learn read sets once
        and you understand both transactions and reactivity.
      </Callout>
    </Section>

    <Section id="occ" title="The commit protocol, step by step">
      <p>
        A mutation executes in a V8 isolate against a snapshot at <C>begin_ts</C>. Reads go to the database layer (through
        indexes at <C>begin_ts</C>); writes accumulate in a pending write set in memory, and your own subsequent reads see
        your own pending writes. When the handler returns, the runner ships <C>(begin_ts, read set, write set)</C> to the
        Committer.
      </p>
      <p>The committer — conceptually a single serial loop — does roughly:</p>
      <ol>
        <li>Pick a new <C>commit_ts</C> greater than every previous commit.</li>
        <li>Look at every transaction committed in <C>(begin_ts, commit_ts)</C> (it keeps a recent in-memory write log for exactly this).</li>
        <li>If any of their writes fall inside any of your read ranges → <strong>reject: OCC conflict</strong>.</li>
        <li>Otherwise, durably append your writes (documents + index entries at <C>commit_ts</C>) to persistence, then publish the commit to the write log so subscriptions can be invalidated.</li>
        <li>Respond to the client with success and the <C>commit_ts</C>.</li>
      </ol>
      <p>
        On a conflict the function runner simply <strong>re-runs your entire handler</strong> at a fresh snapshot. This is
        invisible to you except as latency; after a bounded number of retries it gives up with an error suggesting the
        documents are too contended.
      </p>
      <Flow
        title="Two concurrent mutations, one conflict, one retry"
        height={440}
        nodes={[
          { id: 'a', label: 'Mutation A', sub: 'buyTicket (client 1)', x: 30, y: 40, tone: 'yellow', code: ['application.mutation', 'db.transaction'] },
          { id: 'b', label: 'Mutation B', sub: 'buyTicket (client 2)', x: 30, y: 300, tone: 'purple', code: ['application.mutation', 'db.transaction'] },
          { id: 'snap', label: 'Snapshot @ ts=500', sub: 'event.remaining = 1', x: 310, y: 170, w: 200, code: ['db.snapshot', 'db.timestamp'] },
          { id: 'com', label: 'Committer', sub: 'serial, validates', x: 600, y: 170, tone: 'red', code: ['db.committer', 'db.occ', 'db.nextCommitTs'] },
          { id: 'log', label: 'Write log + persistence', sub: 'ts=510: remaining=0', x: 800, y: 40, w: 180, code: ['db.writeLog', 'persistence.sqliteWrite'] },
          { id: 'retry', label: 'Retry B @ ts=511', sub: 'sees remaining = 0', x: 800, y: 300, w: 180, code: ['application.mutation', 'db.commitConflict'] },
        ]}
        edges={[
          { id: 'a-snap', from: 'a', to: 'snap', label: 'read event', code: ['db.readSet', 'db.indexRange'] },
          { id: 'b-snap', from: 'b', to: 'snap', label: 'read event', code: ['db.readSet', 'db.indexRange'] },
          { id: 'a-com', from: 'a', to: 'com', label: 'commit', curve: -0.15, code: ['db.committer', 'db.writes'] },
          { id: 'com-log', from: 'com', to: 'log', label: 'apply ts=510', code: ['db.publish', 'persistence.sqliteWrite'] },
          { id: 'b-com', from: 'b', to: 'com', label: 'commit', curve: 0.15, code: ['db.committer', 'db.occ'] },
          { id: 'com-retry', from: 'com', to: 'retry', label: 'conflict!', code: ['db.commitConflict', 'application.mutation'] },
        ]}
        steps={[
          { title: 'Both start at the same snapshot', text: 'A and B both begin at ts=500. Each reads the event document and sees remaining = 1. Neither takes a lock; they run truly in parallel in separate isolates.', nodes: ['a', 'b', 'snap'], edges: ['a-snap', 'b-snap'] },
          { title: 'Both decide to buy', text: 'Each handler computes remaining - 1 = 0 and buffers a patch in its private write set, plus an insert into tickets. Nothing is visible to anyone else yet.', nodes: ['a', 'b'] },
          { title: 'A reaches the committer first', text: 'A submits begin_ts=500, read set {events.by_id[event]}, write set {event: remaining=0, tickets: +1}. No commits happened in (500, now), so validation passes.', nodes: ['a', 'com'], edges: ['a-com'] },
          { title: 'A is committed at ts=510', text: 'The committer assigns commit_ts=510, durably writes the new document revisions and index entries, and appends them to the in-memory write log. Subscriptions reading this event are invalidated.', nodes: ['com', 'log'], edges: ['com-log'] },
          { title: 'B submits — and is checked against ts=510', text: 'B also has begin_ts=500. The committer scans commits in (500, now) and finds ts=510 wrote events.by_id[event], which is inside B\'s read set. That is an OCC conflict: B read stale data.', nodes: ['b', 'com', 'log'], edges: ['b-com'] },
          { title: 'B is discarded and transparently retried', text: 'B\'s write set is thrown away (it never touched disk). The runner re-executes B\'s handler from the top at a fresh snapshot, ts=511.', nodes: ['com', 'retry'], edges: ['com-retry'] },
          { title: 'The retry sees the truth', text: 'Now B reads remaining = 0 and throws "sold out" (or returns gracefully). Result: exactly one ticket sold. No lock, no SELECT FOR UPDATE, no race — and the client code is the naive version.', nodes: ['retry'] },
        ]}
        caption="This is why mutation handlers must be deterministic and side-effect free: they may run more than once."
      />
      <Check
        q="Mutation X begins at ts=100 and only reads documents via messages.by_channel for channel 'general'. Before X commits, mutation Y commits at ts=105 inserting a message into channel 'random'. What happens to X?"
        options={['X conflicts and retries, because the messages table changed', 'X commits; Y\'s write is outside X\'s read range', 'X commits but sees Y\'s message', 'X is aborted with an error to the client']}
        answer={1}
        explain="Conflicts are computed on index ranges. Y wrote into by_channel at key 'random', which is outside X's recorded interval for 'general', so there is no overlap and X commits. Table-level changes don't matter, ranges do."
      />
    </Section>

    <Section id="determinism" title="Why determinism is non-negotiable">
      <p>
        Because the runtime may execute your mutation 1, 2 or 5 times, the only observable effects allowed are database
        writes (which are atomic with the commit) and scheduled functions (which are also written transactionally into a
        system table). Everything else would leak out of a discarded attempt. So the Convex runtime for queries and mutations:
      </p>
      <ul>
        <li>disallows <C>fetch</C> and other network I/O (that’s what actions are for);</li>
        <li>seeds <C>Math.random()</C> deterministically per execution;</li>
        <li>freezes <C>Date.now()</C> / <C>new Date()</C> at the start of the function so time doesn’t advance during it;</li>
        <li>runs in a V8 isolate with no filesystem and no Node APIs (unless you opt into the Node runtime — actions only).</li>
      </ul>
      <Code
        title="❌ Side effect inside a mutation (won't even run)"
        code={`
export const checkout = mutation({
  args: { cartId: v.id("carts") },
  handler: async (ctx, { cartId }) => {
    const cart = await ctx.db.get(cartId);
    // fetch is not available in mutations. Even if it were, a retry
    // after an OCC conflict would charge the card twice.
    await fetch("https://api.stripe.com/v1/charges", { method: "POST" });
    await ctx.db.patch(cartId, { status: "paid" });
  },
});`}
      />
      <Code
        title="✅ Commit intent, then do the side effect in an action"
        code={`
export const checkout = mutation({
  args: { cartId: v.id("carts") },
  handler: async (ctx, { cartId }) => {
    await ctx.db.patch(cartId, { status: "charging" });
    // Scheduling is transactional: it only happens if this commit succeeds,
    // and it happens exactly once even if this handler was retried.
    await ctx.scheduler.runAfter(0, internal.payments.charge, { cartId });
  },
});

export const charge = internalAction({
  args: { cartId: v.id("carts") },
  handler: async (ctx, { cartId }) => {
    const res = await fetch("https://api.stripe.com/...", { method: "POST" });
    await ctx.runMutation(internal.carts.markPaid, { cartId, ok: res.ok });
  },
});`}
      />
      <Callout kind="rule">
        Mutations decide; actions do. Put the “what should happen” in a mutation (transactional, retryable), and push the
        “talk to the outside world” into an action that records results via another mutation.
      </Callout>
    </Section>

    <Section id="serializable" title="Isolation level: serializable, by construction">
      <p>
        Validating the full read set (ranges included) against every intervening commit is exactly the condition for
        <strong> serializability</strong>: the final state is as if all mutations ran one at a time in commit-timestamp order.
        Because commit timestamps are assigned by a single committer and a client only gets “success” after the commit is
        durable, the order also respects real time — this is usually called <strong>strict serializability</strong>.
      </p>
      <Compare
        caption="Anomalies vs. isolation level"
        head={['Anomaly', 'Postgres default (Read Committed)', 'Snapshot Isolation', 'Convex']}
        rows={[
          ['Dirty read', 'Prevented', 'Prevented', 'Prevented'],
          ['Non-repeatable read (two reads disagree)', 'Possible', 'Prevented', 'Prevented (one snapshot)'],
          ['Phantom (new row appears in a range)', 'Possible', 'Prevented for reads', 'Prevented (range read sets)'],
          ['Lost update (read-modify-write race)', 'Possible', 'Prevented (first-committer-wins)', 'Prevented'],
          ['Write skew (two txns check, both write disjoint rows)', 'Possible', 'Possible', 'Prevented'],
        ]}
      />
      <Callout kind="insight" title="Write skew is the interesting one">
        Classic example: “at least one doctor must be on call.” Two doctors each read <em>both</em> on-call rows, see 2, and each
        set <em>their own</em> row to off. Under snapshot isolation both commit (they wrote different rows) and you end up with 0
        doctors. In Convex the second commit conflicts because the first one wrote a row inside its read set.
      </Callout>
      <Check
        q="Which anomaly does Convex prevent that plain snapshot isolation does NOT?"
        options={['Dirty reads', 'Write skew', 'Non-repeatable reads', 'Lost updates']}
        answer={1}
        explain="SI checks only write–write conflicts. Convex validates the read set (including ranges) against intervening writes, which also catches read–write dependencies that cause write skew. That's serializability."
      />
    </Section>

    <Section id="impossible" title="Race conditions you no longer have to think about">
      <p>All of these are written the “naive” way in Convex and are still correct:</p>
      <Code
        title="Unique username — no unique constraint needed"
        code={`
export const claimUsername = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) throw new ConvexError("taken");
    // If another claim for the same name commits between our read and our commit,
    // it inserts into by_name[name] — inside our read range — so we retry and see it.
    return await ctx.db.insert("users", { name });
  },
});`}
      />
      <ul>
        <li><strong>Double-spend / overdraft</strong>: read balance, check, decrement — safe.</li>
        <li><strong>Inventory oversell</strong>: the ticket example above.</li>
        <li><strong>Counter increments</strong>: <C>patch(id, {'{'} n: doc.n + 1 {'}'})</C> never loses an increment (but see hot spots below).</li>
        <li><strong>Check-then-insert uniqueness</strong>: as above; index range reads make the “empty result” part of the read set.</li>
        <li><strong>Multi-document invariants</strong>: move money between two accounts atomically.</li>
      </ul>
      <Check
        q="In claimUsername, the index query returned NO document. Why can a concurrent insert of the same name still cause a conflict?"
        options={['Convex locks the whole users table during mutations', 'The read set contains the scanned index range by_name[name], even though it was empty', 'unique() takes a write lock', 'It can\'t — you need a unique index']}
        answer={1}
        explain="Read sets record ranges, not just returned docs. An empty range read is still a read; an insert into that range by someone else overlaps it and invalidates your transaction."
      />
    </Section>

    <Section id="hot" title="Contention: hot documents and broad reads">
      <p>
        OCC is fantastic when conflicts are rare and terrible when they are constant. Two patterns cause most real-world
        trouble:
      </p>
      <ol>
        <li>
          <strong>Hot documents.</strong> A single global counter / “stats” doc patched by every mutation. Every concurrent
          writer conflicts with every other; throughput collapses to roughly one commit per round-trip and retries pile up.
        </li>
        <li>
          <strong>Broad read ranges.</strong> A mutation that does <C>ctx.db.query('orders').collect()</C> (or a full-table
          <C>.filter</C>) has the whole table in its read set — <em>any</em> insert anywhere in <C>orders</C> conflicts with it.
          Same for queries: a subscription over a whole table is invalidated by every write to that table.
        </li>
      </ol>
      <Code
        title="Sharded counter — spread writes across N docs"
        code={`
const SHARDS = 16;

export const increment = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const shard = Math.floor(Math.random() * SHARDS); // deterministic per attempt is fine
    const doc = await ctx.db
      .query("counters")
      .withIndex("by_name_shard", (q) => q.eq("name", name).eq("shard", shard))
      .unique();
    if (doc) await ctx.db.patch(doc._id, { value: doc.value + 1 });
    else await ctx.db.insert("counters", { name, shard, value: 1 });
  },
});

export const read = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const shards = await ctx.db
      .query("counters")
      .withIndex("by_name_shard", (q) => q.eq("name", name))
      .collect();
    return shards.reduce((s, d) => s + d.value, 0);
  },
});`}
      />
      <Compare
        caption="Mitigations"
        head={['Problem', 'Fix', 'Why it works']}
        rows={[
          ['Global counter', 'Sharded counter component / N shard docs', 'Writers usually touch different docs → disjoint write & read sets'],
          ['Count / sum over a table', '@convex-dev/aggregate (B-tree of counts in docs)', 'O(log n) reads; writes touch only a few internal nodes'],
          ['Big doc patched by many fields', 'Split into several docs (e.g. presence separate from profile)', 'Unrelated updates stop conflicting'],
          ['Mutation reads whole table', 'withIndex + eq/range + take(n)', 'Read set shrinks to a small interval'],
          ['Fan-out write to many docs', 'Batch via scheduler in chunks', 'Smaller transactions, fewer overlap windows'],
          ['Throttled writes from many clients', 'Workpool / rate limiter components', 'Control parallelism on a hot resource'],
        ]}
      />
      <Callout kind="warn" title="Symptoms in the dashboard">
        Contention shows up as mutations with high latency and log lines about write conflicts / retries naming the table.
        If you see it, find what document or range everyone is touching.
      </Callout>
      <Check
        q="A mutation inserts a row and then calls ctx.db.query('events').collect() to compute a total. Traffic grows and it starts failing with write conflicts. Best fix?"
        options={['Wrap it in a try/catch and retry manually', 'Keep a running total via an aggregate/sharded counter and read only that', 'Move it to an action', 'Use .filter() instead of .collect()']}
        answer={1}
        explain="The full-table read means every concurrent insert conflicts. Maintain the aggregate incrementally (narrow reads/writes). Manual retries don't help (Convex already retries), actions lose transactionality, and .filter still scans the whole table."
      />
    </Section>

    <Section id="queries-actions" title="Queries are snapshots too; actions are not transactions">
      <p>
        A <C>query</C> also runs at a single snapshot timestamp, so it is internally consistent. It never commits, so it never
        conflicts — instead, its read set is registered with the subscription manager, and any later commit that overlaps it
        causes a re-run (Module 5).
      </p>
      <p>
        An <C>action</C> is just code that may call <C>ctx.runQuery</C> / <C>ctx.runMutation</C>. <strong>Each call is its own
        transaction</strong> at its own timestamp. Two <C>runQuery</C> calls in one action can observe different database
        states, and a <C>runMutation</C> followed by a failure leaves the first write committed.
      </p>
      <Code
        title="❌ Read-modify-write split across transactions in an action"
        code={`
export const bad = action({
  handler: async (ctx) => {
    const n = await ctx.runQuery(api.counter.get);      // tx 1 @ ts=100
    await ctx.runMutation(api.counter.set, { n: n + 1 }); // tx 2 @ ts=140
    // Any increment committed between 100 and 140 is lost. Do the
    // read-modify-write inside ONE mutation instead.
  },
});`}
      />
      <Compare
        head={['', 'query', 'mutation', 'action']}
        rows={[
          ['Transaction?', 'Read-only snapshot', 'Yes, serializable', 'No (each runX is separate)'],
          ['Retried automatically?', 'Re-run on invalidation', 'Yes, on OCC conflict', 'No (at-most-once)'],
          ['Side effects / fetch', 'No', 'No', 'Yes'],
          ['Deterministic required', 'Yes', 'Yes', 'No'],
          ['Reactive / cached', 'Yes', '—', 'No'],
        ]}
      />
      <Check
        q="An action calls runMutation(A) successfully, then fetch() throws. What is the state?"
        options={['A is rolled back', 'A remains committed; the action fails', 'The whole action is retried automatically', 'A is retried']}
        answer={1}
        explain="Actions are not transactional. Each runMutation commits independently. Convex does not automatically retry actions because they may have external side effects; design idempotent steps or use workflow/workpool components."
      />
    </Section>

    <Section id="limits" title="Transaction limits (and why they exist)">
      <p>
        Because a transaction is validated as a unit and must fit in a commit, Convex bounds its size. Exact numbers change —
        check the docs — but approximately:
      </p>
      <ul>
        <li>Documents scanned per function: on the order of tens of thousands (~32k); bytes read ~16 MiB.</li>
        <li>Documents written per mutation: on the order of ~16k; bytes written ~16 MiB.</li>
        <li>User-code execution time for queries/mutations: about 1 second; actions: up to about 10 minutes.</li>
        <li>Single document: ~1 MiB.</li>
      </ul>
      <Callout kind="rule">
        If you’re anywhere near these limits in one transaction, the design is wrong: paginate, batch through the scheduler,
        or maintain incremental aggregates.
      </Callout>
    </Section>
  </>
);

const mod: Module = {
  id: 'transactions',
  n: 4,
  title: 'Transactions, MVCC & OCC',
  kicker: 'How every mutation is serializable without locks',
  minutes: 30,
  summary: 'Snapshots at timestamps, read sets as index ranges, a single committer, automatic retries, and how to avoid contention.',
  Component,
};
export default mod;
