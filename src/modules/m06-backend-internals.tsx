import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Diagram, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="oss" title="It's open source, and it's Rust">
      <p>
        The Convex backend lives at <C>github.com/get-convex/convex-backend</C>. It is a large Rust workspace (dozens of
        crates) plus the TypeScript runtime pieces (the <C>convex</C> npm package, the UDF runtime that runs inside V8, the
        dashboard). The same code powers Convex Cloud and self-hosted deployments; the cloud adds multi-tenant
        orchestration, Node action infrastructure, backups and so on.
      </p>
      <p>
        A <strong>deployment</strong> (e.g. <C>happy-otter-123</C>) is, approximately, one backend process with its own
        database, function code, file storage, scheduler and search indexes. Dev, prod and preview deployments are fully
        separate databases.
      </p>
      <Diagram
        title="Map of a Convex deployment"
        height={470}
        describe={'A Convex deployment: clients connect over HTTPS and WebSocket to the HTTP/WebSocket front (axum-based). Requests go to the sync layer (sync workers per connection) and the application layer, which dispatches to the function runner (V8 isolates via rusty_v8 for queries, mutations, default-runtime actions, HTTP actions) or to a Node.js executor for "use node" actions (AWS Lambda in cloud, a local node process when self-hosted). Functions talk to the database layer: transaction/snapshot manager, committer, in-memory write log, subscription manager, index & table metadata. Text search and vector search indexes sit alongside. The database layer persists to a persistence backend (SQLite by default self-hosted, Postgres or MySQL; cloud uses a managed SQL store on AWS). Files go to object storage (S3 or local disk). Scheduler and cron jobs run as internal workers reading system tables.'}
      >
        <g fontFamily="JetBrains Mono" fontSize="13">
          <rect x="30" y="20" width="940" height="50" rx="10" fill="none" stroke="var(--yellow)" />
          <text x="50" y="50" fill="var(--fg)">Clients: browser (WebSocket sync) · HTTP API · HTTP actions · CLI/dashboard</text>
          <rect x="30" y="90" width="940" height="50" rx="10" fill="none" stroke="var(--yellow)" />
          <text x="50" y="120" fill="var(--fg)">HTTP / WebSocket front (Rust, axum-style)  ·  auth (JWT validation)  ·  routing</text>
          <rect x="30" y="160" width="300" height="80" rx="10" fill="none" stroke="var(--purple)" />
          <text x="50" y="190" fill="var(--fg)">Sync workers</text>
          <text x="50" y="214" fill="var(--muted)">per-connection query sets</text>
          <rect x="350" y="160" width="300" height="80" rx="10" fill="none" stroke="var(--purple)" />
          <text x="370" y="190" fill="var(--fg)">Function runner (V8)</text>
          <text x="370" y="214" fill="var(--muted)">isolates via rusty_v8</text>
          <rect x="670" y="160" width="300" height="80" rx="10" fill="none" stroke="var(--purple)" />
          <text x="690" y="190" fill="var(--fg)">Node executor</text>
          <text x="690" y="214" fill="var(--muted)">"use node" actions (Lambda)</text>
          <rect x="30" y="260" width="940" height="100" rx="10" fill="none" stroke="var(--red)" />
          <text x="50" y="290" fill="var(--fg)">Database layer</text>
          <text x="50" y="315" fill="var(--muted)">snapshots @ ts · committer (OCC) · in-memory write log · subscription manager</text>
          <text x="50" y="338" fill="var(--muted)">tables & index metadata · text search · vector search · scheduler · crons</text>
          <rect x="30" y="380" width="600" height="70" rx="10" fill="none" stroke="var(--line)" />
          <text x="50" y="410" fill="var(--fg)">Persistence: SQLite | Postgres | MySQL</text>
          <text x="50" y="432" fill="var(--muted)">documents log + index entries (MVCC)</text>
          <rect x="650" y="380" width="320" height="70" rx="10" fill="none" stroke="var(--line)" />
          <text x="670" y="410" fill="var(--fg)">Object storage</text>
          <text x="670" y="432" fill="var(--muted)">S3 / local disk: files, modules</text>
        </g>
      </Diagram>
      <KeyTerms
        terms={[
          { term: 'Deployment', def: 'One isolated backend instance: its own DB, code, files, env vars. Dev/prod/preview are separate deployments.' },
          { term: 'UDF', def: '"User-defined function": internal name for your queries/mutations/actions.' },
          { term: 'Isolate', def: 'A V8 sandbox with its own heap. Cheap to create compared to a process/container; Convex runs your JS inside them.' },
          { term: 'Persistence', def: 'The pluggable durable store under the database layer. Convex uses it like a log + key-value store, not as a relational DB.' },
          { term: 'Write log', def: 'In-memory record of recent commits used for OCC validation and subscription invalidation.' },
          { term: 'System tables', def: 'Tables prefixed with _ (e.g. _scheduled_functions, _storage) managed by Convex but queryable via ctx.db.system.' },
        ]}
      />
    </Section>

    <Section id="runtime" title="The function runtime: V8 isolates, not Node">
      <p>
        Queries, mutations, HTTP actions and default actions run in the <strong>Convex JS runtime</strong>: V8 embedded in
        Rust via <C>rusty_v8</C>. Your bundled modules are loaded into an isolate; the runtime exposes a small set of
        “syscalls” back into Rust — <C>ctx.db.get</C>, index scans, inserts, <C>ctx.auth</C>, scheduler, storage — via
        async ops. There is no Node <C>fs</C>, no <C>process</C>, no native modules.
      </p>
      <ul>
        <li><strong>Why isolates?</strong> Startup in milliseconds (not seconds), strong memory isolation per request, tight control over determinism (patched <C>Math.random</C>, frozen <C>Date</C>), and the ability to block <C>fetch</C> in queries/mutations.</li>
        <li><strong>Every DB call crosses into Rust.</strong> That’s where read sets are recorded and where limits (documents scanned, bytes read) are enforced.</li>
        <li><strong>Web-standard APIs</strong> (<C>fetch</C> in actions, <C>TextEncoder</C>, <C>crypto.subtle</C>, <C>URL</C>, <C>Blob</C>, streams) are available in the default runtime.</li>
        <li><strong>Node runtime:</strong> a file starting with <C>"use node"</C> can only define actions; those run on a Node.js executor (AWS Lambda in the cloud; a local Node process when self-hosting). Node actions have slower cold starts and can’t share a file with queries/mutations.</li>
      </ul>
      <Code
        title="convex/ai.ts — Node runtime action"
        code={`
"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai"; // npm packages that need Node built-ins

export const summarize = action({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const doc = await ctx.runQuery(internal.docs.get, { docId });
    const out = await new OpenAI().chat.completions.create({ /* ... */ });
    await ctx.runMutation(internal.docs.saveSummary, { docId, summary: out.choices[0].message.content! });
  },
});`}
      />
      <Check
        q="Why can't a file marked 'use node' export a mutation?"
        options={['Node is too slow', 'Mutations must run in the deterministic V8 runtime colocated with the database; Node actions run in a separate executor', 'It can, with a flag', 'Because Node lacks TypeScript']}
        answer={1}
        explain="Queries and mutations need the deterministic, sandboxed Convex runtime that records read sets and runs close to the DB. The Node executor is a separate environment used only for actions."
      />
    </Section>

    <Section id="mutation-life" title="Life of a mutation through the backend">
      <Flow
        title="From useMutation() to durable commit"
        height={430}
        nodes={[
          { id: 'ws', label: 'WebSocket front', sub: 'Mutation req', x: 20, y: 40, tone: 'yellow', code: ['sync.wsHandler', 'local_backend.router', 'sync.worker'] },
          { id: 'app', label: 'Application layer', sub: 'auth · routing', x: 260, y: 40, tone: 'yellow', code: ['sync.mutation', 'application.mutation', 'application.idempotency'] },
          { id: 'iso', label: 'V8 isolate', sub: 'your handler', x: 500, y: 40, tone: 'purple', code: ['isolate.v8', 'isolate.client', 'isolate.determinism', 'isolate.environment'] },
          { id: 'tx', label: 'Transaction', sub: 'snapshot @ begin_ts', x: 760, y: 40, w: 200, tone: 'purple', code: ['db.transaction', 'db.readSet', 'db.writes'] },
          { id: 'com', label: 'Committer', sub: 'validate + order', x: 760, y: 260, w: 200, tone: 'red', code: ['db.committer', 'db.occ', 'db.commitConflict', 'db.nextCommitTs'] },
          { id: 'per', label: 'Persistence', sub: 'docs + index rows', x: 500, y: 260, tone: 'red', code: ['persistence.trait', 'persistence.documentLog', 'persistence.sqlite', 'persistence.postgres'] },
          { id: 'sub', label: 'Write log / subs', sub: 'invalidate', x: 260, y: 260, tone: 'red', code: ['db.writeLog', 'db.subscriptions', 'db.subscriptionMatch'] },
        ]}
        edges={[
          { id: 'ws-app', from: 'ws', to: 'app', label: 'decode', code: ['sync.wsHandler', 'client.protocol'] },
          { id: 'app-iso', from: 'app', to: 'iso', label: 'run UDF', code: ['runner.functionRunner', 'server.registration'] },
          { id: 'iso-tx', from: 'iso', to: 'tx', label: 'db syscalls', code: ['isolate.syscalls', 'server.syscall', 'server.dbWriter'] },
          { id: 'tx-com', from: 'tx', to: 'com', label: 'read+write sets', code: ['db.transaction', 'db.committer'] },
          { id: 'com-per', from: 'com', to: 'per', label: 'write @ commit_ts', code: ['persistence.sqliteWrite', 'persistence.documentLog', 'db.timestamp'] },
          { id: 'per-sub', from: 'per', to: 'sub', label: 'publish', code: ['db.publish', 'db.writeLog'] },
          { id: 'sub-ws', from: 'sub', to: 'ws', label: 'Response + Transitions', curve: -0.15, code: ['sync.transition', 'sync.mutation'] },
        ]}
        steps={[
          { title: 'Request arrives', text: 'A Mutation message lands on the WebSocket (or POST /api/mutation over HTTP). The session\'s auth identity was established earlier via Authenticate; the JWT was validated against your auth.config providers.', nodes: ['ws', 'app'], edges: ['ws-app'] },
          { title: 'Validate args & dispatch', text: 'The application layer resolves the function path (e.g. "messages:send") in the currently pushed modules, checks it is public (or internal-only callers), validates args against the declared validators, then hands it to the function runner.', nodes: ['app', 'iso'], edges: ['app-iso'] },
          { title: 'Run in an isolate', text: 'An isolate with your bundled module runs the handler. The transaction is opened at begin_ts (a recent committed timestamp). Every ctx.db call is an async op into Rust.', nodes: ['iso', 'tx'], edges: ['iso-tx'] },
          { title: 'Reads and writes accumulate', text: 'Reads go through index range scans at begin_ts and are recorded in the read set. Writes are validated against the schema and buffered in the transaction\'s write set; later reads in the same function see them.', nodes: ['tx'] },
          { title: 'Commit request', text: 'The handler returns. The transaction (begin_ts, read set, write set, scheduled jobs) is sent to the committer, which assigns commit_ts and checks the write log for overlapping commits in (begin_ts, commit_ts). On conflict → retry from step 3.', nodes: ['tx', 'com'], edges: ['tx-com'] },
          { title: 'Durable write', text: 'The committer writes new document revisions and index entries tagged with commit_ts to persistence. Only after this succeeds is the commit considered done.', nodes: ['com', 'per'], edges: ['com-per'] },
          { title: 'Publish & respond', text: 'The commit is published into the in-memory write log: the snapshot "latest ts" advances, the subscription manager invalidates overlapping queries, and the client receives MutationResponse with ts plus transitions for its queries.', nodes: ['per', 'sub', 'ws'], edges: ['per-sub', 'sub-ws'] },
        ]}
      />
      <Callout kind="deep" title="Why a single committer scales well enough">
        Serializing commits sounds like a bottleneck, but the committer only does validation (interval checks against
        recent writes) and a persistence write; all the expensive user JS runs in parallel beforehand. Commits can also
        be pipelined/batched to persistence. Throughput of a single deployment is bounded, but high (approximately
        thousands of mutations/second for small transactions) — and contention, not the committer, is usually what you hit
        first.
      </Callout>
    </Section>

    <Section id="storage" title="How data is actually stored">
      <p>
        Convex uses the underlying SQL database as a dumb, durable, ordered key-value log — not as a relational schema with a
        table per Convex table. Approximately, there are two big physical structures:
      </p>
      <Compare
        head={['Physical structure', 'Key', 'Value', 'Purpose']}
        rows={[
          [<strong>documents</strong>, '(document id, ts)', 'full document JSON (or tombstone), previous ts', 'The transaction log: every revision ever written (within retention)'],
          [<strong>indexes</strong>, '(index id, index key bytes, ts)', 'document id (or deleted marker)', 'Ordered, versioned index entries for every index incl. by_id and by_creation_time'],
        ]}
      />
      <p>
        Index keys are encoded so that byte-order matches Convex’s value ordering (<C>undefined &lt; null &lt; number &lt; …</C>), and every
        user index implicitly has <C>_creationTime</C> and <C>_id</C> appended so keys are unique and ties are ordered. A read
        “at ts=T” takes, for each key, the newest entry with ts ≤ T — that’s MVCC on top of plain ordered rows.
      </p>
      <Callout kind="insight" title="Why this design?">
        Because it keeps the persistence layer swappable (SQLite, Postgres, MySQL) and moves all the interesting semantics —
        snapshots, OCC, subscriptions, schema — into Rust code Convex controls. The SQL engine just needs ordered range scans
        and durable appends.
      </Callout>
      <Flow
        title="A query read through an index at a timestamp"
        height={400}
        nodes={[
          { id: 'q', label: 'withIndex(by_channel)', sub: 'eq channel = c, take(20)', x: 20, y: 40, w: 230, tone: 'yellow', code: ['server.dbReader', 'server.indexRange'] },
          { id: 'rng', label: 'Key range', sub: '[ (c), (c, ∞) )', x: 320, y: 40, tone: 'purple', code: ['db.indexRange', 'value.id'] },
          { id: 'mem', label: 'Recent writes', sub: 'in-memory, ts > persisted', x: 580, y: 40, w: 200, tone: 'red', code: ['db.writeLog', 'db.snapshot'] },
          { id: 'idx', label: 'indexes rows', sub: 'latest ts ≤ T per key', x: 320, y: 240, tone: 'red', code: ['persistence.sqliteScan', 'persistence.sqlite'] },
          { id: 'docs', label: 'documents rows', sub: 'fetch (id, ts)', x: 580, y: 240, w: 200, tone: 'red', code: ['persistence.documentLog', 'persistence.sqlite'] },
          { id: 'rs', label: 'Read set', sub: 'range up to 20th key', x: 820, y: 140, w: 160, tone: 'plain', code: ['db.readSet', 'db.token'] },
        ]}
        edges={[
          { id: 'q-rng', from: 'q', to: 'rng', label: 'encode bounds', code: ['server.indexRange', 'server.dbReader'] },
          { id: 'rng-idx', from: 'rng', to: 'idx', label: 'range scan @ T', code: ['persistence.sqliteScan', 'db.indexRange'] },
          { id: 'rng-mem', from: 'rng', to: 'mem', label: 'merge', code: ['db.snapshot', 'db.writeLog'] },
          { id: 'idx-docs', from: 'idx', to: 'docs', label: 'ids → docs', code: ['db.indexRange', 'persistence.sqliteScan'] },
          { id: 'docs-rs', from: 'docs', to: 'rs', label: 'record', code: ['db.readSet', 'db.indexRange'] },
        ]}
        steps={[
          { title: 'Build the range', text: 'The index expression eq("channel", c) is encoded into byte bounds over the by_channel index: everything starting with key prefix (c). order("desc") just walks it backward.', nodes: ['q', 'rng'], edges: ['q-rng'] },
          { title: 'Scan the index at T', text: 'The database layer scans index entries in that key range, keeping for each key the newest entry with ts ≤ T, skipping deleted markers. Results come out in index order.', nodes: ['rng', 'idx'], edges: ['rng-idx'] },
          { title: 'Merge recent state', text: 'Approximately: very recent commits and caches in memory are consulted so reads don\'t always hit the SQL store. Either way the result must equal "the database as of T".', nodes: ['rng', 'mem'], edges: ['rng-mem'] },
          { title: 'Load documents', text: 'For each index hit, the document revision for that id at ts ≤ T is loaded (from cache or the documents log). take(20) stops after 20.', nodes: ['idx', 'docs'], edges: ['idx-docs'] },
          { title: 'Record what was read', text: 'The interval actually traversed — from the start bound to the 20th key — is added to the read set, along with bytes/docs scanned for limit accounting.', nodes: ['docs', 'rs'], edges: ['docs-rs'] },
          { title: 'Why .filter is expensive', text: 'If instead you had used .filter(channel == c) on a full table scan, steps 2–4 would iterate the whole by_creation_time index and the read set would be the entire table. Indexes are the only way to narrow scans.', nodes: ['q', 'idx', 'rs'] },
        ]}
      />
      <Check
        q="Approximately how is a Convex table stored in Postgres when self-hosting with Postgres?"
        options={['One Postgres table per Convex table with columns per field', 'All tables share generic documents/indexes tables keyed by id+ts and index id+key+ts', 'As JSONB in one row per table', 'In Postgres large objects']}
        answer={1}
        explain="Convex treats persistence as an ordered log/KV store. Documents and index entries for every table live in shared physical tables, versioned by timestamp. Schema and semantics are enforced in Rust."
      />
    </Section>

    <Section id="system-tables" title="System tables & metadata">
      <p>
        Convex dogfoods its own database for metadata. Tables, indexes, schemas, modules, scheduled jobs and file metadata are
        stored as documents in system tables (approximately <C>_tables</C>, <C>_index</C>, <C>_schemas</C>, <C>_modules</C>,
        <C>_scheduled_functions</C>, <C>_storage</C>, <C>_cron_jobs</C>…). That gives metadata the same transactional
        guarantees as your data: scheduling a function in a mutation is just an insert into a system table, committed
        atomically with your writes.
      </p>
      <Code
        title="Reading system tables"
        code={`
export const pendingJobs = query({
  args: {},
  handler: async (ctx) => {
    // Only some system tables are exposed via ctx.db.system
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((j) => j.state.kind === "pending");
  },
});

export const fileMeta = query({
  args: { id: v.id("_storage") },
  handler: (ctx, { id }) => ctx.db.system.get(id), // { sha256, size, contentType, ... }
});`}
      />
      <Callout kind="deep" title="Table numbers & IDs">
        Each table has a numeric identifier; document IDs encode the table number plus a random internal id (and a checksum),
        rendered as a string. That’s why <C>v.id("users")</C> can validate that an id belongs to a specific table, and why
        <C>ctx.db.get(id)</C> doesn’t need the table name.
      </Callout>
    </Section>

    <Section id="deploy" title="Push & deploy: what `npx convex dev` really does">
      <Flow
        title="npx convex dev / deploy"
        height={330}
        nodes={[
          { id: 'cli', label: 'CLI', sub: 'watch convex/', x: 20, y: 130, tone: 'yellow', code: ['cli.push', 'cli.useNode'] },
          { id: 'esb', label: 'esbuild bundle', sub: 'per runtime', x: 230, y: 30, tone: 'yellow', code: ['cli.bundle', 'cli.useNode'] },
          { id: 'gen', label: 'Codegen', sub: '_generated/*', x: 230, y: 230, tone: 'plain', code: ['cli.codegen', 'server.anyApi'] },
          { id: 'up', label: 'Upload', sub: 'modules + schema', x: 450, y: 130, tone: 'purple', code: ['cli.push'] },
          { id: 'an', label: 'Analyze', sub: 'exports, validators', x: 660, y: 30, tone: 'purple', code: ['cli.push', 'server.registration'] },
          { id: 'sc', label: 'Schema check', sub: 'backfill indexes', x: 660, y: 230, tone: 'red', code: ['cli.push', 'values.validators'] },
          { id: 'live', label: 'Atomic switch', sub: 'new code live', x: 830, y: 130, w: 150, tone: 'red', code: ['cli.push'] },
        ]}
        edges={[
          { id: 'cli-esb', from: 'cli', to: 'esb', code: ['cli.bundle'] },
          { id: 'cli-gen', from: 'cli', to: 'gen', code: ['cli.codegen'] },
          { id: 'esb-up', from: 'esb', to: 'up', code: ['cli.push'] },
          { id: 'up-an', from: 'up', to: 'an', code: ['cli.push'] },
          { id: 'up-sc', from: 'up', to: 'sc', code: ['cli.push'] },
          { id: 'an-live', from: 'an', to: 'live' },
          { id: 'sc-live', from: 'sc', to: 'live' },
        ]}
        steps={[
          { title: 'Bundle', text: 'The CLI bundles every file in convex/ with esbuild — one bundle set for the Convex runtime, another for "use node" files.', nodes: ['cli', 'esb'], edges: ['cli-esb'] },
          { title: 'Generate types', text: 'convex/_generated/api.d.ts, server.d.ts and dataModel.d.ts are regenerated from your exports and schema so api.foo.bar and Doc<"table"> are typed end-to-end.', nodes: ['cli', 'gen'], edges: ['cli-gen'] },
          { title: 'Upload', text: 'Bundled modules, source maps, the schema and auth config are pushed to the deployment.', nodes: ['esb', 'up'], edges: ['esb-up'] },
          { title: 'Analyze', text: 'The backend loads the modules in an isolate to discover exported functions, their type (query/mutation/action), visibility, argument and return validators, HTTP routes and crons.', nodes: ['up', 'an'], edges: ['up-an'] },
          { title: 'Validate schema & build indexes', text: 'If schema validation is on, existing documents are checked against the new schema; new indexes are backfilled in the background. Pushing a schema that existing data violates fails the push.', nodes: ['up', 'sc'], edges: ['up-sc'] },
          { title: 'Go live atomically', text: 'Once everything is ready, the new module version, schema and indexes are committed as metadata in one step. New function calls use new code; there is no partially deployed state.', nodes: ['an', 'sc', 'live'], edges: ['an-live', 'sc-live'] },
        ]}
      />
      <Check
        q="You add a new index to schema.ts on a table with 5M rows and push. What happens?"
        options={['The push blocks writes until done', 'The index is backfilled before the push completes; queries using it work once live', 'You must write a migration to build it', 'The index only covers new documents']}
        answer={1}
        explain="Convex backfills new indexes as part of the push (approximately: in the background, without blocking writes), and only switches to the new schema once the index is ready. You never get an index covering only part of the table."
      />
    </Section>

    <Section id="search" title="Text search, vector search, file storage">
      <Compare
        head={['Feature', 'How it’s built (approximately)', 'Consistency']}
        rows={[
          ['Full-text search (searchIndex)', 'Inverted index built on Tantivy (Rust Lucene-like); recent writes held in memory and merged with on-disk segments', 'Transactional & reactive: search queries are subscribable and see your writes'],
          ['Vector search (vectorIndex)', 'ANN index over float vectors with filter fields; stored in segments, recent writes merged', 'Only callable from actions (ctx.vectorSearch); returns ids + scores'],
          ['File storage', 'Blobs in object storage (S3 in cloud, local disk self-host); metadata row in _storage', 'Metadata is transactional; upload via generateUploadUrl, serve via getUrl / HTTP actions'],
        ]}
      />
      <Code
        title="Search & vector index definitions"
        code={`
export default defineSchema({
  messages: defineTable({ channel: v.id("channels"), body: v.string() })
    .index("by_channel", ["channel"])
    .searchIndex("search_body", { searchField: "body", filterFields: ["channel"] }),
  chunks: defineTable({ docId: v.id("docs"), text: v.string(), embedding: v.array(v.float64()) })
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["docId"] }),
});

// query (reactive)
ctx.db.query("messages").withSearchIndex("search_body", (q) =>
  q.search("body", "hello world").eq("channel", c)).take(10);

// action (not reactive)
const hits = await ctx.vectorSearch("chunks", "by_embedding", { vector, limit: 8 });`}
      />
      <Check
        q="Where can you call vector search?"
        options={['Queries only', 'Actions (ctx.vectorSearch)', 'Mutations only', 'Anywhere']}
        answer={1}
        explain="Vector search is exposed via ctx.vectorSearch in actions. It returns ids and scores; load documents with ctx.runQuery. Full-text search, by contrast, works in queries and is reactive."
      />
    </Section>

    <Section id="components" title="Components: isolated namespaces">
      <p>
        <strong>Convex components</strong> (e.g. <C>@convex-dev/aggregate</C>, <C>rate-limiter</C>, <C>workpool</C>,
        <C>workflow</C>, <C>presence</C>) are mini Convex backends installed into your app via <C>convex.config.ts</C>. Each
        component has its <strong>own tables, functions and scheduler namespace</strong>: your code can’t read its tables
        directly and it can’t read yours. You interact via its API (<C>components.aggregate.…</C>). Calls into a component
        from a mutation run in the <em>same transaction</em> — so a component write commits or rolls back with yours.
      </p>
      <Code
        title="convex/convex.config.ts"
        code={`
import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(aggregate, { name: "leaderboard" });
app.use(rateLimiter);
export default app;`}
      />
      <Callout kind="analogy">
        Components are like npm packages that come with their own database schema — but sandboxed, so a buggy library can’t
        corrupt your tables, and still transactional with your code.
      </Callout>
    </Section>

    <Section id="self-host" title="Self-hosting and operations">
      <ul>
        <li><strong>Docker:</strong> the <C>convex-backend</C> image plus a <C>dashboard</C> image. Default persistence is SQLite on a volume; point it at Postgres or MySQL via a database URL env var for production. Files go to local disk or S3-compatible storage.</li>
        <li><strong>CLI:</strong> set <C>CONVEX_SELF_HOSTED_URL</C> and <C>CONVEX_SELF_HOSTED_ADMIN_KEY</C> (generated by a script in the container) and use <C>npx convex dev/deploy</C> as usual.</li>
        <li><strong>Node actions</strong> self-hosted run in a local Node process rather than Lambda.</li>
        <li><strong>Data out:</strong> snapshot export/import (<C>npx convex export / import</C>), streaming export to warehouses (e.g. via Fivetran/Airbyte), log streams (Axiom, Datadog, webhooks) on paid cloud plans.</li>
        <li><strong>Backups:</strong> cloud offers scheduled backups and restores; self-host you back up the persistence DB + file storage.</li>
      </ul>
      <Code
        lang="bash"
        title="Self-host quickstart (approximate)"
        code={`
curl -O https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/docker/docker-compose.yml
docker compose up -d
docker compose exec backend ./generate_admin_key.sh
# .env.local
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<key>
npx convex dev`}
      />
      <Check
        q="What's the default persistence backend of a fresh self-hosted Convex Docker setup?"
        options={['Postgres', 'SQLite', 'MySQL', 'RocksDB']}
        answer={1}
        explain="SQLite on a mounted volume by default; Postgres and MySQL are supported via configuration for production setups."
      />
      <Callout kind="rule">
        If you remember one sentence: <em>Convex is a Rust process that turns an ordered SQL log into a serializable,
        reactive, versioned document database, and runs your TypeScript inside V8 next to it.</em>
      </Callout>
    </Section>
  </>
);

const mod: Module = {
  id: 'backend-internals',
  n: 6,
  title: 'Inside the Backend',
  kicker: 'Rust, V8 isolates and a log-structured store',
  minutes: 40,
  summary: 'The open-source Rust backend: function runner, committer, persistence layout, system tables, deploy pipeline, search, components and self-hosting.',
  Component,
};
export default mod;
