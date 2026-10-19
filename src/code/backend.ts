import type { CodeRef } from './types';

// Generated from get-convex/convex-backend at the SHA in ./types.ts. Excerpts are verbatim;
// a line containing only `// …` marks elided code.
export const backendRefs: Record<string, CodeRef> = {
  "sync.wsHandler": {
    "id": "sync.wsHandler",
    "title": "sync_handler: the /api/sync WebSocket route",
    "repo": "convex-backend",
    "path": "crates/local_backend/src/subs/mod.rs",
    "startLine": 244,
    "endLine": 457,
    "symbol": "sync_handler / run_sync_socket",
    "lang": "rust",
    "summary": "Upgrades an HTTP request on /api/sync to a WebSocket and starts one SyncWorker for that socket.",
    "explain": "Every Convex client opens exactly one WebSocket to /api/sync. The axum handler upgrades it and spawns run_sync_socket, which runs three futures concurrently: one reads client frames, one writes server frames, and one drives the SyncWorker state machine. All per-connection protocol state (query set, identity, versions) therefore lives in a single SyncWorker object owned by that socket.",
    "notes": [
      {
        "line": 245,
        "text": "One SyncWorker per connection. It owns the query set, identity and StateVersion for this client."
      },
      {
        "line": 263,
        "text": "Receive loop, send loop and the worker run concurrently; if any fails, the socket closes and the client reconnects."
      },
      {
        "line": 441,
        "text": "The HTTP connection becomes a WebSocket here."
      }
    ],
    "code": "    let sync_worker_go = async {\n        let mut sync_worker = SyncWorker::new(\n            st.api.clone(),\n            st.runtime.clone(),\n            host,\n            config.clone(),\n            client_rx,\n            server_tx,\n            on_connect,\n            partition_id?,\n            request_metadata,\n        );\n        let r = sync_worker.go().await;\n        identity_version = Some(sync_worker.identity_version());\n        // Explicit drop for emphasis: dropping triggers send_messages to complete.\n        drop(sync_worker);\n        r\n    };\n\n    let result = try_join!(receive_messages, send_messages, sync_worker_go);\n// …\npub async fn sync_handler(\n    st: RouterState,\n    host: ResolvedHostname,\n    request_metadata: RequestMetadata,\n    client_version: ClientVersion,\n    ws: WebSocketUpgrade,\n    on_connect: Box<dyn FnOnce(SessionId) + Send>,\n) -> Result<impl IntoResponse, HttpResponseError> {\n    let config = new_sync_worker_config(\n        client_version,\n        st.subscription_reconnect_rate_limiter.clone(),\n    )?;\n    // Make a copy of the Sentry scope, which contains the request metadata.\n    let sentry_scope = sentry::configure_scope(move |s| s.clone());\n\n    let upgrade_timer = websocket_upgrade_timer();\n    let hub = sentry::Hub::current();\n    Ok(ws.on_upgrade(move |ws: WebSocket| {\n        upgrade_timer.finish();\n        let monitor = ProdRuntime::task_monitor(\"sync_socket\");\n        monitor.instrument(\n            run_sync_socket(\n                st,\n                host,\n                request_metadata,\n                config,\n                ws,\n                sentry_scope,\n                on_connect,\n            )\n            .bind_hub(hub),\n        )\n    }))\n}"
  },
  "sync.worker": {
    "id": "sync.worker",
    "title": "SyncWorker: the per-connection event loop",
    "repo": "convex-backend",
    "path": "crates/sync/src/worker.rs",
    "startLine": 244,
    "endLine": 466,
    "symbol": "SyncWorker::go_inner",
    "lang": "rust",
    "summary": "The sync worker multiplexes client messages, mutation results, action results and subscription invalidations in one select loop.",
    "explain": "This is the server half of the sync protocol. Look at the select_biased! arms: an incoming ClientMessage, a finished mutation, a finished action, an invalidated query (from the subscription manager), and a finished transition computation. Mutations go through a queue processed one at a time, which is why one client's mutations execute in order. Every arm that changes data calls schedule_update(), which later computes a new Transition.",
    "notes": [
      {
        "line": 256,
        "text": "Queue of pending mutations. They are executed one at a time, which gives in-order mutation semantics per client."
      },
      {
        "line": 443,
        "text": "A mutation finished: send MutationResponse, then schedule a query update so the client receives a Transition covering the commit."
      },
      {
        "line": 458,
        "text": "Fires when the subscription manager detects that a commit overlapped one of this client's read sets."
      },
      {
        "line": 465,
        "text": "A new Transition is ready to send."
      }
    ],
    "code": "pub struct SyncWorker<RT: Runtime> {\n    api: Arc<dyn ApplicationApi>,\n    config: SyncWorkerConfig,\n    rt: RT,\n    state: SyncState,\n    host: ResolvedHostname,\n\n    rx: mpsc::UnboundedReceiver<(ClientMessage, tokio::time::Instant)>,\n    tx: SingleFlightSender,\n\n    // Queue of pending functions or mutations. For time being, we only execute\n    // a single one since this is less error prone model for the developer.\n    mutation_futures: Buffered<ReceiverStream<BoxFuture<'static, anyhow::Result<ServerMessage>>>>,\n    mutation_sender: mpsc::Sender<BoxFuture<'static, anyhow::Result<ServerMessage>>>,\n    pending_mutation_operations: usize,\n\n    action_futures: FuturesUnordered<BoxFuture<'static, anyhow::Result<ServerMessage>>>,\n\n    transition_future: Option<Fuse<BoxFuture<'static, anyhow::Result<TransitionState>>>>,\n// …\n    async fn go_inner(&mut self) -> anyhow::Result<()> {\n        let mut ping_timeout = self.rt.wait(HEARTBEAT_INTERVAL);\n        let mut pending = future::pending().boxed().fuse();\n        let mut unavailable_retry_pending = future::pending().boxed().fuse();\n\n        // Create a new subscription client for every sync socket. Thus we don't require\n        // the subscription client to auto-recover on connection failures.\n        let subscription_client: Arc<dyn SubscriptionClient> =\n            self.api.subscription_client(&self.host).await?.into();\n\n        // Starts off as a future that is never ready, as there's no identity that may\n        // expire.\n        'top: loop {\n            self.state.validate()?;\n            let maybe_response = select_biased! {\n                message = self.rx.recv().fuse() => {\n                    let (message, received_time) = match message {\n                        Some(m) => m,\n                        None => break 'top,\n                    };\n                    self.handle_message(message).await?;\n                    let delay = self.rt.monotonic_now() - received_time;\n                    metrics::log_process_client_message_delay(self.partition_id, delay);\n                    None\n                },\n                // TODO(presley): If I swap this with futures below, tests break.\n                // We need to provide a guarantee that we can't transition to a\n                // timestamp past a pending mutation or otherwise optimistic updates\n                // might be flaky. To do that, we need to behave differently if we\n                // have pending operation future or not.\n                result = self.mutation_futures.next().fuse() => {\n                    let message = match result {\n                        Some(m) => {\n                            self.pending_mutation_operations -= 1;\n                            m?\n                        },\n                        None => panic!(\"mutation_futures sender dropped prematurely\"),\n                    };\n                    self.schedule_update();\n                    Some(message)\n                },\n                result = self.action_futures.select_next_some() => {\n                    self.schedule_update();\n                    Some(result?)\n                },\n                result = self.state.next_invalidated_query().fuse() => {\n                    let _ = result?;\n                    self.schedule_update();\n                    None\n                },\n                transition_state = self.transition_future.as_mut().unwrap_or(&mut pending) => {\n                    self.transition_future = None;\n                    Some(self.finish_update_queries(transition_state?)?)\n                },"
  },
  "sync.state": {
    "id": "sync.state",
    "title": "SyncState: query set, versions, subscriptions",
    "repo": "convex-backend",
    "path": "crates/sync/src/state.rs",
    "startLine": 112,
    "endLine": 163,
    "symbol": "SyncState",
    "lang": "rust",
    "summary": "Holds everything the server knows about one client: its queries, current StateVersion, identity and one invalidation future per query.",
    "explain": "The doc comment is the clearest description of the sync engine in the codebase. A StateVersion (query set version + timestamp + identity version) implies a set of queries, and each query has a subscription valid at that timestamp. The subscription worker moves subscriptions forward while they stay valid and completes an invalidation future when a commit overlaps one.",
    "notes": [
      {
        "line": 113,
        "text": "The whole protocol state is described by a StateVersion."
      },
      {
        "line": 141,
        "text": "The version last sent to the client in a Transition."
      },
      {
        "line": 142,
        "text": "One future per query; it resolves when a write overlaps that query's read set."
      },
      {
        "line": 163,
        "text": "Auth identity for this connection. Changing it reruns all queries."
      }
    ],
    "code": "///\n/// Fundamentally, the state is determined by the current `StateVersion`, which\n/// specifies a query set version and a timestamp.\n///\n/// The query set version implies a set of `Query`s, stored under the `query`\n/// field of `SyncedQuery`.\n///\n/// The timestamp, then, implies a `Subscription` for each query, which is\n/// managed by the subscription worker. The subscription worker processes the\n/// commit log, updates subscriptions' timestamps forward when they continue to\n/// be valid, and completes the invalidation future when there's an overlap. A\n/// handle to this invalidation future is stored within `invalidation_future`.\n///\n/// In steady state, both `subscription` and `invalidation_future` must be\n/// `Some` for each query, and `SyncState::validate` checks this invariant. This\n/// invariant can be temporarily broken when a query's subscription completes,\n/// its invalidation future spuriously completes, or a new query is added.\n///\n/// We fix up queries that don't have a subscription by first finding them with\n/// `SyncState::need_fetch`, running their UDF, and then initializing the\n/// subscription with `SyncState::complete_fetch`. We fix up queries that don't\n/// have an invalidation future with `SyncState::fill_subscriptions`.\n///\n/// The general idea here is that the state \"self describes\" what work needs to\n/// be done next.\npub struct SyncState {\n    // ID for the current session. Will be None for old clients that connect\n    // without specifying a session ID.\n    session_id: Option<SessionId>,\n    current_version: StateVersion,\n    invalidation_futures:\n        FuturesUnordered<BoxFuture<'static, Result<anyhow::Result<QueryId>, Aborted>>>,\n    queries: BTreeMap<QueryId, SyncedQuery>,\n    /// Queries being computed for the next transition.\n    in_progress_queries: BTreeMap<QueryId, Query>,\n\n    // If this is true, it means we have invalidated but have not yet refilled\n    // some query subscription. `next_invalidated_query` blocks forever until\n    // `fill_invalidation_futures` is called to recreate the subscriptions.\n    refill_needed: bool,\n\n    /// Updates to the query set and identity requested by the\n    /// client since the last transition began computing.\n    /// These are emptied before computing a new transition.\n    pending_query_updates: Vec<QuerySetModification>,\n    /// These are the query set version and identity according to the client.\n    received_client_version: ClientVersion,\n\n    partition_id: u64,\n\n    auth_token: AuthenticationToken,\n    identity: Identity,"
  },
  "sync.beginUpdate": {
    "id": "sync.beginUpdate",
    "title": "begin_update_queries: picking the new timestamp",
    "repo": "convex-backend",
    "path": "crates/sync/src/worker.rs",
    "startLine": 947,
    "endLine": 1012,
    "symbol": "SyncWorker::begin_update_queries",
    "lang": "rust",
    "summary": "Starts computing the next Transition: applies query set changes, takes subscriptions and picks one new timestamp for all queries.",
    "explain": "All queries of a client are brought to the same new_ts, the latest timestamp the database knows about. That is how every useQuery on a page reflects one consistent snapshot. The query set version only changes when the client sends ModifyQuerySet. An identity change throws away all subscriptions, so every query reruns under the new user.",
    "notes": [
      {
        "line": 955,
        "text": "New auth token or user: every subscription is dropped and every query reruns."
      },
      {
        "line": 968,
        "text": "Apply the Add/Remove modifications from ModifyQuerySet messages."
      },
      {
        "line": 1007,
        "text": "One timestamp for the whole transition, so all queries are mutually consistent."
      },
      {
        "line": 1012,
        "text": "The StateVersion sent to the client: {querySet, ts, identity}."
      }
    ],
    "code": "        let timer = metrics::update_queries_timer(self.partition_id);\n        let current_version = self.state.current_version();\n\n        let (modifications, new_query_version, new_identity_version) =\n            self.state.take_modifications();\n\n        let mut identity_version = current_version.identity;\n        let identity_changed = new_identity_version > identity_version;\n        if identity_changed {\n            // If the identity version has changed, invalidate all existing tokens.\n            // TODO(CX-737): Don't invalidate queries that don't examine auth state.\n            // TODO(CX-737): Don't invalidate the queries if the User the is the same\n            // only with refreshed token. This is a bit tricky because:\n            // - We need to prove that query does not depend on token issue/expiration time.\n            // - We need to make rpc to backend to compare the properties since Usher can't\n            // validate auth tokens. Alternatively, we make Usher be able to validate tokens\n            // long term.\n            self.state.take_subscriptions();\n            identity_version = new_identity_version;\n        }\n\n        // Step 1: Add or remove queries from our query set.\n        let mut state_modifications = BTreeMap::new();\n        for modification in modifications {\n            match modification {\n                QuerySetModification::Add(query) => {\n                    self.state.insert(query)?;\n                },\n                QuerySetModification::Remove { query_id } => {\n                    self.state.remove(query_id)?;\n                    state_modifications\n                        .insert(query_id, StateModification::QueryRemoved { query_id });\n                },\n            }\n        }\n\n        // Step 2: Take all remaining subscriptions.\n        let remaining_subscriptions = self.state.take_subscriptions();\n\n        // Step 3: Refresh subscriptions up to new_ts and run queries which\n        // subscriptions are no longer current.\n        let api = self.api.clone();\n        let rt = self.rt.clone();\n        let need_fetch: Vec<_> = self.state.need_fetch().collect();\n        let host = self.host.clone();\n        let client_version = self.config.client_version.clone();\n        let partition_id = self.partition_id;\n        let request_metadata = self.request_metadata.clone();\n        let mut backoff = Backoff::new(\n            *SYNC_WORKER_UPDATE_QUERIES_RETRY_INITIAL_BACKOFF_MS,\n            *SYNC_WORKER_UPDATE_QUERIES_RETRY_MAX_BACKOFF_SECS,\n        );\n        Ok(async move {\n            loop {\n                // Always transition to the latest timestamp. In the future,\n                // when we have Sync Worker running on the edge, we can remove this\n                // call by making self.update_scheduled to be a Option<Timestamp>,\n                // and set it accordingly based on the operation that triggered the\n                // Transition. We would choose the latest timestamp available at\n                // the edge for the initial sync.\n                let new_ts = *api.latest_timestamp(&host, RequestId::new()).await?;\n                let new_version = StateVersion {\n                    ts: new_ts,\n                    // We only bump the query set version when the client modifies\n                    // the query set\n                    query_set: new_query_version,"
  },
  "sync.runQuery": {
    "id": "sync.runQuery",
    "title": "run_update_queries: reuse or rerun each query",
    "repo": "convex-backend",
    "path": "crates/sync/src/worker.rs",
    "startLine": 1097,
    "endLine": 1160,
    "symbol": "SyncWorker::run_update_queries",
    "lang": "rust",
    "summary": "For each query, either extend its existing subscription to new_ts or rerun the function at new_ts.",
    "explain": "This is the \"run fn\" hop from the sync worker to the function runner. extend_validity asks the subscription layer whether any write between the old timestamp and new_ts touched the query's read set. If none did, the old result stays valid and nothing is sent. Otherwise the query reruns via execute_public_query pinned to ExecuteQueryTimestamp::At(new_ts).",
    "notes": [
      {
        "line": 1100,
        "text": "Can the previous result be proven still correct at new_ts? Valid means no overlapping writes."
      },
      {
        "line": 1104,
        "text": "A commit touched this query's read set: rerun needed."
      },
      {
        "line": 1123,
        "text": "Still valid: no recomputation, no data sent for this query."
      },
      {
        "line": 1150,
        "text": "The query runs at exactly this snapshot timestamp."
      }
    ],
    "code": "                async move {\n                    LocalSpan::add_property(|| (\"udf_path\", query.udf_path.to_string()));\n                    let subscription_state = match current_subscription {\n                        Some(subscription) => match subscription.extend_validity(new_ts).await {\n                            Ok(SubscriptionValidity::Valid) => {\n                                SubscriptionState::Reusable(subscription)\n                            },\n                            Ok(SubscriptionValidity::Invalid { invalid_ts }) => {\n                                metrics::log_query_invalidated(partition_id, invalid_ts, new_ts);\n                                SubscriptionState::NeedsRerun(QueryInvocation::Invalidated)\n                            },\n                            Err(error) if is_recoverable_subscription_stream_failure(&error) => {\n                                return Ok(UpdateQueryOutcome::RecoverableFailure(error));\n                            },\n                            Err(error) => return Err(error),\n                        },\n                        None if has_run_before && identity_changed => {\n                            SubscriptionState::NeedsRerun(QueryInvocation::IdentityChange)\n                        },\n                        None if has_run_before => {\n                            SubscriptionState::NeedsRerun(QueryInvocation::Invalidated)\n                        },\n                        None => SubscriptionState::NeedsRerun(QueryInvocation::Fresh),\n                    };\n                    let (query_result, subscription) = match subscription_state {\n                        SubscriptionState::Reusable(subscription) => {\n                            (QueryResult::Refresh, Some(subscription))\n                        },\n                        SubscriptionState::NeedsRerun(invocation) => {\n                            // We failed to refresh the subscription or it was invalid to start\n                            // with. Rerun the query.\n                            let caller = FunctionCaller::SyncWorker(client_version);\n\n                            // This query run might have been triggered due to invalidation\n                            // of a subscription. The sync worker is effectively the owner\n                            // of the query so we do not want to re-use the original query\n                            // request id.\n                            let mut backoff = Backoff::new(\n                                *SYNC_WORKER_QUERY_RETRY_INITIAL_BACKOFF_MS,\n                                *SYNC_WORKER_QUERY_RETRY_MAX_BACKOFF_SECS,\n                            );\n                            let udf_return_result = loop {\n                                let request_context =\n                                    RequestContext::new(RequestId::new(), request_metadata.clone());\n                                let result = match query.component_path {\n                                    None => {\n                                        api.execute_public_query(\n                                            &host,\n                                            request_context,\n                                            identity_.clone(),\n                                            ExportPath::from(query.udf_path.clone().canonicalize()),\n                                            query.args.clone(),\n                                            caller.clone(),\n                                            ExecuteQueryTimestamp::At(new_ts),\n                                            query.journal.clone(),\n                                            Some(invocation),\n                                        )\n                                        .await\n                                    },\n                                    Some(ref p) => {\n                                        let path = Self::parse_admin_component_path(\n                                            p,\n                                            &query.udf_path,\n                                            &identity_,"
  },
  "sync.transition": {
    "id": "sync.transition",
    "title": "finish_update_queries: building the Transition",
    "repo": "convex-backend",
    "path": "crates/sync/src/worker.rs",
    "startLine": 1255,
    "endLine": 1316,
    "symbol": "SyncWorker::finish_update_queries",
    "lang": "rust",
    "summary": "Collects the rerun results, refills subscriptions and builds the ServerMessage::Transition sent to the client.",
    "explain": "Only queries whose result actually changed produce a modification (QueryUpdated, QueryFailed or QueryRemoved). The worker then advances its version and sends one Transition from start_version to end_version. The client applies it atomically, which is why React never shows half old and half new data.",
    "notes": [
      {
        "line": 1273,
        "text": "Stores the new result and subscription. Returns None if the value did not change."
      },
      {
        "line": 1303,
        "text": "Re-arm invalidation watching for every query."
      },
      {
        "line": 1306,
        "text": "The server now considers the client to be at new_version."
      },
      {
        "line": 1307,
        "text": "The message the client receives: start_version → end_version plus modifications."
      }
    ],
    "code": "    fn finish_update_queries(\n        &mut self,\n        TransitionState {\n            udf_results,\n            mut state_modifications,\n            current_version,\n            new_version,\n            timer,\n            temporarily_unavailable,\n        }: TransitionState,\n    ) -> anyhow::Result<ServerMessage> {\n        for (query_id, result, subscription) in udf_results {\n            match result {\n                QueryResult::Rerun {\n                    result,\n                    log_lines,\n                    journal,\n                } => {\n                    let modification = self.state.complete_fetch(\n                        query_id,\n                        result,\n                        log_lines,\n                        journal,\n                        subscription,\n                    )?;\n                    let Some(modification) = modification else {\n                        continue;\n                    };\n                    state_modifications.insert(query_id, modification);\n                },\n                QueryResult::Refresh => {\n                    self.state.refill_subscription(query_id, subscription)?;\n                },\n                QueryResult::TemporarilyUnavailable => {\n                    anyhow::bail!(\n                        \"No QueryResult::TemporarilyUnavailable should have a udf result and \\\n                         subscription\"\n                    )\n                },\n            }\n        }\n\n        if temporarily_unavailable {\n            self.schedule_unavailable_query_retry();\n        }\n\n        // Resubscribe for queries that don't have an active invalidation\n        // future.\n        self.state.fill_invalidation_futures()?;\n\n        // Step 6: Send our transition to the client and update our version.\n        self.state.advance_version(new_version)?;\n        let transition = ServerMessage::Transition {\n            start_version: current_version,\n            end_version: new_version,\n            modifications: state_modifications.into_values().collect(),\n            client_clock_skew: self.client_clock_skew,\n            server_ts: None,\n        };\n        timer.finish();\n        metrics::log_query_set_size(self.partition_id, self.state.num_queries());\n        // Only retain timers for queries that haven't been updated yet. Finish the"
  },
  "sync.mutation": {
    "id": "sync.mutation",
    "title": "Handling a Mutation message",
    "repo": "convex-backend",
    "path": "crates/sync/src/worker.rs",
    "startLine": 664,
    "endLine": 752,
    "symbol": "SyncWorker::handle_message",
    "lang": "rust",
    "summary": "Turns a client Mutation message into an execute_public_mutation call and replies with MutationResponse carrying the commit timestamp.",
    "explain": "The mutation is tagged with (session_id, request_id) so a retried send after a reconnect is executed at most once. The response carries ts, the commit timestamp. The client keeps the mutation promise pending until it receives a Transition whose end_version.ts is at least that ts, which gives read-your-writes.",
    "notes": [
      {
        "line": 673,
        "text": "Session + request id: lets the backend deduplicate a mutation resent after reconnect."
      },
      {
        "line": 707,
        "text": "Runs the mutation (with OCC retries) inside the application layer."
      },
      {
        "line": 741,
        "text": "Commit timestamp. The client waits for a Transition at or past this ts before resolving."
      },
      {
        "line": 748,
        "text": "Failed mutations commit nothing, so there is no timestamp."
      }
    ],
    "code": "            ClientMessage::Mutation {\n                request_id,\n                udf_path,\n                args,\n                component_path,\n            } => {\n                log_mutation_args_size(self.partition_id, args.get().len());\n                let identity = self.revalidate_identity().await?;\n                let mutation_identifier =\n                    self.state.session_id().map(|id| SessionRequestIdentifier {\n                        session_id: id,\n                        request_id,\n                    });\n// …\n                    rt.with_timeout(\"mutation\", SYNC_WORKER_PROCESS_TIMEOUT, async move {\n                        timer.finish();\n                        let request_context =\n                            RequestContext::new(server_request_id, request_metadata);\n                        let result = match component_path {\n                            None => {\n                                api.execute_public_mutation(\n                                    &host,\n                                    request_context,\n                                    identity,\n                                    ExportPath::from(udf_path.canonicalize()),\n                                    args,\n                                    caller,\n                                    mutation_identifier,\n                                    Some(mutation_queue_size),\n                                )\n                                .in_span(root)\n                                .await?\n                            },\n                            Some(ref p) => {\n                                let path =\n                                    Self::parse_admin_component_path(p, &udf_path, &identity)?;\n                                api.execute_admin_mutation(\n                                    &host,\n                                    request_context,\n                                    identity,\n                                    path,\n                                    args,\n                                    caller,\n                                    mutation_identifier,\n                                    Some(mutation_queue_size),\n                                )\n                                .in_span(root)\n                                .await?\n                            },\n                        };\n                        let response = match result {\n                            Ok(udf_return) => ServerMessage::MutationResponse {\n                                request_id,\n                                result: Ok(udf_return.value),\n                                ts: Some(udf_return.ts),\n                                log_lines: udf_return.log_lines.into(),\n                            },\n                            Err(RedactedMutationError { error, log_lines }) => {\n                                ServerMessage::MutationResponse {\n                                    request_id,\n                                    result: Err(error.into_error_payload()),\n                                    ts: None,\n                                    log_lines: log_lines.into(),\n                                }\n                            },\n                        };"
  },
  "application.mutation": {
    "id": "application.mutation",
    "title": "The mutation OCC retry loop",
    "repo": "convex-backend",
    "path": "crates/application/src/application_function_runner/mod.rs",
    "startLine": 948,
    "endLine": 1110,
    "symbol": "ApplicationFunctionRunner::retry_mutation",
    "lang": "rust",
    "summary": "Begins a transaction, runs the mutation, tries to commit, and on an OCC conflict waits and runs the whole function again.",
    "explain": "This loop is why you never write retry logic for mutations. Each attempt begins a fresh transaction at a new snapshot, runs your JS from the top, and asks the committer to commit. If commit fails with occ_info, the loop backs off, waits until the conflicting write is visible, and repeats. Your function body may run several times per call, which is why queries and mutations must be deterministic and free of side effects.",
    "notes": [
      {
        "line": 970,
        "text": "New transaction at the latest snapshot for every attempt."
      },
      {
        "line": 978,
        "text": "If this (session, request) already committed, return the stored result instead of rerunning."
      },
      {
        "line": 1077,
        "text": "Hand the read set and write set to the committer."
      },
      {
        "line": 1097,
        "text": "OCC conflict: some write after our snapshot overlapped our read set."
      },
      {
        "line": 1109,
        "text": "Wait until the conflicting write is visible before retrying so the retry sees it."
      }
    ],
    "code": "\n        let mut backoff = Backoff::new(\n            *UDF_EXECUTOR_OCC_INITIAL_BACKOFF,\n            *UDF_EXECUTOR_OCC_MAX_BACKOFF,\n        );\n        let mut file_storage_backoff = Backoff::new(\n            *UDF_FILE_STORAGE_INITIAL_BACKOFF,\n            *UDF_FILE_STORAGE_MAX_BACKOFF,\n        );\n\n        loop {\n            let occ_retry_count = backoff.failures() as usize;\n            let mutation_retry_count = occ_retry_count + file_storage_backoff.failures() as usize;\n            let usage_tracker = FunctionUsageTracker::new();\n\n            // Note that we use different context for every mutation attempt.\n            // This so every JS function run gets a different executionId.\n            let context = ExecutionContext::new(request_context.clone(), &caller);\n\n            let start = self.runtime.monotonic_now();\n            let mut tx = self\n                .database\n                .begin_with_usage(identity.clone(), usage_tracker.clone())\n                .await?;\n            let pause_client = self.runtime.pause_client();\n            pause_client.wait(\"retry_mutation_loop_start\").await;\n            let identity = tx.inert_identity();\n\n            // Return the previous execution's result if the mutation was committed already.\n            if let Some(result) = self\n                .check_mutation_status(&mut tx, &mutation_identifier)\n                .await?\n            {\n                return Ok(result);\n            }\n\n// …\n\n            // Attempt to commit the transaction and log an error if commit failed,\n            // even if it was an OCC error. We may decide later to suppress OCC\n            // errors from the log.\n            let result = match self\n                .database\n                .commit_with_write_source(tx, write_source.clone())\n                .await\n            {\n                Ok(ts) => Ok(MutationReturn {\n                    // The commit timestamp is known now, so unresolved commit\n                    // timestamps in the return value resolve to it, matching\n                    // the committer's resolution of the transaction's writes.\n                    value: value.resolve_commit_ts(i64::from(ts))?,\n                    log_lines,\n                    ts,\n                }),\n                Err(e) => {\n                    if e.is_deterministic_user_error() {\n                        let js_error = JsError::from_error(e);\n                        outcome.result = Err(js_error.clone());\n                        Err(MutationError {\n                            error: js_error,\n                            log_lines,\n                        })\n                    } else {\n                        if let Some(occ_info) = e.occ_info()\n                            && (backoff.failures() as usize) < *UDF_EXECUTOR_OCC_MAX_RETRIES\n                        {\n                            let sleep = backoff.fail(&mut self.runtime.rng());\n                            tracing::warn!(\n                                \"Optimistic concurrency control failed ({e}), retrying \\\n                                 {write_source:?} after {sleep:?}\",\n                            );\n                            self.runtime.wait(sleep).await;\n                            if let Some(write_ts_raw) = e.occ_write_ts()\n                                && let Ok(write_ts) = Timestamp::try_from(write_ts_raw)\n                            {\n                                self.database.wait_for_write_ts(write_ts).await;\n                            }"
  },
  "application.idempotency": {
    "id": "application.idempotency",
    "title": "check_mutation_status: exactly-once mutations",
    "repo": "convex-backend",
    "path": "crates/application/src/application_function_runner/mod.rs",
    "startLine": 2080,
    "endLine": 2111,
    "symbol": "check_mutation_status",
    "lang": "rust",
    "summary": "Looks up whether a (session_id, request_id) mutation already committed and returns its stored result.",
    "explain": "When a WebSocket drops after a mutation committed but before the response arrived, the client resends it on reconnect. The result was recorded in the same transaction as the mutation's writes, so this lookup is transactionally consistent: either the mutation committed with its record, or neither happened.",
    "notes": [
      {
        "line": 2089,
        "text": "Look up the record written by an earlier successful attempt."
      },
      {
        "line": 2095,
        "text": "Skip re-execution and replay the stored result."
      },
      {
        "line": 2099,
        "text": "The record commits atomically with the mutation's own writes."
      }
    ],
    "code": "    async fn check_mutation_status(\n        &self,\n        tx: &mut Transaction<RT>,\n        mutation_identifier: &Option<SessionRequestIdentifier>,\n    ) -> anyhow::Result<Option<Result<MutationReturn, MutationError>>> {\n        let Some(identifier) = mutation_identifier else {\n            return Ok(None);\n        };\n        let mutation_status = SessionRequestModel::new(tx)\n            .get_session_request_record(identifier, Identity::system())\n            .await?;\n        let result = match mutation_status {\n            Some((ts, SessionRequestOutcome::Mutation { result, log_lines })) => {\n                let age = tx.begin_timestamp().secs_since_f64(ts);\n                tracing::info!(\n                    \"Mutation already executed {age:.3}s ago so skipping {:?}\",\n                    identifier\n                );\n                log_mutation_already_committed(age);\n                // Sessions are recorded transactionally in mutations so can use the same commit\n                // ts.\n                Ok(MutationReturn {\n                    value: result.resolve_commit_ts(i64::from(ts))?,\n                    log_lines,\n                    ts,\n                })\n            },\n            None => return Ok(None),\n        };\n        Ok(Some(result))\n    }\n"
  },
  "application.query": {
    "id": "application.query",
    "title": "run_query_at_ts: queries go through the cache",
    "repo": "convex-backend",
    "path": "crates/application/src/application_function_runner/mod.rs",
    "startLine": 2023,
    "endLine": 2052,
    "symbol": "run_query_at_ts_inner",
    "lang": "rust",
    "summary": "Entry point for executing a query at a timestamp; it always goes through the query cache manager.",
    "explain": "There is no \"uncached\" path for sync worker queries: the cache manager either returns a cached result proven valid at ts or runs the function. That is how many clients subscribed to the same query with the same args share one execution.",
    "notes": [
      {
        "line": 2035,
        "text": "System functions need admin or system identity."
      },
      {
        "line": 2042,
        "text": "All query executions go through the cache."
      },
      {
        "line": 2048,
        "text": "The snapshot timestamp the result must be valid at."
      }
    ],
    "code": "    #[fastrace::trace]\n    async fn run_query_at_ts_inner(\n        &self,\n        request_context: RequestContext,\n        path: PublicFunctionPath,\n        args: SerializedArgs,\n        identity: Identity,\n        ts: Timestamp,\n        journal: Option<QueryJournal>,\n        caller: FunctionCaller,\n        invocation: QueryInvocation,\n    ) -> anyhow::Result<QueryReturn> {\n        if path.is_system() && !(identity.is_admin() || identity.is_system()) {\n            anyhow::bail!(unauthorized_error(\"query\"));\n        }\n        let start = self.runtime.monotonic_now();\n        let context = ExecutionContext::new(request_context.clone(), &caller);\n        let usage_tracker = FunctionUsageTracker::new();\n        let result = self\n            .cache_manager\n            .get(\n                request_context,\n                path.clone(),\n                args.clone(),\n                identity.clone(),\n                ts,\n                journal,\n                caller.clone(),\n                usage_tracker.clone(),\n                invocation,"
  },
  "cache.udf": {
    "id": "cache.udf",
    "title": "Query cache: key and validation",
    "repo": "convex-backend",
    "path": "crates/application/src/cache/mod.rs",
    "startLine": 251,
    "endLine": 790,
    "symbol": "StoredCacheKey / validate_cache_result",
    "lang": "rust",
    "summary": "Caches query results keyed by function path, args and (only if read) identity, and revalidates them against the write log.",
    "explain": "The cache key includes identity only if the query read ctx.auth, so public queries are shared across all users. A cached result holds a Token (read set plus timestamp). To serve it at a newer ts, refresh_token checks the write log for overlapping writes in between, the same check the committer uses for OCC.",
    "notes": [
      {
        "line": 256,
        "text": "None if the query never read ctx.auth: the result is shared by all users."
      },
      {
        "line": 302,
        "text": "The timestamp the result was computed at."
      },
      {
        "line": 303,
        "text": "The read set plus timestamp used to prove the result is still valid."
      },
      {
        "line": 780,
        "text": "Was anything written into this read set between original_ts and ts?"
      }
    ],
    "code": "pub struct StoredCacheKey {\n    tenant_id: QueryCacheTenantId,\n    path: PublicFunctionPath,\n    args: SerializedArgs,\n    // None means that the query did not read `ctx.auth`.\n    identity: Option<IdentityCacheKey>,\n    journal: QueryJournal,\n    allowed_visibility: AllowedVisibility,\n}\n// …\nstruct CacheResult {\n    outcome: Arc<UdfOutcome>,\n    original_ts: Timestamp,\n    token: Token,\n    visibility_info: Option<VisibilityInfo>,\n}\n// …\n    async fn validate_cache_result(\n        &self,\n        key: &StoredCacheKey,\n        ts: Timestamp,\n        mut result: CacheResult,\n    ) -> anyhow::Result<Option<CacheResult>> {\n        if ts < result.original_ts {\n            // If the cached value is newer than the requested timestamp,\n            // we have to re-execute the UDF.\n            log_validate_ts_too_old();\n            return Ok(None);\n        }\n        result.token = match self.database.refresh_token(result.token, ts).await? {\n            Ok(t) => t,\n            Err(_invalid_ts) => {\n                tracing::debug!(\n                    \"Couldn't refresh cache entry from {} to {}, retrying...\",\n                    result.original_ts,\n                    ts\n                );\n                self.cache.remove_ready(key, result.original_ts);\n                log_validate_refresh_failed();\n                return Ok(None);"
  },
  "runner.functionRunner": {
    "id": "runner.functionRunner",
    "title": "FunctionRunner trait",
    "repo": "convex-backend",
    "path": "crates/function_runner/src/lib.rs",
    "startLine": 86,
    "endLine": 106,
    "symbol": "trait FunctionRunner",
    "lang": "rust",
    "summary": "The interface the application uses to run a function at a snapshot timestamp and get back its writes and outcome.",
    "explain": "run_function takes a timestamp and identity and returns an optional FunctionFinalTransaction (reads and writes) plus the outcome. The application layer then hands that transaction to the committer. In Convex Cloud the function runner can be a separate service from the database; self-hosted it runs in process.",
    "notes": [
      {
        "line": 93,
        "text": "Snapshot timestamp the function reads at."
      },
      {
        "line": 94,
        "text": "Writes already made in this transaction (for nested calls)."
      },
      {
        "line": 102,
        "text": "The read set and write set to commit."
      }
    ],
    "code": "#[async_trait]\npub trait FunctionRunner<RT: Runtime>: Send + Sync + 'static {\n    async fn run_function(\n        &self,\n        udf_type: UdfType,\n        udf_runtime: Option<UdfRuntime>,\n        identity: Identity,\n        ts: RepeatableTimestamp,\n        existing_writes: FunctionWrites,\n        log_line_sender: Option<mpsc::UnboundedSender<LogLine>>,\n        function_metadata: Option<FunctionMetadata>,\n        http_action_metadata: Option<HttpActionMetadata>,\n        default_system_env_vars: BTreeMap<EnvVarName, EnvVarValue>,\n        in_memory_index_last_modified: BTreeMap<IndexId, Timestamp>,\n        context: ExecutionContext,\n    ) -> anyhow::Result<(\n        Option<FunctionFinalTransaction>,\n        FunctionOutcome,\n        FunctionUsageStats,\n    )>;\n"
  },
  "isolate.v8": {
    "id": "isolate.v8",
    "title": "Isolate: a V8 isolate owned by Rust",
    "repo": "convex-backend",
    "path": "crates/isolate/src/isolate.rs",
    "startLine": 75,
    "endLine": 213,
    "symbol": "Isolate::new",
    "lang": "rust",
    "summary": "Creates a V8 isolate through rusty_v8 with memory limits, no dynamic import, no Atomics.wait and explicit microtasks.",
    "explain": "A V8 isolate is an independent JS heap with its own garbage collector, created inside the backend process. Rust creates it, sets a heap limit callback (out-of-memory kills only that isolate), blocks dynamic import, and controls when microtasks run. Node is not involved: there is no process, no libuv event loop and no Node APIs, only what Rust exposes as ops.",
    "notes": [
      {
        "line": 77,
        "text": "The rusty_v8 isolate handle owned by Rust."
      },
      {
        "line": 174,
        "text": "The Convex UDF runtime JS is loaded from a snapshot."
      },
      {
        "line": 192,
        "text": "Dynamic import() is rejected."
      },
      {
        "line": 197,
        "text": "Rust decides when promise callbacks run, so it controls the async scheduling of your function."
      },
      {
        "line": 208,
        "text": "Out-of-memory terminates only this function, not the backend."
      }
    ],
    "code": "pub struct Isolate<RT: Runtime> {\n    rt: RT,\n    v8_isolate: ManuallyDrop<v8::OwnedIsolate>,\n    handle: ExecutionHandle,\n    // Typically, the user timeout is configured based on environment. This\n    // allows us to set an upper bound to it that we use for tests.\n    max_user_timeout: Option<Duration>,\n    // The heap limit callback takes ownership of this `Box` allocation, which\n    // we reclaim after removing the callback.\n    heap_ctx_ptr: *mut HeapContext,\n    array_buffer_memory_limit: Arc<ArrayBufferMemoryLimit>,\n    max_user_heap_size: usize,\n\n    created: tokio::time::Instant,\n}\n// …\nimpl<RT: Runtime> Isolate<RT> {\n    pub fn new(rt: RT, max_user_timeout: Option<Duration>, max_user_heap_size: usize) -> Self {\n        let _timer = create_isolate_timer();\n        let (array_buffer_memory_limit, array_buffer_allocator) =\n            crate::array_buffer_allocator::limited_array_buffer_allocator(\n                *ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE,\n            );\n        let mut v8_isolate = crate::udf_runtime::create_isolate_with_udf_runtime(\n            v8::CreateParams::default().array_buffer_allocator(array_buffer_allocator),\n            max_user_heap_size,\n        );\n\n        // Tells V8 to capture current stack trace when uncaught exception occurs and\n        // report it to the message listeners. The option is off by default.\n        v8_isolate.set_capture_stack_trace_for_uncaught_exceptions(\n            true, // capture\n            10,   // frame_limit\n        );\n\n        // This specifies the callback called by the upcoming import.meta language\n        // feature to retrieve host-defined meta data for a module.\n        v8_isolate.set_host_initialize_import_meta_object_callback(Self::import_meta_callback);\n\n        // This specifies the callback called by the upcoming dynamic import() language\n        // feature to load modules.\n        v8_isolate.set_host_import_module_dynamically_callback(Self::error_dynamic_import_callback);\n\n        // Disallow synchronous `Atomics.wait`.\n        v8_isolate.set_allow_atomics_wait(false);\n\n        v8_isolate.set_microtasks_policy(v8::MicrotasksPolicy::Explicit);\n\n        let handle = ExecutionHandle::new(v8_isolate.thread_safe_handle());\n\n        // Pass ownership of the HeapContext struct to the heap limit callback, which\n        // we'll take back in the `Isolate`'s destructor.\n        let heap_context = Box::new(HeapContext {\n            handle: handle.clone(),\n            callback_count: AtomicU32::new(0),\n        });\n        let heap_ctx_ptr = Box::into_raw(heap_context);\n        v8_isolate.add_near_heap_limit_callback(\n            near_heap_limit_callback,\n            heap_ctx_ptr as *mut ffi::c_void,\n        );\n\n        v8_isolate.add_gc_prologue_callback("
  },
  "isolate.client": {
    "id": "isolate.client",
    "title": "IsolateClient and the isolate scheduler",
    "repo": "convex-backend",
    "path": "crates/isolate/src/client.rs",
    "startLine": 630,
    "endLine": 1170,
    "symbol": "IsolateClient::execute_udf",
    "lang": "rust",
    "summary": "Sends a UDF request (transaction, seed, timestamp) to a pool of isolate worker threads and awaits the transaction back.",
    "explain": "Note that the Transaction itself is moved into the isolate request and returned with the outcome. The scheduler keeps a pool of workers and prefers reusing a worker last used by the same client (deployment), so its module cache is warm.",
    "notes": [
      {
        "line": 634,
        "text": "The database transaction travels with the request; syscalls read and write through it."
      },
      {
        "line": 638,
        "text": "Seed for Math.random, chosen outside the isolate."
      },
      {
        "line": 639,
        "text": "The fixed time Date.now() will return."
      },
      {
        "line": 1164,
        "text": "Idle workers per client, most recently used first, to reuse warm caches."
      }
    ],
    "code": "    pub async fn execute_udf(\n        &self,\n        udf_type: UdfType,\n        path_and_args: ValidatedPathAndArgs,\n        transaction: Transaction<RT>,\n        journal: QueryJournal,\n        context: ExecutionContext,\n        environment_data: EnvironmentData<RT>,\n        rng_seed: [u8; 32],\n        unix_timestamp: UnixTimestamp,\n        reactor_depth: usize,\n        instance_name: String,\n        function_started_sender: Option<oneshot::Sender<()>>,\n        subfunctions_in_same_isolate: bool,\n    ) -> anyhow::Result<(Transaction<RT>, FunctionOutcome)> {\n        let (tx, rx) = oneshot::channel();\n        let request = RequestType::Udf {\n            request: UdfRequest {\n                path_and_args,\n                udf_type,\n                transaction,\n                unix_timestamp,\n                journal,\n                context,\n                environment_data,\n                file_downloads: FileDownloads::default(),\n            },\n            response: tx,\n            queue_timer: queue_timer(),\n            rng_seed,\n            reactor_depth,\n            function_started_sender,\n            udf_callback: if subfunctions_in_same_isolate {\n                None\n            } else {\n                Some(self.clone())\n            },\n        };\n        self.send_request(Request::new(\n            instance_name,\n            request,\n            EncodedSpan::from_parent(),\n        ))?;\n        let (tx, outcome) = Self::receive_response(rx).await??;\n\n        Ok((tx, outcome))\n    }\n// …\npub struct SharedIsolateScheduler<RT: Runtime, W: IsolateWorker<RT>> {\n    rt: RT,\n    worker: W,\n    /// Vec of channels for sending work to individual workers.\n    worker_senders: Vec<\n        mpsc::Sender<(\n            Request<RT>,\n            ConcurrencyPermit,\n            oneshot::Sender<IdleWorkerInfo>,\n        )>,\n    >,\n    /// Map from client_id to stack of workers (implemented with a deque). The\n    /// most recently used worker for a given client is at the front of the\n    /// deque. These workers were previously used by this client, but may\n    /// safely be \"stolen\" for use by another client. A worker with a\n    /// `last_used_ts` older than `ISOLATE_IDLE_TIMEOUT` has already been\n    /// recreated and there will be no penalty for reassigning this worker to a\n    /// new client.\n    available_workers: HashMap<String, VecDeque<IdleWorkerState>>,\n    /// Set of futures awaiting a response from an active worker.\n    in_progress_workers:\n        FuturesUnordered<Join<oneshot::Receiver<IdleWorkerInfo>, Ready<ActiveWorkerState>>>,\n    /// Counts the number of active workers per client. Should only contain a\n    /// key if the value is greater than 0.\n    in_progress_count: HashMap<String, usize>,"
  },
  "isolate.determinism": {
    "id": "isolate.determinism",
    "title": "Seeded Math.random and frozen Date.now",
    "repo": "convex-backend",
    "path": "crates/isolate/src/environment/udf/phase.rs",
    "startLine": 449,
    "endLine": 531,
    "symbol": "UdfPhase::begin_execution",
    "lang": "rust",
    "summary": "At the start of execution the RNG is seeded with a supplied seed and the clock is fixed to one timestamp.",
    "explain": "Math.random is backed by ChaCha12 seeded from rng_seed, and Date.now returns execution_unix_timestamp for the whole run. The phase also records whether the function observed randomness or time; the query cache uses observed time to expire results that depend on the clock.",
    "notes": [
      {
        "line": 467,
        "text": "Math.random is a seeded PRNG."
      },
      {
        "line": 468,
        "text": "Date.now() is frozen at this value."
      },
      {
        "line": 521,
        "text": "Remembered so cached results that read the clock can expire."
      },
      {
        "line": 526,
        "text": "Reading time at module import time is not allowed."
      }
    ],
    "code": "    pub fn begin_execution(\n        &mut self,\n        rng_seed: [u8; 32],\n        execution_unix_timestamp: UnixTimestamp,\n    ) -> anyhow::Result<()> {\n        if self.phase != Phase::Importing {\n            anyhow::bail!(\"Phase was already {:?}\", self.phase)\n        }\n        let UdfPreloaded::Ready {\n            ref mut rng,\n            ref mut unix_timestamp,\n            ref mut performance_api,\n            ..\n        } = self.preloaded\n        else {\n            anyhow::bail!(\"Phase not initialized\");\n        };\n        self.phase = Phase::Executing;\n        *rng = Some(ChaCha12Rng::from_seed(rng_seed));\n        *unix_timestamp = Some(execution_unix_timestamp);\n        if let Some(performance_api) = performance_api {\n            performance_api.begin_execution(&self.rt, execution_unix_timestamp)?;\n        }\n        Ok(())\n    }\n// …\n    pub fn unix_timestamp(&mut self) -> anyhow::Result<UnixTimestamp> {\n        let UdfPreloaded::Ready {\n            unix_timestamp,\n            ref mut observed_time_during_execution,\n            ..\n        } = self.preloaded\n        else {\n            anyhow::bail!(\"Phase not initialized\");\n        };\n        if self.phase == Phase::Executing {\n            *observed_time_during_execution = true;\n        }\n        let Some(unix_timestamp) = unix_timestamp else {\n            // Fail for old modules without import time timestamp populated.\n            anyhow::bail!(ErrorMetadata::bad_request(\n                \"NoDateDuringImport\",\n                \"Date unsupported at import time\"\n            ));\n        };\n        Ok(unix_timestamp)\n    }"
  },
  "isolate.environment": {
    "id": "isolate.environment",
    "title": "No fetch or crypto randomness in queries and mutations",
    "repo": "convex-backend",
    "path": "crates/isolate/src/environment/udf/mod.rs",
    "startLine": 260,
    "endLine": 373,
    "symbol": "DatabaseUdfSyscallProvider",
    "lang": "rust",
    "summary": "The op provider for queries and mutations rejects async ops like fetch and timers and fixes performance.now for queries.",
    "explain": "start_async_op is how fetch, setTimeout and similar are implemented in the runtime; for queries and mutations it always fails with \"Please consider using an action\". This is enforced in Rust, not by convention.",
    "notes": [
      {
        "line": 260,
        "text": "The error you see when calling fetch in a query."
      },
      {
        "line": 287,
        "text": "crypto.getRandomValues is not allowed."
      },
      {
        "line": 298,
        "text": "In queries performance.now() does not advance."
      },
      {
        "line": 365,
        "text": "Every async op (fetch, timers) is rejected."
      }
    ],
    "code": "fn not_allowed_in_udf(name: &str, description: &str) -> ErrorMetadata {\n    ErrorMetadata::bad_request(\n        format!(\"No{name}InQueriesOrMutations\"),\n        format!(\n            \"Can't use {description} in queries and mutations. Please consider using an action. \\\n            See https://docs.convex.dev/functions/actions for more details.\",\n        ),\n    )\n}\n// …\n    fn rng(&mut self) -> anyhow::Result<&mut ChaCha12Rng> {\n        self.phase.rng()\n    }\n\n    fn crypto_rng(&mut self) -> anyhow::Result<super::crypto_rng::CryptoRng> {\n        anyhow::bail!(not_allowed_in_udf(\"CryptoRng\", \"cryptographic randomness\"))\n    }\n\n    fn unix_timestamp(&mut self) -> anyhow::Result<UnixTimestamp> {\n        self.phase.unix_timestamp()\n    }\n\n    fn performance_now(&mut self) -> anyhow::Result<Duration> {\n        match self.udf_type {\n            // Queries must be deterministic, so now() is fixed at its value at the\n            // start of execution and doesn't observe elapsed time.\n            UdfType::Query => self.phase.performance_now_fixed(),\n            UdfType::Mutation => self.phase.performance_now_incrementing(),\n            _ => anyhow::bail!(\"Expected a query or mutation\"),\n        }\n    }\n// …\n        Ok(())\n    }\n\n    fn start_async_op(\n        &mut self,\n        request: AsyncOpRequest,\n        _resolver: Self::AsyncResolver,\n    ) -> anyhow::Result<()> {\n        anyhow::bail!(not_allowed_in_udf(\n            request.name_for_error(),\n            &request.description_for_error(),\n        ))"
  },
  "isolate.syscalls": {
    "id": "isolate.syscalls",
    "title": "Syscall dispatch: ctx.db calls into Rust",
    "repo": "convex-backend",
    "path": "crates/isolate/src/environment/udf/async_syscall.rs",
    "startLine": 255,
    "endLine": 894,
    "symbol": "run_async_syscall_batch",
    "lang": "rust",
    "summary": "Maps syscall names like 1.0/get, 1.0/insert and 1.0/queryStreamNext to Rust implementations operating on the transaction.",
    "explain": "Your ctx.db.get, insert, patch and query iteration become JSON syscalls from the JS runtime into Rust. Reads are batched so many ctx.db.get calls in Promise.all become one batch. Scheduling (1.0/schedule) and storage are syscalls too, which is why they are transactional.",
    "notes": [
      {
        "line": 258,
        "text": "Reads are batched together."
      },
      {
        "line": 868,
        "text": "ctx.db.insert"
      },
      {
        "line": 869,
        "text": "ctx.db.patch"
      },
      {
        "line": 888,
        "text": "ctx.scheduler.runAfter writes into the same transaction."
      }
    ],
    "code": "impl AsyncSyscallBatch {\n    pub fn new(name: String, args: JsonValue) -> Self {\n        match &*name {\n            \"1.0/get\" => Self::Reads(vec![AsyncRead::Get(args)]),\n            \"1.0/queryStreamNext\" => Self::Reads(vec![AsyncRead::QueryStreamNext(args)]),\n            \"1.0/storageGetUrl\" => Self::StorageGetUrls(vec![args]),\n            \"1.0/storageGet\" => Self::StorageGets(vec![args]),\n            _ => Self::Unbatched { name, args },\n// …\npub(super) async fn run_async_syscall_batch<RT: Runtime>(\n    provider: &mut DatabaseUdfSyscallProvider<RT>,\n    batch: AsyncSyscallBatch,\n    udf_callback: impl UdfCallback<RT>,\n) -> Vec<anyhow::Result<String>> {\n    let start = provider.phase.rt.monotonic_now();\n    let batch_name = batch.name().to_string();\n    let timer = async_syscall_timer(&batch_name);\n    // Outer error is a system error that encompases the whole batch, while\n    // inner errors are for individual batch items that may be system or developer\n    // errors.\n    let results = match batch {\n        AsyncSyscallBatch::Reads(batch_args) => query_batch(provider, batch_args).await,\n        AsyncSyscallBatch::StorageGetUrls(batch_args) => {\n            storage_get_url_batch(provider, batch_args).await\n        },\n        AsyncSyscallBatch::StorageGets(batch_args) => storage_get_batch(provider, batch_args).await,\n        AsyncSyscallBatch::Unbatched { name, args } => {\n            let result = match &name[..] {\n                // Database\n                \"1.0/count\" => Box::pin(count(provider, args)).await,\n                \"1.0/insert\" => Box::pin(insert(provider, args)).await,\n                \"1.0/shallowMerge\" => Box::pin(shallow_merge(provider, args)).await,\n                \"1.0/replace\" => Box::pin(replace(provider, args)).await,\n                \"1.0/remove\" => Box::pin(remove(provider, args)).await,\n                \"1.0/queryPage\" => Box::pin(query_page(provider, args)).await,\n                \"1.0/getTransactionMetrics\" => tx_metrics(provider),\n                \"1.0/getFunctionMetadata\" => function_metadata(provider),\n                \"1.0/getDeploymentMetadata\" => deployment_metadata(provider),\n                \"1.0/getRequestMetadata\" => request_metadata(provider),\n                // Auth\n                \"1.0/getUserIdentity\" => Box::pin(get_user_identity(provider, args)).await,\n                \"1.0/signJwt\" => Box::pin(sign_deployment_jwt(provider, args)).await,\n                // Storage\n                \"1.0/storageDelete\" => Box::pin(storage_delete(provider, args)).await,\n                \"1.0/storageGetMetadata\" => Box::pin(storage_get_metadata(provider, args)).await,\n                \"1.0/storageGenerateUploadUrl\" => {\n                    Box::pin(storage_generate_upload_url(provider, args)).await\n                },\n                \"1.0/storageStore\" => Box::pin(storage_store(provider, args)).await,\n                // Scheduling\n                \"1.0/schedule\" => Box::pin(schedule(provider, args)).await,\n                \"1.0/cancel_job\" => Box::pin(cancel_job(provider, args)).await,\n\n                // Audit logging\n                \"1.0/auditLog\" => Box::pin(audit_log(provider, args)).await,\n                // Audit logging (system UDFs only)\n                \"1.0/writeDeploymentAuditLog\" => {"
  },
  "db.transaction": {
    "id": "db.transaction",
    "title": "Transaction: read set + write set at a snapshot",
    "repo": "convex-backend",
    "path": "crates/database/src/transaction.rs",
    "startLine": 174,
    "endLine": 404,
    "symbol": "struct Transaction",
    "lang": "rust",
    "summary": "A transaction holds the read set, buffered writes and a snapshot index fixed at its begin timestamp.",
    "explain": "Writes are buffered in the transaction and nothing is visible to others until commit. Reads go through the TransactionIndex, which overlays the transaction's own writes on the base snapshot, so you read your own writes inside a mutation. begin_timestamp is the snapshot timestamp every read sees.",
    "notes": [
      {
        "line": 191,
        "text": "Every index range read, used for OCC and subscriptions."
      },
      {
        "line": 192,
        "text": "Buffered writes, applied only on commit."
      },
      {
        "line": 403,
        "text": "All reads see the database as of this timestamp (MVCC)."
      }
    ],
    "code": "pub struct Transaction<RT: Runtime> {\n    pub(crate) identity: Identity,\n    pub(crate) id_generator: TransactionIdGenerator,\n\n    pub(crate) next_creation_time: CreationTime,\n\n    // Size of any functions scheduled from this transaction.\n    pub scheduled_size: ScheduledFunctionsSize,\n\n    // Size of the file storage accessed from this transaction.\n    pub file_storage_read_size: FileStorageReadSize,\n\n    pub(crate) file_uploads: NestedWrites<FileUploads>,\n\n    // Transaction limits (reads, writes, scheduled). Defaults to global limits.\n    pub(crate) limits: TransactionLimits,\n\n    pub(crate) reads: TransactionReadSet,\n    pub(crate) writes: NestedWrites<Writes>,\n// …\n    pub fn begin_timestamp(&self) -> RepeatableTimestamp {\n        self.index.base_snapshot().timestamp()\n    }"
  },
  "db.readSet": {
    "id": "db.readSet",
    "title": "ReadSet: index intervals",
    "repo": "convex-backend",
    "path": "crates/database/src/reads.rs",
    "startLine": 68,
    "endLine": 476,
    "symbol": "ReadSet / record_indexed_directly",
    "lang": "rust",
    "summary": "A read set is, per index, a set of key intervals the transaction read.",
    "explain": "This is the read set from the diagrams. It does not record documents, it records key ranges on indexes, so it also covers documents that did not exist yet (phantoms). Each read adds an interval; the number of intervals is capped, which produces the \"Too many reads\" error.",
    "notes": [
      {
        "line": 71,
        "text": "The ranges of index keys read."
      },
      {
        "line": 98,
        "text": "Per-index intervals."
      },
      {
        "line": 99,
        "text": "Text search reads are tracked separately."
      },
      {
        "line": 466,
        "text": "Limit on the number of intervals in one function."
      }
    ],
    "code": "#[derive(Debug, Clone)]\npub struct IndexReads {\n    pub fields: IndexedFields,\n    pub intervals: IntervalSet,\n    pub stack_traces: Option<Vec<(Interval, StackTrace)>>,\n}\n// …\npub struct ReadSet {\n    indexed: WithHeapSize<BTreeMap<TabletIndexName, IndexReads>>,\n    search: WithHeapSize<BTreeMap<TabletIndexName, SearchQueryReads>>,\n}\n\n// …\n    pub fn record_indexed_directly(\n        &mut self,\n        index_name: TabletIndexName,\n        fields: IndexedFields,\n        interval: Interval,\n        limits: &TransactionLimits,\n    ) -> anyhow::Result<()> {\n        let _s = static_span!();\n\n        let (num_intervals_before, num_intervals_after) =\n            self._record_indexed(index_name, fields, [interval]);\n\n        self.num_intervals = self.num_intervals.saturating_sub(num_intervals_before);\n        self.num_intervals += num_intervals_after;\n        let max_intervals = limits.database_queries;\n        if self.num_intervals > max_intervals {\n            anyhow::bail!(\n                anyhow::anyhow!(\"top three: {}\", self.top_three_intervals()).context(\n                    ErrorMetadata::pagination_limit(\n                        \"TooManyReads\",\n                        format!(\n                            \"Too many reads in a single function execution (limit: {}). \\\n                             {OVER_LIMIT_HELP}\",\n                            max_intervals,\n                        ),\n                    )\n                )\n            );\n        }\n        Ok(())"
  },
  "db.writes": {
    "id": "db.writes",
    "title": "Writes: the buffered write set",
    "repo": "convex-backend",
    "path": "crates/database/src/writes.rs",
    "startLine": 199,
    "endLine": 256,
    "symbol": "struct Writes",
    "lang": "rust",
    "summary": "The write set is an ordered set of document updates applied only at commit.",
    "explain": "Every insert, patch, replace and delete becomes an Update in this set, with size limits checked as you go. Note that an insert registers the new id in the read set, so two transactions inserting the same id conflict.",
    "notes": [
      {
        "line": 203,
        "text": "Pending document changes, keyed by document id."
      },
      {
        "line": 253,
        "text": "Inserts also record a read, so concurrent inserts of one id conflict."
      },
      {
        "line": 255,
        "text": "Writes record reads on table metadata so concurrent schema changes conflict."
      }
    ],
    "code": "pub struct Writes {\n    // N.B.: OrdMap/OrdSet are very sensitive to the size of keys and values (as\n    // a map stores a minimum of 64 key-value pairs, even if empty) and likes to\n    // clone them at will, so we store just a single Arc inside of it\n    updates: OrdSet<Update>,\n\n    // Fields below can be recomputed from `updates`.\n\n    // Size of writes to user tables\n    user_tx_size: TransactionWriteSize,\n    // Size of writes to system tables\n    system_tx_size: TransactionWriteSize,\n    // New `_index` documents, tracked so commit finalization can assign a\n    // persistence ID to database indexes that do not already have one.\n    new_index_document_ids: OrdSet<ResolvedDocumentId>,\n}\n// …\n    pub fn update(\n        &mut self,\n        bootstrap_tables: BootstrapTableIds,\n        is_system_document: bool,\n        reads: &mut TransactionReadSet,\n        document_id: ResolvedDocumentId,\n        old_document: Option<(ResolvedDocument, WriteTimestamp)>,\n        new_document: Option<PendingDocument>,\n        limits: &TransactionLimits,\n    ) -> anyhow::Result<()> {\n        if old_document.is_none() {\n            anyhow::ensure!(!self.updates.contains(&document_id), \"Duplicate insert\");\n            self.register_new_id(reads, document_id)?;\n        }\n        Self::record_reads_for_write(bootstrap_tables, reads, document_id.tablet_id)?;\n"
  },
  "db.committer": {
    "id": "db.committer",
    "title": "Committer: assign ts, check conflicts, persist",
    "repo": "convex-backend",
    "path": "crates/database/src/committer.rs",
    "startLine": 269,
    "endLine": 966,
    "symbol": "Committer::validate_commit",
    "lang": "rust",
    "summary": "The single committer gives each commit a timestamp, rejects it if it conflicts, and queues its writes for persistence.",
    "explain": "There is one committer per deployment, so commits are totally ordered. validate_commit assigns commit_ts, checks the transaction's read set against every write after its snapshot (validated_through) up to commit_ts, and if clean, appends its writes to pending_writes so later commits will conflict with it even before it reaches disk.",
    "notes": [
      {
        "line": 272,
        "text": "Commits with a timestamp that are not yet durable; still checked for conflicts."
      },
      {
        "line": 911,
        "text": "Commit timestamps are assigned here, strictly increasing."
      },
      {
        "line": 915,
        "text": "The OCC check."
      },
      {
        "line": 961,
        "text": "From now on this commit can cause conflicts for others."
      }
    ],
    "code": "pub struct Committer<RT: Runtime> {\n    // Writes of commits that have a timestamp but have not finished writing to\n    // persistence, checked for conflicts alongside `log`.\n    pending_writes: PendingWrites,\n    // External log of writes for subscriptions.\n    log: LogWriter,\n\n    snapshot_manager: Writer<SnapshotManager>,\n    persistence: Arc<dyn Persistence>,\n    runtime: RT,\n    deployment_name: String,\n\n    last_assigned_ts: Timestamp,\n// …\n    fn validate_commit(\n        &mut self,\n        transaction: FinalTransaction,\n        write_source: WriteSource,\n        validated_through: Timestamp,\n    ) -> anyhow::Result<ValidatedCommit> {\n        let commit_ts = self.next_commit_ts()?;\n        metrics::log_commit_validation_window(commit_ts.secs_since_f64(validated_through));\n        let timer = metrics::commit_is_stale_timer();\n        if let Some(conflicting_read) =\n            self.commit_has_conflict(transaction.reads.read_set(), validated_through, commit_ts)?\n        {\n            anyhow::bail!(conflicting_read.into_error(\n                &transaction.table_mapping,\n                &transaction.component_registry,\n                &write_source\n            ));\n        }\n        timer.finish();\n\n        // The commit timestamp is now known: produce the final updates, with\n        // every unresolved commit timestamp in the write set replaced by it,\n        // so nothing unresolved reaches persistence or the durable indexes.\n        // Concrete documents move through without cloning.\n        let mut ordered_updates: Vec<DocumentUpdateWithPrevTs> = transaction\n            .writes\n            .into_coalesced_writes()\n            .map(|update| Arc::unwrap_or_clone(update).resolve(commit_ts))\n            .collect::<anyhow::Result<_>>()?;\n        // The updates are ordered using table_dependency_sort_key,\n        // which is the same order they should be applied to database metadata\n        // and index data structures\n        let bootstrap_tables = BootstrapTableIds::new(&transaction.table_mapping);\n        ordered_updates.sort_by_key(|update| {\n            table_dependency_sort_key(\n                bootstrap_tables,\n                InternalDocumentId::from(update.id),\n                update.new_document.as_ref(),\n            )\n        });\n\n        let (document_writes, index_writes, snapshot) =\n            self.compute_writes(commit_ts, &ordered_updates)?;\n\n        // Append the updates to pending_writes, so future conflicting commits\n        // will fail the `commit_has_conflict` check above, even before\n        // this transaction writes to persistence or is visible to reads. Note that\n        // this can cause theoretical false conflicts, where transaction has a conflict\n        // with another one, and the latter never ended up committing. This\n        // should be very rare, and false positives are acceptable by design.\n        let timer = metrics::pending_writes_append_timer();\n        let packed_updates: OrderedDocumentWrites = ordered_updates\n            .into_iter()\n            .map(|update| PackedDocumentUpdate::pack(&update))\n            .collect();\n        let index_registry = snapshot.index_registry.clone();\n        let pending_write = self.pending_writes.push_back(\n            commit_ts,\n            packed_updates.clone(),\n            write_source,\n            snapshot,\n        );"
  },
  "db.occ": {
    "id": "db.occ",
    "title": "The OCC check: do writes overlap my read set?",
    "repo": "convex-backend",
    "path": "crates/database/src/reads.rs",
    "startLine": 167,
    "endLine": 196,
    "symbol": "ReadSet::writes_overlap_by_index",
    "lang": "rust",
    "summary": "For each index read, scans writes in (begin_ts, commit_ts] and checks whether any written index key falls in a read interval.",
    "explain": "This function is OCC in Convex. It is also, nearly identically, how subscriptions are invalidated. A conflict means another commit wrote a key inside a range you read after your snapshot, so your result might have been different: the mutation is retried.",
    "notes": [
      {
        "line": 179,
        "text": "Only writes after the snapshot and up to the commit ts matter."
      },
      {
        "line": 182,
        "text": "Overlap test: written key inside a read interval."
      },
      {
        "line": 190,
        "text": "The conflicting commit's timestamp, used to wait before retrying."
      }
    ],
    "code": "    pub(crate) fn writes_overlap_by_index(\n        &self,\n        by_database_index: &OrdMap<TabletIndexName, OrdSet<ArcWriteInIndex<DatabaseIndexWrite>>>,\n        by_search_index: &OrdMap<TabletIndexName, OrdSet<ArcWriteInIndex<TextIndexWrite>>>,\n        from: Timestamp,\n        to: Timestamp,\n    ) -> Option<ConflictingReadWithWriteSource> {\n        // Check database index reads\n        for (index, index_reads) in self.indexed.iter() {\n            let Some(updates) = by_database_index.get(index) else {\n                continue;\n            };\n            for write in updates.range((Bound::Excluded(from), Bound::Included(to))) {\n                for update in &write.index_updates {\n                    for index_key in update.update.iter() {\n                        if index_reads.intervals.contains(index_key) {\n                            return Some(ConflictingReadWithWriteSource {\n                                read: ConflictingRead {\n                                    index: index.clone(),\n                                    id: update.document_id,\n                                    stack_traces: index_reads.stack_traces_covering(index_key),\n                                },\n                                write_source: write.write_source.clone(),\n                                write_ts: write.ts,\n                            });\n                        }\n                    }\n                }\n            }\n        }"
  },
  "db.commitConflict": {
    "id": "db.commitConflict",
    "title": "commit_has_conflict: log + pending writes",
    "repo": "convex-backend",
    "path": "crates/database/src/committer.rs",
    "startLine": 1025,
    "endLine": 1038,
    "symbol": "Committer::commit_has_conflict",
    "lang": "rust",
    "summary": "Checks the read set against the published write log and against writes that are committing but not yet durable.",
    "explain": "Two sources are checked: the write log of recent durable commits, and pending_writes of commits that have a timestamp but are still being persisted. Both must be clean for the commit to proceed.",
    "notes": [
      {
        "line": 1031,
        "text": "Against recent durable commits."
      },
      {
        "line": 1034,
        "text": "Against in-flight commits."
      }
    ],
    "code": "    fn commit_has_conflict(\n        &self,\n        reads: &ReadSet,\n        validated_through: Timestamp,\n        commit_ts: Timestamp,\n    ) -> anyhow::Result<Option<ConflictingReadWithWriteSource>> {\n        if let Some(conflicting_read) = self.log.is_stale(reads, validated_through, commit_ts)? {\n            return Ok(Some(conflicting_read));\n        }\n        if let Some(conflicting_read) = self.pending_writes.is_stale(reads) {\n            return Ok(Some(conflicting_read));\n        }\n        Ok(None)\n    }"
  },
  "db.publish": {
    "id": "db.publish",
    "title": "publish_commit: make the commit visible",
    "repo": "convex-backend",
    "path": "crates/database/src/committer.rs",
    "startLine": 1117,
    "endLine": 1166,
    "symbol": "Committer::publish_commit",
    "lang": "rust",
    "summary": "After the write is durable, appends it to the write log (which feeds subscriptions) and publishes a new snapshot.",
    "explain": "This is the moment a commit becomes visible. log.append feeds the subscription manager; snapshot_manager.push makes the new state readable at commit_ts. Readers at older timestamps keep using older snapshots, which is MVCC.",
    "notes": [
      {
        "line": 1149,
        "text": "The write log the subscription manager tails."
      },
      {
        "line": 1161,
        "text": "New snapshot readable at commit_ts."
      }
    ],
    "code": "    fn publish_commit(\n        &mut self,\n        pending_write: PendingWriteHandle,\n        write_volume: WriteVolume,\n        writes: IndexKeyWrites,\n    ) {\n        let apply_timer = metrics::commit_apply_timer();\n        let commit_ts = pending_write.must_commit_ts();\n\n        let (ordered_updates, new_snapshot) = self.pending_writes.pop_first(pending_write);\n\n        // Write transaction state at the commit ts to the document store.\n        metrics::commit_rows(ordered_updates.len() as u64);\n        drop(ordered_updates);\n\n        metrics::write_log_commit_bytes(write_volume.bytes as usize);\n\n        let timer = metrics::write_log_append_timer();\n        let index_registry = &new_snapshot.index_registry;\n        let database_writes = writes.database.clone();\n        let apply_writes_callback = || {\n            self.index_cache_handle.apply_writes(\n                database_writes.iter().map(|(index_name, writes_in_index)| {\n                    (index_name, writes_in_index.index_updates.iter())\n                }),\n                &|index_name| {\n                    index_registry\n                        .get_enabled(index_name)\n                        .map(|index| index.id())\n                },\n            )\n        };\n        self.log.append(commit_ts, writes, apply_writes_callback);\n        drop(timer);\n\n        if let Some(table_counts) = new_snapshot.table_counts.as_ref() {\n            metrics::log_num_keys(table_counts.num_user_documents);\n            metrics::log_user_table_documents_size(table_counts.user_tables_size);\n            self.user_documents_size_gauge\n                .set(table_counts.user_docs_size as i64);\n        }\n\n        // Publish the new version of our database metadata and the index.\n        let mut snapshot_manager = self.snapshot_manager.write();\n        snapshot_manager.push(commit_ts, new_snapshot, write_volume);\n\n        apply_timer.finish();\n    }\n\n    /// Hand every commit request's read set to the blocking pool to be checked"
  },
  "db.timestamp": {
    "id": "db.timestamp",
    "title": "Timestamp: nanoseconds, unique per commit",
    "repo": "convex-backend",
    "path": "crates/convex/sync_types/src/timestamp.rs",
    "startLine": 17,
    "endLine": 40,
    "symbol": "struct Timestamp",
    "lang": "rust",
    "summary": "A database timestamp is a u64 of nanoseconds since epoch, unique across transactions.",
    "explain": "These are the ts values in Transition versions and MutationResponse. Because they are unique and ordered, \"the state of the database at ts\" is well defined.",
    "notes": [
      {
        "line": 19,
        "text": "Wall-clock based but strictly increasing."
      },
      {
        "line": 21,
        "text": "Plain integer, cheap to compare."
      }
    ],
    "code": "/// Database transaction timestamp.\n/// This is unique across all transactions.\n/// Units are nanoseconds since epoch.\n#[derive(Copy, Clone, Debug, PartialEq, PartialOrd, Ord, Eq, FromStr, Hash, Default)]\npub struct Timestamp(u64);\n\nimpl Timestamp {\n    // Some SQL and serialization don't support timestamps > i64::MAX,\n    // which is fine to use as an upper bound because real timestamps aren't that\n    // high.\n    pub const MAX: Self = Self(i64::MAX as u64);\n    pub const MIN: Self = Self(0);\n\n    #[inline]\n    pub fn succ_opt(&self) -> Option<Self> {\n        if *self >= Self::MAX {\n            None\n        } else {\n            Some(Self(self.0 + 1))\n        }\n    }\n\n    pub fn succ(&self) -> anyhow::Result<Self> {\n        self.succ_opt()"
  },
  "db.nextCommitTs": {
    "id": "db.nextCommitTs",
    "title": "next_commit_ts: strictly increasing timestamps",
    "repo": "convex-backend",
    "path": "crates/database/src/committer.rs",
    "startLine": 1412,
    "endLine": 1424,
    "symbol": "Committer::next_commit_ts",
    "lang": "rust",
    "summary": "Picks the next commit timestamp as the max of the clock, the last assigned ts + 1, and the latest snapshot + 1.",
    "explain": "Even if the wall clock goes backwards, commit timestamps keep increasing, so the transaction log stays totally ordered.",
    "notes": [
      {
        "line": 1418,
        "text": "Wall clock."
      },
      {
        "line": 1419,
        "text": "Never reuse or go back."
      }
    ],
    "code": "    fn next_commit_ts(&mut self) -> anyhow::Result<Timestamp> {\n        let _timer = next_commit_ts_seconds();\n        let latest_ts = self.snapshot_manager.read().latest_ts();\n        let max = cmp::max(\n            latest_ts.succ()?,\n            cmp::max(\n                self.runtime.generate_timestamp()?,\n                self.last_assigned_ts.succ()?,\n            ),\n        );\n        self.last_assigned_ts = max;\n        Ok(max)\n    }"
  },
  "db.writeLog": {
    "id": "db.writeLog",
    "title": "WriteLog: recent commits by index",
    "repo": "convex-backend",
    "path": "crates/database/src/write_log.rs",
    "startLine": 557,
    "endLine": 622,
    "symbol": "struct WriteLog",
    "lang": "rust",
    "summary": "An in-memory log of recent commits organized by index, used for OCC checks and subscription invalidation.",
    "explain": "Recent commits are kept in memory indexed by index name and timestamp. If a read set is older than purged_ts, the backend can no longer prove anything about it and returns an out-of-retention error; the caller then reruns from scratch.",
    "notes": [
      {
        "line": 558,
        "text": "One structure serves both OCC and subscriptions."
      },
      {
        "line": 565,
        "text": "Older history has been dropped from memory."
      },
      {
        "line": 612,
        "text": "Same overlap check as OCC."
      }
    ],
    "code": "/// WriteLog holds recent commits that have been written to persistence and\n/// snapshot manager. These commits may cause OCC aborts for new commits, and\n/// they may trigger subscriptions.\n#[derive(Clone)]\nstruct WriteLog {\n    by_database_index: WritesByIndex<DatabaseIndexWrite>,\n    by_text_index: WritesByIndex<TextIndexWrite>,\n    max_ts: Timestamp,\n    purged_ts: Timestamp,\n}\n// …\n    fn is_stale(\n        &self,\n        reads: &ReadSet,\n        reads_ts: Timestamp,\n        ts: Timestamp,\n    ) -> Result<Option<ConflictingReadWithWriteSource>, OutOfRetentionError> {\n        if reads_ts < self.purged_ts {\n            Err(OutOfRetentionError {\n                reads_ts,\n                purged_ts: self.purged_ts,\n            })\n        } else {\n            Ok(reads.writes_overlap_by_index(\n                &self.by_database_index.0,\n                &self.by_text_index.0,\n                reads_ts,\n                ts,\n            ))\n        }\n    }\n\n    /// Returns Err(write_ts) if the token could not be refreshed, where\n    /// write_ts is the timestamp of a conflicting write (if known)"
  },
  "db.subscriptions": {
    "id": "db.subscriptions",
    "title": "SubscriptionManager: tailing the write log",
    "repo": "convex-backend",
    "path": "crates/database/src/subscription.rs",
    "startLine": 356,
    "endLine": 530,
    "symbol": "SubscriptionManager::advance_log",
    "lang": "rust",
    "summary": "Tracks every live query's read set and, for each new range of commits, finds which subscribers overlap.",
    "explain": "This is the subscription manager from the diagram. Subscribers are indexed in an interval map per index. advance_log iterates new writes in the log from processed_ts to next_ts and, for each written key, queries the interval map for subscribers whose read ranges contain it. Those subscribers are notified, which completes the sync worker's invalidation future.",
    "notes": [
      {
        "line": 362,
        "text": "Every live subscription (one per query per client, deduplicated by cache)."
      },
      {
        "line": 383,
        "text": "Each subscriber is just a read set plus a channel."
      },
      {
        "line": 500,
        "text": "Collected subscribers to invalidate for this batch of commits."
      },
      {
        "line": 517,
        "text": "Match written index keys against subscribed intervals."
      }
    ],
    "code": "/// Tracks all subscribers to queries and the read-set they're watching for\n/// updates on.\npub struct SubscriptionManager {\n    /// Unique identifier for this manager (used for retention coordination)\n    manager_id: usize,\n\n    subscribers: Slab<Subscriber>,\n    subscriptions: SubscriptionMap,\n    next_seq: Sequence,\n\n    closed_subscriptions: FuturesUnordered<BoxFuture<'static, SubscriptionKey>>,\n\n    log: LogReader,\n\n    retention_coordinator: RetentionCoordinator,\n\n    // The timestamp until which the worker has processed the log, which may be lagging behind\n    // `conflict_checker.max_ts()`.\n    //\n    // Invariant: All `ReadSet` in `subscribers` have a timestamp greater than or equal to\n    // `processed_ts`.\n    processed_ts: Arc<AtomicI64>,\n\n    invalidation_callback: InvalidationMetricCallback,\n}\n\nstruct Subscriber {\n    reads: Arc<ReadSet>,\n    sender: SubscriptionSender,\n// …\n    pub fn advance_log(&mut self, next_ts: Timestamp) -> anyhow::Result<()> {\n        let _timer = metrics::subscriptions_update_timer();\n        block_in_place(|| {\n            let processed_ts = self.processed_ts();\n            let from_ts = processed_ts.succ()?;\n\n            // Maps subscriber_id -> (earliest invalidating write_ts, write_source,\n            // tablet_id)\n            let mut to_notify: BTreeMap<SubscriberId, (Timestamp, Option<WriteSource>, TabletId)> =\n                BTreeMap::new();\n            {\n                let _timer = metrics::subscriptions_log_iterate_timer();\n                let mut num_index_updates = 0;\n                self.log.for_each_index(\n                    from_ts,\n                    next_ts,\n                    &mut to_notify,\n                    &mut num_index_updates,\n                    |index_name, updates, to_notify, num_index_updates| {\n                        if let Some(interval_map) = self.interval_map(index_name) {\n                            Self::process_log_entry(\n                                to_notify,\n                                num_index_updates,\n                                index_name,\n                                |notify, num_index_updates| {\n                                    Self::overlapping_database(\n                                        interval_map,\n                                        updates,\n                                        notify,\n                                        num_index_updates,\n                                    )\n                                },\n                            );\n                        }\n                    },\n                    |index_name, updates, to_notify, num_index_updates| {\n                        if let Some(text_subscription) =\n                            self.text_subscription_for_index(index_name)\n                        {"
  },
  "db.subscriptionMatch": {
    "id": "db.subscriptionMatch",
    "title": "overlapping_database: interval map lookup",
    "repo": "convex-backend",
    "path": "crates/database/src/subscription.rs",
    "startLine": 662,
    "endLine": 882,
    "symbol": "SubscriptionManager::overlapping_database",
    "lang": "rust",
    "summary": "For each written index key, queries an interval map to find every subscription whose read range contains it.",
    "explain": "Instead of checking every subscription against every write, subscriptions are stored in an interval map per index. Cost scales with the number of written keys, not the number of subscriptions.",
    "notes": [
      {
        "line": 680,
        "text": "Find all subscribed ranges containing this key."
      },
      {
        "line": 880,
        "text": "One interval map per index."
      }
    ],
    "code": "    pub fn overlapping_database<'a, I>(\n        interval_map: &IntervalMap,\n        ordered_index_updates: I,\n        notify: &mut (impl FnMut(SubscriberId, Timestamp, Option<WriteSource>) + ?Sized),\n        num_index_updates: &mut usize,\n    ) where\n        I: Iterator<Item = &'a WriteInIndex<DatabaseIndexWrite>>,\n    {\n        for update in ordered_index_updates {\n            let write_ts = update.ts;\n            let write_source = &update.write_source;\n            let mut notify_with_ts_and_write_source = |subscriber_id| {\n                let write_source_clone = write_source.is_udf().then(|| write_source.clone());\n                notify(subscriber_id, write_ts, write_source_clone)\n            };\n            for index_update in &update.index_updates {\n                *num_index_updates += 1;\n                for index_key in index_update.update.iter() {\n                    interval_map.query(&index_key.0, &mut notify_with_ts_and_write_source);\n                }\n            }\n        }\n    }\n// …\nstruct SubscriptionMap {\n    // TODO: remove nesting, merge all IntervalMaps into one big data structure\n    indexed: BTreeMap<TabletIndexName, (IndexedFields, IntervalMap)>,\n    search: TextSearchSubscriptions,\n}"
  },
  "db.snapshot": {
    "id": "db.snapshot",
    "title": "SnapshotManager: MVCC versions in memory",
    "repo": "convex-backend",
    "path": "crates/database/src/snapshot_manager.rs",
    "startLine": 85,
    "endLine": 687,
    "symbol": "SnapshotManager::snapshot",
    "lang": "rust",
    "summary": "Keeps several versions of database metadata and in-memory indexes at recent timestamps so transactions can begin at any of them.",
    "explain": "Snapshots use immutable copy-on-write data structures, so keeping many versions is cheap. snapshot(ts) finds the latest version at or before ts. Too old a ts returns out_of_retention.",
    "notes": [
      {
        "line": 94,
        "text": "Recent versions, ordered by timestamp."
      },
      {
        "line": 668,
        "text": "Beyond the window: the caller must retry at a newer ts."
      },
      {
        "line": 678,
        "text": "Find the version visible at ts."
      }
    ],
    "code": "/// The [SnapshotManager] maintains multiple versions of the [Snapshot]s at\n/// different timestamps. The snapshots internally use immutable data structures\n/// with copy-on-write semantics to provide memory-efficient multiversioning.\n///\n/// We maintain a bounded time range of versions,\n/// determined by `MAX_TRANSACTION_WINDOW`, allowing the `Database` layer to\n/// begin a transaction in any timestamp within that range.\npub struct SnapshotManager {\n    persisted_max_repeatable_ts: Timestamp,\n    versions: VecDeque<(Timestamp, Snapshot)>,\n    write_throughput_limiter: WriteThroughputLimiter,\n    waiters: Mutex<VecDeque<(Timestamp, oneshot::Sender<()>)>>,\n}\n// …\n    pub fn snapshot(&self, ts: Timestamp) -> anyhow::Result<Snapshot> {\n        if ts < self.earliest_ts() {\n            return Err(\n                anyhow::anyhow!(ErrorMetadata::out_of_retention()).context(format!(\n                    \"Timestamp {ts} is too early, retry with a higher timestamp\"\n                )),\n            );\n        }\n        anyhow::ensure!(\n            ts <= *self.latest_ts(),\n            \"Timestamp {ts} is more recent than latest_ts {}\",\n            self.latest_ts(),\n        );\n        let i = match self.versions.binary_search_by_key(&ts, |(ts, ..)| *ts) {\n            Ok(i) => i,\n            // This is the index where insertion would preserve sorted order. That is, it's the\n            // first index that has a timestamp greater than `ts`. So, we'd like the immediately\n            // preceding element.\n            Err(i) => i.checked_sub(1).unwrap(),\n        };\n        let (_, snapshot) = &self.versions[i];\n        Ok(snapshot.clone())\n    }"
  },
  "db.indexRange": {
    "id": "db.indexRange",
    "title": "IndexRange: reading an index and recording the range",
    "repo": "convex-backend",
    "path": "crates/database/src/query/index_range.rs",
    "startLine": 197,
    "endLine": 228,
    "symbol": "IndexRange::start_next",
    "lang": "rust",
    "summary": "Returns the next document from an index range and records the exact interval scanned so far in the read set.",
    "explain": "Only the scanned prefix is recorded: used_interval is split at the cursor. A .take(10) on a big range records only the range up to the 10th key, so writes beyond it do not invalidate the query.",
    "notes": [
      {
        "line": 201,
        "text": "Counts toward read limits and bandwidth."
      },
      {
        "line": 220,
        "text": "Split the range at the cursor: only what was actually scanned."
      },
      {
        "line": 222,
        "text": "Add that interval to the read set."
      }
    ],
    "code": "        if let Some((index_position, v, timestamp)) = self.page.pop_front() {\n            // Charge for document read based on the size of the system table, rather than\n            // virtual table.\n            UserFacingModel::new(tx, self.namespace)\n                .record_read_document(&v, self.printable_index_name.table())?;\n\n            let v = if matches!(self.stable_index_name, StableIndexName::Virtual(_, _)) {\n                VirtualTable::new(tx)\n                    .system_to_virtual_doc(v.unpack(), self.version.clone())\n                    .await?\n            } else {\n                v.unpack().to_developer()\n            };\n\n            let index_bytes = index_position.len();\n            if let Some(intermediate_cursors) = &mut self.intermediate_cursors {\n                intermediate_cursors.push(CursorPosition::After(index_position.clone()));\n            }\n            let cursor_position = CursorPosition::After(index_position);\n            self.cursor_interval.curr_exclusive = Some(cursor_position.clone());\n            self.returned_results += 1;\n            let (used_interval, _) = self\n                .initial_unfetched_interval\n                .split(cursor_position, self.order);\n\n            tx.reads.record_indexed_directly(\n                tablet_index_name,\n                self.indexed_fields.clone(),\n                used_interval,\n                &tx.limits,\n            )?;\n"
  },
  "db.token": {
    "id": "db.token",
    "title": "Token: read set + timestamp",
    "repo": "convex-backend",
    "path": "crates/database/src/token.rs",
    "startLine": 13,
    "endLine": 27,
    "symbol": "struct Token",
    "lang": "rust",
    "summary": "A Token packages a read set with the timestamp it was valid at.",
    "explain": "Tokens are what subscriptions and the query cache hold. Refreshing a token to a newer ts means proving no write in between touched its read set.",
    "notes": [
      {
        "line": 18,
        "text": "What was read."
      },
      {
        "line": 19,
        "text": "When it was valid."
      }
    ],
    "code": "/// A token is a base64 serializable representation of the current read-state\n/// for a transaction. This can be externalized to a user and used to represent\n/// current transaction state.\n#[derive(Clone, Debug)]\npub struct Token {\n    read_set: Arc<ReadSet>,\n    ts: Timestamp,\n}\n\nimpl Token {\n    #[allow(unused)]\n    #[allow(unused)]\n    pub fn new(read_set: Arc<ReadSet>, ts: Timestamp) -> Self {\n        Self { read_set, ts }\n    }"
  },
  "persistence.trait": {
    "id": "persistence.trait",
    "title": "Persistence trait",
    "repo": "convex-backend",
    "path": "crates/common/src/persistence/mod.rs",
    "startLine": 329,
    "endLine": 660,
    "symbol": "trait Persistence / PersistenceReader::index_scan",
    "lang": "rust",
    "summary": "The storage interface: write document log entries plus index entries, and scan an index at a read timestamp.",
    "explain": "Every backend (SQLite, Postgres, MySQL) implements the same two things: append documents and index entries, and scan an index range as of a timestamp. Everything else (transactions, OCC, subscriptions) lives above this layer in Rust.",
    "notes": [
      {
        "line": 338,
        "text": "Rows appended to the document log."
      },
      {
        "line": 339,
        "text": "Index entries written alongside."
      },
      {
        "line": 652,
        "text": "MVCC: scan as of this timestamp."
      }
    ],
    "code": "pub trait Persistence: Sync + Send + 'static {\n    /// Whether the persistence layer is freshely created or not.\n    fn is_fresh(&self) -> bool;\n\n    fn reader(&self) -> Arc<dyn PersistenceReader>;\n\n    /// Writes documents and the respective derived indexes.\n    async fn write<'a>(\n        &self,\n        documents: &'a [DocumentLogEntry],\n        indexes: &'a [PersistenceIndexEntry],\n        conflict_strategy: ConflictStrategy,\n    ) -> anyhow::Result<()>;\n\n// …\n    fn index_scan(\n        &self,\n        index: IndexRef,\n        tablet_id: TabletId,\n        read_timestamp: Timestamp,\n        range: &Interval,\n        order: Order,\n        size_hint: usize,\n        retention_validator: Arc<dyn RetentionValidator>,\n    ) -> IndexStream<'_>;\n\n    async fn get_persistence_global(\n        &self,"
  },
  "persistence.documentLog": {
    "id": "persistence.documentLog",
    "title": "DocumentLogEntry and PersistenceIndexEntry",
    "repo": "convex-backend",
    "path": "crates/common/src/persistence/mod.rs",
    "startLine": 60,
    "endLine": 93,
    "symbol": "DocumentLogEntry",
    "lang": "rust",
    "summary": "Each write is a new row (id, ts, value, prev_ts); deletes have value None. Index entries are (index, key, ts) → document id.",
    "explain": "Nothing is updated in place. A patch appends a new version of the whole document at the new ts, and new index entries point at it. prev_ts links to the previous version.",
    "notes": [
      {
        "line": 64,
        "text": "None is a deletion (tombstone)."
      },
      {
        "line": 65,
        "text": "Previous version of this document."
      },
      {
        "line": 88,
        "text": "Encoded index key, ordered bytes."
      },
      {
        "line": 89,
        "text": "Which document this index entry points to."
      }
    ],
    "code": "#[derive(Debug, Clone, PartialEq)]\npub struct DocumentLogEntry {\n    pub ts: Timestamp,\n    pub id: InternalDocumentId,\n    pub value: Option<ResolvedDocument>,\n    pub prev_ts: Option<Timestamp>,\n}\n// …\n#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]\npub struct PersistenceIndexEntry {\n    /// Whether index backfill may still be inserting entries for existing\n    /// documents.\n    pub mode: IndexWriteMode,\n    pub ts: Timestamp,\n    pub index: IndexRef,\n    pub key: IndexKeyBytes,\n    pub value: Option<InternalDocumentId>,\n    /// `Some` when the key had an entry before this one: always for a\n    /// tombstone, and for a live entry whose key the document's previous\n    /// revision also produced.\n    pub prev: Option<PrevIndexEntry>,"
  },
  "persistence.sqlite": {
    "id": "persistence.sqlite",
    "title": "SQLite schema: documents and indexes",
    "repo": "convex-backend",
    "path": "crates/sqlite/src/lib.rs",
    "startLine": 609,
    "endLine": 638,
    "symbol": "documents / indexes tables",
    "lang": "rust",
    "summary": "The whole database is two SQL tables: an append-only documents log and an indexes table keyed by (index_id, key, ts).",
    "explain": "SQL here is a durable key-value log, not a relational model of your data. Your documents are JSON in json_value; your tables are just a table_id column. Every version of every document is a row keyed by ts.",
    "notes": [
      {
        "line": 615,
        "text": "Your document, serialized as JSON."
      },
      {
        "line": 620,
        "text": "Ordered by commit timestamp: a transaction log."
      },
      {
        "line": 637,
        "text": "Every version of every index key."
      }
    ],
    "code": "CREATE TABLE IF NOT EXISTS documents (\n    id BLOB NOT NULL,\n    ts INTEGER NOT NULL,\n\n    table_id BLOB NOT NULL,\n\n    json_value TEXT NULL,\n    deleted INTEGER NOT NULL,\n\n    prev_ts INTEGER,\n\n    PRIMARY KEY (ts, table_id, id)\n);\nCREATE INDEX IF NOT EXISTS documents_by_table_and_id ON documents (table_id, id, ts);\n\"#;\n\nconst INDEXES_INIT: &str = r#\"\nCREATE TABLE IF NOT EXISTS indexes (\n    index_id BLOB NOT NULL,\n    ts INTEGER NOT NULL,\n\n    key BLOB NOT NULL,\n\n    deleted INTEGER NOT NULL,\n\n    table_id BLOB NULL,\n    document_id BLOB NULL,\n\n    PRIMARY KEY (index_id, key, ts)\n);"
  },
  "persistence.sqliteScan": {
    "id": "persistence.sqliteScan",
    "title": "MVCC index scan in SQL",
    "repo": "convex-backend",
    "path": "crates/sqlite/src/lib.rs",
    "startLine": 163,
    "endLine": 186,
    "symbol": "SqlitePersistence::_index_scan_inner",
    "lang": "rust",
    "summary": "For each key in range, picks the newest index entry with ts <= read_ts and joins the matching document version.",
    "explain": "This query is MVCC in SQL: \"latest version as of ts\" per key. Deleted entries are filtered out. In practice most reads are served from in-memory caches above this layer.",
    "notes": [
      {
        "line": 168,
        "text": "Newest version of each key..."
      },
      {
        "line": 170,
        "text": "...as of the read timestamp."
      },
      {
        "line": 174,
        "text": "Skip keys whose latest version is a deletion."
      }
    ],
    "code": "        };\n        let query = format!(\n            r#\"\nSELECT B.key, B.ts, B.document_id, C.table_id, C.json_value, C.prev_ts\nFROM (\n    SELECT index_id, key, MAX(ts) as max_ts\n    FROM indexes\n    WHERE index_id = $1 AND ts <= $2{lower}{upper}\n    GROUP BY index_id, key\n) A\nJOIN indexes B\nON B.deleted is FALSE\nAND A.index_id = B.index_id\nAND A.key = B.key\nAND A.max_ts = B.ts\nLEFT JOIN documents C\nON B.ts = C.ts\nAND B.table_id = c.table_id\nAND B.document_id = C.id\nORDER BY B.key {order}\n\"#,\n        );\n\n        let connection = &self.inner.lock().connection;"
  },
  "persistence.sqliteWrite": {
    "id": "persistence.sqliteWrite",
    "title": "Writing documents and index entries",
    "repo": "convex-backend",
    "path": "crates/sqlite/src/lib.rs",
    "startLine": 291,
    "endLine": 320,
    "symbol": "SqlitePersistence::write",
    "lang": "rust",
    "summary": "Inserts all document rows and index rows of a commit in one SQLite transaction.",
    "explain": "A commit's document versions and index entries go in atomically. Deletes are written as rows with deleted = 1.",
    "notes": [
      {
        "line": 298,
        "text": "One SQL transaction per batch of commits."
      },
      {
        "line": 310,
        "text": "Deletion: no JSON, deleted flag set."
      }
    ],
    "code": "    async fn write<'a>(\n        &self,\n        documents: &'a [DocumentLogEntry],\n        indexes: &'a [PersistenceIndexEntry],\n        conflict_strategy: ConflictStrategy,\n    ) -> anyhow::Result<()> {\n        let mut inner = self.inner.lock();\n        let tx = inner.connection.transaction()?;\n        let mut insert_document_query = match conflict_strategy {\n            ConflictStrategy::Error => tx.prepare_cached(INSERT_DOCUMENT)?,\n            ConflictStrategy::Overwrite => tx.prepare_cached(INSERT_OVERWRITE_DOCUMENT)?,\n        };\n\n        for update in documents {\n            let (json_value, deleted) = if let Some(document) = &update.value {\n                assert_eq!(update.id, document.id_with_table_id());\n                let json_value = document.value().json_serialize()?;\n                (Some(json_value), 0)\n            } else {\n                (None, 1)\n            };\n            insert_document_query.execute(params![\n                &update.id.internal_id()[..],\n                &i64::from(update.ts),\n                &update.id.table().0[..],\n                &json_value,\n                &deleted,\n                &update.prev_ts.map(i64::from),\n            ])?;\n        }"
  },
  "persistence.postgres": {
    "id": "persistence.postgres",
    "title": "Postgres schema",
    "repo": "convex-backend",
    "path": "crates/postgres/src/sql.rs",
    "startLine": 55,
    "endLine": 139,
    "symbol": "Postgres documents / indexes tables",
    "lang": "rust",
    "summary": "The same two-table layout in Postgres, with the key split into prefix and suffix because of Postgres key length limits.",
    "explain": "Same design as SQLite: a document log and a multi-version index table. json_value is BYTEA here.",
    "notes": [
      {
        "line": 66,
        "text": "Document body."
      },
      {
        "line": 124,
        "text": "Index keys are split to fit Postgres primary key limits."
      },
      {
        "line": 129,
        "text": "Hash of the full key for uniqueness."
      }
    ],
    "code": "                    r#\"\nDO $$\nBEGIN\n    IF to_regclass('@db_name.documents') IS NULL THEN\n        CREATE TABLE IF NOT EXISTS @db_name.documents (\n            {instance_col}\n            id BYTEA NOT NULL,\n            ts BIGINT NOT NULL,\n\n            table_id BYTEA NOT NULL,\n\n            json_value BYTEA NOT NULL,\n            deleted BOOLEAN DEFAULT false,\n\n            prev_ts BIGINT\n        );\n// …\n                    r#\"\nDO $$\nBEGIN\n    IF to_regclass('@db_name.indexes') IS NULL THEN\n        CREATE TABLE IF NOT EXISTS @db_name.indexes (\n            {instance_col}\n            /* ids should be serialized as bytes but we keep it compatible with documents */\n            index_id BYTEA NOT NULL,\n            ts BIGINT NOT NULL,\n            /*\n            Postgres maximum primary key length is 2730 bytes, which\n            is why we split up the key. The first 2500 bytes are stored in key_prefix,\n            and the remaining ones are stored in key suffix if applicable.\n            NOTE: The key_prefix + key_suffix is store all values of IndexKey including\n            the id.\n            */\n            key_prefix BYTEA NOT NULL,\n            key_suffix BYTEA NULL,\n\n            /* key_sha256 of the full key, used in primary key to avoid duplicates in case\n            of key_prefix collision. */\n            key_sha256 BYTEA NOT NULL,\n\n            deleted BOOLEAN,\n\n            /* table_id should be populated iff deleted is false. */\n            table_id BYTEA NULL,\n            /* document_id should be populated iff deleted is false. */\n            document_id BYTEA NULL\n        );\n    END IF;\nEND $$;"
  },
  "value.id": {
    "id": "value.id",
    "title": "Document ID encoding",
    "repo": "convex-backend",
    "path": "crates/value/src/id_v6.rs",
    "startLine": 1,
    "endLine": 93,
    "symbol": "DeveloperDocumentId::encode_into",
    "lang": "rust",
    "summary": "An ID is VInt(table number) + 16-byte internal id + 2-byte checksum footer, base32 encoded.",
    "explain": "The table number inside the ID is why v.id(\"users\") can reject an id from another table, and the checksum catches typos. IDs are not sequential, so they leak nothing about row counts.",
    "notes": [
      {
        "line": 3,
        "text": "Layout."
      },
      {
        "line": 76,
        "text": "Table number first."
      },
      {
        "line": 83,
        "text": "Checksum XOR version."
      },
      {
        "line": 87,
        "text": "Final string form."
      }
    ],
    "code": "//! We encode DocumentIds in two steps. First, we encode them into binary:\n//! ```text\n//! document_id = [ VInt(table_number) ] [ internal ID ] [ footer ]\n//! ```\n//! We use VInt encoding for the table number, which uses between one and five\n//! bytes. Then, we write the 16 bytes of the internal ID as is. Finally, the\n//! footer is a checksum of the ID so far XOR'd with the version number.\n//! ```text\n//! footer = fletcher16( [ VInt(table_number) ] [ internal ID ] ) ^ version\n//! ```\n// …\n    pub fn encoded_len(&self) -> usize {\n        let byte_length = vint_len(self.table().into()) + 16 + 2;\n        base32::encoded_len(byte_length)\n    }\n\n    pub fn encode_into<'a>(&self, out: &'a mut EncodedDocumentIdBuffer) -> &'a str {\n        let mut buf = [0; 28];\n\n        let mut pos = 0;\n\n        pos += vint_encode(self.table().into(), &mut buf[pos..]);\n        let f1 = fletcher16(&buf[..pos]);\n\n        buf[pos..(pos + 16)].copy_from_slice(&self.internal_id());\n        let f2 = fletcher16_simd(&self.internal_id().0);\n        pos += 16;\n\n        let footer = fletcher16_combine(f1, f2, 16) ^ VERSION;\n        buf[pos..(pos + 2)].copy_from_slice(&footer.to_le_bytes());\n        pos += 2;\n\n        base32::encode_into::<true>(&mut out.0, &buf, pos);\n\n        unsafe { std::str::from_utf8_unchecked(&out.0[..base32::encoded_len(pos)]) }\n    }\n\n    pub fn encode(&self) -> String {\n        self.encode_into(&mut Default::default()).to_owned()"
  },
  "scheduler.mutation": {
    "id": "scheduler.mutation",
    "title": "Running a scheduled mutation exactly once",
    "repo": "convex-backend",
    "path": "crates/application/src/scheduled_jobs/mod.rs",
    "startLine": 738,
    "endLine": 806,
    "symbol": "ScheduledJobExecutor::handle_mutation",
    "lang": "rust",
    "summary": "Runs the scheduled mutation and marks the job Success in the same transaction, retrying on OCC.",
    "explain": "Because the job's state change commits atomically with the mutation's writes, a scheduled mutation runs exactly once: either both commit or neither does and it retries.",
    "notes": [
      {
        "line": 745,
        "text": "Only proceed if the job is still pending."
      },
      {
        "line": 767,
        "text": "Visible only inside this transaction."
      },
      {
        "line": 796,
        "text": "Marked done in the same transaction as the mutation's writes."
      },
      {
        "line": 805,
        "text": "One atomic commit."
      }
    ],
    "code": "        let mut backoff = Backoff::new(*SCHEDULER_OCC_INITIAL_BACKOFF, *SCHEDULER_OCC_MAX_BACKOFF);\n        let udf_args = job.udf_args()?;\n        let request_id = RequestId::new();\n        loop {\n            let mutation_retry_count = backoff.failures() as usize;\n            let usage_tracker = FunctionUsageTracker::new();\n            let Some((mut tx, job)) = self\n                .new_transaction_for_job_state(job_id, &job, usage_tracker.clone())\n                .await?\n            else {\n                // Continue without running function since the job state has changed\n                return Ok(());\n// …\n            // Stage a write so that the mutation can observe its own\n            // `_scheduled_functions` record as `inProgress`. This is invisible to\n            // other transactions, for whom the job stays `pending` until it\n            // reaches a completion state.\n            let mut in_progress_job = job.clone();\n            in_progress_job.state = ScheduledJobState::InProgress {\n                request_id: context.request_id.clone(),\n                execution_id: context.execution_id,\n            };\n            SchedulerModel::new(&mut tx, namespace)\n                .replace(job_id, in_progress_job)\n                .await?;\n\n            let result = if let Fault::Error(e) = pause_client.wait(SCHEDULED_JOB_EXECUTING).await {\n                tracing::info!(\"Injected error before running mutation\");\n                Err(e)\n            } else {\n                self.runner\n                    .run_mutation_no_udf_log(\n                        tx,\n                        PublicFunctionPath::Component(path.clone()),\n                        udf_args.clone(),\n                        caller.allowed_visibility(),\n                        context.clone(),\n                        None,\n                    )\n                    .await\n            };\n            let (stats, execution_time, outcome) = match result {\n                Ok((mut tx, mut outcome)) => {\n                    let stats = tx.take_stats();\n                    let execution_time = start.elapsed();\n                    if outcome.result.is_ok() {\n                        SchedulerModel::new(&mut tx, namespace)\n                            .complete(job_id, ScheduledJobState::Success)\n                            .await?;\n                        let commit_result = if let Fault::Error(e) =\n                            pause_client.wait(SCHEDULED_JOB_COMMITTING).await\n                        {\n                            tracing::info!(\"Injected error before committing mutation\");\n                            Err(e)\n                        } else {\n                            self.database\n                                .commit_with_write_source(tx, WriteSource::mutation(path.clone()))\n                                .await"
  },
  "scheduler.action": {
    "id": "scheduler.action",
    "title": "Scheduled actions are at most once",
    "repo": "convex-backend",
    "path": "crates/application/src/scheduled_jobs/mod.rs",
    "startLine": 1016,
    "endLine": 1030,
    "symbol": "ScheduledJobExecutor::handle_action",
    "lang": "rust",
    "summary": "If an action job is found already InProgress (the backend crashed mid-run), it is marked Failed rather than rerun.",
    "explain": "Actions have side effects outside the database, so Convex will not run them twice. A crash mid-action results in a failed job, which is why critical action work should be retried explicitly (for example with the action-retrier component).",
    "notes": [
      {
        "line": 1022,
        "text": "The guarantee, stated in code."
      },
      {
        "line": 1026,
        "text": "Mark failed instead of rerunning."
      }
    ],
    "code": "            ScheduledJobState::InProgress {\n                ref request_id,\n                ref execution_id,\n            } => {\n                // This case can happen if there is a system error while executing\n                // the action or if backend exits after executing the action but\n                // before updating the state. Since we execute actions at most once,\n                // complete this job and log the error.\n                let message = \"Transient error while executing action\".to_string();\n                SchedulerModel::new(&mut tx, namespace)\n                    .complete(job_id, ScheduledJobState::Failed(message.clone()))\n                    .await?;\n                self.database\n                    .commit_with_write_source(tx, \"scheduled_job_action_error\")\n                    .await?;"
  },
  "search.text": {
    "id": "search.text",
    "title": "Text search on Tantivy",
    "repo": "convex-backend",
    "path": "crates/search/src/text_index_manager.rs",
    "startLine": 164,
    "endLine": 197,
    "symbol": "TextIndexManager::search",
    "lang": "rust",
    "summary": "Compiles a search query against a Tantivy schema, runs it, and returns results plus search reads for the read set.",
    "explain": "Full-text search is built on Tantivy. compile returns reads alongside the query, so search queries also have read sets and are reactive.",
    "notes": [
      {
        "line": 174,
        "text": "Tantivy index schema derived from your searchIndex."
      },
      {
        "line": 175,
        "text": "Search reads go into the read set, which makes search reactive."
      }
    ],
    "code": "    pub async fn search(\n        &self,\n        index: &Index,\n        search: &InternalSearch,\n        searcher: Arc<dyn Searcher>,\n        search_storage: Arc<dyn Storage>,\n        version: SearchVersion,\n    ) -> anyhow::Result<QueryResults> {\n        let timer = metrics::search_timer(&SEARCHLIGHT_CLUSTER_NAME);\n        let tantivy_schema =\n            TantivySearchIndexSchema::new_for_index(index, &search.printable_index_name()?)?;\n        let (compiled_query, reads) = tantivy_schema.compile(search, version)?;\n\n        let TextSearchResults {\n            revisions_with_keys,\n            filtered_bytes_searched,\n        } = self\n            .run_compiled_query(\n                index,\n                &search.printable_index_name()?,\n                tantivy_schema,\n                compiled_query,\n                searcher,\n                search_storage,\n            )\n            .await?;\n\n        let results = QueryResults {\n            revisions_with_keys,\n            reads,\n            filtered_bytes_searched,\n        };\n        metrics::finish_search(timer, &results.revisions_with_keys);\n        Ok(results)"
  },
  "search.vector": {
    "id": "search.vector",
    "title": "Vector search on Qdrant segments",
    "repo": "convex-backend",
    "path": "crates/vector/src/vector_index_manager.rs",
    "startLine": 450,
    "endLine": 496,
    "symbol": "VectorIndexManager::vector_search",
    "lang": "rust",
    "summary": "Runs a vector search over on-disk Qdrant segments plus an in-memory index of recent writes.",
    "explain": "Vector indexes use Qdrant's segment format. Recent writes not yet in a disk segment are searched from memory_index, so results include fresh data.",
    "notes": [
      {
        "line": 471,
        "text": "Built on Qdrant segments."
      },
      {
        "line": 488,
        "text": "Recent writes not yet flushed to disk."
      }
    ],
    "code": "    pub async fn vector_search(\n        &self,\n        index: &Index,\n        query: InternalVectorSearch,\n        searcher: Arc<dyn VectorSearcher>,\n        search_storage: Arc<dyn Storage>,\n    ) -> anyhow::Result<Vec<VectorSearchQueryResult>> {\n        let timer = metrics::search_timer(&SEARCHLIGHT_CLUSTER_NAME);\n        let result: anyhow::Result<_> = try_anyhow!({\n            let IndexConfig::Vector { ref spec, .. } = index.metadata.config else {\n                anyhow::bail!(ErrorMetadata::bad_request(\n                    \"IndexNotAVectorIndexError\",\n                    format!(\n                        \"Index {} is not a vector index\",\n                        query.printable_index_name()?\n                    )\n                ));\n            };\n            let Some((vector_index, memory_index)) = self.require_ready_index(&index.id())? else {\n                anyhow::bail!(\"Vector index {:?} not available\", index.id());\n            };\n            let qdrant_schema = QdrantSchema::new(spec);\n            let VectorIndexState::SnapshottedAt(snapshot) = vector_index else {\n                anyhow::bail!(index_backfilling_error(&query.printable_index_name()?));\n            };\n            let metric_labels =\n                SearchIndexMetricLabels::new(Some(index.id()), None::<&str>).to_owned();\n            let (disk_revisions, vector_index_type) = match snapshot.data {\n                VectorIndexSnapshotData::Unknown(_) => {\n                    anyhow::bail!(index_backfilling_error(&query.printable_index_name()?))\n                },\n                VectorIndexSnapshotData::MultiSegment(ref segments) => (\n                    self.multi_segment_search(\n                        query,\n                        searcher,\n                        segments,\n                        search_storage,\n                        qdrant_schema,\n                        memory_index,\n                        snapshot.ts,\n                        metric_labels,\n                    )\n                    .await?,\n                    VectorIndexType::MultiSegment,\n                ),\n            };\n            (disk_revisions, vector_index_type)"
  },
  "storage.files": {
    "id": "storage.files",
    "title": "File storage: upload, then a short transaction",
    "repo": "convex-backend",
    "path": "crates/file_storage/src/core.rs",
    "startLine": 395,
    "endLine": 632,
    "symbol": "TransactionalFileStorage::upload_file / store_entry",
    "lang": "rust",
    "summary": "Streams the file to object storage first, then commits a small _storage document in a separate quick transaction.",
    "explain": "The slow upload happens outside any transaction; only the metadata row is committed, to keep OCC windows short. The storageId you get is different from the object storage key.",
    "notes": [
      {
        "line": 407,
        "text": "Stream to object storage (S3 in the cloud, local disk self-hosted)."
      },
      {
        "line": 422,
        "text": "storageId is not the storage key."
      },
      {
        "line": 625,
        "text": "Transaction only after the upload."
      }
    ],
    "code": "    pub async fn upload_file(\n        &self,\n        content_length: Option<ContentLength>,\n        content_type: Option<ContentType>,\n        file: impl Stream<Item = anyhow::Result<impl Into<Bytes>>> + Send,\n        expected_sha256: Option<Sha256Digest>,\n    ) -> anyhow::Result<FileStorageEntry> {\n        let storage_id = StorageUuid::from(self.rt.new_uuid_v4());\n\n        tracing::info!(\"Uploading with content length {content_length:?}\");\n        let timer = metrics::store_file_timer();\n\n        let mut upload = self.storage.start_upload().await?;\n        let file = file.map(|chunk| chunk.map(|chunk| chunk.into()));\n        let (size, actual_sha256) = upload.try_write_parallel_and_hash(file).await?;\n        if let Some(expected_sha256) = expected_sha256\n            && expected_sha256 != actual_sha256\n        {\n            let msg = format!(\n                \"Sha256 mismatch. Expected: {} Actual: {}\",\n                expected_sha256.as_base64(),\n                actual_sha256.as_base64()\n            );\n\n            anyhow::bail!(ErrorMetadata::bad_request(\"Sha256Mismatch\", msg));\n        }\n\n        // Key in underlying storage is a different UUID from the one we hand out.\n        let storage_key = upload.complete().await?;\n\n        let elapsed = timer.finish();\n        tracing::info!(\n            \"Wrote file {size} to {storage_key:?}. Total:{elapsed:?} ContentType:{content_type:?}\",\n        );\n\n        let entry = FileStorageEntry {\n            storage_id,\n            storage_key,\n            sha256: actual_sha256,\n            size: size.try_into()?,\n            content_type: content_type.map(|ct| ct.to_string()),\n        };\n\n// …\n    pub async fn store_entry(\n        &self,\n        namespace: TableNamespace,\n        entry: FileStorageEntry,\n        usage_tracker: &dyn StorageUsageTracker,\n    ) -> anyhow::Result<DeveloperDocumentId> {\n        let size = entry.size;\n        let content_type = entry\n            .content_type\n            .as_ref()\n            .map(|ct| ct.parse())\n            .transpose()?;\n\n        // Start/Complete transaction after the slow upload process\n        // to avoid OCC risk.\n        let mut tx = self.database.begin(Identity::system()).await?;\n        let (_, virtual_id) = self\n            .transactional_file_storage\n            .store_file_entry(&mut tx, namespace, entry)\n            .await?;\n        let component_path = tx.must_component_path(ComponentId::from(namespace))?;\n        self.database"
  },
  "node.executor": {
    "id": "node.executor",
    "title": "NodeExecutor: \"use node\" actions",
    "repo": "convex-backend",
    "path": "crates/node_executor/src/executor.rs",
    "startLine": 148,
    "endLine": 266,
    "symbol": "NodeActions::execute",
    "lang": "rust",
    "summary": "Node actions are sent to a separate executor (AWS Lambda in the cloud, a local Node process self-hosted) and called back over HTTP.",
    "explain": "This is the other runtime. It is not a V8 isolate in the backend; it is a request to an external Node environment, which calls back to the backend (backend_address) for ctx.runQuery and ctx.runMutation.",
    "notes": [
      {
        "line": 150,
        "text": "Implemented by Lambda (cloud) or a local Node process."
      },
      {
        "line": 160,
        "text": "Lambda request id in the cloud."
      },
      {
        "line": 253,
        "text": "Node calls back into the backend for runQuery and runMutation."
      }
    ],
    "code": "pub trait NodeExecutor: Sync + Send {\n    fn enable(&self) -> anyhow::Result<()>;\n    async fn invoke(\n        &self,\n        request: ExecutorRequest,\n        log_line_sender: mpsc::UnboundedSender<LogLine>,\n    ) -> anyhow::Result<InvokeResponse>;\n    fn shutdown(&self);\n}\n\npub struct InvokeResponse {\n    pub response: JsonValue,\n    pub aws_request_id: Option<String>,\n}\n// …\n    pub async fn execute(\n        &self,\n        request: ExecuteRequest,\n        log_line_sender: mpsc::UnboundedSender<LogLine>,\n        source_maps_callback: impl Future<Output = anyhow::Result<\n            BTreeMap<CanonicalizedModulePath, SourceMap>>>\n            + Send,\n    ) -> anyhow::Result<NodeActionOutcome> {\n        let path = request.path_and_args.path().clone();\n        let timer = node_executor(\"execute\");\n        let request = ExecutorRequest::Execute {\n            request,\n            backend_address: self.convex_origin.clone(),\n            // Use the user facing timeout here, which should be less than the\n            // total Node timeout. This allows us to preempt early and give\n            // better error message and logs in the common case.\n            timeout: self.user_timeout,\n            deployment: self.deployment.clone(),\n        };\n        let InvokeResponse {\n            response,\n            aws_request_id,\n        } = self.executor.invoke(request, log_line_sender).await?;\n        let execute_result = ExecuteResponse::try_from(response.clone()).with_context(|| {\n            format!(\"Failed to deserialize execute (aws_request_id: {aws_request_id:?}) Response: {response}\")\n        })?;"
  },
  "http.actions": {
    "id": "http.actions",
    "title": "HTTP actions: /http/* routes",
    "repo": "convex-backend",
    "path": "crates/local_backend/src/http_actions.rs",
    "startLine": 157,
    "endLine": 180,
    "symbol": "http_any_method",
    "lang": "rust",
    "summary": "Any request under /http/ is turned into an HTTP action invocation and its response is streamed back.",
    "explain": "Auth is optional here: a Convex auth token in Authorization is used if present, otherwise the request runs with an unknown identity and your code checks auth itself.",
    "notes": [
      {
        "line": 159,
        "text": "Convex auth if the header has a valid token."
      },
      {
        "line": 169,
        "text": "Otherwise no identity; your code decides."
      },
      {
        "line": 171,
        "text": "The response is streamed."
      }
    ],
    "code": "pub async fn http_any_method(\n    State(st): State<RouterState>,\n    TryExtractIdentity(identity_result): TryExtractIdentity,\n    ExtractRequestId(request_id): ExtractRequestId,\n    ExtractRequestMetadata(request_metadata): ExtractRequestMetadata,\n    ExtractResolvedHostname(host): ExtractResolvedHostname,\n    ExtractHttpRequestMetadata(http_request_metadata): ExtractHttpRequestMetadata,\n) -> Result<impl IntoResponse, HttpResponseError> {\n    // The `Authorization` header for the request may contain a token corresponding\n    // to Convex auth, or it could be something separate managed by the developer.\n    // Try to extract the identity based on the Convex auth, but allow the request\n    // to go through if the header does not seem to specify Convex auth.\n    let identity = identity_result.unwrap_or_else(|e| Identity::Unknown(e.downcast().ok()));\n\n    let mut http_response_stream = stream_http_response(\n        host,\n        RequestContext::new(request_id, request_metadata),\n        http_request_metadata,\n        identity,\n        st.api.clone(),\n    );\n    let head = http_response_stream.try_next().await?;\n    let Some(HttpActionResponsePart::Head(response_head)) = head else {\n        return Err(anyhow::anyhow!(\"Did not receive HTTP response head first\").into());"
  },
  "local_backend.router": {
    "id": "local_backend.router",
    "title": "Backend HTTP router",
    "repo": "convex-backend",
    "path": "crates/local_backend/src/router.rs",
    "startLine": 398,
    "endLine": 421,
    "symbol": "router",
    "lang": "rust",
    "summary": "Mounts /api/sync (WebSocket), /api/storage and /http/ routes on the self-hosted backend.",
    "explain": "One Rust process serves the sync WebSocket, the HTTP API, storage and your HTTP actions.",
    "notes": [
      {
        "line": 402,
        "text": "The WebSocket endpoint the client connects to."
      },
      {
        "line": 410,
        "text": "File upload and download."
      },
      {
        "line": 417,
        "text": "Your http.ts routes."
      }
    ],
    "code": "\n    let migrated_api_routes = Router::new()\n        .merge(browser_routes)\n        .merge(public_routes)\n        .route(\"/sync\", get(sync))\n        .route(\n            \"/public_openapi.json\",\n            axum::routing::get({\n                let spec = public_openapi_spec.clone();\n                move || async move { spec }\n            }),\n        )\n        .nest(\"/storage\", storage_api_routes());\n    let migrated = Router::new()\n        .nest(\"/api\", migrated_api_routes)\n        .layer(cors())\n        // Order matters. Layers only apply to routes above them.\n        // Notably, any layers added here won't apply to common routes\n        // added inside `serve_http`\n        .nest(\"/http/\", http_action_routes())\n        .with_state(RouterState {\n            api: Arc::new(st.application.clone()),\n            runtime: st.application.runtime(),\n            subscription_reconnect_rate_limiter: None,"
  },
};
