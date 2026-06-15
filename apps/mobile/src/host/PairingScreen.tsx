import { Badge, Button, Input } from "@swarm/ui/react";
import { Link2, ShieldCheck } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { GroveMark } from "../shell/GroveMark.tsx";
import { codeFromUrl, sanitizeCode } from "./pair-code.ts";
import { PAIRING_CODE_MIN_LENGTH } from "./pairing.ts";
import type { PairOutcome } from "./useHost.ts";

interface PairingScreenProps {
  /** Redeem a code → persist the bearer → go live. */
  readonly pair: (code: string) => Promise<PairOutcome>;
  /** A connection notice when a previously-paired host could not be reached. */
  readonly notice?: string | null;
  /** Retry the connection to a stored-but-unreachable host. */
  readonly onRetry?: () => void;
  /** Forget a stored-but-unreachable host (shown alongside the notice). */
  readonly onForget?: () => void;
}

/**
 * The pairing screen (ADR-0014). The operator runs `grove pair` on the host, which
 * prints a QR + an 8-char single-use code. Scanning the QR opens this page with
 * `?code=` pre-filled; otherwise the code is typed. Redeeming it exchanges the code
 * — never the bearer, which only arrives in the redeem RESPONSE — for the live
 * connection, stored in IndexedDB.
 */
export function PairingScreen({ pair, notice, onRetry, onForget }: PairingScreenProps) {
  const [code, setCode] = useState(() => codeFromUrl(window.location.href));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const helpId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = sanitizeCode(code);
    if (clean.length < PAIRING_CODE_MIN_LENGTH) {
      setFormError(`Enter the ${PAIRING_CODE_MIN_LENGTH}-character code shown by \`grove pair\`.`);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const outcome = await pair(clean);
    if (!outcome.ok) {
      setFormError(outcome.error);
      setSubmitting(false);
    }
    // On success the host state advances to connecting/connected and this unmounts.
  }

  return (
    <div className="grid min-h-0 place-items-center overflow-auto p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-line bg-surface p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <GroveMark className="size-10 text-accent-fg" />
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-fg">Pair this phone</h2>
            <p className="text-sm text-fg-muted">
              Run <code className="font-mono text-fg">grove pair</code> on your Grove host, then
              enter the code below — or scan its QR to fill this in automatically.
            </p>
          </div>
          <Badge tone="idle" dot>
            Not paired
          </Badge>
        </div>

        {notice ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-inset p-3">
            <p className="text-xs text-fg-muted">{notice}</p>
            <div className="flex items-center gap-3">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-2xs font-medium text-accent-fg underline-offset-2 hover:underline"
                >
                  Try again
                </button>
              ) : null}
              {onForget ? (
                <button
                  type="button"
                  onClick={onForget}
                  className="text-2xs font-medium text-fg-subtle underline-offset-2 hover:underline"
                >
                  Forget this host
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Input
            label="Pairing code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            error={formError ?? undefined}
            hint="8 characters, single-use, expires in a couple of minutes."
            leadingIcon={<Link2 className="size-4" />}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={16}
            className="font-mono uppercase tracking-widest"
          />
          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            Link this phone
          </Button>
        </form>

        <p id={helpId} className="flex items-start gap-2 text-2xs text-fg-subtle">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success-fg" />
          <span>
            Your phone never sees the host's secret token until this one-time code is redeemed. The
            token is stored only on this device.
          </span>
        </p>
      </div>
    </div>
  );
}
