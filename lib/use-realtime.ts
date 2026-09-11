'use client';

import { useEffect, useRef, useState } from 'react';
import type { TimetableData } from './timetable-data';
import type { StreamEvent } from './realtime';
import { applyChange } from './merge';

export type ConnectionState = 'connecting' | 'live' | 'polling' | 'offline';

/**
 * Subscribes to /api/stream and folds each change into local state (§23).
 *
 * Applies the document the server sent rather than recomputing anything, so
 * every browser converges on server truth instead of on its own arithmetic.
 *
 * Reconnection is EventSource's job — it replays `Last-Event-ID`, which carries
 * the change-stream resume token, so a recycled connection picks up exactly
 * where it left off. What this adds is the give-up path: after two failed
 * attempts it degrades to conditional polling and says so, because a realtime
 * feature that silently stops updating is worse than one that admits it (§43).
 */
export function useRealtime({
  selfId,
  onEvent,
  onRemoteEdit,
  onResync,
  enabled = true,
}: {
  /** This browser's user id, so our own echoes are not announced back to us. */
  selfId: string;
  onEvent: (apply: (d: TimetableData) => TimetableData) => void;
  onRemoteEdit: (who: string) => void;
  onResync: () => void;
  enabled?: boolean;
}): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  // Refs so reconnecting never re-runs the effect and tears down the stream.
  const onEventRef = useRef(onEvent);
  const onRemoteEditRef = useRef(onRemoteEdit);
  const onResyncRef = useRef(onResync);
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;
  onEventRef.current = onEvent;
  onRemoteEditRef.current = onRemoteEdit;
  onResyncRef.current = onResync;

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let disposed = false;

    function startPolling() {
      if (pollTimer || disposed) return;
      setState('polling');
      // The fallback, NOT the design (§23). Conditional so an unchanged
      // timetable costs a 304 rather than the whole payload.
      pollTimer = setInterval(() => onResyncRef.current(), 15_000);
    }

    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    function connect() {
      if (disposed) return;
      setState((s) => (s === 'live' ? s : 'connecting'));
      source = new EventSource('/api/stream');

      source.onopen = () => {
        failures = 0;
        stopPolling();
        setState('live');
      };

      source.onmessage = (msg) => {
        let event: StreamEvent;
        try {
          event = JSON.parse(msg.data) as StreamEvent;
        } catch {
          return;
        }

        if (event.kind === 'hello') {
          setState('live');
          return;
        }

        if (event.kind === 'cycle') {
          // A deliberate close. Reconnect at once instead of waiting out the
          // backoff; EventSource replays Last-Event-ID for us.
          source?.close();
          setTimeout(connect, 50);
          return;
        }

        onEventRef.current((d) => applyChange(d, event));

        // Announce only OTHER people's edits. Our own change comes back on the
        // stream too — applying it is how we converge on server truth — but
        // being told "you just made a change" after every edit is noise.
        if (event.op === 'upsert' && event.by?.name && event.by.id !== selfIdRef.current) {
          onRemoteEditRef.current(event.by.name);
        }
      };

      source.onerror = () => {
        source?.close();
        if (disposed) return;
        failures += 1;
        if (failures >= 2) {
          // Two strikes: stop pretending and fall back visibly.
          startPolling();
          onResyncRef.current();
        } else {
          setState('connecting');
        }
        // Keep trying even while polling, so a recovered network upgrades back.
        setTimeout(connect, Math.min(2000 * failures, 15_000));
      };
    }

    connect();

    return () => {
      disposed = true;
      stopPolling();
      source?.close();
    };
  }, [enabled]);

  return state;
}
