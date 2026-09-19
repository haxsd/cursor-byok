//! Verifies that Cursor trace persistence is ordered and detached from producers.

#[path = "support/fixtures.rs"]
mod fixtures;

use std::time::{Duration, Instant};

use bytes::Bytes;
use cursor_server::{cursor::services::observability::CursorTraceService, store::Store};
use sqlx::{Connection, SqliteConnection};

#[tokio::test]
async fn trace_producers_do_not_wait_for_sqlite_and_artifacts_stay_ordered() {
    let directory = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", directory.path().join("test.db").display());
    let store = Store::connect(&url).await.unwrap();
    store.set_detailed_logging(true).await.unwrap();
    let traces = CursorTraceService::new(store.clone());
    let recorder = traces.recorder("trace-queue-order");
    recorder.begin(Some("conversation-1"), "local_byok", Some("model-1"));

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if store
                .cursor_trace("trace-queue-order")
                .await
                .unwrap()
                .is_some()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    let mut write_lock = SqliteConnection::connect(&url).await.unwrap();
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut write_lock)
        .await
        .unwrap();
    recorder.request(
        "bidi_request",
        Bytes::from_static(b"request-0"),
        serde_json::json!({
            "append_seqno": 0,
            "accepted": true,
            "route_outcome": "local"
        }),
    );
    tokio::time::sleep(Duration::from_millis(25)).await;

    let started = Instant::now();
    let mut seqnos = (1..64).collect::<Vec<_>>();
    for pair in seqnos.chunks_mut(2) {
        pair.reverse();
    }
    for seqno in seqnos {
        recorder.request(
            "bidi_request",
            Bytes::from(format!("request-{seqno}")),
            serde_json::json!({
                "append_seqno": seqno,
                "accepted": true,
                "route_outcome": "local"
            }),
        );
    }
    recorder.finish(None);
    assert!(started.elapsed() < Duration::from_millis(100));
    sqlx::query("ROLLBACK")
        .execute(&mut write_lock)
        .await
        .unwrap();

    let artifacts = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let artifacts = store
                .cursor_trace_artifacts("trace-queue-order")
                .await
                .unwrap();
            if artifacts.len() == 64 {
                break artifacts;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    for (expected, artifact) in artifacts.iter().enumerate() {
        assert_eq!(artifact.seq, expected as i64);
        assert_eq!(artifact.metadata["append_seqno"], expected as i64);
    }
    let trace = store
        .cursor_trace("trace-queue-order")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(trace.status, "completed");
    assert_eq!(
        trace.request_bytes,
        (0..64)
            .map(|seqno| format!("request-{seqno}").len() as i64)
            .sum::<i64>()
    );
}

#[tokio::test]
async fn disabled_detailed_logging_discards_large_trace_artifacts() {
    let (_directory, store) = fixtures::temp_store().await;
    let traces = CursorTraceService::new(store.clone());
    let recorder = traces.recorder("trace-disabled");

    recorder.begin(None, "local_byok", Some("model-1"));
    recorder.request(
        "bidi_request",
        Bytes::from_static(b"body"),
        serde_json::json!({"append_seqno": 0}),
    );

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if store
                .cursor_trace("trace-disabled")
                .await
                .unwrap()
                .is_some()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(store
        .cursor_trace_artifacts("trace-disabled")
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn disabled_detailed_logging_keeps_error_summary_without_artifacts() {
    let (_directory, store) = fixtures::temp_store().await;
    let traces = CursorTraceService::new(store.clone());
    let recorder = traces.recorder("trace-summary");

    recorder.begin(None, "local_byok", Some("deepseek"));
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if store.cursor_trace("trace-summary").await.unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    recorder.response_started(502);
    recorder.finish(Some("connection reset by peer"));

    let trace = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Some(trace) = store.cursor_trace("trace-summary").await.unwrap() {
                if trace.status == "error" {
                    break trace;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    assert_eq!(
        trace.error_message.as_deref(),
        Some("connection reset by peer")
    );
    assert!(store
        .cursor_trace_artifacts("trace-summary")
        .await
        .unwrap()
        .is_empty());
    let diagnostics = store.diagnostics(10).await.unwrap();
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].category, "network");
}
