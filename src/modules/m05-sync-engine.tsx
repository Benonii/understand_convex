import { Module, Section, Callout, KeyTerms, Compare, Code, Flow, Diagram, Check, C } from '../ui/kit';

const Component = () => (
  <>
    <Section id="big-idea" title="The big idea: subscriptions, not requests">
      <p>
        In a typical stack, the client <em>asks</em> for data (REST/GraphQL), caches it, and then guesses when the cache is
        stale. In Convex, the client <em>subscribes</em> to a query function with specific arguments, and the server takes
        responsibility for telling it — precisely and promptly — whenever the result changes. There is no client cache to
        invalidate by hand, no refetch-on-focus heuristics, no websocket channel you design yourself.
      </p>
      <p>
        The “sync engine” is the machinery that makes this work end-to-end. It has four parts you should be able to draw from
        memory:
      </p>
      <ol>
        <li><strong>The client</strong> (<C>ConvexReactClient</C> → <C>BaseConvexClient</C> → a WebSocket manager) holding a local <em>query set</em>.</li>
        <li><strong>The sync protocol</strong> — a small set of JSON messages over one WebSocket.</li>
        <li><strong>The sync worker</strong> on the server — one per connection, holding that client’s subscriptions.</li>
        <li><strong>The subscription manager</strong> — matches every commit’s write set against all live read sets.</li>
      </ol>
      <Callout kind="insight" title="Queries are pure functions of (args, identity, database@ts)">
        That one fact powers everything. Because a query is deterministic and reads only the database, its result can only
        change if a write lands inside its read set. So the server knows <em>exactly</em> when to re-run it — no polling, no
        TTLs, no false negatives.
      </Callout>
      <KeyTerms
        terms={[
          { term: 'Query set', def: 'The set of (queryId → function path, args) the client currently wants. Versioned by an integer querySet version.' },
          { term: 'QueryId', def: 'Small integer the client assigns to each distinct subscription (function + args). Server results are keyed by it.' },
          { term: 'StateVersion', def: '{ querySet, identity, ts }: which query set, which auth identity, and which database timestamp a client view corresponds to.' },
          { term: 'Transition', def: 'Server → client message moving the client from startVersion to endVersion, with a list of query modifications.' },
          { term: 'Sync worker', def: 'Server-side task per WebSocket that tracks the client\'s queries, re-runs invalidated ones, and sends transitions.' },
          { term: 'Subscription manager', def: 'Server component that indexes all active read sets so each commit can find the subscriptions it invalidates.' },
          { term: 'Optimistic update', def: 'A local, temporary patch to query results applied immediately on mutation, removed once the server\'s authoritative result arrives.' },
        ]}
      />
    </Section>

    <Section id="client" title="The client stack">
      <Diagram
        title="Client layers"
        height={330}
        describe={'Client layers from top to bottom: React components call useQuery/useMutation/usePaginatedQuery. ConvexReactClient wraps BaseConvexClient and maps React hooks to subscriptions (watchQuery), deduplicating identical function+args. BaseConvexClient owns the local query set, remote query results, the optimistic update layer, the request manager for in-flight mutations/actions, and the auth manager. WebSocketManager handles the single socket, reconnection with backoff, and ping/pong. All of it talks to the Convex deployment over one WebSocket (wss://<deployment>.convex.cloud/api/<version>/sync).'}
        caption="One socket per client, no matter how many components call useQuery."
      >
        {[
          { y: 20, t: 'React: useQuery · useMutation · usePaginatedQuery · useConvexAuth', c: 'var(--yellow)' },
          { y: 85, t: 'ConvexReactClient — watchQuery(), dedupe by (path, args), notify subscribers', c: 'var(--yellow)' },
          { y: 150, t: 'BaseConvexClient — LocalSyncState (query set) · RemoteQuerySet · OptimisticQueryResults · RequestManager · AuthenticationManager', c: 'var(--purple)' },
          { y: 215, t: 'WebSocketManager — connect, reconnect w/ backoff, ping, (re)send state', c: 'var(--purple)' },
          { y: 280, t: '⇅  one WebSocket → wss://<deployment>.convex.cloud/api/…/sync', c: 'var(--red)' },
        ].map((r) => (
          <g key={r.y}>
            <rect x={40} y={r.y} width={920} height={48} rx={10} fill="none" stroke={r.c} strokeWidth="1.5" />
            <text x={60} y={r.y + 30} fill="var(--fg)" fontSize="15" fontFamily="JetBrains Mono">{r.t}</text>
          </g>
        ))}
      </Diagram>
      <ul>
        <li><strong>Deduplication.</strong> Ten components calling <C>useQuery(api.msgs.list, {'{'} channel {'}'})</C> with equal args share <em>one</em> query id and one server subscription. Args are compared by their serialized JSON form (Convex values).</li>
        <li><strong>Reference counting.</strong> When the last component using a query unmounts, the client removes it from the query set (sends a <C>Remove</C>).</li>
        <li><strong>Batching.</strong> Changes to the query set made in the same tick are coalesced into one <C>ModifyQuerySet</C> message.</li>
        <li><strong>Atomic React updates.</strong> When a transition arrives, every affected query is updated in a single batch, so the UI never renders half of one database state and half of another.</li>
      </ul>
      <Code
        title="src/main.tsx — the whole setup"
        code={`
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={convex}>
    <App />
  </ConvexProvider>,
);

// anywhere:
function Channel({ id }: { id: Id<"channels"> }) {
  const messages = useQuery(api.messages.list, { channel: id }); // undefined while loading
  const send = useMutation(api.messages.send);
  if (messages === undefined) return <Spinner />;
  return <List items={messages} onSend={(body) => send({ channel: id, body })} />;
}`}
      />
    </Section>

    <Section id="protocol" title="The wire protocol">
      <p>
        The protocol is small enough to memorize. Field names below are close to the real JSON (the client is open source in
        the <C>convex</C> npm package under <C>browser/sync</C>), but treat exact shapes as approximate.
      </p>
      <Diagram
        title="Messages over the sync WebSocket"
        height={470}
        describe={'Client to server: Connect {sessionId, connectionCount, lastCloseReason, maxObservedTimestamp}; ModifyQuerySet {baseVersion, newVersion, modifications: [Add {queryId, udfPath, args} | Remove {queryId}]}; Mutation {requestId, udfPath, args}; Action {requestId, udfPath, args}; Authenticate {baseVersion, tokenType, value}; Event (logging). Server to client: Transition {startVersion, endVersion, modifications: [QueryUpdated {queryId, value, logLines} | QueryFailed {queryId, errorMessage} | QueryRemoved {queryId}]}; MutationResponse {requestId, success, result, ts, logLines}; ActionResponse {requestId, success, result}; AuthError {error, baseVersion}; FatalError; Ping. StateVersion = {querySet, identity, ts}.'}
      >
        <text x="40" y="35" fill="var(--yellow)" fontSize="16" fontFamily="JetBrains Mono" fontWeight="600">client → server</text>
        <text x="540" y="35" fill="var(--purple)" fontSize="16" fontFamily="JetBrains Mono" fontWeight="600">server → client</text>
        {[
          'Connect { sessionId, connectionCount, maxObservedTimestamp }',
          'ModifyQuerySet { baseVersion, newVersion,',
          '  modifications: [Add{queryId,udfPath,args} | Remove{queryId}] }',
          'Mutation { requestId, udfPath, args }',
          'Action { requestId, udfPath, args }',
          'Authenticate { baseVersion, tokenType, value: JWT }',
          'Event { eventType, event }   // telemetry',
        ].map((t, i) => (
          <text key={t} x="40" y={75 + i * 34} fill="var(--fg)" fontSize="13" fontFamily="JetBrains Mono">{t}</text>
        ))}
        {[
          'Transition { startVersion, endVersion,',
          '  modifications: [QueryUpdated{queryId,value}',
          '                | QueryFailed{queryId,errorMessage}',
          '                | QueryRemoved{queryId}] }',
          'MutationResponse { requestId, success, result, ts }',
          'ActionResponse { requestId, success, result }',
          'AuthError { error, baseVersion }',
          'FatalError · Ping',
        ].map((t, i) => (
          <text key={t} x="540" y={75 + i * 34} fill="var(--fg)" fontSize="13" fontFamily="JetBrains Mono">{t}</text>
        ))}
        <line x1="510" y1="20" x2="510" y2="350" stroke="var(--line)" strokeDasharray="5 6" />
        <rect x="40" y="380" width="920" height="66" rx="12" fill="none" stroke="var(--red)" />
        <text x="60" y="408" fill="var(--red)" fontSize="15" fontFamily="JetBrains Mono" fontWeight="600">StateVersion = {'{'} querySet: number, identity: number, ts: Timestamp {'}'}</text>
        <text x="60" y="432" fill="var(--muted)" fontSize="13" fontFamily="JetBrains Mono">Every Transition moves the client from one StateVersion to the next — never skipping, never mixing.</text>
      </Diagram>
      <p>
        The <C>StateVersion</C> is the heart of it. It says: “these query results correspond to <em>query set version N</em>,
        evaluated as <em>identity version M</em>, at <em>database timestamp T</em>.” The client applies a <C>Transition</C>
        only if its <C>startVersion</C> equals the client’s current version, which guarantees the client never jumps to a
        state that skips a query-set or auth change it made.
      </p>
      <Check
        q="Why does a Transition carry both startVersion and endVersion?"
        options={['For compression', 'So the client can verify the diff applies to exactly the state it has, keeping its view consistent', 'To let the client reorder transitions', 'For logging only']}
        answer={1}
        explain="Transitions are diffs. A diff is only meaningful relative to a base state. Matching startVersion to the client's current StateVersion ensures the client moves atomically from one consistent snapshot (query set + identity + ts) to the next."
      />
    </Section>

    <Section id="subscribe" title="Lifecycle of a subscription">
      <Flow
        title="useQuery → first result"
        height={430}
        nodes={[
          { id: 'cmp', label: 'React component', sub: 'useQuery(api.msgs.list, {c})', x: 20, y: 40, w: 210, tone: 'yellow' },
          { id: 'cli', label: 'BaseConvexClient', sub: 'query set v7 → v8', x: 20, y: 250, w: 210, tone: 'yellow' },
          { id: 'sw', label: 'Sync worker', sub: 'per connection', x: 330, y: 250, tone: 'purple' },
          { id: 'cache', label: 'Query cache', sub: 'path+args+identity', x: 330, y: 40, tone: 'plain' },
          { id: 'fr', label: 'Function runner', sub: 'V8 isolate @ ts', x: 580, y: 250, tone: 'purple' },
          { id: 'db', label: 'Database', sub: 'indexes @ ts', x: 800, y: 250, w: 170, tone: 'red' },
          { id: 'sub', label: 'Subscription mgr', sub: 'read set registered', x: 580, y: 40, w: 190, tone: 'red' },
        ]}
        edges={[
          { id: 'c-cli', from: 'cmp', to: 'cli', label: 'watchQuery' },
          { id: 'cli-sw', from: 'cli', to: 'sw', label: 'ModifyQuerySet Add{q12}' },
          { id: 'sw-cache', from: 'sw', to: 'cache', label: 'lookup' },
          { id: 'sw-fr', from: 'sw', to: 'fr', label: 'run @ ts' },
          { id: 'fr-db', from: 'fr', to: 'db', label: 'index reads' },
          { id: 'sw-sub', from: 'sw', to: 'sub', label: 'subscribe(read set)', curve: -0.1 },
          { id: 'sw-cli', from: 'sw', to: 'cli', label: 'Transition v7→v8', curve: 0.25 },
          { id: 'cli-c', from: 'cli', to: 'cmp', label: 're-render', curve: 0.25 },
        ]}
        steps={[
          { title: 'Component mounts', text: 'useQuery returns undefined immediately (loading). ConvexReactClient checks whether an identical (path, args) subscription already exists; if so it just adds a listener and you are done.', nodes: ['cmp', 'cli'], edges: ['c-cli'] },
          { title: 'Query set changes', text: 'The client assigns queryId 12, bumps its query set from version 7 to 8 and sends ModifyQuerySet {baseVersion: 7, newVersion: 8, modifications: [Add {queryId: 12, udfPath: "msgs:list", args: [{c}]}]}.', nodes: ['cli', 'sw'], edges: ['cli-sw'] },
          { title: 'Cache check', text: 'The sync worker picks a timestamp to evaluate at (≥ anything the client has already seen) and asks the query cache for (path, args, identity). A cached result is reusable if its read set has not been touched by any write between when it was computed and the target ts.', nodes: ['sw', 'cache'], edges: ['sw-cache'] },
          { title: 'Execute on a miss', text: 'On a miss the function runner executes the query in a V8 isolate against a snapshot at that ts, recording every index range it reads.', nodes: ['sw', 'fr', 'db'], edges: ['sw-fr', 'fr-db'] },
          { title: 'Register the read set', text: 'The result plus its read set (index ranges) are stored. The read set is registered with the subscription manager so future commits can find this subscription.', nodes: ['sw', 'sub'], edges: ['sw-sub'] },
          { title: 'Transition to the client', text: 'The worker sends Transition {startVersion: {querySet: 7, identity, ts: T0}, endVersion: {querySet: 8, identity, ts: T1}, modifications: [QueryUpdated {queryId: 12, value}]}. If other queries also changed by T1 they are included in the same transition.', nodes: ['sw', 'cli'], edges: ['sw-cli'] },
          { title: 'React renders', text: 'The client applies the transition atomically, recomputes optimistic layers on top, and notifies every listener of queryId 12. useQuery now returns the array.', nodes: ['cli', 'cmp'], edges: ['cli-c'] },
        ]}
      />
    </Section>

    <Section id="invalidation" title="Write → invalidate → re-run → push">
      <p>
        Here is the reactive loop. It reuses the read sets from Module 4. After the committer makes a transaction durable,
        the commit is appended to an in-memory log of recent writes. The subscription manager walks new commits and, for each
        written index key, finds every subscription whose read set contains a range covering that key.
      </p>
      <Flow
        title="One mutation updates every relevant screen"
        height={430}
        nodes={[
          { id: 'b', label: 'Client B', sub: 'useMutation(send)', x: 20, y: 40, tone: 'purple' },
          { id: 'com', label: 'Committer', sub: 'commit_ts = 900', x: 260, y: 40, tone: 'red' },
          { id: 'log', label: 'Write log', sub: 'msgs.by_channel[c]', x: 500, y: 40, tone: 'red' },
          { id: 'sub', label: 'Subscription mgr', sub: 'range overlap?', x: 760, y: 40, w: 200, tone: 'red' },
          { id: 'swA', label: 'Sync worker A', sub: 'q12 invalidated', x: 760, y: 250, w: 200, tone: 'purple' },
          { id: 'fr', label: 'Function runner', sub: 're-run q12 @ 900', x: 500, y: 250, tone: 'purple' },
          { id: 'a', label: 'Client A', sub: 'useQuery(list,{c})', x: 20, y: 250, tone: 'yellow' },
        ]}
        edges={[
          { id: 'b-com', from: 'b', to: 'com', label: 'Mutation' },
          { id: 'com-log', from: 'com', to: 'log', label: 'append' },
          { id: 'log-sub', from: 'log', to: 'sub', label: 'new writes' },
          { id: 'sub-sw', from: 'sub', to: 'swA', label: 'invalidate' },
          { id: 'sw-fr', from: 'swA', to: 'fr', label: 're-execute' },
          { id: 'fr-a', from: 'fr', to: 'a', label: 'Transition (QueryUpdated)', curve: 0 },
          { id: 'com-b', from: 'com', to: 'b', label: 'MutationResponse ts=900', curve: 0.3 },
        ]}
        steps={[
          { title: 'A mutation commits', text: 'Client B calls send({channel: c, body}). The mutation runs, passes OCC validation, and is committed at ts=900. It inserted a doc whose index entries include messages.by_channel = (c, _creationTime, _id).', nodes: ['b', 'com'], edges: ['b-com'] },
          { title: 'Writes become visible to the sync layer', text: 'The commit is appended to the in-memory write log. Only after it is durable in persistence does it become visible to readers and subscriptions.', nodes: ['com', 'log'], edges: ['com-log'] },
          { title: 'Find overlapping read sets', text: 'For each written index key the subscription manager looks up subscriptions whose recorded ranges contain it. Client A\'s q12 read by_channel ∈ [c, c+∞) — overlap. A query on channel d would not be touched.', nodes: ['log', 'sub'], edges: ['log-sub'] },
          { title: 'Notify the owning sync workers', text: 'Each affected subscription\'s sync worker is told its query is invalid as of ts=900. Workers for unaffected clients do nothing at all.', nodes: ['sub', 'swA'], edges: ['sub-sw'] },
          { title: 'Re-run (or reuse) at the new ts', text: 'Worker A re-executes q12 at ts=900 (or reuses a cache entry if another client already recomputed the same path+args+identity). A fresh read set replaces the old one.', nodes: ['swA', 'fr'], edges: ['sw-fr'] },
          { title: 'Push one consistent transition', text: 'All of A\'s queries that changed are bundled into one Transition ending at ts=900. If the new result equals the old one, the server may skip sending a value — but the version still advances.', nodes: ['fr', 'a'], edges: ['fr-a'] },
          { title: 'Meanwhile, B gets its answer', text: 'B receives MutationResponse {success, result, ts: 900}. B\'s own subscriptions will reflect the write once B receives a transition with ts ≥ 900 — that\'s the read-your-writes rule.', nodes: ['com', 'b'], edges: ['com-b'] },
        ]}
        caption="No polling, no pub/sub topics you design: the read set IS the topic."
      />
      <Callout kind="deep" title="Why not just diff results?">
        Re-running every query after every write would be O(queries × writes). Indexing read sets turns it into
        “find subscriptions whose ranges contain these keys” — an interval lookup — so cost scales with the queries that
        actually changed. (The precise data structure is an implementation detail; think “interval index over read ranges.”)
      </Callout>
      <Check
        q="Client A subscribes to a query that does ctx.db.query('tasks').filter(q => q.eq(q.field('owner'), me)).collect(). Another user inserts a task they own. What happens?"
        options={['Nothing — the filter excludes it', 'A\'s query is invalidated and re-run, because its read set is the whole tasks table', 'The client filters it locally', 'The insert is rejected']}
        answer={1}
        explain="filter() runs after the scan; the read set covers the entire table. Any write to tasks invalidates the subscription. The result is unchanged, but you pay for the re-run. Use withIndex('by_owner', q => q.eq('owner', me)) so unrelated writes don't touch your range."
      />
    </Section>

    <Section id="consistency" title="Consistency: one timestamp for the whole screen">
      <p>
        A sync worker evaluates <strong>all of a client’s queries at the same timestamp</strong> before sending a transition.
        This is a big deal and is easy to miss:
      </p>
      <ul>
        <li>A “unread count” badge and the message list can never disagree, even though they are separate queries.</li>
        <li>You never see a parent document updated while its children query still shows the old state.</li>
        <li>The client’s view moves forward monotonically in time: ts never goes backward, even across reconnects (the client sends <C>maxObservedTimestamp</C> on <C>Connect</C>).</li>
      </ul>
      <Callout kind="analogy">
        Think of each Transition as a frame in a film. Every query on screen is drawn from the same frame. Other systems give
        you each query from a different frame and hope you don’t notice.
      </Callout>
      <Compare
        caption="How consistency compares"
        head={['', 'REST + React Query', 'Firebase RTDB/Firestore listeners', 'Convex']}
        rows={[
          ['Freshness', 'Polling / manual invalidation', 'Push per listener', 'Push per subscription, automatic'],
          ['Cross-query consistency', 'None', 'Per listener (can disagree)', 'All queries at one ts'],
          ['Server logic in the read', 'Yes (endpoint)', 'Limited (rules + query shapes)', 'Arbitrary TS function'],
          ['Read-your-writes', 'Manual (invalidate after mutate)', 'Local cache latency compensation', 'Guaranteed by ts ordering'],
          ['Joins / aggregation reactive?', 'No', 'Client-side', 'Yes — the function is the subscription'],
        ]}
      />
    </Section>

    <Section id="ryw" title="Mutations, ordering and read-your-writes">
      <p>Three guarantees for mutations sent from one client:</p>
      <ol>
        <li><strong>Ordered:</strong> mutations from a single client are executed in the order they were sent (the client queues them on the socket; the server processes them serially per session).</li>
        <li><strong>Exactly-once-ish on reconnect:</strong> each carries a <C>requestId</C>; if the socket drops, unacknowledged mutations are resent and the server deduplicates by session + request id, so a retry after a disconnect doesn’t double-apply (approximately; details in the client source).</li>
        <li><strong>Read-your-writes:</strong> the <C>await mutation()</C> promise resolves only after the client has applied a Transition whose <C>ts</C> ≥ the mutation’s commit <C>ts</C>. When your <C>await</C> returns, every <C>useQuery</C> already reflects the write.</li>
      </ol>
      <Code
        title="Read-your-writes in practice"
        code={`
const create = useMutation(api.todos.create);
const todos = useQuery(api.todos.list);

async function onAdd(text: string) {
  const id = await create({ text });
  // Guaranteed: \`todos\` (on the next render) already includes \`id\`.
  // No refetch, no invalidateQueries(["todos"]), no race.
  setSelected(id);
}`}
      />
      <Check
        q="A mutation commits at ts=900 and the MutationResponse arrives, but the client's latest transition is at ts=880. What does the client do?"
        options={['Resolve the promise immediately', 'Hold the promise until a transition with ts ≥ 900 is applied, then resolve', 'Refetch all queries via HTTP', 'Drop the response']}
        answer={1}
        explain="Resolving early would let code after `await` observe query results that don't include its own write. The client waits until its synced view has caught up to the mutation's commit ts."
      />
    </Section>

    <Section id="optimistic" title="Optimistic updates">
      <p>
        Round-trip latency is still latency. <C>useMutation(fn).withOptimisticUpdate(cb)</C> lets you patch local query results
        instantly. The client keeps these patches as a <em>layer</em> on top of the server results:
      </p>
      <Code
        title="Optimistic send"
        code={`
const send = useMutation(api.messages.send).withOptimisticUpdate(
  (localStore, { channel, body }) => {
    const current = localStore.getQuery(api.messages.list, { channel });
    if (current === undefined) return; // query not loaded: nothing to patch
    localStore.setQuery(api.messages.list, { channel }, [
      ...current,
      { _id: crypto.randomUUID() as Id<"messages">, _creationTime: Date.now(), channel, body },
    ]);
  },
);`}
      />
      <Flow
        title="Optimistic update lifecycle"
        height={400}
        nodes={[
          { id: 'ui', label: 'UI', sub: 'shows messages', x: 20, y: 160, tone: 'yellow' },
          { id: 'opt', label: 'Optimistic layer', sub: 'pending: send#41', x: 270, y: 40, w: 190, tone: 'yellow' },
          { id: 'srv', label: 'Server results', sub: 'q12 @ ts', x: 270, y: 280, w: 190, tone: 'purple' },
          { id: 'ws', label: 'WebSocket', sub: 'Mutation req 41', x: 540, y: 160, tone: 'plain' },
          { id: 'be', label: 'Backend', sub: 'commit ts=900', x: 790, y: 160, tone: 'red' },
        ]}
        edges={[
          { id: 'ui-opt', from: 'ui', to: 'opt', label: 'apply update' },
          { id: 'opt-ui', from: 'opt', to: 'ui', label: 'instant render', curve: 0.2 },
          { id: 'ui-ws', from: 'opt', to: 'ws', label: 'send' },
          { id: 'ws-be', from: 'ws', to: 'be', label: 'Mutation' },
          { id: 'be-ws', from: 'be', to: 'ws', label: 'Response + Transition', curve: 0.25 },
          { id: 'ws-srv', from: 'ws', to: 'srv', label: 'apply ts=900' },
          { id: 'srv-ui', from: 'srv', to: 'ui', label: 'authoritative', curve: -0.2 },
        ]}
        steps={[
          { title: 'Call the mutation', text: 'The client runs your optimistic update function against a local store view of current query results and records the patch as a layer tagged with the mutation\'s requestId.', nodes: ['ui', 'opt'], edges: ['ui-opt'] },
          { title: 'Render immediately', text: 'Every useQuery whose result was touched re-renders with the optimistic value. The user sees their message in ~0ms.', nodes: ['opt', 'ui'], edges: ['opt-ui'] },
          { title: 'Send the real mutation', text: 'In parallel, Mutation {requestId: 41, udfPath, args} goes over the socket.', nodes: ['opt', 'ws', 'be'], edges: ['ui-ws', 'ws-be'] },
          { title: 'Server commits and pushes', text: 'The mutation commits at ts=900. The client receives MutationResponse {ts: 900} and, separately, a Transition containing the real updated q12.', nodes: ['be', 'ws'], edges: ['be-ws'] },
          { title: 'Drop the layer, show the truth', text: 'Once the client\'s server view reaches ts ≥ 900, the optimistic layer for request 41 is removed. Remaining layers for still-pending mutations are re-applied on top of the new server results (they are replayed, not merged).', nodes: ['ws', 'srv', 'ui'], edges: ['ws-srv', 'srv-ui'] },
          { title: 'If it failed', text: 'If the mutation throws, its layer is simply dropped and the UI reverts to server truth. There is no manual rollback code.', nodes: ['opt', 'ui'] },
        ]}
      />
      <Callout kind="warn" title="Optimistic update rules">
        The callback must be pure and fast, must not mutate objects returned by <C>getQuery</C> in place (create new arrays/objects),
        and should handle <C>undefined</C> (query not loaded). It may run multiple times as layers are replayed.
      </Callout>
      <Check
        q="Two optimistic mutations are pending. The first one's server result arrives. What happens to the second one's optimistic layer?"
        options={['It is discarded', 'It is re-run on top of the new server state', 'It is merged with a three-way diff', 'It is committed locally']}
        answer={1}
        explain="Optimistic updates are functions, not snapshots. Pending layers are replayed in order on top of the latest authoritative results until their own mutations are reflected."
      />
    </Section>

    <Section id="auth-reconnect" title="Reconnects and auth">
      <p>
        <strong>Reconnect:</strong> the WebSocket manager reconnects with exponential backoff. On reconnect it sends
        <C>Connect</C> (with session id and <C>maxObservedTimestamp</C>), re-sends the full current query set as one
        <C>ModifyQuerySet</C>, re-sends <C>Authenticate</C>, and replays un-acknowledged mutations in order. The server
        recomputes results at a ts no earlier than what the client already saw, so the UI never goes back in time.
        <C>useConvexConnectionState</C> / <C>client.connectionState()</C> expose this to your UI.
      </p>
      <p>
        <strong>Auth:</strong> the client fetches a JWT from your provider (Clerk, Auth0, Convex Auth…) and sends
        <C>Authenticate</C>. That bumps the <C>identity</C> component of the StateVersion, and the server re-evaluates every
        query under the new identity (results depend on <C>ctx.auth</C>). Before the token expires, the client fetches a fresh
        one and re-authenticates without dropping subscriptions; if the server rejects it you get <C>AuthError</C>.
      </p>
      <Code
        title="Auth-dependent query"
        code={`
export const myTasks = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity(); // from the JWT, not a db read
    if (!identity) return [];
    return ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("owner", identity.tokenIdentifier))
      .collect();
  },
});
// The cache key includes identity, so two users never share a result.`}
      />
    </Section>

    <Section id="hooks" title="Client APIs you must know cold">
      <Compare
        head={['API', 'What it does', 'Under the hood']}
        rows={[
          [<C>useQuery(fn, args)</C>, 'Reactive result; undefined while loading; throws on error (use an error boundary)', 'Add to query set; listener on queryId'],
          [<C>useQuery(fn, "skip")</C>, 'Don\'t subscribe (e.g. args not ready yet)', 'No query set entry'],
          [<C>useMutation(fn)</C>, 'Returns a stable function → Promise', 'Mutation message, requestId, RYW wait'],
          [<C>useAction(fn)</C>, 'Call an action (no RYW, not reactive)', 'Action message'],
          [<C>usePaginatedQuery(fn, args, {'{'}initialNumItems{'}'})</C>, 'results, status, loadMore(n)', 'One subscription per page; each page is reactive; page boundaries pinned by cursors'],
          [<C>useQueries</C>, 'Dynamic number of subscriptions', 'Multiple queryIds'],
          [<C>ConvexHttpClient</C>, 'Plain HTTP query/mutation/action (scripts, servers)', 'POST /api/query etc; not reactive'],
          [<><C>preloadQuery</C> / <C>usePreloadedQuery</C></>, 'SSR in Next.js: fetch on server, hydrate & subscribe on client', 'HTTP fetch at a ts, then WebSocket subscription'],
          [<><C>fetchQuery</C> / <C>fetchMutation</C></>, 'One-shot calls from server components / route handlers', 'HTTP'],
        ]}
      />
      <Code
        title="Pagination is reactive too"
        code={`
export const list = query({
  args: { channel: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: (ctx, { channel, paginationOpts }) =>
    ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .order("desc")
      .paginate(paginationOpts), // { page, isDone, continueCursor }
});

// client
const { results, status, loadMore } = usePaginatedQuery(
  api.messages.list, { channel }, { initialNumItems: 25 },
);`}
        note={<>Each loaded page is its own subscription over a fixed index interval (start cursor → end cursor). New items inserted inside a loaded page appear in that page, so pages can grow; boundaries don’t shift.</>}
      />
      <Check
        q="When should you use ConvexHttpClient instead of ConvexReactClient?"
        options={['Always in production', 'For scripts, cron jobs on other servers, or server-side code where you need a one-off call and no live updates', 'When you need optimistic updates', 'When you need consistency across queries']}
        answer={1}
        explain="The HTTP client is stateless request/response: no WebSocket, no subscriptions, no transitions. Use it outside interactive UIs."
      />
    </Section>

    <Section id="why-no-cache" title="Why you never write cache invalidation again">
      <p>Put together, the guarantees remove whole categories of client code:</p>
      <ul>
        <li>No <C>invalidateQueries</C>: the server knows which results changed because it knows their read sets.</li>
        <li>No stale-while-revalidate tuning: there is no TTL — a result is valid until a write overlaps it.</li>
        <li>No manual websocket channels / pub-sub topics for realtime features: every query is already live.</li>
        <li>No “refetch after mutate”: read-your-writes is built in.</li>
        <li>No torn UI across components: all queries at one ts.</li>
      </ul>
      <Callout kind="rule" title="The cost model">
        Reactivity is not free: every subscription whose read set is hit costs a re-execution. Keep read sets narrow (indexes,
        <C>take</C>, pagination), avoid reading volatile docs (like a global “lastSeen” field) in widely-used queries, and
        split rapidly-changing data (presence, typing indicators) into their own tables.
      </Callout>
      <Check
        q="A query reads the current user doc, which also stores lastActiveAt updated every 10s by a heartbeat. 50 queries on the page read that user doc. What's the issue?"
        options={['None, Convex caches it', 'Every heartbeat invalidates all 50 queries for that user, re-running them every 10s', 'The heartbeat will conflict and fail', 'Queries can\'t read user docs']}
        answer={1}
        explain="Any write to the user doc overlaps every read set that includes it. Move volatile fields (presence/heartbeat) to a separate table so unrelated queries aren't invalidated."
      />
    </Section>
  </>
);

const mod: Module = {
  id: 'sync-engine',
  n: 5,
  title: 'The Sync Engine',
  kicker: 'How a useQuery stays correct forever',
  minutes: 50,
  summary: 'Client query sets, the WebSocket protocol, transitions and StateVersions, read-set invalidation, read-your-writes, optimistic updates, reconnects and auth.',
  Component,
};
export default mod;
