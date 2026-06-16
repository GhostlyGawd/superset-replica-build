import type { Notification as NotificationRow } from "@swarm/db";
import { Badge, Button, EmptyState, Spinner, useToast } from "@swarm/ui/react";
import { Bell, BellOff, BellRing, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { HostTrpcClient } from "./host-client.ts";
import { currentPermission, enablePush, isPushSupported } from "./push.ts";

interface NotificationsCardProps {
  readonly client: HostTrpcClient;
}

type OptInState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "on" }
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * The push opt-in + in-app inbox shown in Settings (ADR-0014). "Enable notifications"
 * is a real user gesture → permission request → `pushManager.subscribe` against the
 * host VAPID key → `notifications.subscribePush`. The list reads `notifications.list`
 * and flips rows read via `markRead`. States are honest: a blocked permission or an
 * unsupported origin says so rather than pretending push is on.
 */
export function NotificationsCard({ client }: NotificationsCardProps) {
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [optIn, setOptIn] = useState<OptInState>({ kind: "idle" });
  const [items, setItems] = useState<readonly NotificationRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const { toast } = useToast();

  const refreshList = useCallback(async () => {
    try {
      const list = await client.notifications.list.query({});
      setItems(list);
    } catch {
      // Leave the prior list in place on a transient read failure.
    } finally {
      setLoadingList(false);
    }
  }, [client]);

  // On mount: fetch the VAPID key, reflect any existing subscription, load the inbox.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { key } = await client.notifications.vapidPublicKey.query();
        if (!cancelled) {
          setVapidKey(key);
        }
      } catch {
        // Without a key, the opt-in stays disabled below.
      }
      if (isPushSupported() && currentPermission() === "granted") {
        try {
          const registration = await navigator.serviceWorker.ready;
          const existing = await registration.pushManager.getSubscription();
          if (!cancelled && existing) {
            setOptIn({ kind: "on" });
          }
        } catch {
          // Ignore — the user can still re-enable.
        }
      }
      await refreshList();
    })();
    return () => {
      cancelled = true;
    };
  }, [client, refreshList]);

  const onEnable = useCallback(async () => {
    if (!vapidKey) {
      setOptIn({ kind: "error", message: "The host did not provide a push key." });
      return;
    }
    setOptIn({ kind: "busy" });
    const result = await enablePush(client, vapidKey);
    if (result.ok) {
      setOptIn({ kind: "on" });
      toast({ tone: "success", title: "Notifications on" });
      return;
    }
    setOptIn(
      result.reason === "denied"
        ? { kind: "blocked", message: result.message }
        : { kind: "error", message: result.message },
    );
  }, [client, vapidKey, toast]);

  const onMarkRead = useCallback(
    async (id: string) => {
      try {
        await client.notifications.markRead.mutate({ id });
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      } catch {
        toast({ tone: "error", title: "Couldn't mark as read" });
      }
    },
    [client, toast],
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-fg">
          <Bell className="size-4 text-fg-muted" aria-hidden />
          Push notifications
        </span>
        {optIn.kind === "on" ? (
          <Badge tone="running" dot>
            On
          </Badge>
        ) : (
          <Badge tone="idle" dot>
            Off
          </Badge>
        )}
      </div>

      {optIn.kind === "on" ? (
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <BellRing className="mt-0.5 size-3.5 shrink-0 text-success-fg" aria-hidden />
          <span>This phone gets a push when a worktree needs your attention.</span>
        </p>
      ) : (
        <>
          <p className="text-xs text-fg-muted">
            Get a push the moment a worktree needs you — even when Grove is closed.
          </p>
          <Button
            variant="primary"
            icon={<Bell className="size-4" />}
            loading={optIn.kind === "busy"}
            disabled={!vapidKey || optIn.kind === "busy"}
            onClick={onEnable}
          >
            Enable notifications
          </Button>
          {optIn.kind === "blocked" ? (
            <p className="flex items-start gap-2 text-2xs text-attention-fg">
              <BellOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{optIn.message}</span>
            </p>
          ) : null}
          {optIn.kind === "error" ? (
            <p className="text-2xs text-fg-subtle">{optIn.message}</p>
          ) : null}
        </>
      )}

      <div className="mt-1 flex flex-col gap-2 border-line border-t pt-3">
        <span className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">Inbox</span>
        {loadingList ? (
          <div className="flex justify-center py-3">
            <Spinner size="sm" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="No notifications yet"
            description="Attention alerts from your worktrees land here."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className={
                  item.read
                    ? "flex items-start justify-between gap-3 rounded-lg border border-line bg-inset p-3"
                    : "flex items-start justify-between gap-3 rounded-lg border border-line-strong bg-raised p-3"
                }
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-fg">{item.title}</span>
                  {item.body ? (
                    <span className="truncate text-xs text-fg-muted">{item.body}</span>
                  ) : null}
                  <span className="text-2xs text-fg-subtle">{relativeTime(item.createdAt)}</span>
                </div>
                {item.read ? (
                  <span className="flex items-center gap-1 text-2xs text-fg-subtle">
                    <Check className="size-3.5" aria-hidden />
                    Read
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void onMarkRead(item.id)}>
                    Mark read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
