import type { CodeRef } from './types';

// Generated from real source excerpts. Line numbers refer to the pinned SHA in types.ts.
export const clientRefs: Record<string, CodeRef> = {
  "client.useQuery": {
    "id": "client.useQuery",
    "title": "useQuery: the React entry point",
    "repo": "convex-js",
    "path": "src/react/client.ts",
    "startLine": 922,
    "endLine": 955,
    "symbol": "useQuery",
    "lang": "ts",
    "summary": "Turns a function reference + args into a single-entry query request and returns its current value (or undefined while loading).",
    "explain": "useQuery is a thin wrapper: it builds a one-element request map and delegates to useQueries. The args are memoized by their Convex-JSON string, so a new-but-equal args object on every render does not resubscribe. 'skip' produces an empty request map, which unsubscribes. If the server returned an error for this query, the error is thrown during render so an error boundary catches it.",
    "notes": [
      {
        "line": 945,
        "text": "Dedupe by value, not identity: equal args never trigger a resubscribe."
      },
      {
        "line": 948,
        "text": "All real work happens in useQueries."
      },
      {
        "line": 952,
        "text": "A QueryFailed modification surfaces here as a thrown Error."
      }
    ],
    "code": "export function useQuery<\n  Query extends FunctionReference<\"query\"> | FunctionReference_future<\"query\">,\n>(\n  query: Query,\n  ...args: OptionalRestArgsOrSkip<Query>\n): FunctionReturnType<Query> | undefined {\n  const skip = args[0] === \"skip\";\n  const argsObject = args[0] === \"skip\" ? {} : parseArgs(args[0]);\n  const queryReference =\n    typeof query === \"string\"\n      ? makeFunctionReference<\"query\", any, any>(query)\n      : query;\n\n  const queryName = getFunctionName(queryReference);\n\n  const queries = useMemo(\n    () =>\n      skip\n        ? ({} as RequestForQueries)\n        : { query: { query: queryReference, args: argsObject } },\n    // Stringify args so args that are semantically the same don't trigger a\n    // rerender. Saves developers from adding `useMemo` on every args usage.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n    [JSON.stringify(convexToJson(argsObject)), queryName, skip],\n  );\n\n  const results = useQueries(queries);\n  const result = results[\"query\"];\n\n  if (result instanceof Error) {\n    throw result;\n  }\n  return result;\n}"
  },
  "client.useQueries": {
    "id": "client.useQueries",
    "title": "useQueries: React ↔ client bridge",
    "repo": "convex-js",
    "path": "src/react/use_queries.ts",
    "startLine": 62,
    "endLine": 127,
    "symbol": "useQueries / useQueriesHelper",
    "lang": "ts",
    "summary": "Creates a QueriesObserver that holds Watch objects for each query and exposes them to React through useSubscription.",
    "explain": "This is where React state meets the Convex client. A QueriesObserver owns one Watch per query (created via convex.watchQuery). useSubscription gets two functions: getCurrentValue reads the latest local results synchronously from the client's store, and subscribe registers a callback that the client invokes when a Transition touches one of these queries. React state is just a cache of getCurrentValue(); Convex's client store is the source of truth.",
    "notes": [
      {
        "line": 90,
        "text": "Each query becomes a Watch on the ConvexReactClient."
      },
      {
        "line": 104,
        "text": "One observer per component instance, kept across renders."
      },
      {
        "line": 116,
        "text": "Synchronous read of the client's current (optimistic-layered) results."
      },
      {
        "line": 126,
        "text": "Hands off to the generic external-store hook."
      }
    ],
    "code": "export function useQueries(\n  queries: RequestForQueriesCompat,\n): Record<string, any | undefined | Error> {\n// …\n  const createWatch = useMemo(() => {\n    return (\n      query: FunctionReference<\"query\"> | FunctionReference_future<\"query\">,\n      args: Record<string, Value>,\n      {\n        journal,\n        paginationOptions,\n      }: {\n        journal?: QueryJournal;\n        paginationOptions?: SubscribeToPaginatedQueryOptions;\n      },\n    ) => {\n      if (paginationOptions) {\n        return convex.watchPaginatedQuery(query, args, paginationOptions);\n      } else {\n        return convex.watchQuery(query, args, journal ? { journal } : {});\n      }\n    };\n  }, [convex]);\n  return useQueriesHelper(queries, createWatch);\n}\n\n/**\n * Internal version of `useQueries` that is exported for testing.\n */\nexport function useQueriesHelper(\n  queries: RequestForQueriesCompat,\n  createWatch: CreateWatch,\n): Record<string, any | undefined | Error> {\n  const [observer] = useState(() => new QueriesObserver(createWatch));\n\n  if (observer.createWatch !== createWatch) {\n    observer.setCreateWatch(createWatch);\n  }\n\n  // Unsubscribe from all queries on unmount.\n  useEffect(() => () => observer.destroy(), [observer]);\n\n  const subscription = useMemo(\n    () => ({\n      getCurrentValue: () => {\n        return observer.getLocalResults(queries);\n      },\n      subscribe: (callback: () => void) => {\n        observer.setQueries(queries);\n        return observer.subscribe(callback);\n      },\n    }),\n    [observer, queries],\n  );\n\n  return useSubscription(subscription);\n}"
  },
  "client.useSubscription": {
    "id": "client.useSubscription",
    "title": "useSubscription: how React re-renders",
    "repo": "convex-js",
    "path": "src/react/use_subscription.ts",
    "startLine": 41,
    "endLine": 140,
    "symbol": "useSubscription",
    "lang": "ts",
    "summary": "A small external-store hook: stores the current value in React state and calls setState when the client says something changed.",
    "explain": "This is the actual re-render mechanism. The value lives in useState; subscribe is attached in a passive effect; when the Convex client fires the callback after applying a Transition, checkForUpdates calls getCurrentValue() and setState only if the value object changed (reference equality). Because the client swaps in a new result object only for queries whose result changed, unchanged queries bail out without rendering.",
    "notes": [
      {
        "line": 56,
        "text": "React's copy of the query value."
      },
      {
        "line": 117,
        "text": "Read the client store, not the network."
      },
      {
        "line": 118,
        "text": "Reference equality: no change, no render."
      },
      {
        "line": 125,
        "text": "Callback registered with ConvexReactClient listeners."
      }
    ],
    "code": "export function useSubscription<Value>({\n  // (Synchronously) returns the current value of our subscription.\n  getCurrentValue,\n\n  // This function is passed an event handler to attach to the subscription.\n  // It should return an unsubscribe function that removes the handler.\n  subscribe,\n}: {\n  getCurrentValue: () => Value;\n  subscribe: (callback: () => void) => () => void;\n}): Value {\n  // Read the current value from our subscription.\n  // When this value changes, we'll schedule an update with React.\n  // It's important to also store the hook params so that we can check for staleness.\n  // (See the comment in checkForUpdates() below for more info.)\n  const [state, setState] = useState(() => ({\n    getCurrentValue,\n    subscribe,\n    value: getCurrentValue(),\n  }));\n\n  let valueToReturn = state.value;\n// …\n  useEffect(() => {\n    let didUnsubscribe = false;\n\n    const checkForUpdates = () => {\n      // It's possible that this callback will be invoked even after being unsubscribed,\n      // if it's removed as a result of a subscription event/update.\n      // In this case, React will log a DEV warning about an update from an unmounted component.\n      // We can avoid triggering that warning with this check.\n      if (didUnsubscribe) {\n        return;\n      }\n\n      setState((prevState) => {\n        // Ignore values from stale sources!\n        // Since we subscribe an unsubscribe in a passive effect,\n        // it's possible that this callback will be invoked for a stale (previous) subscription.\n        // This check avoids scheduling an update for that stale subscription.\n        if (\n          prevState.getCurrentValue !== getCurrentValue ||\n          prevState.subscribe !== subscribe\n        ) {\n          return prevState;\n        }\n\n        // Some subscriptions will auto-invoke the handler, even if the value hasn't changed.\n        // If the value hasn't changed, no update is needed.\n        // Return state as-is so React can bail out and avoid an unnecessary render.\n        const value = getCurrentValue();\n        if (prevState.value === value) {\n          return prevState;\n        }\n\n        return { ...prevState, value };\n      });\n    };\n    const unsubscribe = subscribe(checkForUpdates);\n\n    // Because we're subscribing in a passive effect,\n    // it's possible that an update has occurred between render and our effect handler.\n    // Check for this and schedule an update if work has occurred.\n    checkForUpdates();\n\n    return () => {\n      didUnsubscribe = true;\n      unsubscribe();\n    };\n  }, [getCurrentValue, subscribe]);\n\n  // Return the current value for our caller to use while rendering.\n  return valueToReturn;\n}"
  },
  "client.reactClient": {
    "id": "client.reactClient",
    "title": "ConvexReactClient: listeners per query token",
    "repo": "convex-js",
    "path": "src/react/client.ts",
    "startLine": 395,
    "endLine": 812,
    "symbol": "ConvexReactClient.watchQuery / transition",
    "lang": "ts",
    "summary": "Lazily creates the BaseConvexClient, maps query tokens to React listener callbacks, and fans out transitions to them.",
    "explain": "ConvexReactClient is the React-facing adapter. watchQuery().onUpdate calls BaseConvexClient.subscribe (which may send a ModifyQuerySet) and stores the callback under the query token (canonical path + serialized args). When the base client reports changed tokens after a Transition, transition() invokes exactly those callbacks. Unsubscribing removes the listener and decrements the base client's refcount, which may send a Remove.",
    "notes": [
      {
        "line": 401,
        "text": "Created lazily so SSR never opens a WebSocket."
      },
      {
        "line": 510,
        "text": "Ask the sync layer to add (or refcount) this query."
      },
      {
        "line": 520,
        "text": "Listeners are keyed by query token, so duplicates share one subscription."
      },
      {
        "line": 805,
        "text": "Only listeners for changed tokens are notified."
      }
    ],
    "code": "    if (this.cachedSync) {\n      return this.cachedSync;\n    }\n    // BaseConvexClient and paginated query client are always created together.\n    this.cachedSync =\n      this.options.baseClient ??\n      new BaseConvexClient(\n        this.address,\n        () => {}, // Use the PaginatedQueryClient's transition instead.\n        this.options,\n      );\n    if (this.adminAuth) {\n      this.cachedSync.setAdminAuth(this.adminAuth, this.fakeUserIdentity);\n    }\n    this.cachedPaginatedQueryClient = new PaginatedQueryClient(\n      this.cachedSync,\n      (transition) => this.handleTransition(transition),\n    );\n    return this.cachedSync;\n// …\n  watchQuery<\n    Query extends\n      | FunctionReference<\"query\">\n      | FunctionReference_future<\"query\">,\n  >(\n    query: Query,\n    ...argsAndOptions: ArgsAndOptions<Query, WatchQueryOptions>\n  ): Watch<FunctionReturnType<Query>> {\n    const [args, options] = argsAndOptions;\n    const name = getFunctionName(query);\n\n    return {\n      onUpdate: (callback) => {\n        const { queryToken, unsubscribe } = this.sync.subscribe(\n          name as string,\n          args,\n          options,\n        );\n\n        const currentListeners = this.listeners.get(queryToken);\n        if (currentListeners !== undefined) {\n          currentListeners.add(callback);\n        } else {\n          this.listeners.set(queryToken, new Set([callback]));\n        }\n\n        return () => {\n          if (this.closed) {\n            return;\n          }\n\n          const currentListeners = this.listeners.get(queryToken)!;\n          currentListeners.delete(callback);\n          if (currentListeners.size === 0) {\n            this.listeners.delete(queryToken);\n          }\n          unsubscribe();\n        };\n      },\n// …\n  private handleTransition(transition: ExtendedTransition) {\n    const simple = transition.queries.map((q) => q.token);\n    const paginated = transition.paginatedQueries.map((q) => q.token);\n    this.transition([...simple, ...paginated]);\n  }\n\n  private transition(updatedQueries: (QueryToken | PaginatedQueryToken)[]) {\n    for (const queryToken of updatedQueries) {\n      const callbacks = this.listeners.get(queryToken);\n      if (callbacks) {\n        for (const callback of callbacks) {\n          callback();\n        }\n      }\n    }\n  }"
  },
  "client.base": {
    "id": "client.base",
    "title": "BaseConvexClient: handling server messages",
    "repo": "convex-js",
    "path": "src/browser/sync/client.ts",
    "startLine": 466,
    "endLine": 512,
    "symbol": "BaseConvexClient onMessage",
    "lang": "ts",
    "summary": "The dispatch point for every server message: Transition, MutationResponse, ActionResponse, AuthError, FatalError.",
    "explain": "On a Transition the order matters: auth bookkeeping, then RemoteQuerySet applies the diff and advances its version, then completed mutations whose commit ts is ≤ the new query timestamp are resolved, then React is notified. A successful MutationResponse does not resolve the promise; it only records the commit ts. Only a later Transition at or past that ts completes it. That ordering is what gives you read-your-writes.",
    "notes": [
      {
        "line": 470,
        "text": "Apply QueryUpdated/Failed/Removed and adopt endVersion."
      },
      {
        "line": 472,
        "text": "Resolve mutations whose ts ≤ the new timestamp."
      },
      {
        "line": 483,
        "text": "MutationResponse: remember ts, don't resolve yet (unless failed)."
      },
      {
        "line": 506,
        "text": "FatalError kills the connection."
      }
    ],
    "code": "          switch (serverMessage.type) {\n            case \"Transition\": {\n              this.observedTimestamp(serverMessage.endVersion.ts);\n              this.authenticationManager.onTransition(serverMessage);\n              this.remoteQuerySet.transition(serverMessage);\n              this.state.transition(serverMessage);\n              const completedRequests = this.requestManager.removeCompleted(\n                this.remoteQuerySet.timestamp(),\n              );\n              this.notifyOnQueryResultChanges(completedRequests);\n              break;\n            }\n            case \"MutationResponse\": {\n              if (serverMessage.success) {\n                this.observedTimestamp(serverMessage.ts);\n              }\n              const completedMutationInfo =\n                this.requestManager.onResponse(serverMessage);\n              if (completedMutationInfo !== null) {\n                this.notifyOnQueryResultChanges(\n                  new Map([\n                    [\n                      completedMutationInfo.requestId,\n                      completedMutationInfo.result,\n                    ],\n                  ]),\n                );\n              }\n              break;\n            }\n            case \"ActionResponse\": {\n              this.requestManager.onResponse(serverMessage);\n              break;\n            }\n            case \"AuthError\": {\n              this.authenticationManager.onAuthError(serverMessage);\n              break;\n            }\n            case \"FatalError\": {\n              const error = logFatalError(this.logger, serverMessage.error);\n              void this.webSocketManager.terminate();\n              throw error;\n            }\n            default: {\n              serverMessage satisfies never;\n            }\n          }"
  },
  "client.notifyQueryResults": {
    "id": "client.notifyQueryResults",
    "title": "notifyOnQueryResultChanges: layering optimistic updates",
    "repo": "convex-js",
    "path": "src/browser/sync/client.ts",
    "startLine": 566,
    "endLine": 622,
    "symbol": "notifyOnQueryResultChanges",
    "lang": "ts",
    "summary": "Rebuilds visible query results from the server's results plus the remaining optimistic updates and reports which tokens changed.",
    "explain": "After every Transition the client recomputes what the UI should see: take the server's result for every query, drop optimistic updates belonging to mutations that are now reflected in server data, replay the rest on top, and diff. The changed tokens are emitted as one transition to the React layer, so all affected components update from the same snapshot.",
    "notes": [
      {
        "line": 570,
        "text": "Authoritative server results at one timestamp."
      },
      {
        "line": 591,
        "text": "Drop completed optimistic layers, replay the rest."
      },
      {
        "line": 608,
        "text": "Mutations now visible in server data."
      }
    ],
    "code": "  private notifyOnQueryResultChanges(\n    completedRequests: Map<RequestId, FunctionResult>,\n  ) {\n    const remoteQueryResults: Map<QueryId, FunctionResult> =\n      this.remoteQuerySet.remoteQueryResults();\n    const queryTokenToValue: QueryResultsMap = new Map();\n    for (const [queryId, result] of remoteQueryResults) {\n      const queryToken = this.state.queryToken(queryId);\n      // It's possible that we've already unsubscribed to this query but\n      // the server hasn't learned about that yet. If so, ignore this one.\n\n      if (queryToken !== null) {\n        const query = {\n          result,\n          udfPath: this.state.queryPath(queryId)!,\n          args: this.state.queryArgs(queryId)!,\n        };\n        queryTokenToValue.set(queryToken, query);\n      }\n    }\n\n    // Query tokens that are new (because of new server results or new local optimistic updates)\n    // or differ from old values (because of changes from local optimistic updates or new results\n    // from the server).\n    const changedQueryTokens =\n      this.optimisticQueryResults.ingestQueryResultsFromServer(\n        queryTokenToValue,\n        new Set(completedRequests.keys()),\n      );\n\n    this.handleTransition({\n      queries: changedQueryTokens.map((token) => {\n        const optimisticResult =\n          this.optimisticQueryResults.rawQueryResult(token);\n        return {\n          token,\n          modification: {\n            kind: \"Updated\" as const,\n            result: optimisticResult,\n          },\n        };\n      }),\n      reflectedMutations: Array.from(completedRequests).map(\n        ([requestId, result]) => ({\n          requestId,\n          result,\n        }),\n      ),\n      timestamp: this.remoteQuerySet.timestamp(),\n    });\n  }\n\n  private handleTransition(transition: Transition) {\n    for (const fn of this._onTransitionFns.values()) {\n      fn(transition);\n    }\n  }"
  },
  "client.subscribe": {
    "id": "client.subscribe",
    "title": "BaseConvexClient.subscribe",
    "repo": "convex-js",
    "path": "src/browser/sync/client.ts",
    "startLine": 709,
    "endLine": 733,
    "symbol": "subscribe",
    "lang": "ts",
    "summary": "Registers a query in the local query set and sends the resulting ModifyQuerySet over the socket.",
    "explain": "LocalSyncState decides whether this is a new query (returns a modification) or a duplicate (refcount only, modification null). Note there is no explicit batching here: each new query produces its own ModifyQuerySet immediately unless the socket is paused (e.g. waiting for auth), in which case modifications are queued and coalesced on resume.",
    "notes": [
      {
        "line": 716,
        "text": "Local bookkeeping: query id, refcount, versions."
      },
      {
        "line": 722,
        "text": "Duplicate subscriptions send nothing."
      },
      {
        "line": 728,
        "text": "Last subscriber leaving produces a Remove."
      }
    ],
    "code": "  subscribe(\n    name: string,\n    args?: Record<string, Value>,\n    options?: SubscribeOptions,\n  ): { queryToken: QueryToken; unsubscribe: () => void } {\n    const argsObject = parseArgs(args);\n\n    const { modification, queryToken, unsubscribe } = this.state.subscribe(\n      name,\n      argsObject,\n      options?.journal,\n      options?.componentPath,\n    );\n    if (modification !== null) {\n      this.webSocketManager.sendMessage(modification);\n    }\n    return {\n      queryToken,\n      unsubscribe: () => {\n        const modification = unsubscribe();\n        if (modification) {\n          this.webSocketManager.sendMessage(modification);\n        }\n      },\n    };"
  },
  "client.localState": {
    "id": "client.localState",
    "title": "LocalSyncState.subscribe: query ids and querySet versions",
    "repo": "convex-js",
    "path": "src/browser/sync/local_state.ts",
    "startLine": 88,
    "endLine": 153,
    "symbol": "LocalSyncState.subscribe",
    "lang": "ts",
    "summary": "Assigns query ids, refcounts duplicate subscriptions and builds ModifyQuerySet messages with base/new querySet versions.",
    "explain": "The query token is the canonical udf path plus serialized args; equal tokens share one query id. A new query bumps the querySet version and produces {baseVersion, newVersion, modifications:[Add]}. The server applies modifications only if baseVersion matches what it has, which keeps both sides' view of the query set in lockstep. This querySet number is the 'qs' part of StateVersion.",
    "notes": [
      {
        "line": 99,
        "text": "Identity of a subscription = path + args."
      },
      {
        "line": 104,
        "text": "Second useQuery with same args: no network traffic."
      },
      {
        "line": 124,
        "text": "querySet version increments per change."
      },
      {
        "line": 142,
        "text": "The message the server's sync worker consumes."
      }
    ],
    "code": "  subscribe(\n    udfPath: string,\n    args: Record<string, Value>,\n    journal?: QueryJournal | undefined,\n    componentPath?: string | undefined,\n  ): {\n    queryToken: QueryToken;\n    modification: QuerySetModification | null;\n    unsubscribe: () => QuerySetModification | null;\n  } {\n    const canonicalizedUdfPath = canonicalizeUdfPath(udfPath);\n    const queryToken = serializePathAndArgs(canonicalizedUdfPath, args);\n\n    const existingEntry = this.querySet.get(queryToken);\n\n    if (existingEntry !== undefined) {\n      existingEntry.numSubscribers += 1;\n      return {\n        queryToken,\n        modification: null,\n        unsubscribe: () => this.removeSubscriber(queryToken),\n      };\n    } else {\n      const queryId = this.nextQueryId++;\n      const query: LocalQuery = {\n        id: queryId,\n        canonicalizedUdfPath,\n        args,\n        numSubscribers: 1,\n        journal,\n        componentPath,\n      };\n      this.querySet.set(queryToken, query);\n      this.queryIdToToken.set(queryId, queryToken);\n\n      const baseVersion = this.querySetVersion;\n      const newVersion = this.querySetVersion + 1;\n\n      const add: AddQuery = {\n        type: \"Add\",\n        queryId,\n        udfPath: canonicalizedUdfPath,\n        args: [convexToJson(args)],\n        journal,\n        componentPath,\n      };\n\n      if (this.paused) {\n        this.pendingQuerySetModifications.set(queryId, add);\n      } else {\n        this.querySetVersion = newVersion;\n      }\n\n      const modification: QuerySetModification = {\n        type: \"ModifyQuerySet\",\n        baseVersion,\n        newVersion,\n        modifications: [add],\n      };\n      return {\n        queryToken,\n        modification,\n        unsubscribe: () => this.removeSubscriber(queryToken),\n      };\n    }\n  }"
  },
  "client.remoteQuerySet": {
    "id": "client.remoteQuerySet",
    "title": "RemoteQuerySet.transition: applying a Transition",
    "repo": "convex-js",
    "path": "src/browser/sync/remote_query_set.ts",
    "startLine": 30,
    "endLine": 95,
    "symbol": "RemoteQuerySet.transition",
    "lang": "ts",
    "summary": "Checks the Transition's startVersion against the client's current version, applies each modification, then adopts endVersion.",
    "explain": "This is the client half of the versioned sync protocol. A Transition is a diff from one StateVersion {querySet, ts, identity} to another; if startVersion doesn't equal what the client holds, the client throws (and reconnects) rather than applying a diff to the wrong base. All modifications in one Transition are applied together, then version.ts becomes the single timestamp every query result is now consistent at.",
    "notes": [
      {
        "line": 33,
        "text": "Diffs must apply to the exact base version."
      },
      {
        "line": 43,
        "text": "New result value for a query id."
      },
      {
        "line": 58,
        "text": "The query threw; stored as an error result."
      },
      {
        "line": 86,
        "text": "All queries now reflect this one timestamp."
      }
    ],
    "code": "  transition(transition: Transition): void {\n    const start = transition.startVersion;\n    if (\n      this.version.querySet !== start.querySet ||\n      this.version.ts.notEquals(start.ts) ||\n      this.version.identity !== start.identity\n    ) {\n      throw new Error(\n        `Invalid start version: ${start.ts.toString()}:${start.querySet}:${start.identity}, transitioning from ${this.version.ts.toString()}:${this.version.querySet}:${this.version.identity}`,\n      );\n    }\n    for (const modification of transition.modifications) {\n      switch (modification.type) {\n        case \"QueryUpdated\": {\n          const queryPath = this.queryPath(modification.queryId);\n          if (queryPath) {\n            for (const line of modification.logLines) {\n              logForFunction(this.logger, \"info\", \"query\", queryPath, line);\n            }\n          }\n          const value = jsonToConvex(modification.value ?? null);\n          this.remoteQuerySet.set(modification.queryId, {\n            success: true,\n            value,\n            logLines: modification.logLines,\n          });\n          break;\n        }\n        case \"QueryFailed\": {\n          const queryPath = this.queryPath(modification.queryId);\n          if (queryPath) {\n            for (const line of modification.logLines) {\n              logForFunction(this.logger, \"info\", \"query\", queryPath, line);\n            }\n          }\n          const { errorData } = modification;\n          this.remoteQuerySet.set(modification.queryId, {\n            success: false,\n            errorMessage: modification.errorMessage,\n            errorData:\n              errorData !== undefined ? jsonToConvex(errorData) : undefined,\n            logLines: modification.logLines,\n          });\n          break;\n        }\n        case \"QueryRemoved\": {\n          this.remoteQuerySet.delete(modification.queryId);\n          break;\n        }\n        default: {\n          // Enforce that the switch-case is exhaustive.\n          modification satisfies never;\n          throw new Error(`Invalid modification ${(modification as any).type}`);\n        }\n      }\n    }\n    this.version = transition.endVersion;\n  }\n\n  remoteQueryResults(): Map<QueryId, FunctionResult> {\n    return this.remoteQuerySet;\n  }\n\n  timestamp(): Long {\n    return this.version.ts;\n  }"
  },
  "client.requestManager": {
    "id": "client.requestManager",
    "title": "RequestManager: read-your-writes",
    "repo": "convex-js",
    "path": "src/browser/sync/request_manager.ts",
    "startLine": 124,
    "endLine": 191,
    "symbol": "RequestManager.onResponse / removeCompleted",
    "lang": "ts",
    "summary": "Tracks in-flight mutations and actions; holds successful mutations as 'Completed' until a Transition reaches their commit timestamp.",
    "explain": "When MutationResponse arrives with success, the promise is not resolved; the request is marked Completed with its commit ts. removeCompleted(ts) runs on every Transition and resolves all completed mutations whose ts ≤ the query set's new timestamp. So when `await mutation()` returns, every useQuery is already showing a database state that includes that write. Failures and actions resolve immediately since they have no reflected writes to wait for.",
    "notes": [
      {
        "line": 141,
        "text": "Actions and failed mutations resolve right away."
      },
      {
        "line": 156,
        "text": "The read-your-writes rule, in the source."
      },
      {
        "line": 173,
        "text": "Resolve once queries have caught up to the commit ts."
      }
    ],
    "code": "      const errorMessage = response.result as string;\n      const { errorData } = response;\n      logForFunction(this.logger, \"error\", udfType, udfPath, errorMessage);\n      result = {\n        success: false,\n        errorMessage,\n        errorData:\n          errorData !== undefined ? jsonToConvex(errorData) : undefined,\n        logLines: response.logLines,\n      };\n      onResolve = () => status.onResult(result);\n    }\n\n    // We can resolve Mutation failures immediately since they don't have any\n    // side effects. Actions are intentionally decoupled from\n    // queries/mutations here on the sync protocol since they have different\n    // guarantees.\n    if (response.type === \"ActionResponse\" || !response.success) {\n      onResolve();\n      this.inflightRequests.delete(response.requestId);\n      this.requestsOlderThanRestart.delete(response.requestId);\n\n      if (requestInfo.message.type === \"Action\") {\n        this.inflightActionsCount--;\n      } else if (requestInfo.message.type === \"Mutation\") {\n        this.inflightMutationsCount--;\n      }\n\n      this.markConnectionStateDirty();\n      return { requestId: response.requestId, result };\n    }\n\n    // We have to wait to resolve the request promise until after we transition\n    // past this timestamp so clients can read their own writes.\n    requestInfo.status = {\n      status: \"Completed\",\n      result,\n      ts: response.ts,\n      onResolve,\n    };\n\n    return null;\n  }\n\n  // Remove and returns completed requests.\n  removeCompleted(ts: Long): Map<RequestId, FunctionResult> {\n    const completeRequests: Map<RequestId, FunctionResult> = new Map();\n    for (const [requestId, requestInfo] of this.inflightRequests.entries()) {\n      const status = requestInfo.status;\n      if (status.status === \"Completed\" && status.ts.lessThanOrEqual(ts)) {\n        status.onResolve();\n        completeRequests.set(requestId, status.result);\n\n        if (requestInfo.message.type === \"Mutation\") {\n          this.inflightMutationsCount--;\n        } else if (requestInfo.message.type === \"Action\") {\n          this.inflightActionsCount--;\n        }\n\n        this.inflightRequests.delete(requestId);\n        this.requestsOlderThanRestart.delete(requestId);\n      }\n    }\n    if (completeRequests.size > 0) {\n      this.markConnectionStateDirty();\n    }\n    return completeRequests;\n  }"
  },
  "client.mutationOrdering": {
    "id": "client.mutationOrdering",
    "title": "RequestManager.restart: replaying mutations on reconnect",
    "repo": "convex-js",
    "path": "src/browser/sync/request_manager.ts",
    "startLine": 193,
    "endLine": 230,
    "symbol": "RequestManager.restart",
    "lang": "ts",
    "summary": "On reconnect, resends every in-flight mutation (in requestId order) but fails in-flight actions.",
    "explain": "Mutations from one client travel over one ordered WebSocket, numbered by requestId, and the server runs a session's mutations in that order. After a reconnect the client resends them all, even ones already completed, which the source justifies as safe because mutations are idempotent: the backend recognizes a resent (session, requestId) and does not apply it twice, and resending a completed one just makes the server transition the client past its commit ts. Actions can't be safely retried (they may have had external side effects), so they are failed with 'Connection lost while action was in flight'.",
    "notes": [
      {
        "line": 202,
        "text": "Mutations are resent, including completed ones."
      },
      {
        "line": 212,
        "text": "Why actions are at-most-once."
      },
      {
        "line": 223,
        "text": "The error you'll see on flaky networks."
      }
    ],
    "code": "  restart(): ClientMessage[] {\n    // When we reconnect to the backend, re-request all requests that are safe\n    // to be resend.\n\n    this.requestsOlderThanRestart = new Set(this.inflightRequests.keys());\n    const allMessages = [];\n    for (const [requestId, value] of this.inflightRequests) {\n      if (value.status.status === \"NotSent\") {\n        value.status.status = \"Requested\";\n        allMessages.push(value.message);\n        continue;\n      }\n\n      if (value.message.type === \"Mutation\") {\n        // This includes ones that have already been completed because we still\n        // want to tell the backend to transition the client past the completed\n        // timestamp. This is safe since mutations are idempotent.\n        allMessages.push(value.message);\n      } else if (value.message.type === \"Action\") {\n        // Unlike mutations, actions are not idempotent. When we reconnect to the\n        // backend, we don't know if it is safe to resend in-flight actions, so we\n        // cancel them and consider them failed.\n        this.inflightRequests.delete(requestId);\n        this.requestsOlderThanRestart.delete(requestId);\n        this.inflightActionsCount--;\n        if (value.status.status === \"Completed\") {\n          throw new Error(\"Action should never be in 'Completed' state\");\n        }\n        value.status.onResult({\n          success: false,\n          errorMessage: \"Connection lost while action was in flight\",\n          logLines: [],\n        });\n      }\n    }\n    this.markConnectionStateDirty();\n    return allMessages;\n  }"
  },
  "client.enqueueMutation": {
    "id": "client.enqueueMutation",
    "title": "enqueueMutation: optimistic update + send",
    "repo": "convex-js",
    "path": "src/browser/sync/client.ts",
    "startLine": 917,
    "endLine": 988,
    "symbol": "BaseConvexClient.enqueueMutation",
    "lang": "ts",
    "summary": "Allocates a requestId, applies the optimistic update locally, notifies React, then sends the Mutation message.",
    "explain": "Optimistic updates run synchronously before the message is even sent, so the UI changes in the same tick as the click. The update is recorded against the requestId; it stays applied (and is replayed on top of each new server result) until the mutation's commit is reflected in a Transition, at which point it is dropped and the server data takes over.",
    "notes": [
      {
        "line": 925,
        "text": "Monotonic per-client request ids give ordering."
      },
      {
        "line": 944,
        "text": "Layer the local change on current results."
      },
      {
        "line": 975,
        "text": "Wire message to the sync worker."
      },
      {
        "line": 982,
        "text": "Promise resolves later, after read-your-writes."
      }
    ],
    "code": "  enqueueMutation(\n    udfPath: string,\n    args?: Record<string, Value>,\n    options?: MutationOptions,\n    componentPath?: string,\n  ): { requestId: RequestId; mutationPromise: Promise<FunctionResult> } {\n    const mutationArgs = parseArgs(args);\n    this.tryReportLongDisconnect();\n    const requestId = this.nextRequestId;\n    this._nextRequestId++;\n\n    if (options !== undefined) {\n      const optimisticUpdate = options.optimisticUpdate;\n      if (optimisticUpdate !== undefined) {\n        const wrappedUpdate = (localQueryStore: OptimisticLocalStore) => {\n          const result: unknown = optimisticUpdate(\n            localQueryStore,\n            mutationArgs,\n          );\n          if (result instanceof Promise) {\n            this.logger.warn(\n              \"Optimistic update handler returned a Promise. Optimistic updates should be synchronous.\",\n            );\n          }\n        };\n\n        const changedQueryTokens =\n          this.optimisticQueryResults.applyOptimisticUpdate(\n            wrappedUpdate,\n            requestId,\n          );\n\n        const changedQueries = changedQueryTokens.map((token) => {\n          const localResult = this.localQueryResultByToken(token);\n          return {\n            token,\n            modification: {\n              kind: \"Updated\" as const,\n              result:\n                localResult === undefined\n                  ? undefined\n                  : {\n                      success: true as const,\n                      value: localResult,\n                      logLines: [],\n                    },\n            },\n          };\n        });\n        this.handleTransition({\n          queries: changedQueries,\n          reflectedMutations: [],\n          timestamp: this.remoteQuerySet.timestamp(),\n        });\n      }\n    }\n\n    const message: MutationRequest = {\n      type: \"Mutation\",\n      requestId,\n      udfPath,\n      componentPath,\n      args: [convexToJson(mutationArgs)],\n    };\n    const mightBeSent = this.webSocketManager.sendMessage(message);\n    const mutationPromise = this.requestManager.request(message, mightBeSent);\n    return {\n      requestId,\n      mutationPromise,\n    };\n  }\n"
  },
  "client.optimistic": {
    "id": "client.optimistic",
    "title": "OptimisticQueryResults: the optimistic layer stack",
    "repo": "convex-js",
    "path": "src/browser/sync/optimistic_updates_impl.ts",
    "startLine": 160,
    "endLine": 215,
    "symbol": "OptimisticQueryResults",
    "lang": "ts",
    "summary": "Keeps a list of pending optimistic updates and replays them over fresh server results.",
    "explain": "There is no 'rollback' code: rollback falls out of recomputation. Each time server results arrive, the store starts from the server's values, filters out updates whose mutations completed, and re-runs the remaining update functions in order. If a mutation failed, its update is simply dropped and the next recomputation no longer includes it. That is why optimistic updates must be pure functions of the local store.",
    "notes": [
      {
        "line": 177,
        "text": "Completed (or failed) mutations' layers are discarded."
      },
      {
        "line": 181,
        "text": "Start from authoritative server state."
      },
      {
        "line": 184,
        "text": "Replay remaining layers in order."
      },
      {
        "line": 192,
        "text": "Shallow diff decides which components re-render."
      }
    ],
    "code": "export class OptimisticQueryResults {\n  private queryResults: QueryResultsMap;\n  private optimisticUpdates: OptimisticUpdateAndId[];\n\n  constructor() {\n    this.queryResults = new Map();\n    this.optimisticUpdates = [];\n  }\n\n  /**\n   * Apply all optimistic updates on top of server query results\n   */\n  ingestQueryResultsFromServer(\n    serverQueryResults: QueryResultsMap,\n    optimisticUpdatesToDrop: Set<RequestId>,\n  ): ChangedQueries {\n    this.optimisticUpdates = this.optimisticUpdates.filter((updateAndId) => {\n      return !optimisticUpdatesToDrop.has(updateAndId.mutationId);\n    });\n\n    const oldQueryResults = this.queryResults;\n    this.queryResults = new Map(serverQueryResults);\n    const localStore = new OptimisticLocalStoreImpl(this.queryResults);\n    for (const updateAndId of this.optimisticUpdates) {\n      updateAndId.update(localStore);\n    }\n\n    // To find the changed queries, just do a shallow comparison\n    // TODO(CX-733): Change this so we avoid unnecessary rerenders\n    const changedQueries: ChangedQueries = [];\n    for (const [queryToken, query] of this.queryResults) {\n      const oldQuery = oldQueryResults.get(queryToken);\n      if (oldQuery === undefined || oldQuery.result !== query.result) {\n        changedQueries.push(queryToken);\n      }\n    }\n\n    return changedQueries;\n  }\n\n  applyOptimisticUpdate(\n    update: WrappedOptimisticUpdate,\n    mutationId: RequestId,\n  ): ChangedQueries {\n    // Apply the update to our store\n    this.optimisticUpdates.push({\n      update,\n      mutationId,\n    });\n    const localStore = new OptimisticLocalStoreImpl(this.queryResults);\n    update(localStore);\n\n    // Notify about any query results that changed\n    // TODO(CX-733): Change this so we avoid unnecessary rerenders\n    return localStore.modifiedQueries;\n  }"
  },
  "client.websocket": {
    "id": "client.websocket",
    "title": "WebSocketManager: frames, pings and chunked transitions",
    "repo": "convex-js",
    "path": "src/browser/sync/web_socket_manager.ts",
    "startLine": 434,
    "endLine": 476,
    "symbol": "WebSocketManager.connect → ws.onmessage",
    "lang": "ts",
    "summary": "Parses each frame, resets the inactivity timer, drops Pings, reassembles TransitionChunks and forwards messages to the client.",
    "explain": "Server Pings exist only to prove liveness: if nothing arrives for the inactivity threshold (60s), the client closes and reconnects. Large Transitions can arrive as TransitionChunk parts that are reassembled before the client logic sees them. Once the client reports it has synced past the last reconnect, backoff resets to zero.",
    "notes": [
      {
        "line": 435,
        "text": "Any frame counts as a heartbeat."
      },
      {
        "line": 441,
        "text": "Pings never reach BaseConvexClient."
      },
      {
        "line": 446,
        "text": "Big transitions are split and reassembled."
      },
      {
        "line": 473,
        "text": "Backoff resets after a healthy resync."
      }
    ],
    "code": "    ws.onmessage = (message) => {\n      this.resetServerInactivityTimeout();\n      const messageLength = message.data.length;\n      let serverMessage = parseServerMessage(JSON.parse(message.data));\n      this._logVerbose(`received ws message with type ${serverMessage.type}`);\n\n      // Ping's only purpose is to reset the server inactivity timer.\n      if (serverMessage.type === \"Ping\") {\n        return;\n      }\n\n      // TransitionChunks never reach the main client logic.\n      if (serverMessage.type === \"TransitionChunk\") {\n        const transition = this.assembleTransition(serverMessage);\n        if (!transition) {\n          return;\n        }\n        serverMessage = transition;\n        this._logVerbose(\n          `assembled full ws message of type ${serverMessage.type}`,\n        );\n      }\n\n      if (this.transitionChunkBuffer !== null) {\n        this.transitionChunkBuffer = null;\n        this.logger.log(\n          `Received unexpected ${serverMessage.type} while buffering TransitionChunks`,\n        );\n      }\n\n      if (serverMessage.type === \"Transition\") {\n        this.reportLargeTransition({\n          messageLength,\n          transition: serverMessage,\n        });\n      }\n      const response = this.onMessage(serverMessage);\n      if (response.hasSyncedPastLastReconnect) {\n        // Reset backoff to 0 once all outstanding requests are complete.\n        this.retries = 0;\n        this.markConnectionStateDirty();\n      }\n    };"
  },
  "client.reconnect": {
    "id": "client.reconnect",
    "title": "Reconnect with jittered exponential backoff",
    "repo": "convex-js",
    "path": "src/browser/sync/web_socket_manager.ts",
    "startLine": 571,
    "endLine": 883,
    "symbol": "scheduleReconnect / nextBackoff",
    "lang": "ts",
    "summary": "Schedules reconnects with exponential backoff and ±50% jitter, starting at 100ms for client-side causes.",
    "explain": "Every close path (error, server close, inactivity) ends in scheduleReconnect. When the socket reopens, BaseConvexClient sends Connect (with sessionId and maxObservedTimestamp), replays the whole query set as a fresh ModifyQuerySet, re-authenticates, and resends in-flight mutations. The server rebuilds state from scratch, so reconnects are correct by construction.",
    "notes": [
      {
        "line": 579,
        "text": "Delay depends on why we disconnected."
      },
      {
        "line": 878,
        "text": "Exponential growth, capped at maxBackoff."
      },
      {
        "line": 881,
        "text": "Jitter avoids thundering-herd reconnects after an outage."
      }
    ],
    "code": "  private scheduleReconnect(reason: \"client\" | ServerDisconnectError) {\n    // Cancel any existing scheduled reconnect to avoid multiple reconnects\n    if (this.scheduledReconnect) {\n      clearTimeout(this.scheduledReconnect.timeout);\n      this.scheduledReconnect = null;\n    }\n\n    this.socket = { state: \"disconnected\" };\n    const backoff = this.nextBackoff(reason);\n    this.markConnectionStateDirty();\n    this.logger.log(`Attempting reconnect in ${Math.round(backoff)}ms`);\n\n    const scheduledAt = monotonicMillis();\n    const timeoutId = setTimeout(() => {\n      // Only proceed if this timeout hasn't been cleared\n      if (this.scheduledReconnect?.timeout === timeoutId) {\n        this.scheduledReconnect = null;\n        this.connect();\n      }\n    }, backoff);\n\n    this.scheduledReconnect = {\n      timeout: timeoutId,\n      scheduledAt,\n      backoffMs: backoff,\n    };\n  }\n\n  /**\n// …\n  private nextBackoff(reason: \"client\" | ServerDisconnectError): number {\n    const initialBackoff: number =\n      reason === \"client\"\n        ? 100 // There's no evidence of a server problem, retry quickly\n        : reason === \"Unknown\"\n          ? this.defaultInitialBackoff\n          : serverDisconnectErrors[reason].timeout;\n\n    const baseBackoff = initialBackoff * Math.pow(2, this.retries);\n    this.retries += 1;\n    const actualBackoff = Math.min(baseBackoff, this.maxBackoff);\n    const jitter = actualBackoff * (Math.random() - 0.5);\n    return actualBackoff + jitter;\n  }"
  },
  "client.onOpen": {
    "id": "client.onOpen",
    "title": "On (re)connect: Connect + replay state",
    "repo": "convex-js",
    "path": "src/browser/sync/client.ts",
    "startLine": 421,
    "endLine": 445,
    "symbol": "BaseConvexClient onOpen",
    "lang": "ts",
    "summary": "Sends Connect, throws away remote results, and replays the query set, auth and in-flight mutations.",
    "explain": "A fresh RemoteQuerySet starts at version zero, matching a brand-new server-side sync worker. state.restart() builds a ModifyQuerySet that re-adds every live query; requestManager.restart() resends mutations. maxObservedTimestamp lets the server avoid serving the client a snapshot older than what it already saw (no time travel backwards after reconnect).",
    "notes": [
      {
        "line": 426,
        "text": "First message on every socket."
      },
      {
        "line": 428,
        "text": "Prevents going back in time after reconnect."
      },
      {
        "line": 437,
        "text": "Re-add every query, re-send auth."
      }
    ],
    "code": "        onOpen: (reconnectMetadata: ReconnectMetadata) => {\n          // We have a new WebSocket!\n          this.mark(\"convexWebSocketOpen\");\n          this.webSocketManager.sendMessage({\n            ...reconnectMetadata,\n            type: \"Connect\",\n            sessionId: this._sessionId,\n            maxObservedTimestamp: this.maxObservedTimestamp,\n          });\n\n          // Throw out our remote query, reissue queries\n          // and outstanding mutations, and reauthenticate.\n          this.remoteQuerySet = new RemoteQuerySet(\n            (queryId) => this.state.queryPath(queryId),\n            this.logger,\n          );\n          const [querySetModification, authModification] = this.state.restart();\n          if (authModification) {\n            this.webSocketManager.sendMessage(authModification);\n          }\n          this.webSocketManager.sendMessage(querySetModification);\n          for (const message of this.requestManager.restart()) {\n            this.webSocketManager.sendMessage(message);\n          }\n        },"
  },
  "client.protocol": {
    "id": "client.protocol",
    "title": "Sync protocol: client → server messages",
    "repo": "convex-js",
    "path": "src/browser/sync/protocol.ts",
    "startLine": 119,
    "endLine": 205,
    "symbol": "ClientMessage",
    "lang": "ts",
    "summary": "The full set of messages the client can send: Connect, ModifyQuerySet (Add/Remove), Mutation, Action, Authenticate, Event.",
    "explain": "Every message is JSON over one WebSocket. Queries are referenced by small integer ids that the client assigns. ModifyQuerySet and Authenticate both carry a baseVersion, making the query set and identity versioned state that the server must agree on before applying changes. Mutations and actions carry a requestId that pairs them with their responses.",
    "notes": [
      {
        "line": 146,
        "text": "Versioned diff of the subscription set."
      },
      {
        "line": 153,
        "text": "Request/response, matched by requestId."
      },
      {
        "line": 147,
        "text": "Server applies the diff only if its querySet version matches."
      }
    ],
    "code": "type Connect = {\n  type: \"Connect\";\n  sessionId: string;\n  connectionCount: number;\n  lastCloseReason: string | null;\n  maxObservedTimestamp?: TS | undefined;\n  clientTs: number;\n};\n\nexport type AddQuery = {\n  type: \"Add\";\n  queryId: QueryId;\n  udfPath: string;\n  args: JSONValue[];\n  journal?: QueryJournal | undefined;\n  /**\n   * @internal\n   */\n  componentPath?: string | undefined;\n};\n\nexport type RemoveQuery = {\n  type: \"Remove\";\n  queryId: QueryId;\n};\n\nexport type QuerySetModification = {\n  type: \"ModifyQuerySet\";\n  baseVersion: QuerySetVersion;\n  newVersion: QuerySetVersion;\n  modifications: (AddQuery | RemoveQuery)[];\n};\n\nexport type MutationRequest = {\n  type: \"Mutation\";\n  requestId: RequestId;\n  udfPath: string;\n  args: JSONValue[];\n  // Execute the mutation on a specific component.\n  // Only admin auth is allowed to run mutations on non-root components.\n  componentPath?: string | undefined;\n};\n\nexport type ActionRequest = {\n  type: \"Action\";\n  requestId: RequestId;\n  udfPath: string;\n  args: JSONValue[];\n  // Execute the action on a specific component.\n  // Only admin auth is allowed to run actions on non-root components.\n  componentPath?: string | undefined;\n};\n// …\nexport type ClientMessage =\n  | Connect\n  | Authenticate\n  | QuerySetModification\n  | MutationRequest\n  | ActionRequest\n  | Event;"
  },
  "client.protocolServer": {
    "id": "client.protocolServer",
    "title": "Sync protocol: server → client messages",
    "repo": "convex-js",
    "path": "src/browser/sync/protocol.ts",
    "startLine": 229,
    "endLine": 290,
    "symbol": "ServerMessage",
    "lang": "ts",
    "summary": "StateVersion, Transition with QueryUpdated/QueryFailed/QueryRemoved, TransitionChunk, and MutationResponse with its commit ts.",
    "explain": "StateVersion = {querySet, ts, identity}: which query set, at which database timestamp, under which identity. A Transition moves the client from startVersion to endVersion and lists only the queries whose results changed. MutationSuccess includes ts, the commit timestamp the client waits for before resolving the promise.",
    "notes": [
      {
        "line": 229,
        "text": "qs (querySet), ts, identity."
      },
      {
        "line": 258,
        "text": "The only way query results reach the client."
      },
      {
        "line": 274,
        "text": "MutationSuccess carries ts: the commit timestamp the client waits for (read-your-writes)."
      }
    ],
    "code": "export type StateVersion = {\n  querySet: QuerySetVersion;\n  ts: TS;\n  identity: IdentityVersion;\n};\ntype EncodedStateVersion = Omit<StateVersion, \"ts\"> & { ts: EncodedTS };\n\ntype StateModification =\n  | {\n      type: \"QueryUpdated\";\n      queryId: QueryId;\n      value: JSONValue;\n      logLines: LogLines;\n      journal: QueryJournal;\n    }\n  | {\n      type: \"QueryFailed\";\n      queryId: QueryId;\n      errorMessage: string;\n      logLines: LogLines;\n      errorData: JSONValue;\n      journal: QueryJournal;\n    }\n  | {\n      type: \"QueryRemoved\";\n      queryId: QueryId;\n    };\n\nexport type Transition = {\n  type: \"Transition\";\n  startVersion: StateVersion;\n  endVersion: StateVersion;\n  modifications: StateModification[];\n  clientClockSkew?: number;\n  serverTs?: number;\n};\n\nexport type TransitionChunk = {\n  type: \"TransitionChunk\";\n  chunk: string;\n  partNumber: number;\n  totalParts: number;\n  transitionId: string;\n};\n\ntype MutationSuccess = {\n  type: \"MutationResponse\";\n  requestId: RequestId;\n  success: true;\n  result: JSONValue;\n  ts: TS;\n  logLines: LogLines;\n};\ntype MutationFailed = {\n  type: \"MutationResponse\";\n  requestId: RequestId;\n  success: false;\n  result: string;\n  logLines: LogLines;\n  errorData?: JSONValue;\n};\nexport type MutationResponse = MutationSuccess | MutationFailed;"
  },
  "client.auth": {
    "id": "client.auth",
    "title": "AuthenticationManager: confirming and refreshing tokens",
    "repo": "convex-js",
    "path": "src/browser/sync/authentication_manager.ts",
    "startLine": 188,
    "endLine": 256,
    "symbol": "AuthenticationManager.onTransition / onAuthError",
    "lang": "ts",
    "summary": "Treats a Transition that bumps the identity version as server confirmation of a token and schedules refreshes before expiry.",
    "explain": "Authenticate is just another versioned state change. The server re-runs subscriptions under the new identity and answers with a Transition whose endVersion.identity is higher. That Transition is the 'token accepted' signal. AuthErrors carry the base version so stale errors for an old token can be ignored. Refetch is scheduled from the JWT's iat/exp so tokens are swapped before they expire, without dropping subscriptions.",
    "notes": [
      {
        "line": 199,
        "text": "Not an auth transition: ignore."
      },
      {
        "line": 211,
        "text": "Server accepted the token."
      },
      {
        "line": 255,
        "text": "Rejected token: refetch and retry."
      }
    ],
    "code": "  onTransition(serverMessage: Transition) {\n    if (\n      !this.syncState.isCurrentOrNewerAuthVersion(\n        serverMessage.endVersion.identity,\n      )\n    ) {\n      // This is a stale transition - client has moved on to\n      // a newer auth version.\n      return;\n    }\n    if (\n      serverMessage.endVersion.identity <= serverMessage.startVersion.identity\n    ) {\n      // This transition did not change auth - it is not a response to Authenticate.\n      return;\n    }\n\n    this._logVerbose(\n      `auth state is ${this.authState.state} when handling transition`,\n    );\n\n    // This transition advanced the auth version, which means the token used was valid\n    // and the client and server auth states are in sync.\n    this.syncState.markAuthCompletion();\n\n    if (this.authState.state === \"waitingForServerConfirmationOfCachedToken\") {\n      this._logVerbose(\"server confirmed auth token is valid\");\n      const cachedToken = this.syncState.getAuth()?.value;\n      if (this.initialAuthTokenReuse && cachedToken) {\n        this.scheduleTokenRefetch(cachedToken, serverMessage.clientClockSkew);\n      } else {\n        void this.refetchToken();\n      }\n      this.authState.config.onAuthChange(true);\n      return;\n    }\n    if (this.authState.state === \"waitingForServerConfirmationOfFreshToken\") {\n      this._logVerbose(\"server confirmed new auth token is valid\");\n      this.notifyRefreshChange(false);\n      this.scheduleTokenRefetch(this.authState.token);\n      this.tokenConfirmationAttempts = 0;\n      if (!this.authState.hadAuth) {\n        this.authState.config.onAuthChange(true);\n      }\n    }\n  }\n\n  onAuthError(serverMessage: AuthError) {\n    // If the AuthError is not due to updating the token, and we're currently\n    // waiting on the result of a token update, ignore.\n    if (\n      serverMessage.authUpdateAttempted === false &&\n      (this.authState.state === \"waitingForServerConfirmationOfFreshToken\" ||\n        this.authState.state === \"waitingForServerConfirmationOfCachedToken\")\n    ) {\n      this._logVerbose(\"ignoring non-auth token expired error\");\n      return;\n    }\n    const { baseVersion } = serverMessage;\n    // Versioned AuthErrors are ignored if the client advanced to\n    // a newer auth identity\n    // Error are reporting the previous version, since the server\n    // didn't advance, hence `+ 1`.\n    if (!this.syncState.isCurrentOrNewerAuthVersion(baseVersion + 1)) {\n      this._logVerbose(\"ignoring auth error for previous auth attempt\");\n      return;\n    }\n    void this.tryToReauthenticate(serverMessage);\n    return;"
  },
  "client.authState": {
    "id": "client.authState",
    "title": "LocalSyncState.setAuth: identity versions",
    "repo": "convex-js",
    "path": "src/browser/sync/local_state.ts",
    "startLine": 204,
    "endLine": 218,
    "symbol": "LocalSyncState.setAuth",
    "lang": "ts",
    "summary": "Builds an Authenticate message and bumps the client's identity version.",
    "explain": "Identity is the third component of StateVersion. Each new token increments identityVersion; the server applies it only if baseVersion matches. Because query results are cached per identity, a new identity can change every subscription's results, which the server delivers in one Transition.",
    "notes": [
      {
        "line": 209,
        "text": "Server checks this matches its view."
      },
      {
        "line": 211,
        "text": "Bumped immediately unless paused."
      }
    ],
    "code": "  setAuth(value: string): Authenticate {\n    this.auth = {\n      tokenType: \"User\" as const,\n      value: value,\n    };\n    const baseVersion = this.identityVersion;\n    if (!this.paused) {\n      this.identityVersion = baseVersion + 1;\n    }\n    return {\n      type: \"Authenticate\",\n      baseVersion: baseVersion,\n      ...this.auth,\n    };\n  }"
  },
  "client.usePaginatedQuery": {
    "id": "client.usePaginatedQuery",
    "title": "usePaginatedQuery: pages are separate reactive queries",
    "repo": "convex-js",
    "path": "src/react/use_paginated_query.ts",
    "startLine": 318,
    "endLine": 440,
    "symbol": "usePaginatedQuery",
    "lang": "ts",
    "summary": "Each loaded page is its own subscribed query with a fixed cursor range; oversized pages are split in two.",
    "explain": "loadMore adds a new query with paginationOpts {numItems, cursor: continueCursor}. Once a page has loaded, its end is pinned by the server (endCursor), so later inserts land inside existing pages instead of shifting page boundaries: pages grow or shrink reactively. If a page grows past twice the requested size or the server recommends it, the hook replaces it with two queries split at splitCursor.",
    "notes": [
      {
        "line": 329,
        "text": "Server-driven page splitting."
      },
      {
        "line": 331,
        "text": "Client-driven split for pages that grew."
      },
      {
        "line": 426,
        "text": "Next page starts exactly where the last ended."
      }
    ],
    "code": "      const ongoingSplit = currState.ongoingSplits[pageKey];\n      if (ongoingSplit !== undefined) {\n        if (\n          resultsObject[ongoingSplit[0]] !== undefined &&\n          resultsObject[ongoingSplit[1]] !== undefined\n        ) {\n          // Both pages of the split have results now. Swap them in.\n          setState(completeSplitQuery(pageKey));\n        }\n      } else if (\n        currResult.splitCursor &&\n        (currResult.pageStatus === \"SplitRecommended\" ||\n          currResult.pageStatus === \"SplitRequired\" ||\n          currResult.page.length > options.initialNumItems * 2)\n      ) {\n        // If a single page has more than double the expected number of items,\n        // or if the server requests a split, split the page into two.\n        setState(\n          splitQuery(\n            pageKey,\n            currResult.splitCursor,\n            currResult.continueCursor,\n          ),\n        );\n      }\n// …\n    const continueCursor = maybeLastResult.continueCursor;\n    let alreadyLoadingMore = false;\n    return {\n      status: \"CanLoadMore\",\n      isLoading: false,\n      loadMore: (numItems: number) => {\n        if (!alreadyLoadingMore) {\n          alreadyLoadingMore = true;\n          setState((prevState) => {\n            const pageKeys = [...prevState.pageKeys, prevState.nextPageKey];\n            const queries = { ...prevState.queries };\n            queries[prevState.nextPageKey] = {\n              query: prevState.query,\n              args: {\n                ...prevState.args,\n                paginationOpts: {\n                  numItems,\n                  cursor: continueCursor,\n                  id: prevState.id,\n                },\n              },\n            };\n            return {\n              ...prevState,\n              nextPageKey: prevState.nextPageKey + 1,\n              pageKeys,\n              queries,\n            };\n          });\n        }\n      },\n    } as const;"
  },
  "client.httpClient": {
    "id": "client.httpClient",
    "title": "ConvexHttpClient: one-shot queries and queued mutations",
    "repo": "convex-js",
    "path": "src/browser/http_client.ts",
    "startLine": 300,
    "endLine": 427,
    "symbol": "ConvexHttpClient.queryInner / processMutationQueue",
    "lang": "ts",
    "summary": "Non-reactive client: POSTs to /api/query or /api/mutation and serializes mutations through a local queue.",
    "explain": "No WebSocket, no subscriptions, no Transitions: you get one result at one timestamp. query_at_ts lets several queries read the same snapshot. Mutations are queued and executed one at a time by default to keep the in-order guarantee the WebSocket client gets for free.",
    "notes": [
      {
        "line": 322,
        "text": "Pin a query to a specific timestamp."
      },
      {
        "line": 325,
        "text": "Plain HTTPS POST."
      },
      {
        "line": 421,
        "text": "One mutation at a time: ordering preserved."
      }
    ],
    "code": "    const headers: Record<string, string> = {\n      \"Content-Type\": \"application/json\",\n      \"Convex-Client\": `npm-${version}`,\n    };\n    if (this.adminAuth) {\n      headers[\"Authorization\"] = `Convex ${this.adminAuth}`;\n    } else if (this.auth) {\n      headers[\"Authorization\"] = `Bearer ${this.auth}`;\n    }\n    const localFetch = this.fetch || specifiedFetch || fetch;\n\n    const timestamp = options.timestampPromise\n      ? await options.timestampPromise\n      : undefined;\n\n    const body = JSON.stringify({\n      path: name,\n      format: \"convex_encoded_json\",\n      args,\n      ...(timestamp ? { ts: timestamp } : {}),\n    });\n    const endpoint = timestamp\n      ? `${this.address}/api/query_at_ts`\n      : `${this.address}/api/query`;\n\n    const response = await localFetch(endpoint, {\n      ...this.fetchOptions,\n      body,\n      method: \"POST\",\n      headers: headers,\n    });\n    if (!response.ok && response.status !== STATUS_CODE_UDF_FAILED) {\n      throw new Error(await response.text());\n    }\n    const respJSON = await response.json();\n\n    if (this.debug) {\n      for (const line of respJSON.logLines ?? []) {\n        logForFunction(this.logger, \"info\", \"query\", name, line);\n      }\n    }\n    switch (respJSON.status) {\n      case \"success\":\n        return jsonToConvex(respJSON.value);\n      case \"error\":\n        if (respJSON.errorData !== undefined) {\n          throw forwardErrorData(\n            respJSON.errorData,\n            new ConvexError(respJSON.errorMessage),\n          );\n        }\n        throw new Error(respJSON.errorMessage);\n      default:\n        throw new Error(`Invalid response: ${JSON.stringify(respJSON)}`);\n    }\n  }\n\n// …\n  private async processMutationQueue() {\n    if (this.isProcessingQueue) {\n      return;\n    }\n\n    this.isProcessingQueue = true;\n    while (this.mutationQueue.length > 0) {\n      const { mutation, args, resolve, reject } = this.mutationQueue.shift()!;\n      try {\n        const result = await this.mutationInner(mutation, args);\n        resolve(result);\n      } catch (error) {\n        reject(error);\n      }\n    }\n    this.isProcessingQueue = false;"
  },
  "server.registration": {
    "id": "server.registration",
    "title": "mutationGeneric: what `mutation({...})` actually builds",
    "repo": "convex-js",
    "path": "src/server/impl/registration_impl.ts",
    "startLine": 49,
    "endLine": 265,
    "symbol": "mutationGeneric / invokeMutation",
    "lang": "ts",
    "summary": "Wraps your handler in an object the Rust host can call: it builds ctx from syscall-backed shims and exports validators as JSON.",
    "explain": "Your exported mutation is a function object tagged isMutation/isPublic with invokeMutation, exportArgs and exportReturns. On push the backend calls exportArgs/exportReturns to read validators as JSON, and the host validates args before your handler runs. At call time invokeMutation parses the JSON args, builds ctx (db writer, auth, storage, scheduler, runQuery/runMutation), awaits the handler, and returns JSON.",
    "notes": [
      {
        "line": 57,
        "text": "ctx.db is a syscall-backed object, not a DB connection."
      },
      {
        "line": 60,
        "text": "Scheduling is part of the mutation's transaction."
      },
      {
        "line": 181,
        "text": "Validators are exported as JSON for the backend."
      },
      {
        "line": 260,
        "text": "Entry point the isolate calls."
      }
    ],
    "code": "async function invokeMutation<\n  F extends (ctx: GenericMutationCtx<GenericDataModel>, ...args: any) => any,\n>(func: F, argsStr: string, visibility: FunctionVisibility) {\n  // TODO(presley): Change the function signature and propagate the requestId from Rust.\n  // Ok, to mock it out for now, since queries are only running in V8.\n  const requestId = \"\";\n  const args = jsonToConvex(JSON.parse(argsStr));\n  const mutationCtx = {\n    db: setupWriter(),\n    auth: setupAuth(requestId),\n    storage: setupStorageWriter(requestId),\n    scheduler: setupMutationScheduler(),\n    meta: setupMutationMeta(visibility),\n\n    runQuery: (reference: any, args?: any, options?: any) =>\n      options?.useStaleSnapshot\n        ? runUdf(\"snapshotQuery\", reference, args, options?.transactionLimits)\n        : runUdf(\"query\", reference, args, options?.transactionLimits),\n    runMutation: (reference: any, args?: any, options?: any) =>\n      runUdf(\"mutation\", reference, args, options?.transactionLimits),\n  };\n  const result = await invokeFunction(func, mutationCtx, args as any);\n  validateReturnValue(result);\n  return JSON.stringify(convexToJson(result === undefined ? null : result));\n}\n// …\nfunction exportArgs(functionDefinition: FunctionDefinition) {\n  return () => {\n    let args: GenericValidator = v.any();\n    if (\n      typeof functionDefinition === \"object\" &&\n      functionDefinition.args !== undefined\n    ) {\n      args = asObjectValidator(functionDefinition.args);\n    }\n    return JSON.stringify(args.json, strictReplacer);\n  };\n// …\nexport const mutationGeneric: MutationBuilder<any, \"public\"> = ((\n  functionDefinition: FunctionDefinition,\n) => {\n  const handler = (\n    typeof functionDefinition === \"function\"\n      ? functionDefinition\n      : functionDefinition.handler\n  ) as (ctx: GenericMutationCtx<any>, args: any) => any;\n  const func = dontCallDirectly(\"mutation\", handler) as RegisteredMutation<\n    \"public\",\n    any,\n    any\n  >;\n\n  assertNotBrowser();\n  func.isMutation = true;\n  func.isPublic = true;\n  func.invokeMutation = (argsStr) => invokeMutation(handler, argsStr, \"public\");\n  func.exportArgs = exportArgs(functionDefinition);\n  func.exportReturns = exportReturns(functionDefinition);\n  func._handler = handler;\n  return func;\n}) as MutationBuilder<any, \"public\">;"
  },
  "server.queryCtx": {
    "id": "server.queryCtx",
    "title": "invokeQuery: the query ctx",
    "repo": "convex-js",
    "path": "src/server/impl/registration_impl.ts",
    "startLine": 329,
    "endLine": 352,
    "symbol": "invokeQuery",
    "lang": "ts",
    "summary": "Builds a read-only ctx for queries: db reader, auth, storage reader, runQuery.",
    "explain": "Compare with invokeMutation: no writer, no scheduler. This is enforced at the API level and again by the host, which runs queries in a read-only transaction. Queries can be cached and re-run on invalidation precisely because their only inputs are args, identity and database reads.",
    "notes": [
      {
        "line": 337,
        "text": "Read-only database API."
      },
      {
        "line": 341,
        "text": "Nested queries share the same transaction."
      }
    ],
    "code": "async function invokeQuery<\n  F extends (ctx: GenericQueryCtx<GenericDataModel>, ...args: any) => any,\n>(func: F, argsStr: string, visibility: FunctionVisibility) {\n  // TODO(presley): Change the function signature and propagate the requestId from Rust.\n  // Ok, to mock it out for now, since queries are only running in V8.\n  const requestId = \"\";\n  const args = jsonToConvex(JSON.parse(argsStr));\n  const queryCtx = {\n    db: setupReader(),\n    auth: setupAuth(requestId),\n    storage: setupStorageReader(requestId),\n    meta: setupQueryMeta(visibility),\n    runQuery: (reference: any, args?: any, options?: any) => {\n      if (options?.useStaleSnapshot) {\n        throw new Error(\n          \"`useStaleSnapshot` is only supported in mutations, not queries.\",\n        );\n      }\n      return runUdf(\"query\", reference, args, options?.transactionLimits);\n    },\n  };\n  const result = await invokeFunction(func, queryCtx, args as any);\n  validateReturnValue(result);\n  return JSON.stringify(convexToJson(result === undefined ? null : result));"
  },
  "server.actionCtx": {
    "id": "server.actionCtx",
    "title": "invokeAction: actions have no ctx.db",
    "repo": "convex-js",
    "path": "src/server/impl/registration_impl.ts",
    "startLine": 500,
    "endLine": 514,
    "symbol": "invokeAction",
    "lang": "ts",
    "summary": "Actions get runQuery/runMutation/runAction, scheduler, storage and vectorSearch, but no database handle.",
    "explain": "Actions are not transactions. Each ctx.runQuery or ctx.runMutation inside an action is a separate transaction at its own timestamp, which is why consecutive runQuery calls in an action can see different database states.",
    "notes": [
      {
        "line": 504,
        "text": "runQuery/runMutation/runAction via syscalls."
      },
      {
        "line": 510,
        "text": "Vector search is action-only."
      }
    ],
    "code": "async function invokeAction<\n  F extends (ctx: GenericActionCtx<GenericDataModel>, ...args: any) => any,\n>(func: F, requestId: string, argsStr: string, visibility: FunctionVisibility) {\n  const args = jsonToConvex(JSON.parse(argsStr));\n  const calls = setupActionCalls(requestId);\n  const ctx = {\n    ...calls,\n    auth: setupAuth(requestId),\n    scheduler: setupActionScheduler(requestId),\n    storage: setupStorageActionWriter(requestId),\n    vectorSearch: setupActionVectorSearch(requestId) as any,\n    meta: setupActionMeta(visibility),\n  };\n  const result = await invokeFunction(func, ctx, args as any);\n  return JSON.stringify(convexToJson(result === undefined ? null : result));"
  },
  "server.runUdf": {
    "id": "server.runUdf",
    "title": "runUdf: ctx.runQuery / ctx.runMutation",
    "repo": "convex-js",
    "path": "src/server/impl/registration_impl.ts",
    "startLine": 755,
    "endLine": 772,
    "symbol": "runUdf",
    "lang": "ts",
    "summary": "Nested function calls are a single async syscall, 1.0/runUdf, handled by the Rust host.",
    "explain": "Inside a mutation, ctx.runMutation runs the callee as a sub-transaction in the same overall transaction. From an action, the same syscall starts an independent transaction. Either way the JS side only sends a function address and JSON args.",
    "notes": [
      {
        "line": 770,
        "text": "Host decides how to run the nested call."
      }
    ],
    "code": "async function runUdf(\n  udfType: \"query\" | \"mutation\" | \"snapshotQuery\",\n  f: any,\n  args?: Record<string, Value>,\n  transactionLimits?: Record<string, number>,\n): Promise<any> {\n  const queryArgs = parseArgs(args);\n  const syscallArgs: Record<string, any> = {\n    udfType,\n    args: convexToJson(queryArgs),\n    ...getFunctionAddress(f),\n  };\n  if (transactionLimits) {\n    syscallArgs.transactionLimits = transactionLimits;\n  }\n  const result = await performAsyncSyscall(\"1.0/runUdf\", syscallArgs);\n  return jsonToConvex(result);\n}"
  },
  "server.syscall": {
    "id": "server.syscall",
    "title": "performSyscall: JS → Rust boundary",
    "repo": "convex-js",
    "path": "src/server/impl/syscall.ts",
    "startLine": 1,
    "endLine": 55,
    "symbol": "performSyscall / performAsyncSyscall",
    "lang": "ts",
    "summary": "Every ctx operation is a JSON string passed to a host function (global `Convex`) that the Rust isolate injects.",
    "explain": "Inside the V8 isolate there is no network, filesystem or database driver. The host installs a global Convex object with syscall (sync) and asyncSyscall (returns a Promise resolved by Rust). ctx.db.get, insert, query streaming, scheduling and auth all become strings like '1.0/get' with JSON args. This narrow boundary is how the Rust side records every read into the read set and buffers every write.",
    "notes": [
      {
        "line": 4,
        "text": "Injected by the isolate host, not a Node global."
      },
      {
        "line": 24,
        "text": "Synchronous call into Rust."
      },
      {
        "line": 40,
        "text": "Async call: Rust resolves the promise."
      }
    ],
    "code": "import { ConvexError } from \"../../values/errors.js\";\nimport { jsonToConvex } from \"../../values/value.js\";\n\ndeclare const Convex: {\n  syscall: (op: string, jsonArgs: string) => string;\n  asyncSyscall: (op: string, jsonArgs: string) => Promise<string>;\n  jsSyscall: (op: string, args: Record<string, any>) => any;\n};\n/**\n * Perform a syscall, taking in a JSON-encodable object as an argument, serializing with\n * JSON.stringify, calling into Rust, and then parsing the response as a JSON-encodable\n * value. If one of your arguments is a Convex value, you must call `convexToJson` on it\n * before passing it to this function, and if the return value has a Convex value, you're\n * also responsible for calling `jsonToConvex`: This layer only deals in JSON.\n */\n\nexport function performSyscall(op: string, arg: Record<string, any>): any {\n  if (typeof Convex === \"undefined\" || Convex.syscall === undefined) {\n    throw new Error(\n      \"The Convex database and auth objects are being used outside of a Convex backend. \" +\n        \"Did you mean to use `useQuery` or `useMutation` to call a Convex function?\",\n    );\n  }\n  const resultStr = Convex.syscall(op, JSON.stringify(arg));\n  return JSON.parse(resultStr);\n}\n\nexport async function performAsyncSyscall(\n  op: string,\n  arg: Record<string, any>,\n): Promise<any> {\n  if (typeof Convex === \"undefined\" || Convex.asyncSyscall === undefined) {\n    throw new Error(\n      \"The Convex database and auth objects are being used outside of a Convex backend. \" +\n        \"Did you mean to use `useQuery` or `useMutation` to call a Convex function?\",\n    );\n  }\n  let resultStr;\n  try {\n    resultStr = await Convex.asyncSyscall(op, JSON.stringify(arg));\n  } catch (e: any) {\n    // Rethrow the exception to attach stack trace starting from here.\n    // If the error came from JS it will include its own stack trace in the message.\n    // If it came from Rust it won't.\n\n    // This only happens if we're propagating ConvexErrors\n    if (e.data !== undefined) {\n      const rethrown = new ConvexError(e.message);\n      rethrown.data = jsonToConvex(e.data);\n      throw rethrown;\n    }\n    throw new Error(e.message);\n  }\n  return JSON.parse(resultStr);\n}"
  },
  "server.dbReader": {
    "id": "server.dbReader",
    "title": "Query builder: withIndex, filter, streaming",
    "repo": "convex-js",
    "path": "src/server/impl/query_impl.ts",
    "startLine": 51,
    "endLine": 272,
    "symbol": "QueryInitializerImpl / QueryImpl",
    "lang": "ts",
    "summary": "The query builder only serializes a plan; execution streams results from Rust one document at a time.",
    "explain": "withIndex produces {source: IndexRange, range}, filter appends a serialized expression, and nothing touches the database until you iterate. Then 1.0/queryStream hands the whole plan to Rust and 1.0/queryStreamNext pulls rows. Note that filter expressions are evaluated in Rust, not JS, but they still run after the rows are read from the index range: every scanned row is in your read set and counts toward limits.",
    "notes": [
      {
        "line": 62,
        "text": "The index range becomes the read-set interval."
      },
      {
        "line": 197,
        "text": "Plan handed to the host."
      },
      {
        "line": 238,
        "text": "Filters are data, evaluated by Rust after the scan."
      },
      {
        "line": 264,
        "text": "Pull-based streaming, one document per call."
      }
    ],
    "code": "  withIndex(\n    indexName: string,\n    indexRange?: (q: IndexRangeBuilderImpl) => IndexRangeBuilderImpl,\n  ): QueryImpl {\n    validateArg(indexName, 1, \"withIndex\", \"indexName\");\n    let rangeBuilder = IndexRangeBuilderImpl.new();\n    if (indexRange !== undefined) {\n      rangeBuilder = indexRange(rangeBuilder);\n    }\n    return new QueryImpl({\n      source: {\n        type: \"IndexRange\",\n        indexName: this.tableName + \".\" + indexName,\n        range: rangeBuilder.export(),\n        order: null,\n      },\n      operators: [],\n    });\n  }\n// …\n  private startQuery(): number {\n    if (this.state.type === \"executing\") {\n      throw new Error(\"Iteration can only begin on a query once.\");\n    }\n    if (this.state.type === \"closed\" || this.state.type === \"consumed\") {\n      throwClosedError(this.state.type);\n    }\n    const query = this.state.query;\n    const { queryId } = performSyscall(\"1.0/queryStream\", { query, version });\n    this.state = { type: \"executing\", queryId };\n    return queryId;\n  }\n// …\n  filter(\n    predicate: (\n      q: FilterBuilder<GenericTableInfo>,\n    ) => ExpressionOrValue<boolean>,\n  ): any {\n    validateArg(predicate, 1, \"filter\", \"predicate\");\n    const query = this.takeQuery();\n    if (query.operators.length >= MAX_QUERY_OPERATORS) {\n      throw new Error(\n        `Can't construct query with more than ${MAX_QUERY_OPERATORS} operators`,\n      );\n    }\n    query.operators.push({\n      filter: serializeExpression(predicate(filterBuilderImpl)),\n    });\n    return new QueryImpl(query);\n  }\n\n// …\n  async next(): Promise<IteratorResult<any>> {\n    if (this.state.type === \"closed\" || this.state.type === \"consumed\") {\n      throwClosedError(this.state.type);\n    }\n    // Allow calling `.next()` when the query is in \"preparing\" state to implicitly start the\n    // query. This allows the developer to call `.next()` on the query without having to use\n    // a `for await` statement.\n    const queryId =\n      this.state.type === \"preparing\" ? this.startQuery() : this.state.queryId;\n    const { value, done } = await performAsyncSyscall(\"1.0/queryStreamNext\", {\n      queryId,\n    });\n    if (done) {\n      this.closeQuery();\n    }\n    const convexValue = jsonToConvex(value);\n    return { value: convexValue, done };\n  }"
  },
  "server.paginate": {
    "id": "server.paginate",
    "title": "paginate: cursors via 1.0/queryPage",
    "repo": "convex-js",
    "path": "src/server/impl/query_impl.ts",
    "startLine": 279,
    "endLine": 313,
    "symbol": "QueryImpl.paginate",
    "lang": "ts",
    "summary": "One syscall returns a page plus continueCursor, splitCursor and pageStatus.",
    "explain": "Cursors are opaque encodings of a position in the index. endCursor pins the end of a page so a reactive page keeps the same bounds as data changes. maximumRowsRead caps how much is scanned, which is how the server can return SplitRequired for a page that would exceed limits.",
    "notes": [
      {
        "line": 294,
        "text": "Pinned page end for reactive pagination."
      },
      {
        "line": 297,
        "text": "Single host call per page."
      }
    ],
    "code": "  async paginate(\n    paginationOpts: PaginationOptions,\n  ): Promise<PaginationResult<any>> {\n    validateArg(paginationOpts, 1, \"paginate\", \"options\");\n    if (\n      typeof paginationOpts?.numItems !== \"number\" ||\n      paginationOpts.numItems < 0\n    ) {\n      throw new Error(\n        `\\`options.numItems\\` must be a positive number. Received \\`${paginationOpts?.numItems}\\`.`,\n      );\n    }\n    const query = this.takeQuery();\n    const pageSize = paginationOpts.numItems;\n    const cursor = paginationOpts.cursor;\n    const endCursor = paginationOpts?.endCursor ?? null;\n    const maximumRowsRead = paginationOpts.maximumRowsRead ?? null;\n    const { page, isDone, continueCursor, splitCursor, pageStatus } =\n      await performAsyncSyscall(\"1.0/queryPage\", {\n        query,\n        cursor,\n        endCursor,\n        pageSize,\n        maximumRowsRead,\n        maximumBytesRead: paginationOpts.maximumBytesRead,\n        version,\n      });\n    return {\n      page: page.map((json: string) => jsonToConvex(json)),\n      isDone,\n      continueCursor,\n      splitCursor,\n      pageStatus,\n    };\n  }"
  },
  "server.indexRange": {
    "id": "server.indexRange",
    "title": "IndexRangeBuilder.eq",
    "repo": "convex-js",
    "path": "src/server/impl/index_range_builder_impl.ts",
    "startLine": 17,
    "endLine": 56,
    "symbol": "IndexRangeBuilderImpl",
    "lang": "ts",
    "summary": "Range expressions are accumulated as a list of {type, fieldPath, value} and exported to the query plan.",
    "explain": "q.eq('a', 1).gt('b', 2) is just a list of serialized expressions. The backend validates that eqs come first in index-field order followed by at most one lower and one upper bound, then turns it into a contiguous key interval. The builder is single-use (consume()) to force the chaining style.",
    "notes": [
      {
        "line": 44,
        "text": "Each builder can be used once."
      },
      {
        "line": 51,
        "text": "Serialized range expression."
      }
    ],
    "code": "export class IndexRangeBuilderImpl\n  extends IndexRange\n  implements\n    IndexRangeBuilder<GenericDocument, GenericIndexFields>,\n    LowerBoundIndexRangeBuilder<GenericDocument, string>,\n    UpperBoundIndexRangeBuilder<GenericDocument, string>\n{\n  private rangeExpressions: ReadonlyArray<SerializedRangeExpression>;\n  private isConsumed: boolean;\n  private constructor(\n    rangeExpressions: ReadonlyArray<SerializedRangeExpression>,\n  ) {\n    super();\n    this.rangeExpressions = rangeExpressions;\n    this.isConsumed = false;\n  }\n\n  static new(): IndexRangeBuilderImpl {\n    return new IndexRangeBuilderImpl([]);\n  }\n\n  private consume() {\n    if (this.isConsumed) {\n      throw new Error(\n        \"IndexRangeBuilder has already been used! Chain your method calls like `q => q.eq(...).eq(...)`. See https://docs.convex.dev/using/indexes\",\n      );\n    }\n    this.isConsumed = true;\n  }\n\n  eq(fieldName: string, value: Value) {\n    this.consume();\n    return new IndexRangeBuilderImpl(\n      this.rangeExpressions.concat({\n        type: \"Eq\",\n        fieldPath: fieldName,\n        value: convexOrUndefinedToJson(value),\n      }),\n    );\n  }"
  },
  "server.dbWriter": {
    "id": "server.dbWriter",
    "title": "ctx.db writes: insert, patch, replace, delete",
    "repo": "convex-js",
    "path": "src/server/impl/database_impl.ts",
    "startLine": 95,
    "endLine": 136,
    "symbol": "insert / patch / replace / delete_",
    "lang": "ts",
    "summary": "Each write is an async syscall; Rust buffers it in the transaction's pending writes until commit.",
    "explain": "Writes are not sent to storage when you call them. The host validates them against the schema and stages them in the transaction; the function's later reads see its own pending writes. Only after the handler returns does the committer validate the read set (OCC) and persist everything atomically. patch maps to shallowMerge.",
    "notes": [
      {
        "line": 98,
        "text": "System tables are written only by the host."
      },
      {
        "line": 102,
        "text": "Returns the new _id, assigned by the host."
      },
      {
        "line": 113,
        "text": "patch = shallow merge."
      }
    ],
    "code": "\nasync function insert(tableName: string, value: any) {\n  if (tableName.startsWith(\"_\")) {\n    throw new Error(\"System tables (prefixed with `_`) are read-only.\");\n  }\n  validateArg(tableName, 1, \"insert\", \"table\");\n  validateArg(value, 2, \"insert\", \"value\");\n  const syscallJSON = await performAsyncSyscall(\"1.0/insert\", {\n    table: tableName,\n    value: convexToJson(value),\n  });\n  const syscallResult = jsonToConvex(syscallJSON) as any;\n  return syscallResult._id;\n}\n\nasync function patch(table: string | undefined, id: any, value: any) {\n  validateArg(id, 1, \"patch\", \"id\");\n  validateArg(value, 2, \"patch\", \"value\");\n  await performAsyncSyscall(\"1.0/shallowMerge\", {\n    id: convexToJson(id),\n    value: patchValueToJson(value as Value),\n    table,\n  });\n}\n\nasync function replace(table: string | undefined, id: any, value: any) {\n  validateArg(id, 1, \"replace\", \"id\");\n  validateArg(value, 2, \"replace\", \"value\");\n  await performAsyncSyscall(\"1.0/replace\", {\n    id: convexToJson(id),\n    value: convexToJson(value),\n    table,\n  });\n}\n\nasync function delete_(table: string | undefined, id: any) {\n  validateArg(id, 1, \"delete\", \"id\");\n  await performAsyncSyscall(\"1.0/remove\", {\n    id: convexToJson(id),\n    table,\n  });\n}"
  },
  "server.scheduler": {
    "id": "server.scheduler",
    "title": "ctx.scheduler: scheduling is a database write",
    "repo": "convex-js",
    "path": "src/server/impl/scheduler_impl.ts",
    "startLine": 17,
    "endLine": 106,
    "symbol": "setupMutationScheduler",
    "lang": "ts",
    "summary": "runAfter/runAt become 1.0/schedule syscalls that insert a row into _scheduled_functions inside the current transaction.",
    "explain": "Because scheduling from a mutation is just a write in the same transaction, the job exists if and only if the mutation commits. If the mutation retries due to an OCC conflict or throws, the scheduled job disappears with it. Note Date.now() here: inside a mutation it is fixed for the whole execution, so the computed run time is deterministic across retries.",
    "notes": [
      {
        "line": 25,
        "text": "Transactional insert into _scheduled_functions."
      },
      {
        "line": 99,
        "text": "Uses the deterministic Date.now of the function run."
      }
    ],
    "code": "export function setupMutationScheduler(): Scheduler {\n  return {\n    runAfter: async (\n      delayMs: number,\n      functionReference: SchedulableFunctionReferenceCompat,\n      args?: Record<string, Value>,\n    ) => {\n      const syscallArgs = runAfterSyscallArgs(delayMs, functionReference, args);\n      return await performAsyncSyscall(\"1.0/schedule\", syscallArgs);\n    },\n    runAt: async (\n      ms_since_epoch_or_date: number | Date,\n      functionReference: SchedulableFunctionReferenceCompat,\n      args?: Record<string, Value>,\n    ) => {\n      const syscallArgs = runAtSyscallArgs(\n        ms_since_epoch_or_date,\n        functionReference,\n        args,\n      );\n      return await performAsyncSyscall(\"1.0/schedule\", syscallArgs);\n    },\n    cancel: async (id: Id<\"_scheduled_functions\">) => {\n      validateArg(id, 1, \"cancel\", \"id\");\n      const args = { id: convexToJson(id) };\n      await performAsyncSyscall(\"1.0/cancel_job\", args);\n    },\n  };\n}\n// …\nfunction runAfterSyscallArgs(\n  delayMs: number,\n  functionReference: SchedulableFunctionReferenceCompat,\n  args?: Record<string, Value>,\n) {\n  if (typeof delayMs !== \"number\") {\n    throw new Error(\"`delayMs` must be a number\");\n  }\n  if (!isFinite(delayMs)) {\n    throw new Error(\"`delayMs` must be a finite number\");\n  }\n  if (delayMs < 0) {\n    throw new Error(\"`delayMs` must be non-negative\");\n  }\n  const functionArgs = parseArgs(args);\n  const address = getFunctionAddress(functionReference);\n  // Note the syscall expects a unix timestamp, measured in seconds.\n  const ts = (Date.now() + delayMs) / 1000.0;\n  return {\n    ...address,\n    ts,\n    args: convexToJson(functionArgs),\n    version,\n  };\n}"
  },
  "server.auth": {
    "id": "server.auth",
    "title": "ctx.auth.getUserIdentity",
    "repo": "convex-js",
    "path": "src/server/impl/authentication_impl.ts",
    "startLine": 1,
    "endLine": 12,
    "symbol": "setupAuth",
    "lang": "ts",
    "summary": "getUserIdentity is one syscall; the identity was verified by the host from the JWT before your function ran.",
    "explain": "JWT verification happens on the Rust side when the client sends Authenticate (or per HTTP request). Your function only reads the already-verified identity. Because identity is an input to the function, it is part of the query cache key.",
    "notes": [
      {
        "line": 7,
        "text": "Verified identity provided by the host."
      }
    ],
    "code": "import { Auth } from \"../authentication.js\";\nimport { performAsyncSyscall } from \"./syscall.js\";\n\nexport function setupAuth(requestId: string): Auth {\n  return {\n    getUserIdentity: async () => {\n      return await performAsyncSyscall(\"1.0/getUserIdentity\", {\n        requestId,\n      });\n    },\n  };\n}"
  },
  "server.storage": {
    "id": "server.storage",
    "title": "ctx.storage: file storage syscalls",
    "repo": "convex-js",
    "path": "src/server/impl/storage_impl.ts",
    "startLine": 13,
    "endLine": 81,
    "symbol": "setupStorageReader / setupStorageWriter",
    "lang": "ts",
    "summary": "Storage operations are syscalls; generateUploadUrl returns a short-lived URL the browser POSTs file bytes to.",
    "explain": "Mutations can generate upload URLs, delete files and read metadata, but bytes are not streamed through the mutation. In actions, store/get use JS-level syscalls that pass Blobs efficiently. File metadata lives in the _storage system table, so file references are ordinary, reactive documents.",
    "notes": [
      {
        "line": 37,
        "text": "Client uploads directly to this URL."
      },
      {
        "line": 56,
        "text": "Store raw bytes (base64) from a function."
      }
    ],
    "code": "export function setupStorageReader(requestId: string): StorageReader {\n  return {\n    getUrl: async (storageId: FileStorageId) => {\n      validateArg(storageId, 1, \"getUrl\", \"storageId\");\n      return await performAsyncSyscall(\"1.0/storageGetUrl\", {\n        requestId,\n        version,\n        storageId,\n      });\n    },\n    getMetadata: async (storageId: FileStorageId): Promise<FileMetadata> => {\n      return await performAsyncSyscall(\"1.0/storageGetMetadata\", {\n        requestId,\n        version,\n        storageId,\n      });\n    },\n  };\n}\n\nexport function setupStorageWriter(requestId: string): StorageWriter {\n  const reader = setupStorageReader(requestId);\n  return {\n    generateUploadUrl: async () => {\n      return await performAsyncSyscall(\"1.0/storageGenerateUploadUrl\", {\n        requestId,\n        version,\n      });\n    },\n    delete: async (storageId: FileStorageId) => {\n      await performAsyncSyscall(\"1.0/storageDelete\", {\n        requestId,\n        version,\n        storageId,\n      });\n    },\n    store: async (blob: Blob, options?: { sha256?: string }) => {\n      if (!(blob instanceof Blob)) {\n        throw new Error(\n          \"store() expects a Blob. If you are trying to store a Request, `await request.blob()` will give you the correct input.\",\n        );\n      }\n      const bytes = new Uint8Array(await blob.arrayBuffer());\n      return await performAsyncSyscall(\"1.0/storageStore\", {\n        requestId,\n        version,\n        blob: fromByteArray(bytes),\n        contentType: blob.type,\n        sha256: options?.sha256,\n      });\n    },\n    get: async (storageId: FileStorageId) => {\n      const result: { blob: string; contentType: string | null } | null =\n        await performAsyncSyscall(\"1.0/storageGet\", {\n          requestId,\n          version,\n          storageId,\n        });\n      if (result === null) {\n        return null;\n      }\n      return new Blob([toByteArray(result.blob)], {\n        type: result.contentType ?? \"\",\n      });\n    },\n    getUrl: reader.getUrl,\n    getMetadata: reader.getMetadata,\n  };\n}"
  },
  "values.validators": {
    "id": "values.validators",
    "title": "v.id and validator JSON",
    "repo": "convex-js",
    "path": "src/values/validators.ts",
    "startLine": 69,
    "endLine": 109,
    "symbol": "VId",
    "lang": "ts",
    "summary": "Validators are classes whose main runtime job is producing JSON (`.json`) that the backend enforces.",
    "explain": "v.id('users') carries the table name. Its json form {type: 'id', tableName} is shipped to the backend during push, together with schema validators. The backend checks args, return values and documents against these descriptions, so validation happens in Rust and is not skippable by a client.",
    "notes": [
      {
        "line": 81,
        "text": "Discriminant used by tooling and codegen."
      },
      {
        "line": 101,
        "text": "What the backend actually receives."
      }
    ],
    "code": "export class VId<\n  Type,\n  IsOptional extends OptionalProperty = \"required\",\n> extends BaseValidator<Type, IsOptional> {\n  /**\n   * The name of the table that the validated IDs must belong to.\n   */\n  readonly tableName: TableNameFromType<Type>;\n\n  /**\n   * The kind of validator, `\"id\"`.\n   */\n  readonly kind = \"id\" as const;\n\n  /**\n   * Usually you'd use `v.id(tableName)` instead.\n   */\n  constructor({\n    isOptional,\n    tableName,\n  }: {\n    isOptional: IsOptional;\n    tableName: TableNameFromType<Type>;\n  }) {\n    super({ isOptional });\n    if (typeof tableName !== \"string\") {\n      throw new Error(\"v.id(tableName) requires a string\");\n    }\n    this.tableName = tableName;\n  }\n  /** @internal */\n  get json(): ValidatorJSON {\n    return { type: \"id\", tableName: this.tableName };\n  }\n  /** Allow this field to be validated as absent. */\n  optional() {\n    return new VId<Type | undefined, \"optional\">({\n      isOptional: \"optional\",\n      tableName: this.tableName,\n    });\n  }"
  },
  "values.id": {
    "id": "values.id",
    "title": "Id<T>: just a branded string",
    "repo": "convex-js",
    "path": "src/values/value.ts",
    "startLine": 32,
    "endLine": 52,
    "symbol": "Id",
    "lang": "ts",
    "summary": "Ids are URL-safe base32 strings at runtime; the table name exists only in the TypeScript type.",
    "explain": "The client never decodes ids. Table membership is checked server-side: the encoded id contains the table number and a checksum, and v.id('table') rejects ids from other tables.",
    "notes": [
      {
        "line": 40,
        "text": "Encoding is opaque to the client."
      },
      {
        "line": 52,
        "text": "Compile-time brand only."
      }
    ],
    "code": "/**\n * An identifier for a document in Convex.\n *\n * Convex documents are uniquely identified by their `Id`, which is accessible\n * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/database/document-ids).\n *\n * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.\n *\n * IDs are base 32 encoded strings which are URL safe.\n *\n * IDs are just strings at runtime, but this type can be used to distinguish them from other\n * strings at compile time.\n *\n * If you're using code generation, use the `Id` type generated for your data model in\n * `convex/_generated/dataModel.d.ts`.\n *\n * @typeParam TableName - A string literal type of the table name (like \"users\").\n *\n * @public\n */\nexport type Id<TableName extends string> = string & { __tableName: TableName };"
  },
  "cli.bundle": {
    "id": "cli.bundle",
    "title": "bundle(): esbuild for the isolate or Node",
    "repo": "convex-js",
    "path": "src/bundler/index.ts",
    "startLine": 182,
    "endLine": 250,
    "symbol": "bundle",
    "lang": "ts",
    "summary": "convex dev / deploy bundle your convex/ folder with esbuild, separately for the V8 isolate and for 'use node' files.",
    "explain": "Each output file becomes a module {path, source, sourceMap, environment}. environment is 'isolate' for the default runtime and 'node' for 'use node' files, which run in a separate Node executor. These bundles are what gets uploaded and stored by the backend.",
    "notes": [
      {
        "line": 242,
        "text": "Two runtimes, two bundles."
      },
      {
        "line": 250,
        "text": "Unit of upload: a module."
      }
    ],
    "code": "export async function bundle({\n  ctx,\n  dir,\n  entryPoints,\n  generateSourceMaps,\n// …\n  const result = await doEsbuild({\n    ctx,\n    dir,\n    entryPoints,\n    generateSourceMaps,\n    platform,\n    chunksFolder,\n    externalPackages: availableExternalPackages,\n    extraConditions,\n    includeSourcesContent,\n    splitting,\n  });\n  // Some ESBuild errors won't show up here, instead crashing in doEsbuild().\n  if (result.errors.length) {\n    const errorMessage = result.errors\n      .map((e) => `esbuild error: ${e.text}`)\n      .join(\"\\n\");\n    return await ctx.crash({\n      exitCode: 1,\n      errorType: \"invalid filesystem data\",\n      printedMessage: errorMessage,\n    });\n  }\n  for (const warning of result.warnings) {\n    logWarning(chalkStderr.yellow(`esbuild warning: ${warning.text}`));\n  }\n  const sourceMaps = new Map();\n  const modules: Bundle[] = [];\n  const environment = platform === \"node\" ? \"node\" : \"isolate\";\n  for (const outputFile of result.outputFiles) {\n    const relPath = path.relative(path.normalize(\"out\"), outputFile.path);\n    if (path.extname(relPath) === \".map\") {\n      sourceMaps.set(relPath, outputFile.text);\n      continue;\n    }\n    const posixRelPath = relPath.split(path.sep).join(path.posix.sep);\n    modules.push({ path: posixRelPath, source: outputFile.text, environment });"
  },
  "cli.useNode": {
    "id": "cli.useNode",
    "title": "Detecting the 'use node' directive",
    "repo": "convex-js",
    "path": "src/bundler/index.ts",
    "startLine": 505,
    "endLine": 529,
    "symbol": "hasUseNodeDirective",
    "lang": "ts",
    "summary": "Files are routed to the Node runtime only if their AST has a top-level 'use node' directive.",
    "explain": "This is why a 'use node' file may only contain actions: the whole file is bundled for and executed by the Node executor, which doesn't have transactional database access.",
    "notes": [
      {
        "line": 512,
        "text": "Fast path."
      },
      {
        "line": 527,
        "text": "Real check: a directive prologue."
      }
    ],
    "code": "// A fallback regex in case we fail to parse the AST.\nexport const useNodeDirectiveRegex = /^\\s*(\"|')use node(\"|');?\\s*$/;\n\nfunction hasUseNodeDirective(ctx: Context, fpath: string): boolean {\n  // Do a quick check for the exact string. If it doesn't exist, don't\n  // bother parsing.\n  const source = ctx.fs.readUtf8File(fpath);\n  if (source.indexOf(\"use node\") === -1) {\n    return false;\n  }\n\n  // We parse the AST here to extract the \"use node\" declaration. This is more\n  // robust than doing a regex. We only use regex as a fallback.\n  try {\n    const ast = parseAST(source, {\n      // parse in strict mode and allow module declarations\n      sourceType: \"module\",\n\n      // esbuild supports jsx and typescript by default. Allow the same plugins\n      // here too.\n      plugins: [\"jsx\", \"typescript\"],\n    });\n    return ast.program.directives\n      .map((d) => d.value.value)\n      .includes(\"use node\");"
  },
  "cli.push": {
    "id": "cli.push",
    "title": "runComponentsPush: start → wait for schema → finish",
    "repo": "convex-js",
    "path": "src/cli/lib/components.ts",
    "startLine": 665,
    "endLine": 729,
    "symbol": "runComponentsPush",
    "lang": "ts",
    "summary": "A push is three backend calls: start_push (upload + analyze + codegen), wait for schema/index backfill, finish_push (atomically switch).",
    "explain": "startPush uploads bundles and definitions; the backend analyzes modules (finding exported functions and validators) and returns what codegen needs. waitForSchema blocks until new indexes are backfilled and existing data is validated against the new schema. finishPush flips the deployment to the new code and schema at once.",
    "notes": [
      {
        "line": 681,
        "text": "Bundle, upload, analyze, generate types."
      },
      {
        "line": 694,
        "text": "Index backfill and schema validation."
      },
      {
        "line": 728,
        "text": "Atomic switch-over."
      }
    ],
    "code": "export async function runComponentsPush(\n  ctx: Context,\n  options: PushOptions,\n  configPath: string,\n  projectConfig: ProjectConfig,\n) {\n  const reporter = new Reporter();\n  const pushSpan = Span.root(reporter, \"runComponentsPush\");\n  pushSpan.setProperty(\"cli_version\", version);\n  const verbose = options.verbose || options.dryRun;\n\n  await ensureHasConvexDependency(ctx, \"push\");\n\n  const startPushResponse = await pushSpan.enterAsync(\n    \"startComponentsPushAndCodegen\",\n    (span) =>\n      startComponentsPushAndCodegen(\n        ctx,\n        span,\n        projectConfig,\n        configPath,\n        options,\n      ),\n  );\n  if (!startPushResponse) {\n    return;\n  }\n\n  await pushSpan.enterAsync(\"waitForSchema\", (span) =>\n    waitForSchema(ctx, span, startPushResponse, options),\n  );\n// …\n  const finishPushResponse = await pushSpan.enterAsync(\"finishPush\", (span) =>\n    finishPush(ctx, span, startPushResponse, options),\n  );"
  },
  "cli.codegen": {
    "id": "cli.codegen",
    "title": "_generated/api: types over a Proxy",
    "repo": "convex-js",
    "path": "src/cli/codegen_templates/api.ts",
    "startLine": 149,
    "endLine": 176,
    "symbol": "apiCodegen",
    "lang": "ts",
    "summary": "The generated api object is the runtime anyApi Proxy, cast to a type built from your modules' exports.",
    "explain": "Codegen emits types only; at runtime api.messages.list is a Proxy that records the path. Types come from `typeof import('../messages')`, which is how end-to-end type safety works without any runtime schema of your functions on the client.",
    "notes": [
      {
        "line": 156,
        "text": "Runtime value is the generic Proxy."
      },
      {
        "line": 166,
        "text": "Only public functions appear on api."
      }
    ],
    "code": "const fullApi: ApiFromModules<{\n  ${modulePaths\n    .map(\n      (modulePath) =>\n        `\"${importPath(modulePath)}\": typeof ${moduleIdentifier(modulePath)},`,\n    )\n    .join(\"\\n\")}\n}> = anyApi as any;\n\n/**\n * A utility for referencing Convex functions in your app's public API.\n *\n * Usage:\n * \\`\\`\\`js\n * const myFunctionReference = api.myModule.myFunction;\n * \\`\\`\\`\n */\nexport const api: FilterApi<typeof fullApi, FunctionReference<any, \"public\">> = anyApi as any;\n\n/**\n * A utility for referencing Convex functions in your app's internal API.\n *\n * Usage:\n * \\`\\`\\`js\n * const myFunctionReference = internal.myModule.myFunction;\n * \\`\\`\\`\n */\nexport const internal: FilterApi<typeof fullApi, FunctionReference<any, \"internal\">> = anyApi as any;"
  },
  "server.anyApi": {
    "id": "server.anyApi",
    "title": "anyApi: function references are paths",
    "repo": "convex-js",
    "path": "src/server/api.ts",
    "startLine": 320,
    "endLine": 349,
    "symbol": "createApi",
    "lang": "ts",
    "summary": "Property access builds a path; asking for the function name yields 'module/path:exportName'.",
    "explain": "api.messages.list resolves to the string 'messages:list' (that's the udfPath in ModifyQuerySet and Mutation messages). Nothing about your function is bundled into the client.",
    "notes": [
      {
        "line": 324,
        "text": "Each property access extends the path."
      },
      {
        "line": 338,
        "text": "The udfPath sent over the wire."
      }
    ],
    "code": "function createApi(pathParts: string[] = []): AnyApi {\n  const handler: ProxyHandler<object> = {\n    get(_, prop: string | symbol) {\n      if (typeof prop === \"string\") {\n        const newParts = [...pathParts, prop];\n        return createApi(newParts);\n      } else if (prop === functionName) {\n        if (pathParts.length < 2) {\n          const found = [\"api\", ...pathParts].join(\".\");\n          throw new Error(\n            `API path is expected to be of the form \\`api.moduleName.functionName\\`. Found: \\`${found}\\``,\n          );\n        }\n        const path = pathParts.slice(0, -1).join(\"/\");\n        const exportName = pathParts[pathParts.length - 1];\n        if (exportName === \"default\") {\n          return path;\n        } else {\n          return path + \":\" + exportName;\n        }\n      } else if (prop === Symbol.toStringTag) {\n        return \"FunctionReference\";\n      } else {\n        return undefined;\n      }\n    },\n  };\n\n  return new Proxy({}, handler);\n}"
  }
};
