"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

const WARMUP_RESYNC_MS = 3000;

type Options<Row extends Record<string, unknown>> = {
  /** Unique per subscription; used as the channel topic. */
  channel: string;
  table: "agent_run_events" | "documents";
  /** Postgres Changes filter, e.g. `run_id=eq.<uuid>`. Always scope subscriptions as narrowly as possible. */
  filter: string;
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  enabled?: boolean;
  onChange: (payload: RealtimePostgresChangesPayload<Row>) => void;
  /**
   * Called whenever the channel becomes live: on first subscribe and after
   * every reconnect. Consumers refetch here so events missed while
   * disconnected are not lost.
   */
  onResync?: () => void;
};

/**
 * Subscribes to Supabase Realtime Postgres Changes with the signed-in user's
 * token, so the server applies the table's RLS SELECT policy to every change.
 * supabase-js rejoins dropped channels with backoff; this hook reports the
 * connection state and removes the channel on unmount.
 */
export function useRealtimeTable<Row extends Record<string, unknown>>({
  channel, table, filter, event = "*", enabled = true, onChange, onResync,
}: Options<Row>): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  // Keep the latest callbacks without resubscribing on every render.
  const onChangeRef = useRef(onChange);
  const onResyncRef = useRef(onResync);
  useEffect(() => {
    onChangeRef.current = onChange;
    onResyncRef.current = onResync;
  });

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    if (!supabase) return;
    let cancelled = false;
    let subscription: RealtimeChannel | null = null;
    let warmupTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      // Authenticate the socket before joining so RLS evaluates as this user, not anon.
      const { data } = await supabase.auth.getSession();
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      subscription = supabase
        .channel(channel)
        .on("postgres_changes", { event, schema: "public", table, filter }, (payload: RealtimePostgresChangesPayload<Row>) => onChangeRef.current(payload))
        .subscribe((state) => {
          if (cancelled) return;
          if (state === "SUBSCRIBED") {
            setStatus("live");
            onResyncRef.current?.();
            // Postgres Changes can take a few seconds to start delivering after SUBSCRIBED
            // (verified against local Supabase). Resync once more after that window.
            if (warmupTimer) clearTimeout(warmupTimer);
            warmupTimer = setTimeout(() => { if (!cancelled) onResyncRef.current?.(); }, WARMUP_RESYNC_MS);
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
            setStatus("reconnecting");
          } else if (state === "CLOSED") {
            setStatus("offline");
          }
        });
    })();

    const onOnline = () => setStatus((current) => (current === "live" ? current : "reconnecting"));
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      cancelled = true;
      if (warmupTimer) clearTimeout(warmupTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (subscription) void supabase.removeChannel(subscription);
    };
  }, [channel, table, filter, event, enabled]);

  return enabled ? status : "offline";
}
