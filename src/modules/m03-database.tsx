import { useState } from 'react';
import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Diagram, Check, C, Copyable } from '../ui/kit';

/* ---------------- Interactive index-range visualiser ---------------- */

type Row = { author: string; status: string; t: number };
const ROWS: Row[] = [
  { author: 'ada', status: 'draft', t: 3 }, { author: 'grace', status: 'live', t: 1 }, { author: 'ada', status: 'live', t: 9 },
  { author: 'linus', status: 'live', t: 4 }, { author: 'ada', status: 'live', t: 6 }, { author: 'grace', status: 'draft', t: 7 },
  { author: 'linus', status: 'draft', t: 2 }, { author: 'ada', status: 'draft', t: 11 }, { author: 'grace', status: 'live', t: 10 },
  { author: 'ada', status: 'live', t: 12 }, { author: 'linus', status: 'live', t: 8 }, { author: 'grace', status: 'live', t: 5 },
];

type Mode = 'filter' | 'eq1' | 'eq2' | 'eq2range' | 'filterOnIndex';
const MODES: Record<Mode, { label: string; code: string; index: 'by_creation_time' | 'by_author_status'; inRange: (r: Row) => boolean; match: (r: Row) => boolean }> = {
  filter: {
    label: '.filter() only',
    code: 'ctx.db.query("posts")\n  .filter(q => q.and(q.eq(q.field("author"), "ada"), q.eq(q.field("status"), "live")))\n  .collect()',
    index: 'by_creation_time',
    inRange: () => true,
    match: (r) => r.author === 'ada' && r.status === 'live',
  },
  eq1: {
    label: 'withIndex eq(author)',
    code: 'ctx.db.query("posts")\n  .withIndex("by_author_status", q => q.eq("author", "ada"))\n  .collect()',
    index: 'by_author_status',
    inRange: (r) => r.author === 'ada',
    match: (r) => r.author === 'ada',
  },
  eq2: {
    label: 'withIndex eq(author).eq(status)',
    code: 'ctx.db.query("posts")\n  .withIndex("by_author_status", q => q.eq("author", "ada").eq("status", "live"))\n  .collect()',
    index: 'by_author_status',
    inRange: (r) => r.author === 'ada' && r.status === 'live',
    match: (r) => r.author === 'ada' && r.status === 'live',
  },
  eq2range: {
    label: '… .gt("_creationTime", 6)',
    code: 'ctx.db.query("posts")\n  .withIndex("by_author_status", q =>\n    q.eq("author", "ada").eq("status", "live").gt("_creationTime", 6))\n  .collect()',
    index: 'by_author_status',
    inRange: (r) => r.author === 'ada' && r.status === 'live' && r.t > 6,
    match: (r) => r.author === 'ada' && r.status === 'live' && r.t > 6,
  },
  filterOnIndex: {
    label: 'withIndex eq(author) + .filter(status)',
    code: 'ctx.db.query("posts")\n  .withIndex("by_author_status", q => q.eq("author", "ada"))\n  .filter(q => q.eq(q.field("status"), "live"))\n  .collect()',
    index: 'by_author_status',
    inRange: (r) => r.author === 'ada',
    match: (r) => r.author === 'ada' && r.status === 'live',
  },
};

function IndexVisualizer() {
  const [mode, setMode] = useState<Mode>('filter');
  const m = MODES[mode];
  const sorted = [...ROWS].sort((a, b) =>
    m.index === 'by_creation_time' ? a.t - b.t : a.author.localeCompare(b.author) || a.status.localeCompare(b.status) || a.t - b.t,
  );
  const scanned = sorted.filter(m.inRange).length;
  const returned = sorted.filter((r) => m.inRange(r) && m.match(r)).length;
  return (
    <Copyable
      label="Index range visualiser"
      className="ixviz"
      extra={`Current mode: ${m.label}. Index used: ${m.index}. Documents scanned (read set): ${scanned} of ${ROWS.length}. Returned: ${returned}.`}
    >
      <div className="flow-kicker">Interactive · index range visualiser</div>
      <p style={{ marginTop: 6 }}>
        12 posts. Pick a query and watch which index entries are <strong>scanned</strong> (part of the read
        set, so they count toward limits and invalidation) and which are <strong>returned</strong>.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        {(Object.keys(MODES) as Mode[]).map((k) => (
          <button key={k} className={`chip ${k === mode ? 'on' : ''}`} onClick={() => setMode(k)}>{MODES[k].label}</button>
        ))}
      </div>
      <pre className="ixviz-code"><code>{m.code}</code></pre>
      <div className="ixviz-meta">
        Index <C>{m.index}</C>{m.index === 'by_author_status' ? <> on <C>["author","status",_creationTime]</C></> : <> on <C>[_creationTime]</C></>} ·
        scanned <strong style={{ color: 'var(--yellow)' }}>{scanned}</strong> · returned <strong style={{ color: 'var(--red)' }}>{returned}</strong> · wasted reads <strong>{scanned - returned}</strong>
      </div>
      <div className="ixviz-rows" role="list">
        {sorted.map((r, i) => {
          const inR = m.inRange(r), hit = inR && m.match(r);
          return (
            <div
              key={i}
              role="listitem"
              style={{
                display: 'grid', gridTemplateColumns: '28px 1fr 1fr 60px 90px', gap: 8, padding: '6px 10px', borderRadius: 8,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 13, transition: 'all .3s',
                background: hit ? 'color-mix(in oklab, var(--red) 22%, transparent)' : inR ? 'color-mix(in oklab, var(--yellow) 16%, transparent)' : 'transparent',
                opacity: inR ? 1 : 0.38,
                marginBottom: 3,
              }}
            >
              <span style={{ color: 'var(--muted)' }}>{i}</span>
              <span>{r.author}</span>
              <span>{r.status}</span>
              <span>t={r.t}</span>
              <span style={{ color: 'var(--muted)' }}>{hit ? 'returned' : inR ? 'scanned' : '—'}</span>
            </div>
          );
        })}
      </div>
      <p className="ixviz-foot">
        Key observation: the index range is contiguous in sort order. <C>.filter()</C> never shrinks the
        range. It only drops rows after they have been read. Moving a condition from <C>.filter</C> into
        <C> withIndex</C> shrinks both the read set (fewer invalidations) and the cost.
      </p>
    </Copyable>
  );
}

/* ---------------- Module ---------------- */

const Component = () => (
  <>
    <Section id="model" title="A document-relational database">
      <p>
        Convex stores <strong>documents</strong> (JSON-like objects with Convex value types) in
        <strong> tables</strong>. Like a document DB, documents are nested and schema-flexible. Like a relational
        DB, you model relationships with IDs across tables, there is no expectation that you denormalize
        everything into one tree, and every transaction is serializable across all tables.
      </p>
      <KeyTerms
        terms={[
          { term: '_id', def: <>Every document's primary key, type <C>{'Id<"table">'}</C>. A string that encodes the table and an internal ID, plus a checksum. It is globally unique and stable for the document's life.</> },
          { term: '_creationTime', def: 'Milliseconds since epoch (a float) assigned at insert. Immutable. Implicitly the last column of every index, which gives every index a deterministic total order.' },
          { term: 'Table', def: 'Created lazily on first insert, or declared in schema.ts. Has a table number internally; IDs are only valid for their own table.' },
          { term: 'Index', def: 'An ordered list of field values (a B-tree-like sorted key space) maintained transactionally with each write.' },
          { term: 'System tables', def: <>Tables prefixed with <C>_</C> (e.g. <C>_storage</C>, <C>_scheduled_functions</C>) managed by Convex and readable via <C>ctx.db.system</C>.</> },
        ]}
      />
      <Callout kind="deep" title="How IDs work">
        An ID isn't a random UUID you can point anywhere. It encodes which table it belongs to (by internal table
        number) plus the per-document internal ID, with a checksum. That's why <C>ctx.db.get(id)</C> needs no
        table name, and why <C>v.id("users")</C> can reject an ID from <C>"posts"</C> at the validator level. Use
        <C> ctx.db.normalizeId("users", str)</C> to safely turn an untrusted string into an ID (or null).
      </Callout>
    </Section>

    <Section id="schema" title="schema.ts and validators">
      <Code
        title="convex/schema.ts"
        code={`
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    tokenIdentifier: v.string(),
    plan: v.union(v.literal("free"), v.literal("pro")),
  }).index("by_token", ["tokenIdentifier"]),

  posts: defineTable({
    author: v.id("users"),
    status: v.union(v.literal("draft"), v.literal("live")),
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
    meta: v.object({ views: v.number(), pinned: v.boolean() }),
  })
    .index("by_author_status", ["author", "status"])
    .searchIndex("search_body", { searchField: "body", filterFields: ["status"] }),

  // Many-to-many join table
  postLikes: defineTable({ post: v.id("posts"), user: v.id("users") })
    .index("by_post", ["post"])
    .index("by_user_post", ["user", "post"]),
});
`}
      />
      <Compare
        caption="The validator vocabulary"
        head={['Validator', 'TS type', 'Notes']}
        rows={[
          [<C>v.string() / v.number() / v.boolean()</C>, 'string / number / boolean', 'number is float64'],
          [<C>v.int64()</C>, 'bigint', 'true 64-bit ints'],
          [<C>v.null()</C>, 'null', 'distinct from undefined'],
          [<C>v.id("t")</C>, 'Id<"t">', 'checks table membership'],
          [<C>v.array(x) / v.object({'{…}'}) / v.record(k, x)</C>, 'T[] / {...} / Record', 'arrays and objects have size limits'],
          [<C>v.union(...) / v.literal(x)</C>, 'A | B / literal', 'discriminated unions work great'],
          [<C>v.optional(x)</C>, 'x | undefined (field may be absent)', 'only meaningful as an object field'],
          [<C>v.bytes()</C>, 'ArrayBuffer', 'small binary; use file storage for big'],
          [<C>v.any()</C>, 'any', 'escape hatch'],
        ]}
      />
      <Callout kind="insight" title="Schema is optional, then enforced">
        Without a schema, Convex infers one from your data (visible in the dashboard). Once you define one,
        <C> defineSchema</C> has <C>schemaValidation: true</C> by default: every write is validated, <em>and</em>
        every push is checked against the existing data. A push that would make existing documents invalid is
        rejected, so the schema is a true invariant.
      </Callout>
      <Callout kind="warn" title="Adding a required field to a populated table">
        Push 1: add it as <C>v.optional(...)</C>. Run a migration to backfill it in batches. Push 2: make it
        required. The second push validates every document and succeeds only once the backfill is complete.
      </Callout>
    </Section>

    <Section id="indexes" title="Indexes: the only way to make a query fast">
      <p>
        Convex has <strong>no query planner</strong>. A query either names an index with <C>withIndex</C> or
        scans the default <C>by_creation_time</C> order. This is a deliberate choice: performance is visible in
        the code and never changes because a planner changed its mind under load.
      </p>
      <Diagram
        title="An index is a sorted key space"
        height={300}
        describe={'Index by_author_status on ["author","status"] is physically a sorted list of keys (author, status, _creationTime, _id) → document. A withIndex query picks a contiguous range: equality on a prefix of fields, then at most one range bound on the next field. Example: eq(author,"ada").eq(status,"live").gt(_creationTime,6) selects a contiguous slice.'}
      >
        <g fontFamily="JetBrains Mono, monospace" fontSize="14">
          {[
            ['ada', 'draft', 3], ['ada', 'draft', 11], ['ada', 'live', 6], ['ada', 'live', 9], ['ada', 'live', 12],
            ['grace', 'draft', 7], ['grace', 'live', 1], ['grace', 'live', 5], ['grace', 'live', 10], ['linus', 'draft', 2],
          ].map(([a, s, t], i) => {
            const inR = a === 'ada' && s === 'live';
            const hi = inR && (t as number) > 6;
            return (
              <g key={i} transform={`translate(${30 + i * 95}, 90)`}>
                <rect width="86" height="110" rx="10" fill={hi ? 'color-mix(in oklab, var(--red) 35%, transparent)' : inR ? 'color-mix(in oklab, var(--yellow) 22%, transparent)' : 'none'} stroke={hi ? 'var(--red)' : inR ? 'var(--yellow)' : 'var(--line)'} />
                <text x="43" y="32" textAnchor="middle" fill="var(--fg)">{a}</text>
                <text x="43" y="58" textAnchor="middle" fill="var(--muted)">{s}</text>
                <text x="43" y="84" textAnchor="middle" fill="var(--muted)">t={t}</text>
              </g>
            );
          })}
          <text x="30" y="60" fill="var(--muted)">by_author_status → (author, status, _creationTime, _id)  sorted ascending</text>
          <path d="M220 225 h280" stroke="var(--yellow)" strokeWidth="3" />
          <text x="225" y="250" fill="var(--yellow)">eq("author","ada").eq("status","live")</text>
          <path d="M315 270 h185" stroke="var(--red)" strokeWidth="3" />
          <text x="320" y="292" fill="var(--red)">… .gt("_creationTime", 6)</text>
        </g>
      </Diagram>
      <Callout kind="rule" title="The withIndex grammar">
        Inside <C>withIndex(name, q =&gt; …)</C> you may write: zero or more <C>.eq</C> on the index fields
        <em> in order</em>, then optionally one lower bound (<C>.gt</C>/<C>.gte</C>) and/or one upper bound
        (<C>.lt</C>/<C>.lte</C>) on the <em>next</em> field. That always describes one contiguous range. You
        cannot skip a field or put equality after a range.
      </Callout>
      <IndexVisualizer />
      <Check
        q="Index by_author_status = ['author','status']. Which withIndex expression is INVALID?"
        options={[
          'q.eq("author", a)',
          'q.eq("author", a).eq("status", "live")',
          'q.eq("status", "live")',
          'q.eq("author", a).eq("status", "live").gte("_creationTime", t)',
        ]}
        answer={2}
        explain="You must constrain index fields as a prefix, in order. Skipping 'author' to constrain 'status' doesn't describe a contiguous range. Define an index starting with 'status' if you need that access path."
      />
      <Callout kind="deep" title="Why the read set is a range, not a list of documents">
        A query that read <C>by_channel = X</C> must be invalidated when a <em>new</em> message is inserted into
        channel X, and that document didn't exist when the query ran. So Convex records the index <em>key range</em>
        scanned, not the doc IDs it returned. Any later write whose index key falls in the range is a conflict
        (for mutations) or an invalidation (for subscriptions). A wide scan with <C>.filter</C> records a wide
        range, so unrelated writes invalidate it too.
      </Callout>
    </Section>

    <Section id="query-api" title="The query builder, end to end">
      <Code
        title="Reading data"
        code={`
// Point read by ID (no index needed)
const post = await ctx.db.get(postId);                     // Doc | null

// Range read via index, newest first, bounded
const recent = await ctx.db.query("posts")
  .withIndex("by_author_status", (q) => q.eq("author", userId).eq("status", "live"))
  .order("desc")
  .take(20);

// Exactly one (throws if >1), or null
const me = await ctx.db.query("users")
  .withIndex("by_token", (q) => q.eq("tokenIdentifier", id.tokenIdentifier))
  .unique();

// First match, or null
const latest = await ctx.db.query("posts").order("desc").first();

// Streaming with for-await (stops reading when you break)
for await (const p of ctx.db.query("posts").withIndex("by_author_status", (q) => q.eq("author", userId))) {
  if (p.meta.pinned) { found = p; break; }
}

// Writing (mutations only)
const id = await ctx.db.insert("posts", { ... });
await ctx.db.patch(id, { title: "New" });    // shallow merge; set field to undefined to remove
await ctx.db.replace(id, { ...whole doc });  // full replace
await ctx.db.delete(id);
`}
      />
      <Compare
        caption="Terminal operations"
        head={['Method', 'Returns', 'Reads', 'Use when']}
        rows={[
          [<C>.collect()</C>, 'all in range', 'whole range', 'range is known to be small'],
          [<C>.take(n)</C>, 'first n', '≈ n (+ filtered-out)', 'bounded lists'],
          [<C>.first()</C>, 'one or null', 'until first match', 'latest / any'],
          [<C>.unique()</C>, 'one or null; throws on >1', 'up to 2', 'lookups by unique key'],
          [<C>.paginate(opts)</C>, '{ page, isDone, continueCursor }', 'one page', 'infinite lists'],
        ]}
      />
      <Check
        q="Which query has the SMALLEST read set?"
        options={[
          'query("posts").filter(q => q.eq(q.field("author"), id)).first()',
          'query("posts").withIndex("by_author_status", q => q.eq("author", id)).first()',
          'query("posts").collect() then .find() in JS',
          'All the same — filter is applied by the database',
        ]}
        answer={1}
        explain="With withIndex the scan starts at the first entry for that author and stops after one doc. The filter version walks by_creation_time until it hits a match, possibly thousands of docs, all in its read set. Filtering in JS after collect() reads everything."
      />
    </Section>

    <Section id="pagination" title="Pagination: cursors and reactive page boundaries">
      <p>
        <C>.paginate({'{ numItems, cursor }'})</C> returns a page plus an opaque <C>continueCursor</C>
        encoding a position in the index. The interesting part is how this stays <em>reactive</em> without
        pages shifting as data is inserted.
      </p>
      <Flow
        title="usePaginatedQuery under the hood"
        height={340}
        nodes={[
          { id: 'hook', label: 'usePaginatedQuery', sub: 'loadMore(20)', x: 20, y: 140, w: 180, tone: 'yellow', code: ['client.usePaginatedQuery'] },
          { id: 'p1', label: 'Page 1 query', sub: 'cursor=null', x: 290, y: 30, code: ['server.paginate'] },
          { id: 'p2', label: 'Page 2 query', sub: 'cursor=c1', x: 290, y: 140, code: ['server.paginate'] },
          { id: 'p3', label: 'Page 3 query', sub: 'cursor=c2', x: 290, y: 250, code: ['server.paginate'] },
          { id: 'idx', label: 'Index', sub: 'by_channel desc', x: 580, y: 140, tone: 'red', code: ['db.indexRange', 'persistence.sqliteScan', 'server.indexRange'] },
          { id: 'ins', label: 'New insert', sub: 'lands in page 1 range', x: 810, y: 30, tone: 'purple', code: ['server.dbWriter', 'db.writes'] },
        ]}
        edges={[
          { id: 'h1', from: 'hook', to: 'p1', code: ['client.usePaginatedQuery'] }, { id: 'h2', from: 'hook', to: 'p2', code: ['client.usePaginatedQuery'] }, { id: 'h3', from: 'hook', to: 'p3', code: ['client.usePaginatedQuery'] },
          { id: '1i', from: 'p1', to: 'idx', code: ['server.paginate', 'db.indexRange'] }, { id: '2i', from: 'p2', to: 'idx', code: ['server.paginate', 'db.indexRange'] }, { id: '3i', from: 'p3', to: 'idx', code: ['server.paginate', 'db.indexRange'] },
          { id: 'ins-idx', from: 'ins', to: 'idx', code: ['db.committer', 'persistence.sqliteWrite'] }, { id: 'idx-1', from: 'idx', to: 'p1', curve: 0.25, label: 'invalidate', code: ['db.subscriptionMatch', 'db.readSet'] },
        ]}
        steps={[
          { title: 'Each page is its own subscription', text: 'The hook subscribes to the same query function once per loaded page, each with a different cursor argument. They are all regular reactive queries.', nodes: ['hook', 'p1', 'p2', 'p3'], edges: ['h1', 'h2', 'h3'] },
          { title: 'First run: page boundaries are discovered', text: 'Page 1 reads 20 items from the start of the range and returns continueCursor c1 (the key after its last item). Page 2 starts at c1, and so on.', nodes: ['p1', 'p2', 'idx'], edges: ['1i', '2i'] },
          { title: 'Boundaries are pinned', text: 'On re-runs, a page reads exactly from its start cursor to the end cursor it returned before (Convex passes the previous end as an internal bound). Each page covers a fixed key range, not "20 items".', nodes: ['p1', 'p2', 'p3', 'idx'], edges: ['1i', '2i', '3i'] },
          { title: 'Insert into page 1\'s range', text: 'A new message lands in page 1\'s key range. Only page 1\'s read set intersects, so only page 1 re-runs.', nodes: ['ins', 'idx', 'p1'], edges: ['ins-idx', 'idx-1'] },
          { title: 'Page grows instead of shifting', text: 'Page 1 now returns 21 items. Nothing is duplicated into page 2 or skipped. The concatenated list stays gap-free and consistent.', nodes: ['p1', 'hook'], edges: ['h1'] },
          { title: 'Splitting large pages', text: 'If a page grows too big, the server can signal that it should be split, and the client re-fetches it as two pages. That keeps reactive pages bounded.', nodes: ['p1', 'hook'] },
        ]}
      />
      <Code
        title="Paginated query + hook"
        code={`
// convex/messages.ts
import { paginationOptsValidator } from "convex/server";
export const page = query({
  args: { channel: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: (ctx, { channel, paginationOpts }) =>
    ctx.db.query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .order("desc")
      .paginate(paginationOpts),
});

// React
const { results, status, loadMore } = usePaginatedQuery(
  api.messages.page, { channel }, { initialNumItems: 25 },
);
// status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"
`}
      />
    </Section>

    <Section id="relations" title="Modeling relations">
      <p>
        There is no <C>JOIN</C>. You join in code, which is fast because function and data are co-located and
        every <C>ctx.db.get</C> is a cheap indexed point read inside the same snapshot.
      </p>
      <Code
        title="One-to-many and many-to-many joins in code"
        code={`
export const feed = query({
  args: { channel: v.id("channels") },
  handler: async (ctx, { channel }) => {
    const msgs = await ctx.db.query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .order("desc").take(50);
    // N+1 is fine here: parallel point reads, same transaction snapshot
    return Promise.all(msgs.map(async (m) => ({
      ...m,
      author: await ctx.db.get(m.author),
    })));
  },
});

// many-to-many: posts <-> users via postLikes
const likes = await ctx.db.query("postLikes")
  .withIndex("by_post", (q) => q.eq("post", postId)).take(100);
const likers = await Promise.all(likes.map((l) => ctx.db.get(l.user)));
`}
      />
      <Compare
        caption="Choosing a shape"
        head={['Relationship', 'Recommended', 'Avoid']}
        rows={[
          ['1 : few (bounded, e.g. ≤ ~10s)', 'Array of IDs or embedded objects on parent', 'Unbounded arrays (doc size limit, hot doc)'],
          ['1 : many', 'Child table with v.id(parent) + index on it', 'Array of child IDs on parent'],
          ['many : many', 'Join table with indexes on both sides', 'Arrays on both sides'],
          ['Counts / aggregates', 'Maintain a counter doc, sharded counter, or Aggregate component', '.collect().length on every read'],
        ]}
      />
      <Callout kind="warn" title="Arrays inside documents are not indexed">
        You can't <C>withIndex</C> on "array contains X". If you need to look up by tag, use a
        <C> postTags</C> join table indexed by tag (or a search index's filter fields).
      </Callout>
    </Section>

    <Section id="writes" title="How writes and index maintenance happen">
      <Flow
        title="ctx.db.patch → durable, indexed, visible"
        height={300}
        nodes={[
          { id: 'h', label: 'Handler', sub: 'ctx.db.patch(id, …)', x: 20, y: 120, tone: 'purple', code: ['server.dbWriter', 'server.syscall', 'isolate.syscalls'] },
          { id: 'buf', label: 'Write buffer', sub: 'in-txn overlay', x: 230, y: 120, tone: 'yellow', code: ['db.writes', 'db.transaction'] },
          { id: 'val', label: 'Validate', sub: 'schema + limits', x: 440, y: 20, tone: 'red', code: ['values.validators'] },
          { id: 'ix', label: 'Index updates', sub: 'old key ✗ new key ✓', x: 440, y: 220, tone: 'red', code: ['persistence.documentLog', 'db.writes'] },
          { id: 'log', label: 'Commit @ ts', sub: 'docs + index rows', x: 680, y: 120, tone: 'plain', code: ['db.committer', 'persistence.sqliteWrite', 'persistence.sqlite'] },
          { id: 'subs', label: 'Readers', sub: 'snapshot ≥ ts', x: 880, y: 120, w: 100, code: ['db.snapshot', 'db.publish'] },
        ]}
        edges={[
          { id: 'h-b', from: 'h', to: 'buf', code: ['server.dbWriter', 'db.writes'] }, { id: 'b-v', from: 'buf', to: 'val' }, { id: 'b-i', from: 'buf', to: 'ix', code: ['persistence.documentLog'] },
          { id: 'v-l', from: 'val', to: 'log', code: ['db.committer'] }, { id: 'i-l', from: 'ix', to: 'log', code: ['persistence.sqliteWrite'] }, { id: 'l-s', from: 'log', to: 'subs', code: ['db.publish', 'db.subscriptions'] },
        ]}
        steps={[
          { title: 'Writes are buffered', text: 'patch/insert/delete don\'t touch storage. They go into a per-transaction write buffer. Later reads in the same mutation see them (read-your-own-writes inside the txn).', nodes: ['h', 'buf'], edges: ['h-b'] },
          { title: 'Schema validation', text: 'The new document version is validated against the table\'s validator (when schemaValidation is on) and size limits. A failure throws and discards the whole transaction.', nodes: ['buf', 'val'], edges: ['b-v'] },
          { title: 'Compute index deltas', text: 'For every index on the table, the old key is removed and the new key added. A patch that doesn\'t change indexed fields doesn\'t move the doc in those indexes.', nodes: ['buf', 'ix'], edges: ['b-i'] },
          { title: 'Atomic commit', text: 'Document revisions and index entries are written together at one commit timestamp. MVCC means older snapshots still see the previous revision.', nodes: ['val', 'ix', 'log'], edges: ['v-l', 'i-l'] },
          { title: 'Visible to new snapshots', text: 'Any query evaluated at a timestamp ≥ commit ts sees the change. Subscriptions whose read ranges include the old or new index keys are invalidated.', nodes: ['log', 'subs'], edges: ['l-s'] },
        ]}
      />
      <Check
        q="A query reads by_status eq('open'). A mutation changes a task from 'open' to 'closed'. Is the query invalidated?"
        options={['No — the task is no longer open', 'Yes — the delete of the old index key ("open", …) falls inside the read range', 'Only if the query used .collect()', 'Only after a timeout']}
        answer={1}
        explain="Index maintenance removes the old key and inserts the new one. The removal of ('open', creationTime, id) intersects the query's range, so the query re-runs and the task correctly disappears from the list."
      />
    </Section>

    <Section id="ops" title="Index backfills, staged indexes, and limits">
      <p>
        Adding an index to a large table means building it from existing data. On push, Convex backfills new
        indexes before the push completes, and the index can't be queried until it's ready. For very large
        tables you can declare an index as <strong>staged</strong> so it backfills in the background without
        blocking the deploy, then un-stage it to make it usable once it's built (check the docs for the current
        syntax).
      </p>
      <Callout kind="rule" title="Index hygiene">
        Every index costs write amplification: each insert or patch of an indexed field updates every index on
        the table. Prefer one compound index such as <C>["author","status"]</C> that serves both
        <C> eq(author)</C> and <C>eq(author).eq(status)</C> over two separate ones. A prefix of a compound index
        is itself usable.
      </Callout>
      <Check
        q="You have index by_author_status ['author','status']. Do you also need by_author ['author']?"
        options={['Yes, a compound index can only be used with all fields', 'No — eq("author", x) uses a prefix of by_author_status', 'Only for descending order', 'Only if author is optional']}
        answer={1}
        explain="Any prefix of a compound index is a valid range. by_author would just be redundant write amplification (though it orders by _creationTime directly after author, which can matter for 'newest by author regardless of status')."
      />
    </Section>
  </>
);

const mod: Module = {
  id: 'database',
  n: 3,
  title: 'The Database & Indexes',
  kicker: 'Data model',
  minutes: 40,
  summary: 'Documents, IDs, schemas and validators; indexes as sorted key spaces; withIndex vs filter; read sets as ranges; pagination internals; modeling relations.',
  Component,
};
export default mod;
