import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Diagram, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="what" title="What Convex actually is">
      <p>
        Convex is a backend made of three things built to fit together: a transactional document database, a
        serverless function runtime that sits right next to it, and a sync engine that keeps clients up to date
        over WebSockets. You don't write SQL, configure a cache, or run a pub/sub bus. You write TypeScript
        functions (queries, mutations, actions) and they run <em>inside</em> the backend, right beside the data.
      </p>
      <p>
        The key design choice: <strong>the database knows exactly what every query read</strong>. A query
        function is deterministic and only touches data through <C>ctx.db</C>, so the system can record its
        <em> read set</em> (the index ranges it scanned). When a mutation commits, Convex checks its writes against
        the read sets of every live subscription and re-runs only the queries whose results could have changed.
        Reactivity, caching, consistency and retries all follow from that.
      </p>
      <Callout kind="analogy" title="A spreadsheet for your backend">
        Think of every <C>useQuery</C> as a spreadsheet cell holding a formula. The formula (your query
        function) reads other cells (documents in index ranges). When any of those cells change, the
        spreadsheet recomputes the formula and shows the new value. You never write invalidation code. The
        dependency tracking is automatic and exact, because the "spreadsheet" (the database) runs the formula itself.
      </Callout>
      <KeyTerms
        terms={[
          { term: 'Deployment', def: 'One isolated Convex backend instance (dev, prod, preview). It has its own database, functions, env vars, and URL (https://<name>.convex.cloud).' },
          { term: 'Query', def: 'A read-only, deterministic, transactional function. It can be cached and subscribed to.' },
          { term: 'Mutation', def: 'A read-write, deterministic, transactional function. It commits atomically, or it is retried or fails as a whole.' },
          { term: 'Action', def: 'A non-transactional function that can call the outside world (fetch, SDKs). It reaches the DB only by calling queries and mutations.' },
          { term: 'Read set', def: 'The precise set of index ranges a function read during execution. The basis of conflict detection and invalidation.' },
          { term: 'Sync engine', def: 'The WebSocket protocol plus the server-side machinery that keeps every client\'s subscribed query results consistent and current.' },
        ]}
      />
    </Section>

    <Section id="architecture" title="The big-picture architecture">
      <p>
        Follow one request from a React component to disk and back. The backend is written in Rust (open source
        as <C>get-convex/convex-backend</C>). It hosts V8 isolates for your JS functions, a transaction log and
        index layer on top of a persistence store, and per-connection sync workers that speak the WebSocket
        protocol.
      </p>
      <Flow
        title="Convex end-to-end: from useQuery to disk and back"
        height={460}
        nodes={[
          { id: 'app', label: 'React app', sub: 'useQuery / useMutation', x: 20, y: 40, tone: 'plain', code: ['client.useQuery', 'client.useSubscription', 'client.useQueries'] },
          { id: 'client', label: 'Convex client', sub: 'BaseConvexClient', x: 20, y: 200, tone: 'yellow', code: ['client.base', 'client.localState', 'client.reactClient', 'client.subscribe'] },
          { id: 'sync', label: 'Sync worker', sub: 'one per WebSocket', x: 290, y: 200, tone: 'yellow', code: ['sync.worker', 'sync.state', 'sync.wsHandler'] },
          { id: 'runner', label: 'Function runner', sub: 'V8 isolates (Rust host)', x: 560, y: 60, tone: 'purple', code: ['runner.functionRunner', 'isolate.v8', 'isolate.client'] },
          { id: 'db', label: 'Database layer', sub: 'txn log + indexes', x: 560, y: 220, tone: 'red', code: ['db.transaction', 'db.snapshot', 'db.indexRange'] },
          { id: 'subs', label: 'Subscription mgr', sub: 'read sets of live queries', x: 290, y: 370, tone: 'yellow', code: ['db.subscriptions', 'db.subscriptionMatch'] },
          { id: 'persist', label: 'Persistence', sub: 'SQLite / Postgres / MySQL', x: 810, y: 220, w: 170, tone: 'plain', code: ['persistence.trait', 'persistence.sqlite', 'persistence.documentLog', 'persistence.postgres'] },
        ]}
        edges={[
          { id: 'a-c', from: 'app', to: 'client', label: 'subscribe', code: ['client.useQueries', 'client.subscribe', 'client.localState'] },
          { id: 'c-s', from: 'client', to: 'sync', label: 'WebSocket', code: ['client.websocket', 'client.protocol', 'sync.wsHandler'] },
          { id: 's-r', from: 'sync', to: 'runner', label: 'run fn', curve: -0.15, code: ['sync.runQuery', 'application.query', 'runner.functionRunner'] },
          { id: 'r-d', from: 'runner', to: 'db', label: 'ctx.db', code: ['isolate.syscalls', 'server.syscall', 'server.dbReader'] },
          { id: 'd-p', from: 'db', to: 'persist', label: 'commit', code: ['db.committer', 'persistence.sqliteWrite'] },
          { id: 'd-sub', from: 'db', to: 'subs', label: 'write log', curve: 0.15, code: ['db.writeLog', 'db.publish'] },
          { id: 'sub-s', from: 'subs', to: 'sync', label: 'invalidate', code: ['db.subscriptionMatch', 'sync.beginUpdate'] },
          { id: 's-c', from: 'sync', to: 'client', label: 'Transition', curve: 0.2, code: ['sync.transition', 'client.protocolServer', 'client.remoteQuerySet'] },
          { id: 'c-a', from: 'client', to: 'app', label: 're-render', curve: 0.2, code: ['client.notifyQueryResults', 'client.reactClient', 'client.useSubscription'] },
        ]}
        steps={[
          { title: 'A component subscribes', text: 'useQuery(api.messages.list, { channel }) registers a query with the client. The client batches it into a ModifyQuerySet message: "add query #7 = messages:list with these args".', nodes: ['app', 'client'], edges: ['a-c'] },
          { title: 'One WebSocket per client', text: 'All queries, mutations and actions share a single multiplexed WebSocket. On the server, a sync worker owns that connection: its query set, its auth identity, and the version it has already sent.', nodes: ['client', 'sync'], edges: ['c-s'] },
          { title: 'The query runs in a V8 isolate', text: 'The sync worker asks the function runner to run messages:list at a specific database timestamp. Your bundled JS runs in a V8 isolate managed by Rust. It is not a Node process, so it starts fast and is sandboxed.', nodes: ['sync', 'runner'], edges: ['s-r'] },
          { title: 'Reads go through indexes and get recorded', text: 'Every ctx.db call becomes an index range read at that snapshot timestamp. The runtime records each range in the read set. The result plus read set go back to the sync worker, and the result may be cached.', nodes: ['runner', 'db'], edges: ['r-d'] },
          { title: 'Someone commits a mutation', text: 'Another client sends a mutation. It runs in an isolate, buffers its writes, and the committer validates it (OCC) and appends it to the transaction log in persistence at a new timestamp.', nodes: ['db', 'persist'], edges: ['d-p'] },
          { title: 'Writes are checked against live read sets', text: 'The subscription manager sees the new commit in the write log and intersects its written index keys with every active subscription\'s read set. Only overlapping subscriptions are invalidated.', nodes: ['db', 'subs'], edges: ['d-sub', 'sub-s'] },
          { title: 'Re-run and push a Transition', text: 'Invalidated queries re-run at the new timestamp. The sync worker sends a Transition message: "from version (qs=3, ts=100) to (qs=3, ts=105), query #7 now equals …". All of a client\'s queries move to the new timestamp together.', nodes: ['sync', 'client'], edges: ['s-c'] },
          { title: 'React re-renders', text: 'The client applies the Transition atomically. Every useQuery whose value changed re-renders, all at one consistent snapshot. No component ever sees a mix of old and new data.', nodes: ['client', 'app'], edges: ['c-a'] },
        ]}
        caption="Click through the steps or press Play. Each arrow carrying a packet is the active data path."
      />
      <Callout kind="deep" title="Why co-locating functions with the DB matters">
        In a classic stack each query is a network round trip from an app server to the DB, so you batch,
        cache, and accept N+1 pain. In Convex the function runs inside the backend and each <C>ctx.db.get</C>
        is an in-process call against an index layer (with caching of recent data). A loop of 50 gets is fine.
        "Join in code" is the intended pattern, not an anti-pattern.
      </Callout>
    </Section>

    <Section id="reactive-default" title="Everything is a function; the DB is reactive by default">
      <p>
        Convex has no query language exposed to the client. Clients can only call <em>named functions</em> that
        you deployed. That gives you three properties at once:
      </p>
      <ul>
        <li><strong>Security boundary:</strong> functions are your API. There are no row-level-security rules to get wrong, because authorization is just TypeScript inside the function.</li>
        <li><strong>Exact dependency tracking:</strong> the system runs the function, so it sees every read. No query parser or heuristic is needed.</li>
        <li><strong>Cacheability:</strong> a deterministic function of (args, identity, DB snapshot) can be memoized and invalidated exactly.</li>
      </ul>
      <Code
        title="convex/messages.ts — a query and a mutation"
        code={`
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { channel: v.id("channels") },
  handler: async (ctx, { channel }) => {
    // Read set: index range by_channel [channel, channel], newest 50
    return await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .order("desc")
      .take(50);
  },
});

export const send = mutation({
  args: { channel: v.id("channels"), body: v.string() },
  handler: async (ctx, { channel, body }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) throw new Error("Unauthenticated");
    // Write set: one new doc in messages (+ index entries)
    await ctx.db.insert("messages", { channel, body, author: user.subject });
  },
});
`}
        note={<>Any client subscribed to <C>list</C> for that channel sees the new message about one round trip after <C>send</C> commits. You write no invalidation, pub/sub, or cache-busting code.</>}
      />
      <Code
        title="src/Chat.tsx — the client side"
        code={`
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

export function Chat({ channel }: { channel: Id<"channels"> }) {
  const messages = useQuery(api.messages.list, { channel }); // undefined while loading
  const send = useMutation(api.messages.send);
  if (messages === undefined) return <Spinner />;
  return <List items={messages} onSend={(body) => send({ channel, body })} />;
}
`}
      />
    </Section>

    <Section id="compare" title="How it differs from what you know">
      <Compare
        caption="Convex vs. common backend shapes"
        head={['', 'Convex', 'Firebase / Firestore', 'Supabase / Postgres + REST', 'App server + DB + cache + pub/sub']}
        rows={[
          ['Where logic runs', 'TS functions inside the backend, next to data', 'Client SDK + security rules; Cloud Functions separately', 'SQL/RLS in DB; API via PostgREST or your server', 'Your app server'],
          ['Reactivity', 'Any query function is live. Invalidation by exact read-set intersection', 'Listeners on documents and simple queries', 'Realtime via WAL → channels; you reconcile', 'You build it: publish events, invalidate caches'],
          ['Consistency', 'Serializable transactions; clients see consistent snapshots across all queries', 'Transactions exist; listeners may update independently', 'Postgres is strong; realtime and REST reads can diverge', 'Cache staleness is your problem'],
          ['Query language', 'TypeScript over explicit indexes (no planner)', 'Restricted query API', 'Full SQL with planner', 'Whatever you choose'],
          ['Type safety', 'Schema → generated types → client hooks, end to end', 'Mostly manual', 'Generated types possible', 'Manual / codegen'],
          ['Background work', 'Built-in transactional scheduler + crons', 'Cloud Functions / Tasks', 'pg_cron, edge functions', 'Queues + workers'],
        ]}
      />
      <Callout kind="insight" title="The real difference is who owns the invalidation problem">
        Firebase lets clients query directly and pushes updates for simple query shapes. Postgres-based realtime
        streams row changes and leaves you to figure out which views they affect. Convex treats a whole
        arbitrary TypeScript function as the unit of subscription. Because the function's reads are tracked
        exactly, even a complex query with joins, auth checks and computed aggregates stays live and correct.
      </Callout>
    </Section>

    <Section id="feature-map" title="The out-of-the-box feature map, and why each one is free">
      <p>
        These features aren't bolted on. Each one follows from four core decisions: <strong>(1) deterministic
        functions run inside the DB, (2) a single ordered transaction log with timestamps, (3) read-set
        tracking, (4) a stateful WebSocket protocol.</strong>
      </p>
      <Compare
        caption="Feature → which core decision makes it possible"
        head={['Feature', 'Falls out of…', 'Mechanism']}
        rows={[
          ['Reactivity', '(1)+(3)+(4)', 'Read sets intersected with each commit\'s writes; re-run and push over WS'],
          ['Consistent UI', '(2)+(4)', 'Every query in a client\'s set is evaluated at the same log timestamp; Transitions move them together'],
          ['ACID / serializable transactions', '(1)+(2)+(3)', 'OCC: re-check the read set against commits since the snapshot; retry deterministically on conflict'],
          ['Automatic retries', '(1)', 'Mutations are deterministic and side-effect free, so replaying them is safe'],
          ['Query caching', '(1)+(3)', 'Result keyed by (fn, args, identity) and still valid until a write hits its read set'],
          ['End-to-end types', 'functions-as-API', 'Codegen from schema + function definitions → api object + typed hooks'],
          ['Scheduler / crons', '(2)', 'Scheduling a function is a write to a system table, so it commits atomically with your mutation'],
          ['File storage', 'functions-as-API', 'Blobs in object storage, metadata in the _storage system table, accessed via ctx.storage'],
          ['Text & vector search', 'indexes', 'Search indexes kept transactionally in sync with documents; text search is reactive too'],
          ['Auth hooks', '(4)', 'Client sends a JWT over the WS; the identity becomes part of every function\'s context and of cache keys'],
          ['Components', '(1)', 'Sandboxed function+table namespaces that share the same transaction'],
        ]}
      />
      <Check
        q="Why can Convex automatically retry a mutation that hit a write conflict, while most backends cannot?"
        options={[
          'Because Convex locks every table during a mutation',
          'Because mutations are deterministic and have no external side effects, so re-executing is equivalent to running once',
          'Because Convex stores a copy of every HTTP request',
          'Because retries only happen on the client',
        ]}
        answer={1}
        explain="Mutations can't fetch or do I/O, and Math.random/Date.now are controlled. Throwing away a failed attempt and re-running it against a newer snapshot can't double-charge a card or send two emails. That's also why external side effects belong in actions."
      />
    </Section>

    <Section id="lifecycle" title="The mutation lifecycle at a glance">
      <Flow
        title="What happens when you call a mutation"
        height={380}
        nodes={[
          { id: 'ui', label: 'UI', sub: 'send({ body })', x: 20, y: 150, w: 140 },
          { id: 'opt', label: 'Optimistic layer', sub: 'optional local patch', x: 200, y: 30, tone: 'yellow', code: ['client.optimistic', 'client.enqueueMutation'] },
          { id: 'ws', label: 'Sync worker', sub: 'Mutation{requestId}', x: 200, y: 260, tone: 'yellow', code: ['sync.mutation', 'sync.worker'] },
          { id: 'iso', label: 'Isolate', sub: 'run handler @ ts=T0', x: 430, y: 150, tone: 'purple', code: ['application.mutation', 'isolate.v8', 'isolate.syscalls'] },
          { id: 'commit', label: 'Committer', sub: 'OCC check, assign T1', x: 650, y: 150, tone: 'red', code: ['db.committer', 'db.occ', 'db.nextCommitTs'] },
          { id: 'log', label: 'Txn log', sub: 'persisted', x: 850, y: 150, w: 130, code: ['persistence.sqliteWrite', 'persistence.documentLog', 'db.writeLog'] },
        ]}
        edges={[
          { id: 'u-o', from: 'ui', to: 'opt', label: 'instant', code: ['client.enqueueMutation', 'client.optimistic'] },
          { id: 'u-w', from: 'ui', to: 'ws', label: 'WS frame', code: ['client.enqueueMutation', 'client.protocol', 'client.websocket'] },
          { id: 'w-i', from: 'ws', to: 'iso', code: ['sync.mutation', 'application.mutation'] },
          { id: 'i-c', from: 'iso', to: 'commit', label: 'reads+writes', code: ['db.transaction', 'db.readSet', 'db.writes'] },
          { id: 'c-i', from: 'commit', to: 'iso', label: 'conflict → retry', curve: 0.35, code: ['application.mutation', 'db.occ', 'db.commitConflict'] },
          { id: 'c-l', from: 'commit', to: 'log', label: 'append', code: ['db.committer', 'persistence.sqliteWrite'] },
          { id: 'c-w', from: 'commit', to: 'ws', label: 'ok @ T1', curve: -0.2, code: ['sync.mutation', 'client.requestManager'] },
        ]}
        steps={[
          { title: 'Optional optimistic update', text: 'If you attached .withOptimisticUpdate, the client patches its local query results right away. This is a temporary layer over server state.', nodes: ['ui', 'opt'], edges: ['u-o'] },
          { title: 'Mutation sent in order', text: 'The client sends a Mutation message with a requestId. A single client\'s mutations are sent and executed in order.', nodes: ['ui', 'ws'], edges: ['u-w'] },
          { title: 'Execute at a snapshot', text: 'The handler runs in an isolate against a snapshot at begin timestamp T0. Reads are recorded and writes are buffered in memory. Nothing is visible to anyone yet.', nodes: ['ws', 'iso'], edges: ['w-i'] },
          { title: 'Commit-time validation', text: 'The committer checks: did any transaction committed after T0 write into this mutation\'s read set? If not, the commit gets a new timestamp T1.', nodes: ['iso', 'commit'], edges: ['i-c'] },
          { title: 'Conflict? Retry transparently', text: 'If the read set overlaps a newer write, the attempt is discarded and the handler re-runs at a newer snapshot. Your code never sees a partial state.', nodes: ['iso', 'commit'], edges: ['c-i'] },
          { title: 'Durable append', text: 'The write set is appended to the transaction log in persistence. Index entries are written in the same commit.', nodes: ['commit', 'log'], edges: ['c-l'] },
          { title: 'Respond, then resolve when visible', text: 'The server replies "success at ts T1". The client resolves the promise only once it also has query results at ≥ T1. Then the optimistic layer is dropped. Read-your-writes is guaranteed.', nodes: ['commit', 'ws', 'ui'], edges: ['c-w'] },
        ]}
      />
      <Callout kind="warn" title="A resolved mutation promise means the UI already reflects it">
        Because the client waits for a Transition at or after the mutation's commit timestamp before resolving,
        code after <C>await send(...)</C> can rely on every subscribed query already including the write. In
        most stacks you have to refetch to get this.
      </Callout>
    </Section>

    <Section id="dev-loop" title="The dev loop: what npx convex dev really does">
      <Flow
        title="npx convex dev, one save"
        height={300}
        nodes={[
          { id: 'src', label: 'convex/*.ts', sub: 'your source', x: 20, y: 110, w: 140 },
          { id: 'esb', label: 'esbuild', sub: 'bundle per runtime', x: 200, y: 110, tone: 'yellow', code: ['cli.bundle', 'cli.useNode'] },
          { id: 'push', label: 'Push', sub: 'modules + schema', x: 410, y: 110, tone: 'purple', code: ['cli.push'] },
          { id: 'check', label: 'Backend checks', sub: 'analyze + schema', x: 620, y: 30, tone: 'red', code: ['cli.push'] },
          { id: 'gen', label: 'Codegen', sub: '_generated/*', x: 620, y: 200, tone: 'yellow', code: ['cli.codegen', 'server.anyApi'] },
          { id: 'live', label: 'Live', sub: 'new fns serving', x: 830, y: 110, w: 150 },
        ]}
        edges={[
          { id: 's-e', from: 'src', to: 'esb', code: ['cli.bundle'] },
          { id: 'e-p', from: 'esb', to: 'push', code: ['cli.push'] },
          { id: 'p-c', from: 'push', to: 'check' },
          { id: 'p-g', from: 'push', to: 'gen', code: ['cli.codegen'] },
          { id: 'c-l', from: 'check', to: 'live' },
        ]}
        steps={[
          { title: 'Watch & typecheck', text: 'The CLI watches convex/. It typechecks with tsc (configurable) so type errors block a push.', nodes: ['src'] },
          { title: 'Bundle', text: 'esbuild bundles each function file. Files with "use node" are bundled separately for the Node.js runtime, and the rest for the Convex V8 runtime.', nodes: ['src', 'esb'], edges: ['s-e'] },
          { title: 'Push to the deployment', text: 'Bundled modules, the schema, auth config, and crons are uploaded to your dev deployment.', nodes: ['esb', 'push'], edges: ['e-p'] },
          { title: 'Analyze & validate', text: 'The backend loads the modules to find exported functions and their visibility/args. It diffs the schema: new indexes get backfilled, and if schemaValidation is on, existing documents are checked against the new schema. A violating push is rejected.', nodes: ['push', 'check'], edges: ['p-c'] },
          { title: 'Generate types', text: 'convex/_generated/api.d.ts (function references), dataModel.d.ts (doc types from the schema), and server.d.ts (typed query/mutation builders) are regenerated, so your editor knows every function and table.', nodes: ['push', 'gen'], edges: ['p-g'] },
          { title: 'Atomic switch', text: 'Once accepted, the new code serves requests and subscriptions re-run on the new code. Pushes to prod (npx convex deploy) use the same pipeline.', nodes: ['check', 'live'], edges: ['c-l'] },
        ]}
      />
      <Code
        lang="bash"
        title="The commands you'll use daily"
        code={`
npx convex dev              # watch, push to your personal dev deployment, codegen
npx convex deploy           # push to production (CI: set CONVEX_DEPLOY_KEY)
npx convex run messages:send '{"channel":"...","body":"hi"}'
npx convex logs             # stream function logs
npx convex import --table messages data.jsonl
npx convex dashboard        # open the dashboard
`}
      />
      <Check
        q="Your teammate adds a required field to a table that already has documents, with schema validation on. What happens on push?"
        options={[
          'Push succeeds; old docs get the field set to null',
          'Push is rejected because existing documents don\'t match the new schema',
          'Push succeeds but queries on that table throw',
          'Convex auto-migrates the data',
        ]}
        answer={1}
        explain="Schema validation checks existing data on push. The standard migration is: make the field v.optional, backfill it with a migration, then make it required."
      />
    </Section>

    <Section id="anatomy" title="Anatomy of a Convex project">
      <Diagram
        title="Project layout"
        height={300}
        describe={'A Convex project: convex/ contains schema.ts, function files (queries/mutations/actions), http.ts for HTTP actions, crons.ts, auth.config.ts, convex.config.ts for components, and _generated/ (api, dataModel, server). The frontend imports api from convex/_generated/api and wraps the app in ConvexProvider with a ConvexReactClient.'}
      >
        <g fontFamily="JetBrains Mono, monospace" fontSize="15" fill="var(--fg)">
          <rect x="20" y="20" width="440" height="260" rx="14" fill="none" stroke="var(--line)" />
          <text x="40" y="52" fill="var(--yellow)">convex/</text>
          <text x="60" y="80">schema.ts        <tspan fill="var(--muted)">// tables, indexes</tspan></text>
          <text x="60" y="104">messages.ts      <tspan fill="var(--muted)">// query/mutation</tspan></text>
          <text x="60" y="128">ai.ts            <tspan fill="var(--muted)">// "use node" actions</tspan></text>
          <text x="60" y="152">http.ts          <tspan fill="var(--muted)">// httpRouter</tspan></text>
          <text x="60" y="176">crons.ts         <tspan fill="var(--muted)">// cronJobs()</tspan></text>
          <text x="60" y="200">auth.config.ts   <tspan fill="var(--muted)">// JWT providers</tspan></text>
          <text x="60" y="224">convex.config.ts <tspan fill="var(--muted)">// components</tspan></text>
          <text x="60" y="252" fill="var(--purple)">_generated/ <tspan fill="var(--muted)">api · dataModel · server</tspan></text>
          <rect x="540" y="20" width="440" height="260" rx="14" fill="none" stroke="var(--line)" />
          <text x="560" y="52" fill="var(--yellow)">src/</text>
          <text x="580" y="84">main.tsx</text>
          <text x="600" y="110" fill="var(--muted)">new ConvexReactClient(url)</text>
          <text x="600" y="134" fill="var(--muted)">{'<ConvexProvider client>'}</text>
          <text x="580" y="170">Chat.tsx</text>
          <text x="600" y="196" fill="var(--muted)">useQuery(api.messages.list)</text>
          <text x="600" y="220" fill="var(--muted)">useMutation(api.messages.send)</text>
          <line x1="460" y1="252" x2="540" y2="196" stroke="var(--red)" strokeDasharray="5 5" />
        </g>
      </Diagram>
      <Check
        q="Where does the fully-typed `api` object your React code imports come from?"
        options={['A runtime fetch of the deployment\'s schema', 'Codegen by the Convex CLI from your convex/ function exports', 'You write it by hand', 'The ConvexProvider injects it']}
        answer={1}
        explain="The CLI generates convex/_generated/api.d.ts from your exported functions. At runtime `api` is a Proxy (anyApi) that builds string function names like 'messages:list'. All the type safety exists at compile time."
      />
      <Check
        q="What is the single most important property that lets Convex know which subscriptions a write affects?"
        options={['Clients declare which tables they listen to', 'Queries are deterministic and all reads go through ctx.db, so read sets are recorded exactly', 'Convex re-runs every query after every write', 'The WAL is parsed for table names']}
        answer={1}
        explain="Re-running everything wouldn't scale, and table-level listening is too coarse. Recording the exact index ranges each query read makes invalidation precise."
      />
    </Section>
  </>
);

const mod: Module = {
  id: 'mental-model',
  n: 1,
  title: 'The Mental Model',
  kicker: 'Foundations',
  minutes: 25,
  summary: 'What Convex is, the architecture end to end, and why reactivity, consistency, transactions and types all fall out of a few core decisions.',
  Component,
};
export default mod;
