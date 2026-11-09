"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useRealtimeTable } from "@/hooks/use-realtime";
import { LiveIndicator } from "./live-indicator";

const DEBOUNCE_MS = 1500;
const FALLBACK_REFRESH_MS = 30_000;

/**
 * Re-renders the current server page when run events arrive for the
 * organization (debounced so bursts of events cause one refresh). Falls back to
 * a slow periodic refresh while the realtime connection is down.
 */
export function LiveRefresh({ organizationId, workspaceId }: { organizationId: string; workspaceId?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
  };
  const status = useRealtimeTable({
    channel: `live-refresh:${workspaceId ?? organizationId}`,
    table: "agent_run_events",
    event: "INSERT",
    filter: workspaceId ? `workspace_id=eq.${workspaceId}` : `organization_id=eq.${organizationId}`,
    onChange: schedule,
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (status === "live" || status === "connecting") return;
    const interval = setInterval(() => router.refresh(), FALLBACK_REFRESH_MS);
    return () => clearInterval(interval);
  }, [status, router]);

  return <LiveIndicator status={status} />;
}
