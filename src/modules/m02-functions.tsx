import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="four-kinds" title="The four kinds of functions">
      <p>
        Every piece of backend logic in Convex is one of four function types. The type is a <em>contract</em>
        with the runtime. It decides which capabilities <C>ctx</C> gives you, whether the function is
        transactional, whether it can be cached or subscribed to, and whether it may touch the network.
      </p>
      <Compare
        caption="Function types at a glance"
        head={['', 'query', 'mutation', 'action', 'httpAction']}
        rows={[
          ['Reads DB', 'ctx.db (reader)', 'ctx.db (writer)', 'only via ctx.runQuery', 'only via ctx.runQuery'],
          ['Writes DB', '✗', 'ctx.db (writer)', 'only via ctx.runMutation', 'only via ctx.runMutation'],
          ['Transactional', '✓ snapshot read', '✓ serializable', '✗ each run* is its own txn', '✗'],
          ['Deterministic', 'required', 'required', 'no', 'no'],
          ['fetch / network', '✗', '✗', '✓', '✓'],
          ['Cached / reactive', '✓ subscribable', '✗', '✗', '✗'],
          ['Auto-retry', 'n/a (re-runs on invalidation)', '✓ on OCC conflict', '✗ (at most once)', '✗'],
          ['Runtime', 'Convex V8', 'Convex V8', 'V8 or Node ("use node")', 'Convex V8'],
          ['Called from', 'client, other fns', 'client, scheduler', 'client, scheduler', 'HTTP request to .convex.site'],
        ]}
      />
      <Callout kind="rule" title="Pick the type by side effects">
        Only reading? Use a <strong>query</strong>. Changing DB state? Use a <strong>mutation</strong>. Talking
        to the outside world (Stripe, OpenAI, email)? Use an <strong>action</strong>, which usually writes its
        result back through a mutation. Receiving a webhook? Use an <strong>httpAction</strong>.
      </Callout>
      <KeyTerms
        terms={[
          { term: 'QueryCtx', def: <>{'{ db: DatabaseReader, auth, storage (reader: getUrl), runQuery? }'} — no writes, no scheduler.</> },
          { term: 'MutationCtx', def: <>{'{ db: DatabaseWriter, auth, storage (getUrl, delete, generateUploadUrl), scheduler, runQuery, runMutation }'}</> },
          { term: 'ActionCtx', def: <>{'{ runQuery, runMutation, runAction, scheduler, auth, storage (store, get, getUrl, delete), vectorSearch }'} — no ctx.db.</> },
          { term: 'Function reference', def: <>A typed pointer like <C>api.messages.send</C> or <C>internal.billing.charge</C>. At runtime it is just the path string "messages:send".</> },
        ]}
      />
    </Section>

    <Section id="anatomy" title="Anatomy of a function definition">
      <Code
        title="convex/tasks.ts"
        code={`
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const byProject = query({
  // 1. Argument validator: checked at runtime on every call, also drives TS types
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  // 2. Return validator (optional but recommended): checked on return
  returns: v.array(v.object({ _id: v.id("tasks"), _creationTime: v.number(), title: v.string(), done: v.boolean(), projectId: v.id("projects") })),
  // 3. Handler: ctx + validated args
  handler: async (ctx, { projectId, limit }) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(limit ?? 100);
  },
});

export const toggle = mutation({
  args: { id: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);
    if (!task) throw new Error("not found");
    await ctx.db.patch(id, { done: !task.done });
    return null;
  },
});

// Not callable from clients, only from other functions / scheduler / dashboard
export const purgeDone = internalMutation({
  args: {},
  handler: async (ctx) => { /* ... */ },
});
`}
      />
      <Callout kind="warn" title="Public functions are a public API">
        Anything exported as <C>query</C>, <C>mutation</C>, or <C>action</C> can be called by anyone who knows
        your deployment URL, with any arguments that pass the validator. Always validate args (TS types alone
        are erased at runtime) and check <C>ctx.auth</C> inside the handler. Mark helpers <C>internal*</C> so
        they aren't exposed at all.
      </Callout>
      <Callout kind="deep" title="Validators do double duty">
        <C>v.object(...)</C> validators exist at runtime (they are serialized into the function's metadata on
        push, which is how the dashboard can show argument forms) and at compile time (via <C>Infer</C>). Convex
        values are a JSON superset: they add <C>Id</C>, <C>bigint</C> (v.int64), <C>ArrayBuffer</C> (v.bytes),
        and distinguish <C>undefined</C> (field missing) from <C>null</C>.
      </Callout>
    </Section>

    <Section id="determinism" title="Determinism: the rule everything else depends on">
      <p>
        Queries and mutations must be <strong>deterministic</strong>: the same arguments, identity, and database
        snapshot must always produce the same result and the same writes. Convex enforces this through the
        runtime rather than trusting you:
      </p>
      <ul>
        <li><C>Math.random()</C> is seeded per function execution, so retries produce the same sequence.</li>
        <li><C>Date.now()</C> / <C>new Date()</C> is frozen at the start of the function execution. It doesn't advance while your code runs.</li>
        <li><C>fetch</C>, timers like <C>setTimeout</C>/<C>setInterval</C> (for side effects), and network or filesystem access are unavailable in queries and mutations.</li>
        <li>Only <C>ctx.db</C> reads count as dependencies. There are no hidden inputs.</li>
      </ul>
      <Flow
        title="Why determinism unlocks caching, retries and subscriptions"
        height={330}
        nodes={[
          { id: 'det', label: 'Deterministic fn', sub: 'f(args, identity, snapshot)', x: 400, y: 20, w: 200, tone: 'purple', code: ['isolate.determinism', 'isolate.environment'] },
          { id: 'cache', label: 'Query cache', sub: 'memoize by key + read set', x: 40, y: 220, tone: 'yellow', code: ['cache.udf', 'application.query'] },
          { id: 'occ', label: 'OCC retries', sub: 'replay is safe', x: 415, y: 220, tone: 'red', code: ['application.mutation', 'db.occ'] },
          { id: 'sub', label: 'Subscriptions', sub: 're-run = new truth', x: 790, y: 220, tone: 'yellow', code: ['db.subscriptions', 'sync.runQuery'] },
        ]}
        edges={[
          { id: 'd-c', from: 'det', to: 'cache', code: ['cache.udf'] },
          { id: 'd-o', from: 'det', to: 'occ', code: ['application.mutation'] },
          { id: 'd-s', from: 'det', to: 'sub', code: ['db.subscriptionMatch', 'sync.runQuery'] },
        ]}
        steps={[
          { title: 'A pure function of three inputs', text: 'The output depends only on args, the auth identity, and the DB snapshot at timestamp T. Time and randomness are pinned, and there is no network.', nodes: ['det'] },
          { title: 'Caching becomes exact', text: 'If two clients call list({channel}) with the same identity-dependence and no write has hit the read set since T, the cached result is valid. Convex can serve it without running JS.', nodes: ['det', 'cache'], edges: ['d-c'] },
          { title: 'Retries become invisible', text: 'On an OCC conflict, Convex discards the attempt and re-runs the mutation at a newer snapshot. Since the function had no side effects, the user only ever observes the successful run.', nodes: ['det', 'occ'], edges: ['d-o'] },
          { title: 'Subscriptions become correct', text: 'When a write intersects the read set, re-running the query gives exactly the new truth. Nothing outside the read set could have influenced it.', nodes: ['det', 'sub'], edges: ['d-s'] },
          { title: 'Break determinism, break all three', text: 'If a query read the wall clock, its result would change without any write. No invalidation would fire, so the subscription would be silently stale. That is why Date.now is frozen and why "time-based" queries need a different design.', nodes: ['cache', 'occ', 'sub'] },
        ]}
      />
      <Callout kind="warn" title="The classic bug: Date.now() in a query">
        <C>{'.filter(q => q.gt(q.field("expiresAt"), Date.now()))'}</C> looks fine but goes stale. The query
        only re-runs when data in its read set changes, not when time passes. Fixes: pass a coarse
        <C> now</C> argument from the client (rounded to the minute so caching still works), or keep an
        <C> isExpired</C> flag that a scheduled function flips at the right time.
      </Callout>
      <Check
        q="A query uses Math.random() to pick a 'featured' item. What do subscribers see?"
        options={[
          'A different random item every second',
          'A stable item that only changes when the query is invalidated by a write (randomness is seeded per execution)',
          'An error — Math.random is forbidden',
          'Different items for every client always',
        ]}
        answer={1}
        explain="Math.random works but is seeded per execution so results are reproducible. A query re-runs only on invalidation, so the 'random' pick stays fixed until relevant data changes. Also, a cached result may be shared between clients."
      />
    </Section>

    <Section id="runtimes" title="Two runtimes: Convex V8 vs Node.js">
      <p>
        By default every function runs in the <strong>Convex runtime</strong>: V8 isolates embedded in the Rust
        backend (similar in spirit to Cloudflare Workers). Isolates start in milliseconds, share no state between
        requests that you can rely on, and offer web-standard APIs (<C>fetch</C> in actions, <C>TextEncoder</C>,
        <C> crypto.subtle</C>, <C>URL</C>, streams) but not Node built-ins.
      </p>
      <p>
        Put <C>"use node";</C> at the top of a file and its <em>actions</em> run in a real Node.js environment
        instead (on separate infrastructure, typically AWS Lambda in Convex Cloud). That gives you npm packages
        that need Node APIs (fs, native crypto, some SDKs). The costs are slower cold starts, and the file may
        contain only actions, because queries and mutations must be in the V8 runtime.
      </p>
      <Code
        title="convex/ai.ts — Node action calling an SDK, writing back via mutation"
        code={`
"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

export const summarize = action({
  args: { docId: v.id("docs") },
  handler: async (ctx, { docId }) => {
    const doc = await ctx.runQuery(internal.docs.get, { docId }); // txn #1
    const openai = new OpenAI();                                   // reads process.env.OPENAI_API_KEY
    const res = await openai.chat.completions.create({ /* ... */ });
    await ctx.runMutation(internal.docs.saveSummary, {              // txn #2
      docId, summary: res.choices[0].message.content ?? "",
    });
  },
});
`}
        note={<>Each <C>runQuery</C>/<C>runMutation</C> is a separate transaction. Between #1 and #2 the doc can change. If that matters, re-check it inside <C>saveSummary</C>.</>}
      />
      <Callout kind="deep" title="Isolate reuse and globals">
        Isolates may be reused between invocations for speed, so module-level state <em>can</em> survive
        across calls. Never rely on it for correctness. A module-level cache in a query is a determinism hazard.
        Treat the module scope as read-only setup.
      </Callout>
    </Section>

    <Section id="actions" title="Actions: escaping the transaction">
      <p>
        Actions exist because the outside world isn't transactional. An action can await <C>fetch</C> for
        seconds or minutes, call any number of queries and mutations, and schedule more work. The guarantees
        it gives up:
      </p>
      <ul>
        <li><strong>No atomicity across steps.</strong> If it crashes after <C>runMutation</C> A but before B, A stays committed.</li>
        <li><strong>At-most-once.</strong> Convex does <em>not</em> automatically retry actions, because it can't know whether your Stripe call went through. You build retries (with idempotency keys) yourself or use the Action Retrier / Workpool components.</li>
        <li><strong>Not reactive or cached.</strong> Clients call actions imperatively and get a single result.</li>
      </ul>
      <Flow
        title="The canonical pattern: mutation → scheduler → action → mutation"
        height={340}
        nodes={[
          { id: 'cl', label: 'Client', sub: 'useMutation', x: 20, y: 140, w: 130, code: ['client.enqueueMutation', 'client.requestManager'] },
          { id: 'm1', label: 'mutation', sub: 'insert {status:"pending"}', x: 190, y: 140, tone: 'red', code: ['server.registration', 'server.dbWriter'] },
          { id: 'sch', label: 'Scheduler', sub: '_scheduled_functions', x: 400, y: 20, tone: 'yellow', code: ['server.scheduler', 'scheduler.action'] },
          { id: 'act', label: 'action', sub: 'fetch Stripe/OpenAI', x: 600, y: 140, tone: 'purple', code: ['server.actionCtx', 'node.executor'] },
          { id: 'm2', label: 'internalMutation', sub: 'patch {status:"done"}', x: 810, y: 140, w: 170, tone: 'red', code: ['server.runUdf', 'server.registration'] },
          { id: 'q', label: 'useQuery', sub: 'sees status change', x: 400, y: 260, code: ['client.useQuery', 'client.useSubscription'] },
        ]}
        edges={[
          { id: 'c-m1', from: 'cl', to: 'm1', code: ['client.enqueueMutation', 'sync.mutation'] },
          { id: 'm1-s', from: 'm1', to: 'sch', label: 'runAfter(0)', code: ['server.scheduler'] },
          { id: 's-a', from: 'sch', to: 'act', code: ['scheduler.action'] },
          { id: 'a-m2', from: 'act', to: 'm2', label: 'runMutation', code: ['server.runUdf'] },
          { id: 'm2-q', from: 'm2', to: 'q', label: 'invalidate', curve: -0.15, code: ['db.subscriptionMatch', 'sync.transition'] },
          { id: 'm1-q', from: 'm1', to: 'q', label: 'pending', curve: 0.15, code: ['db.subscriptionMatch', 'sync.transition'] },
        ]}
        steps={[
          { title: 'Client calls a mutation, not the action', text: 'The client intent ("generate summary") is recorded transactionally first. Calling the action directly from the client would lose the intent if the tab closed.', nodes: ['cl', 'm1'], edges: ['c-m1'] },
          { title: 'Record state + schedule atomically', text: 'The mutation inserts a job row (status: pending) and calls ctx.scheduler.runAfter(0, internal.ai.run, {...}). The schedule is a write to a system table, so it commits atomically with the row. Both happen or neither does.', nodes: ['m1', 'sch'], edges: ['m1-s'] },
          { title: 'UI shows pending immediately', text: 'Any query reading the jobs row updates reactively. The UI renders a spinner from data, not from local state.', nodes: ['m1', 'q'], edges: ['m1-q'] },
          { title: 'Scheduler runs the action', text: 'After the mutation commits, the scheduler invokes the action. Actions scheduled from a mutation are executed at most once.', nodes: ['sch', 'act'], edges: ['s-a'] },
          { title: 'Side effect, then write back', text: 'The action does the slow or flaky work and then calls an internalMutation to store the result and flip status to done (or failed).', nodes: ['act', 'm2'], edges: ['a-m2'] },
          { title: 'Reactivity closes the loop', text: 'The write invalidates the job query and every subscribed client sees "done" with the result. No polling, no websockets of your own.', nodes: ['m2', 'q'], edges: ['m2-q'] },
        ]}
      />
      <Callout kind="rule" title="Don't call actions from the client for business-critical work">
        It works, but if the user closes the tab mid-flight you have no record of the attempt. Mutation-first
        gives you a durable record, retry hooks, and a reactive status for free.
      </Callout>
      <Check
        q="An action calls runMutation(A), then fetch() to Stripe, then runMutation(B). The process crashes during fetch. What is the DB state?"
        options={['Neither A nor B is applied — actions are atomic', 'A is applied, B is not; nothing retries automatically', 'Convex retries the whole action so A is applied twice', 'A is rolled back automatically']}
        answer={1}
        explain="Each runMutation is its own committed transaction and actions are at-most-once. Design for this: make steps idempotent, record progress in the DB, and use idempotency keys with external APIs."
      />
    </Section>

    <Section id="composition" title="Calling functions from functions">
      <p>
        <C>ctx.runQuery</C> / <C>ctx.runMutation</C> exist in mutations too, but inside a mutation they run in
        the <strong>same transaction</strong> as sub-calls with some overhead (argument/return validation,
        separate isolate context). The idiomatic way to share logic between queries and mutations is plain
        TypeScript helper functions that take <C>ctx</C>:
      </p>
      <Code
        title="convex/lib/auth.ts — helpers, not runQuery"
        code={`
import { QueryCtx } from "../_generated/server";

export async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError("NO_USER");
  return user;
}
// MutationCtx extends QueryCtx-compatible shape, so this works in both.
`}
      />
      <Compare
        caption="Where each composition call can be used"
        head={['From ↓ / call →', 'runQuery', 'runMutation', 'runAction', 'scheduler']}
        rows={[
          ['query', '✓ (same snapshot)', '✗', '✗', '✗'],
          ['mutation', '✓ (same txn)', '✓ (same txn, sub-transaction)', '✗ (schedule it)', '✓ atomic with commit'],
          ['action', '✓ own txn', '✓ own txn', '✓ (discouraged; prefer helpers)', '✓'],
        ]}
      />
      <Check
        q="Why can't a mutation call ctx.runAction directly?"
        options={['Actions are too slow', 'A mutation may be retried; running a side-effecting action inside it would duplicate side effects and break atomicity. Scheduling defers it until after commit', 'It\'s only a type restriction', 'Actions can only be called from the client']}
        answer={1}
        explain="The scheduler write commits with the mutation, so the action runs exactly when (and only if) the mutation commits, and once per successful commit."
      />
    </Section>

    <Section id="errors" title="Errors, ConvexError and what the client sees">
      <p>
        If a handler throws, a mutation's buffered writes are discarded: nothing commits. In production, plain
        <C> Error</C> messages are redacted for the client ("Server Error") so you don't leak internals.
        To send structured, expected errors to the client, throw <C>ConvexError</C> with a data payload:
      </p>
      <Code
        title="Application errors"
        code={`
import { ConvexError } from "convex/values";

// server
throw new ConvexError({ code: "INSUFFICIENT_FUNDS", balance: 12 });

// client
try {
  await transfer({ to, amount });
} catch (e) {
  if (e instanceof ConvexError) {
    const { code, balance } = e.data as { code: string; balance: number };
  }
}
`}
      />
      <Callout kind="insight" title="Query errors are reactive too">
        If a subscribed query throws, <C>useQuery</C> throws during render (catch it with an error boundary).
        When the data changes so the query no longer throws, the subscription recovers on its own, because the
        failed result's read set was tracked like any other.
      </Callout>
    </Section>

    <Section id="http" title="HTTP actions">
      <Code
        title="convex/http.ts"
        code={`
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature");
    const body = await req.text();
    // verify signature..., then hand off to a transactional mutation
    await ctx.runMutation(internal.billing.recordEvent, { body });
    return new Response(null, { status: 200 });
  }),
});

export default http;
`}
        note={<>Served at <C>https://&lt;deployment&gt;.convex.site/stripe/webhook</C> (note <C>.site</C>, not <C>.cloud</C>). Request/Response are standard Fetch API objects.</>}
      />
    </Section>

    <Section id="limits" title="Limits that shape your design">
      <p>These numbers are approximate and change over time. Check the docs' Limits page before relying on them.</p>
      <Compare
        caption="Approximate per-function limits (verify in docs)"
        head={['Limit', 'Rough value', 'Design implication']}
        rows={[
          ['Query/mutation execution time', '~1 s of JS execution', 'Keep transactions small; move heavy compute to actions'],
          ['Action timeout', '~10 min', 'Chunk long jobs; chain via scheduler'],
          ['Documents scanned per txn', 'on the order of tens of thousands', 'Use indexes; paginate; never .collect() unbounded tables'],
          ['Data read / written per txn', 'on the order of MiBs (≈8–16 MiB)', 'Batch migrations into many small mutations'],
          ['Document size', '~1 MiB', 'Store blobs in file storage'],
          ['Args / return value size', 'a few MiB', 'Paginate results'],
          ['Scheduled functions per mutation', 'on the order of 1000s', 'Fan out in stages'],
        ]}
      />
      <Check
        q="You need to backfill a field on 2 million documents. What's the right shape?"
        options={['One mutation that .collect()s and patches everything', 'An action that loops runMutation over pages (or the Migrations component), each mutation handling a bounded batch', 'A query that patches documents', 'A single httpAction']}
        answer={1}
        explain="Per-transaction read/write limits make a single giant mutation impossible. Batch with cursors, either self-scheduling mutations or the @convex-dev/migrations component, so each transaction stays small and conflicts stay rare."
      />
    </Section>
  </>
);

const mod: Module = {
  id: 'functions',
  n: 2,
  title: 'Functions & Runtimes',
  kicker: 'The programming model',
  minutes: 35,
  summary: 'Queries, mutations, actions and HTTP actions; what ctx gives each; why determinism is enforced; V8 vs Node; and the canonical mutation → scheduler → action pattern.',
  Component,
};
export default mod;
