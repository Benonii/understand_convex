import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Diagram, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="pf-thesis" title="One core, many features">
      <p>
        Most backends are a pile of separate products: a database, a job queue, a cron service, an object store, a search
        cluster, a vector DB, an auth gateway, a webhook receiver. Convex ships all of these, but they aren't bolted-on
        services. Nearly every feature is <strong>built on three primitives</strong>: the transactional document database,
        the function runtime (queries, mutations, actions), and the sync engine that keeps query results live.
      </p>
      <p>
        So each feature inherits the same guarantees. A scheduled job is a row in a system table, so it's transactional. A
        file is a row in <C>_storage</C> that points at blob storage, so its metadata is reactive. A search index is an index,
        so search results update by themselves. Once you see that, you can work out how most features behave without
        reading their docs.
      </p>
      <Diagram
        title="Features layered on the core"
        height={340}
        describe="Layer diagram. Bottom: transaction log + persistence (documents, indexes). Middle: database API (indexes, search indexes, vector indexes, system tables like _scheduled_functions and _storage), function runtime (V8 queries/mutations, actions incl. Node), sync engine (subscriptions over WebSocket). Top: product features built from them: scheduler, crons, file storage, auth, full-text search, vector search, HTTP actions, components."
        caption="Every feature on top reuses what's underneath: transactions, reactivity and typed functions."
      >
        <g fontFamily="var(--font-mono, monospace)" fontSize="15">
          {[
            ['Scheduler', 20], ['Crons', 140], ['File storage', 260], ['Auth', 400], ['Text search', 510], ['Vector search', 650], ['HTTP actions', 800],
          ].map(([l, x]) => (
            <g key={l as string} transform={`translate(${x},30)`}>
              <rect width="120" height="52" rx="10" fill="none" stroke="var(--yellow)" strokeWidth="1.5" />
              <text x="60" y="31" textAnchor="middle" fill="var(--fg)" fontSize="13">{l}</text>
            </g>
          ))}
          <g transform="translate(920,30)"><rect width="60" height="52" rx="10" fill="none" stroke="var(--yellow)" strokeWidth="1.5" /><text x="30" y="31" textAnchor="middle" fill="var(--fg)" fontSize="12">Comps</text></g>
          <rect x="20" y="120" width="300" height="80" rx="12" fill="none" stroke="var(--purple)" strokeWidth="2" />
          <text x="170" y="155" textAnchor="middle" fill="var(--fg)">Database API</text>
          <text x="170" y="178" textAnchor="middle" fill="var(--muted)" fontSize="12">indexes · search · vector · system tables</text>
          <rect x="350" y="120" width="300" height="80" rx="12" fill="none" stroke="var(--purple)" strokeWidth="2" />
          <text x="500" y="155" textAnchor="middle" fill="var(--fg)">Function runtime</text>
          <text x="500" y="178" textAnchor="middle" fill="var(--muted)" fontSize="12">query · mutation · action · httpAction</text>
          <rect x="680" y="120" width="300" height="80" rx="12" fill="none" stroke="var(--purple)" strokeWidth="2" />
          <text x="830" y="155" textAnchor="middle" fill="var(--fg)">Sync engine</text>
          <text x="830" y="178" textAnchor="middle" fill="var(--muted)" fontSize="12">subscriptions · WebSocket</text>
          <rect x="20" y="240" width="960" height="70" rx="12" fill="none" stroke="var(--red)" strokeWidth="2" />
          <text x="500" y="272" textAnchor="middle" fill="var(--fg)">Transaction log + persistence</text>
          <text x="500" y="294" textAnchor="middle" fill="var(--muted)" fontSize="12">documents · index entries · timestamps · OCC</text>
          {[170, 500, 830].map((x) => <line key={x} x1={x} y1="200" x2={x} y2="240" stroke="var(--line)" strokeWidth="2" />)}
          {[80, 200, 320, 460, 570, 710, 860, 950].map((x, k) => <line key={k} x1={x} y1="82" x2={Math.min(900, Math.max(100, x))} y2="120" stroke="var(--line)" strokeWidth="1" />)}
        </g>
      </Diagram>
      <Callout kind="analogy" title="A feature is a recipe, not a product">
        When you meet a new Convex feature, ask three things. Where is its state stored (which table, system or user)? Which
        function type runs it (query, mutation or action)? Is the result reactive? Those three answers tell you its
        consistency, its failure modes and its cost.
      </Callout>
    </Section>

    <Section id="pf-scheduler" title="Scheduler: durable jobs that commit with your mutation">
      <p>
        <C>ctx.scheduler.runAfter(delayMs, fnRef, args)</C> and <C>ctx.scheduler.runAt(timestamp, fnRef, args)</C> enqueue a
        function to run later. In a mutation, the scheduling call <strong>writes a document into the system table</strong>{' '}
        <C>_scheduled_functions</C> as part of the mutation's own transaction. That's where the scheduler gets its guarantees:
      </p>
      <ul>
        <li><strong>Atomic with your writes.</strong> If the mutation throws, or is retried after an OCC conflict, the job never existed. You can't get "order saved but email job lost" or "email sent for an order that rolled back".</li>
        <li><strong>Scheduled mutations run exactly once.</strong> They're transactions, so the scheduler can commit the mutation and mark the job done atomically, and retry on transient failures without double effects.</li>
        <li><strong>Scheduled actions run at most once.</strong> Actions have side effects Convex can't roll back (a <C>fetch</C> to Stripe), so they aren't retried automatically. If one fails partway through, you decide what to do (or use the action-retrier / workpool components).</li>
        <li><strong>Observable and reactive.</strong> <C>_scheduled_functions</C> is queryable with <C>ctx.db.system.get(id)</C> / <C>ctx.db.system.query("_scheduled_functions")</C>. The job's state (pending, inProgress, success, failed, canceled) is just data, so a UI can subscribe to it.</li>
        <li><strong>Cancelable.</strong> <C>runAfter</C> returns an <C>Id&lt;"_scheduled_functions"&gt;</C>, and <C>ctx.scheduler.cancel(id)</C> cancels it. A job that hasn't started won't run. A running action isn't interrupted, but no further scheduled work starts.</li>
      </ul>
      <Code
        title="convex/orders.ts — schedule work transactionally"
        code={`
import { mutation, internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const placeOrder = mutation({
  args: { items: v.array(v.id("products")) },
  handler: async (ctx, { items }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) throw new Error("Unauthenticated");
    const orderId = await ctx.db.insert("orders", {
      owner: user.tokenIdentifier, items, status: "pending",
    });
    // Written into _scheduled_functions in THIS transaction.
    // If anything below throws, the job never exists.
    await ctx.scheduler.runAfter(0, internal.orders.chargeCard, { orderId });
    // Auto-expire unpaid orders after 15 minutes
    await ctx.scheduler.runAfter(15 * 60_000, internal.orders.expire, { orderId });
    return orderId;
  },
});

export const chargeCard = internalAction({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const res = await fetch("https://api.stripe.com/v1/...", { method: "POST" }); // side effect
    const ok = res.ok;
    // Close the loop transactionally
    await ctx.runMutation(internal.orders.markPaid, { orderId, ok });
  },
});

export const markPaid = internalMutation({
  args: { orderId: v.id("orders"), ok: v.boolean() },
  handler: async (ctx, { orderId, ok }) => {
    await ctx.db.patch(orderId, { status: ok ? "paid" : "failed" });
  },
});

export const expire = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const o = await ctx.db.get(orderId);
    if (o?.status === "pending") await ctx.db.patch(orderId, { status: "expired" });
  },
});
`}
        note={<>
          <C>runAfter(0, ...)</C> is the standard way to kick off an action from a mutation. A mutation can't call an action
          directly, because actions have side effects and the mutation may be retried.
        </>}
      />
      <Flow
        title="Mutation → scheduled action → mutation (the canonical pipeline)"
        height={400}
        nodes={[
          { id: 'client', label: 'Client', sub: 'useMutation', x: 20, y: 40, tone: 'plain', code: ['client.enqueueMutation', 'client.protocol'] },
          { id: 'mut', label: 'placeOrder', sub: 'mutation (txn)', x: 300, y: 40, tone: 'yellow', code: ['server.registration', 'application.mutation'] },
          { id: 'sched', label: '_scheduled_functions', sub: 'system table', x: 600, y: 40, w: 200, tone: 'purple', code: ['server.scheduler', 'scheduler.mutation'] },
          { id: 'exec', label: 'Scheduler', sub: 'executor loop', x: 620, y: 180, tone: 'plain', code: ['scheduler.action', 'scheduler.mutation'] },
          { id: 'act', label: 'chargeCard', sub: 'action (side effects)', x: 300, y: 180, tone: 'red', code: ['server.actionCtx', 'node.executor'] },
          { id: 'ext', label: 'Stripe API', sub: 'fetch', x: 20, y: 180, tone: 'plain' },
          { id: 'mut2', label: 'markPaid', sub: 'internalMutation', x: 300, y: 310, tone: 'yellow', code: ['server.registration', 'scheduler.mutation'] },
          { id: 'db', label: 'orders table', sub: 'reactive', x: 620, y: 310, tone: 'purple', code: ['db.subscriptions', 'persistence.sqlite'] },
        ]}
        edges={[
          { id: 'c-m', from: 'client', to: 'mut', label: 'mutation', code: ['client.enqueueMutation', 'sync.mutation'] },
          { id: 'm-s', from: 'mut', to: 'sched', label: 'insert job', code: ['server.scheduler', 'db.writes'] },
          { id: 's-e', from: 'sched', to: 'exec', label: 'due?', code: ['scheduler.action', 'scheduler.mutation'] },
          { id: 'e-a', from: 'exec', to: 'act', label: 'run', code: ['scheduler.action', 'server.actionCtx'] },
          { id: 'a-x', from: 'act', to: 'ext', label: 'HTTP' },
          { id: 'a-m2', from: 'act', to: 'mut2', label: 'runMutation', code: ['server.runUdf', 'server.actionCtx'] },
          { id: 'm2-db', from: 'mut2', to: 'db', label: 'patch', code: ['server.dbWriter', 'db.writes'] },
          { id: 'db-c', from: 'db', to: 'client', label: 'subscription push', curve: -0.25, code: ['db.subscriptions', 'sync.transition', 'client.remoteQuerySet'] },
        ]}
        steps={[
          { title: 'Client calls a mutation', text: 'The client sends placeOrder over the WebSocket. The mutation runs in a V8 isolate inside a serializable transaction.', nodes: ['client', 'mut'], edges: ['c-m'] },
          { title: 'Scheduling is a write', text: 'ctx.scheduler.runAfter inserts a job document into _scheduled_functions in the same transaction as the order insert. They commit together or not at all.', nodes: ['mut', 'sched'], edges: ['m-s'] },
          { title: 'The scheduler picks it up', text: "After commit, the scheduler sees jobs whose scheduled time has passed and starts them, honouring the deployment's concurrency limits.", nodes: ['sched', 'exec'], edges: ['s-e'] },
          { title: 'The action runs', text: "The action can fetch, call Node SDKs and run for minutes. It isn't a transaction and is executed at most once, so it isn't retried automatically.", nodes: ['exec', 'act'], edges: ['e-a'] },
          { title: 'Side effect', text: 'The action calls the outside world (Stripe). If the action crashes now, Convex will not retry it. Make external calls idempotent (idempotency keys) or use a retrier/workpool.', nodes: ['act', 'ext'], edges: ['a-x'] },
          { title: 'Write the result back with a mutation', text: "Actions have no ctx.db. They record results through ctx.runMutation(internal...), which is its own exactly-once transaction.", nodes: ['act', 'mut2'], edges: ['a-m2'] },
          { title: 'Reactivity closes the loop', text: "The patch to orders invalidates every subscription whose read set covers that document. The client's useQuery re-renders with status 'paid', with no polling.", nodes: ['mut2', 'db', 'client'], edges: ['m2-db', 'db-c'] },
        ]}
      />
      <Callout kind="warn" title="Scheduling from an action is NOT atomic">
        In an action, <C>ctx.scheduler.runAfter</C> commits the job immediately, because there's no surrounding
        transaction. If the action then throws, the job still runs. Schedule from mutations whenever the job should depend
        on other writes.
      </Callout>
      <Callout kind="deep" title="Why mutations can't call actions directly">
        Mutations are deterministic and retried on OCC conflict. If a mutation could <C>fetch</C>, every retry would repeat
        the side effect. The scheduler fixes this by turning "call that action" into data (a row), which commits once. The
        effectful work then happens outside the transaction, after commit.
      </Callout>
    </Section>

    <Section id="pf-crons" title="Cron jobs: declarative schedules">
      <p>
        Recurring jobs are declared in <C>convex/crons.ts</C> with <C>cronJobs()</C>. On <C>npx convex deploy</C> / <C>dev</C>,
        the backend reconciles the declared crons with what's registered. Each run is then executed through the same
        scheduling machinery, so cron-run mutations get exactly-once and cron-run actions get at-most-once.
      </p>
      <Code
        title="convex/crons.ts"
        code={`
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("purge stale sessions", { minutes: 30 }, internal.sessions.purge, {});
crons.daily("daily digest", { hourUTC: 14, minuteUTC: 0 }, internal.email.digest, {});
crons.cron("weekly report", "0 9 * * 1", internal.reports.weekly, {}); // standard cron syntax (UTC)

export default crons;
`}
      />
      <Callout kind="rule" title="Crons should do bounded work">
        A cron mutation is still one transaction with read/write limits. For big jobs (purge a million rows), have the cron
        process one page and schedule itself (or use the workpool / migrations components) until it's done. If a cron run
        is still going when the next one is due, Convex skips the overlapping run rather than stacking them (check docs for
        the exact semantics).
      </Callout>
    </Section>

    <Section id="pf-files" title="File storage: blobs outside, metadata inside">
      <p>
        File bytes live in blob storage (object storage such as S3 behind Convex cloud; local disk or S3-compatible storage
        for self-hosted). Each file also has a metadata document in the system table <C>_storage</C>: <C>_id</C>
        (a <C>Id&lt;"_storage"&gt;</C>), <C>sha256</C>, <C>size</C>, <C>contentType</C>, <C>_creationTime</C>. You store the
        storage ID in your own documents and resolve it to a URL with <C>ctx.storage.getUrl(id)</C>.
      </p>
      <p>There are three ways files get in:</p>
      <ol>
        <li><strong>Upload URLs</strong> (best for browser uploads of any size): a mutation calls <C>ctx.storage.generateUploadUrl()</C>, the client POSTs the bytes straight to that short-lived URL, gets back <C>{'{ storageId }'}</C>, then calls a second mutation to save it.</li>
        <li><strong>HTTP action upload</strong>: the client POSTs to your <C>httpAction</C>, which calls <C>ctx.storage.store(blob)</C>. One round trip and custom logic, but the request size is limited (about 20 MB; check docs).</li>
        <li><strong>From an action</strong>: <C>ctx.storage.store(blob)</C> after generating or fetching content (an AI image, a downloaded PDF).</li>
      </ol>
      <Flow
        title="Upload-URL flow (3 steps, bytes never touch your functions)"
        height={360}
        nodes={[
          { id: 'b', label: 'Browser', sub: 'File input', x: 20, y: 140, tone: 'plain' },
          { id: 'gen', label: 'generateUploadUrl', sub: 'mutation', x: 330, y: 20, w: 200, tone: 'yellow', code: ['storage.files', 'server.storage'] },
          { id: 'blob', label: 'Blob storage', sub: 'upload endpoint', x: 330, y: 150, w: 200, tone: 'red', code: ['storage.files'] },
          { id: 'meta', label: '_storage', sub: 'system table', x: 700, y: 150, tone: 'purple', code: ['storage.files', 'server.storage'] },
          { id: 'save', label: 'saveMessage', sub: 'mutation', x: 330, y: 280, w: 200, tone: 'yellow', code: ['server.dbWriter', 'server.registration'] },
          { id: 'tbl', label: 'messages', sub: '{ storageId }', x: 700, y: 280, tone: 'purple', code: ['server.dbWriter', 'value.id'] },
        ]}
        edges={[
          { id: 'b-g', from: 'b', to: 'gen', label: '1. ask URL', code: ['server.storage', 'client.enqueueMutation'] },
          { id: 'b-bl', from: 'b', to: 'blob', label: '2. POST bytes', code: ['storage.files', 'http.actions'] },
          { id: 'bl-m', from: 'blob', to: 'meta', label: 'record', code: ['storage.files'] },
          { id: 'b-s', from: 'b', to: 'save', label: '3. save id', code: ['client.enqueueMutation', 'values.validators'] },
          { id: 's-t', from: 'save', to: 'tbl', label: 'insert', code: ['server.dbWriter', 'db.writes'] },
        ]}
        steps={[
          { title: 'Ask for an upload URL', text: 'A mutation calls ctx.storage.generateUploadUrl() and returns a short-lived signed URL (it expires after about an hour). Put your auth check here: this is where you decide who may upload.', nodes: ['b', 'gen'], edges: ['b-g'] },
          { title: 'POST the bytes directly', text: "fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file }). The bytes stream to blob storage, not through a V8 isolate, so function limits don't apply.", nodes: ['b', 'blob'], edges: ['b-bl'] },
          { title: 'Metadata row appears', text: 'Convex writes a document to _storage with sha256, size and contentType. The response JSON contains { storageId }.', nodes: ['blob', 'meta'], edges: ['bl-m'] },
          { title: 'Persist the reference', text: 'The client calls a second mutation that stores storageId (v.id("_storage")) in your table, with your validation and auth checks.', nodes: ['b', 'save', 'tbl'], edges: ['b-s', 's-t'] },
          { title: 'Serve it reactively', text: 'A query reads the message and calls ctx.storage.getUrl(storageId) to get a serving URL. Delete with ctx.storage.delete(id). Clean up orphans (uploaded but never saved) with a cron.', nodes: ['tbl', 'meta'], edges: [] },
        ]}
      />
      <Code
        title="convex/files.ts"
        code={`
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Unauthenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const sendImage = mutation({
  args: { storageId: v.id("_storage"), body: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", { ...args, format: "image" });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const msgs = await ctx.db.query("messages").order("desc").take(50);
    return Promise.all(msgs.map(async (m) => ({
      ...m,
      url: m.storageId ? await ctx.storage.getUrl(m.storageId) : null,
    })));
  },
});
`}
      />
      <Code
        title="client — the upload"
        lang="tsx"
        code={`
const generateUploadUrl = useMutation(api.files.generateUploadUrl);
const sendImage = useMutation(api.files.sendImage);

async function onUpload(file: File) {
  const postUrl = await generateUploadUrl();
  const res = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const { storageId } = await res.json();
  await sendImage({ storageId, body: file.name });
}
`}
      />
    </Section>

    <Section id="pf-auth" title="Auth: identity is a verified JWT on the connection">
      <p>
        Convex doesn't make you run an auth server. It verifies <strong>OpenID Connect JWTs</strong> from providers you
        configure in <C>convex/auth.config.ts</C>: Clerk, Auth0, WorkOS, any OIDC issuer, custom JWT, or the first-party{' '}
        <strong>Convex Auth</strong> library (which runs the auth flows inside your own deployment and issues tokens
        itself).
      </p>
      <Code
        title="convex/auth.config.ts"
        code={`
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN, // the token's "iss"
      applicationID: "convex",                     // the token's "aud"
    },
  ],
};
`}
      />
      <ol>
        <li>The client gets a JWT from the provider and passes a token fetcher to <C>ConvexProviderWithClerk</C> / <C>ConvexProviderWithAuth</C> (or <C>client.setAuth(fetchToken)</C>).</li>
        <li>The client sends an <C>Authenticate</C> message over the WebSocket. The backend checks the signature against the issuer's JWKS, plus <C>iss</C>, <C>aud</C> and expiry.</li>
        <li>Every function on that connection sees <C>ctx.auth.getUserIdentity()</C>, which returns a <C>UserIdentity</C> (<C>tokenIdentifier</C>, <C>subject</C>, <C>issuer</C>, plus claims like <C>email</C>, <C>name</C>) or <C>null</C>.</li>
        <li>Before the token expires, the client fetches a fresh one and re-authenticates <strong>on the same socket</strong>. The identity version changes, so queries re-run under the new identity.</li>
      </ol>
      <Callout kind="deep" title="Identity is part of the cache key">
        Query results are cached per (function, args, identity). Two users calling <C>api.messages.mine</C> with identical
        args never share a cached result, because <C>getUserIdentity()</C> is an input to the query just like its args. This
        is why auth is "reactive": when your token changes, or you log out, the client's query set is re-evaluated under the
        new identity.
      </Callout>
      <Code
        title="Map identity → your users table"
        code={`
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
  },
});
`}
        note={<>Key users on <C>tokenIdentifier</C> (issuer + subject), which is unique across providers. Keep the users table up to date with a "store user" mutation on login, or with provider webhooks through an HTTP action.</>}
      />
      <Callout kind="warn" title="Authorization is your job, in every public function">
        Convex authenticates (who is this?). Your functions authorize (may they do this?). There's no row-level-security
        layer by default: every exported <C>query</C>/<C>mutation</C>/<C>action</C> is a public API endpoint. Check identity
        and ownership in each one, or wrap them with <C>customQuery</C>/<C>customMutation</C> from convex-helpers.
      </Callout>
    </Section>

    <Section id="pf-search" title="Full-text search: reactive, transactional search indexes">
      <p>
        A <C>searchIndex</C> is declared in the schema next to normal indexes. It names one <C>searchField</C> (a string that
        gets tokenized) and optional <C>filterFields</C> for fast equality filters. Search indexes are kept up to date
        transactionally like any other index: a document you just wrote shows up in search in the same snapshot. Search
        queries are also <strong>reactive</strong>, so a <C>useQuery</C> on search results updates when matching documents
        change.
      </p>
      <Code
        title="schema + query"
        code={`
// schema.ts
messages: defineTable({ body: v.string(), channel: v.id("channels"), author: v.string() })
  .searchIndex("search_body", { searchField: "body", filterFields: ["channel"] }),

// messages.ts
export const search = query({
  args: { q: v.string(), channel: v.id("channels") },
  handler: (ctx, { q, channel }) =>
    ctx.db
      .query("messages")
      .withSearchIndex("search_body", (s) => s.search("body", q).eq("channel", channel))
      .take(20), // results come back in relevance order
});
`}
      />
      <ul>
        <li>Relevance uses BM25-style scoring over terms. The last term gets prefix matching (good for type-ahead), and there's limited fuzzy matching (check docs, this has changed over time).</li>
        <li>Results are ordered by relevance only. You can't <C>.order()</C> a search query.</li>
        <li>Filter fields are equality-only and part of the index. Anything else you <C>.filter()</C> after the fact, which costs scanned results.</li>
        <li>There's a cap on how many results one search query can return (about 1024; check docs). Paginate with <C>.paginate()</C>.</li>
        <li>Under the hood the backend uses a Tantivy-based inverted index: segments built in the background from the transaction log, plus an in-memory index over recent writes so new documents are searchable immediately.</li>
      </ul>
    </Section>

    <Section id="pf-vector" title="Vector search: ANN in actions, documents in queries">
      <p>
        A <C>vectorIndex</C> declares a <C>vectorField</C> (an <C>v.array(v.float64())</C> of fixed <C>dimensions</C>) and
        optional <C>filterFields</C>. Vector search is <strong>only available in actions</strong>, through{' '}
        <C>ctx.vectorSearch(table, index, {'{ vector, limit, filter }'})</C>. It returns <C>{'{ _id, _score }'}</C> pairs
        (cosine similarity), and you then load the documents with a query.
      </p>
      <Code
        title="RAG retrieval in two hops"
        code={`
// schema.ts
chunks: defineTable({ text: v.string(), docId: v.id("docs"), embedding: v.array(v.float64()) })
  .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["docId"] }),

// rag.ts
export const retrieve = action({
  args: { question: v.string() },
  handler: async (ctx, { question }) => {
    const vector = await embed(question);                 // fetch to an embeddings API
    const hits = await ctx.vectorSearch("chunks", "by_embedding", { vector, limit: 8 });
    const chunks: Doc<"chunks">[] = await ctx.runQuery(internal.rag.fetchChunks, {
      ids: hits.map((h) => h._id),
    });
    return chunks;
  },
});

export const fetchChunks = internalQuery({
  args: { ids: v.array(v.id("chunks")) },
  handler: async (ctx, { ids }) =>
    (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((d) => d !== null),
});
`}
      />
      <Callout kind="insight" title="Why only in actions?">
        Approximate nearest-neighbour search isn't part of the deterministic, read-set-tracked query model. Its results
        can't be cheaply turned into an index range that the subscription manager can invalidate. Convex keeps queries
        precisely reactive by doing ANN in actions (non-reactive), then switching back to documents. For reactive results,
        store the hit IDs in a table and subscribe to that.
      </Callout>
      <Compare
        caption="Search flavours compared"
        head={['', 'Database index', 'Search index', 'Vector index']}
        rows={[
          ['Declared with', <C>.index()</C>, <C>.searchIndex()</C>, <C>.vectorIndex()</C>],
          ['Used from', 'query / mutation', 'query / mutation', 'action only'],
          ['Reactive', 'yes', 'yes', 'no (fetch docs in a query)'],
          ['Ordering', 'index key order', 'relevance', 'similarity score'],
          ['Filters', 'range on key prefix', 'equality on filterFields', 'eq / or on filterFields'],
          ['Typical use', 'lookups, ranges, pagination', 'type-ahead, keyword search', 'semantic search, RAG'],
        ]}
      />
    </Section>

    <Section id="pf-http" title="HTTP actions: your public REST & webhook surface">
      <p>
        HTTP actions use the standard <C>Request</C>/<C>Response</C> Fetch API and are routed in <C>convex/http.ts</C>. They're
        served from your deployment's <C>.convex.site</C> domain (not <C>.convex.cloud</C>). They behave like actions: no
        direct <C>ctx.db</C>, and they use <C>ctx.runQuery</C> / <C>ctx.runMutation</C> / <C>ctx.runAction</C>. They run in
        the Convex (V8) runtime.
      </p>
      <Code
        title="convex/http.ts — a verified webhook"
        code={`
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    const payload = await request.text();
    // Verify (or forward to a "use node" internalAction that uses the Stripe SDK)
    const ok = await ctx.runAction(internal.stripe.verifyAndFulfill, { signature, payload });
    return new Response(null, { status: ok ? 200 : 400 });
  }),
});

// CORS preflight for browser callers
http.route({
  path: "/api/echo",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": process.env.CLIENT_ORIGIN!,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })),
});

export default http;
`}
      />
      <Flow
        title="Webhook → HTTP action → mutation → live UI"
        height={300}
        nodes={[
          { id: 'ext', label: 'Stripe / GitHub', sub: 'webhook sender', x: 20, y: 40, tone: 'plain' },
          { id: 'site', label: '*.convex.site', sub: 'httpRouter', x: 280, y: 40, tone: 'plain', code: ['http.actions', 'local_backend.router'] },
          { id: 'ha', label: 'httpAction', sub: 'verify signature', x: 540, y: 40, tone: 'red', code: ['http.actions'] },
          { id: 'mut', label: 'internalMutation', sub: 'idempotent upsert', x: 800, y: 40, w: 180, tone: 'yellow', code: ['server.registration', 'application.mutation'] },
          { id: 'tbl', label: 'payments table', sub: 'transaction log', x: 800, y: 200, w: 180, tone: 'purple', code: ['db.committer', 'persistence.sqliteWrite'] },
          { id: 'ui', label: 'Dashboard', sub: 'useQuery', x: 280, y: 200, tone: 'plain', code: ['client.useQuery', 'client.useSubscription'] },
        ]}
        edges={[
          { id: 'e-s', from: 'ext', to: 'site', label: 'POST', code: ['local_backend.router', 'http.actions'] },
          { id: 's-h', from: 'site', to: 'ha', label: 'route', code: ['http.actions', 'local_backend.router'] },
          { id: 'h-m', from: 'ha', to: 'mut', label: 'runMutation', code: ['server.runUdf', 'application.mutation'] },
          { id: 'm-t', from: 'mut', to: 'tbl', label: 'commit', code: ['db.committer', 'db.publish'] },
          { id: 't-u', from: 'tbl', to: 'ui', label: 'push', code: ['db.subscriptions', 'sync.transition'] },
          { id: 'h-e', from: 'ha', to: 'ext', label: '200 OK', curve: 0.3, code: ['http.actions'] },
        ]}
        steps={[
          { title: 'Provider POSTs an event', text: 'The external service sends a signed POST to https://<deployment>.convex.site/stripe/webhook.', nodes: ['ext', 'site'], edges: ['e-s'] },
          { title: 'Router matches path + method', text: 'httpRouter dispatches on exact path or pathPrefix plus the HTTP method, then invokes the httpAction with a standard Request.', nodes: ['site', 'ha'], edges: ['s-h'] },
          { title: 'Verify before trusting', text: "HTTP actions are fully public. Verify the signature (HMAC / SDK) before doing anything. Read the raw body with request.text(), since signature checks need the exact bytes.", nodes: ['ha'], edges: [] },
          { title: 'Write through a mutation', text: 'ctx.runMutation(internal.payments.record, ...) commits atomically. Make it idempotent (look up by event id first), because providers retry deliveries.', nodes: ['ha', 'mut', 'tbl'], edges: ['h-m', 'm-t'] },
          { title: 'Every subscriber updates', text: 'The commit invalidates matching subscriptions, so dashboards showing payments re-render within milliseconds.', nodes: ['tbl', 'ui'], edges: ['t-u'] },
          { title: 'Acknowledge', text: "Return a 2xx quickly. Push slow follow-up work to ctx.scheduler.runAfter(0, ...) inside the mutation so the webhook doesn't time out.", nodes: ['ha', 'ext'], edges: ['h-e'] },
        ]}
      />
    </Section>

    <Section id="pf-components" title="Components: sandboxed backend packages">
      <p>
        Components are reusable backend modules (npm packages) with their <strong>own tables, functions, schema and
        scheduled jobs</strong>, isolated from your app. You install one in <C>convex/convex.config.ts</C>; its tables don't
        show up in your <C>ctx.db</C>, and it can only touch your data through the arguments you pass. Its functions are
        called transactionally: a component mutation called from your mutation commits or rolls back with it.
      </p>
      <Code
        title="convex/convex.config.ts"
        code={`
import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(aggregate, { name: "leaderboard" });   // a named instance
app.use(rateLimiter);
app.use(workpool, { name: "emailPool" });
export default app;
`}
      />
      <Code
        title="Using a component from your code"
        code={`
import { components } from "./_generated/api";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";

const rate = new RateLimiter(components.rateLimiter, {
  sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
});

export const send = mutation({
  args: { body: v.string() },
  handler: async (ctx, { body }) => {
    const user = await requireUser(ctx);
    await rate.limit(ctx, "sendMessage", { key: user._id, throws: true }); // transactional
    await ctx.db.insert("messages", { body, author: user._id });
  },
});
`}
      />
      <Compare
        caption="Commonly used components"
        head={['Component', 'Solves', 'How (built on core)']}
        rows={[
          ['aggregate', 'O(log n) counts, sums, rank, offset pagination', 'Its own B-tree stored in component tables, updated in your mutation'],
          ['sharded-counter', 'High-write counters without OCC contention', 'Spreads increments over N shard docs, sums on read'],
          ['rate-limiter', 'Token bucket / fixed window limits', 'State rows updated transactionally with the guarded write'],
          ['workpool', 'Bounded parallelism, retries, completion callbacks', 'Its own job tables + scheduler'],
          ['action-retrier', 'Retry flaky actions with backoff', 'Scheduler + status rows'],
          ['migrations', 'Batched, resumable data migrations', 'Paginated mutations that schedule themselves'],
          ['crons (dynamic)', 'Register crons at runtime', 'Stored schedules + scheduler'],
          ['presence, prosemirror-sync, agent, r2, …', 'Presence, collab editing, AI agents, R2 storage', 'Same building blocks'],
        ]}
      />
      <Callout kind="insight" title="Why components can be transactional">
        A component is a separate namespace inside the same deployment and the same transaction log. Calling a component
        mutation from your mutation is a sub-call inside one transaction (like <C>ctx.runMutation</C> inside a mutation).
        A rate-limit check, an aggregate update and your insert commit atomically. Microservices can't give you that.
      </Callout>
    </Section>

    <Section id="pf-ops" title="Env vars, logs, import/export, backups">
      <ul>
        <li><strong>Environment variables</strong> are set per deployment (dashboard or <C>npx convex env set KEY value</C>) and read with <C>process.env.KEY</C> in any function. Changing one restarts nothing and needs no redeploy, though cached query results depend on them (check docs on invalidation).</li>
        <li><strong>Logs</strong>: <C>console.log</C> from functions streams to the dashboard and to <C>npx convex dev</C> / <C>npx convex logs</C>. Log streams (Axiom, Datadog, webhook) are available on paid plans. Every function execution is also recorded with timing, read/write volume and errors.</li>
        <li><strong>Import/export</strong>: <C>npx convex import</C> (JSON/JSONL/CSV, or a ZIP snapshot) and <C>npx convex export</C> (ZIP of tables + files). Snapshot import can replace or append tables atomically.</li>
        <li><strong>Streaming export</strong> (Fivetran / Airbyte connectors) replicates tables to a warehouse by tailing the transaction log through document-delta APIs. Streaming import is also available.</li>
        <li><strong>Backups</strong>: on-demand or scheduled backups in the dashboard, restorable into the same or another deployment. A backup is a snapshot at a single timestamp, so it's consistent.</li>
      </ul>
      <Code
        title="CLI cheat sheet"
        lang="bash"
        code={`
npx convex dev                 # watch, typecheck, push to your personal dev deployment
npx convex deploy              # push to prod (uses CONVEX_DEPLOY_KEY in CI)
npx convex run messages:list '{"channel":"..."}'   # call any function, incl. internal
npx convex env set OPENAI_API_KEY sk-...           # per-deployment env var
npx convex logs                # tail logs
npx convex export --path backup.zip
npx convex import --table users users.jsonl
npx convex dashboard           # open the dashboard for this deployment
`}
      />
    </Section>

    <Section id="pf-deployments" title="Deployments: dev, prod, preview, self-hosted">
      <Compare
        head={['Deployment', 'Created by', 'Used for', 'Notes']}
        rows={[
          ['Dev (per developer)', <C>npx convex dev</C>, 'Your local loop', 'Each teammate gets their own backend; pushes on file save'],
          ['Production', <C>npx convex deploy</C>, 'Real users', 'One per project; deployed from CI with a production deploy key'],
          ['Preview', 'deploy with a preview deploy key + branch name', 'PR previews (Vercel/Netlify)', 'Fresh deployment per branch, optional --preview-run to seed data, auto-cleaned'],
          ['Self-hosted', 'Docker image (open-source backend)', 'On-prem / compliance / local', 'SQLite or Postgres (also MySQL) persistence, S3-compatible or local storage; you run the dashboard too'],
        ]}
      />
      <p>
        <strong>Deploy keys</strong> are secrets scoped to a deployment type (prod or preview). In CI the frontend build
        usually runs as <C>npx convex deploy --cmd 'npm run build'</C>. That pushes functions, then runs your build with{' '}
        <C>CONVEX_URL</C> (or the framework-prefixed variant) injected, so the frontend points at the right backend.
      </p>
      <Callout kind="deep" title="What a push actually does">
        The CLI bundles <C>convex/</C> with esbuild, runs codegen and typechecks, then uploads modules. The backend analyzes
        them (exported functions, validators, crons, HTTP routes), validates the new schema against existing data, and
        backfills new indexes. Only then does it atomically switch to the new code version. If data violates the new schema,
        or an index is still backfilling, the push waits or fails instead of breaking production.
      </Callout>
    </Section>

    <Section id="pf-review" title="Feature map — terms & checks">
      <KeyTerms
        terms={[
          { term: '_scheduled_functions', def: 'System table of scheduled jobs. Written transactionally by ctx.scheduler; queryable through ctx.db.system.' },
          { term: 'runAfter / runAt', def: 'Schedule a function by delay or absolute timestamp. Returns a job id you can cancel.' },
          { term: 'Exactly-once vs at-most-once', def: 'Scheduled mutations are retried safely (transactional). Scheduled actions are not retried automatically.' },
          { term: '_storage', def: 'System table of file metadata (sha256, size, contentType). Bytes live in blob storage.' },
          { term: 'generateUploadUrl', def: 'Mutation-issued short-lived URL that the client POSTs file bytes to directly.' },
          { term: 'tokenIdentifier', def: 'Stable unique user key derived from issuer + subject of the JWT.' },
          { term: 'auth.config.ts', def: 'Declares the OIDC providers (domain = iss, applicationID = aud) whose JWTs Convex accepts.' },
          { term: 'searchIndex', def: 'Inverted text index on one searchField with equality filterFields. Reactive and transactional.' },
          { term: 'vectorIndex', def: 'ANN index over fixed-dimension float arrays. Queried only from actions with ctx.vectorSearch.' },
          { term: 'httpAction', def: 'Fetch-API handler routed by httpRouter on *.convex.site. Public, action-like.' },
          { term: 'Component', def: 'Sandboxed backend package with its own tables/functions, installed via convex.config.ts app.use().' },
          { term: 'Deploy key', def: 'CI secret that authorizes npx convex deploy to a prod or preview deployment.' },
        ]}
      />
      <Check
        q="A mutation inserts an order and calls ctx.scheduler.runAfter(0, internal.email.send, ...). Then it throws an error. What happens to the email job?"
        options={['It runs anyway, because scheduling is fire-and-forget', "It never exists: the job row is rolled back with the mutation's other writes", 'It runs once the mutation is retried', 'It is queued but marked failed']}
        answer={1}
        explain="In a mutation, scheduling writes a row into _scheduled_functions inside the same transaction. A thrown error aborts the transaction, so nothing commits, including the job."
      />
      <Check
        q="Why can't you call ctx.vectorSearch inside a query?"
        options={["Vector indexes live in a different database that queries can't reach", "ANN results aren't part of the deterministic, read-set-tracked model that makes queries reactive and cacheable", 'Queries are too slow for vectors', "It's a pricing restriction"]}
        answer={1}
        explain="Queries must be deterministic, and their read sets must be expressible as index ranges so the subscription manager can invalidate them. Approximate nearest neighbour doesn't fit, so it lives in actions. You then fetch documents with a (reactive) query."
      />
      <Check
        q="Which upload strategy streams bytes without passing through a Convex function?"
        options={['ctx.storage.store in a mutation', 'An HTTP action calling ctx.storage.store', 'POSTing to a URL from ctx.storage.generateUploadUrl()', 'Passing the file as a v.bytes() mutation arg']}
        answer={2}
        explain="Upload URLs go straight to blob storage. Function arg/body limits don't apply, and you then save the returned storageId with a mutation. (Mutations can't call ctx.storage.store; it's available in actions.)"
      />
      <Check
        q="Two users subscribe to api.notes.mine with identical args {}. Do they share a cached result?"
        options={['Yes, the cache key is (function, args)', 'No, identity is part of the cache key', 'Only if they are on the same WebSocket', 'Only for public queries']}
        answer={1}
        explain="ctx.auth.getUserIdentity() is an input to the query, so the cache key includes identity. Results are never shared across users, and re-authenticating triggers a re-evaluation."
      />
      <Check
        q="Your rate-limiter component check and your message insert run in the same mutation. The insert throws. What happens to the consumed rate-limit token?"
        options={['It stays consumed: components are separate services', 'It is rolled back: component mutations run inside your transaction', 'It is refunded asynchronously by a cron', 'Undefined behaviour']}
        answer={1}
        explain="Components share the deployment's transaction log. A component mutation called from your mutation is part of the same transaction and commits or aborts with it."
      />
    </Section>
  </>
);

const mod: Module = {
  id: 'platform-features',
  n: 7,
  title: 'Platform features',
  kicker: 'Scheduler · storage · auth · search · HTTP · components',
  minutes: 35,
  summary: 'How every out-of-the-box feature (scheduler, crons, files, auth, text and vector search, HTTP actions, components, deployments) is built on the same transactional, reactive core.',
  Component,
};
export default mod;
