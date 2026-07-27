import { FormEvent } from 'react';
import type { AdminPartner, PartnerRequest } from '@/types';

/**
 * Admin partners are a standing pairing between two accounts — like a
 * joint bank account alongside each person's individual one. Once
 * accepted, either person can pick the other as a co-admin when
 * creating a NEW group (see the "Create as" chips in the create-group
 * form on Groups.tsx); it never touches groups that already exist,
 * and it's opt-in per group rather than automatic, so someone can
 * keep creating solo groups even after pairing up.
 *
 * Purely presentational: Groups.tsx owns the data (it needs the same
 * partner list for the create-group picker) and passes everything in,
 * the same way GroupDashboard hands settlements down to
 * SettlementSummary rather than each component fetching its own copy.
 */
export function AdminPartnersPanel({
  partners,
  requests,
  busyId,
  error,
  inviteUsername,
  onInviteUsernameChange,
  inviteBusy,
  onInvite,
  onDecide,
  onCancel,
  onEnd,
    inviteLinkUrl,
    inviteLinkBusy,
    inviteLinkCopied,
    onCopyInviteLink,
    onRegenerateInviteLink
}: {
  partners: AdminPartner[];
  requests: PartnerRequest[];
  busyId: string | null;
  error: string | null;
  inviteUsername: string;
  onInviteUsernameChange: (value: string) => void;
  inviteBusy: boolean;
  onInvite: (e: FormEvent) => void;
  onDecide: (id: string, approve: boolean) => void;
  onCancel: (id: string) => void;
  onEnd: (id: string) => void;
    inviteLinkUrl: string | null;
    inviteLinkBusy: boolean;
    inviteLinkCopied: boolean;
    onCopyInviteLink: () => void;
    onRegenerateInviteLink: () => void;
}) {
  const incoming = requests.filter((r) => r.direction === 'incoming');
  const outgoing = requests.filter((r) => r.direction === 'outgoing');

  return (
    <div className="receipt-card p-4 mb-4 space-y-4">
      <div>
        <p className="label-eyebrow mb-1">Admin partners</p>
        <p className="text-xs text-ink-faint">
          Pair up with someone to jointly run groups you create together, like a joint account alongside
          your own. Pairing doesn't change any group you've already made — you choose per group, when
          creating it.
        </p>
      </div>

      <form onSubmit={onInvite} className="flex items-center gap-2">
        <input
          value={inviteUsername}
          onChange={(e) => onInviteUsernameChange(e.target.value)}
          className="input-field flex-1"
          placeholder="Their username"
        />
        <button type="submit" disabled={inviteBusy || !inviteUsername.trim()} className="btn-primary shrink-0">
          {inviteBusy ? '…' : 'Invite'}
        </button>
      </form>

      {error ? <p className="text-brick text-xs">{error}</p> : null}

      <div className="pt-3 border-t border-dashed border-rule">
        <p className="text-[11px] text-ink-faint mb-2">Or share an invite link</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCopyInviteLink}
            disabled={inviteLinkBusy}
            className="btn-secondary flex-1 text-xs"
          >
            {inviteLinkBusy ? '…' : inviteLinkCopied ? 'Copied!' : 'Copy invite link'}
          </button>
          <button
            type="button"
            onClick={onRegenerateInviteLink}
            disabled={inviteLinkBusy}
            title="Invalidate the old link and generate a new one"
            className="text-xs text-ink-faint hover:text-ink transition-colors shrink-0"
          >
            Regenerate
          </button>
        </div>
        <p className="text-[11px] text-ink-faint mt-1">
          Anyone with this link can partner with you — regenerating invalidates the old one.
        </p>
      </div>
{incoming.length > 0 ? (
        <div>
          <p className="text-[11px] text-ink-faint mb-2">Waiting on your answer</p>
          <ul className="space-y-2">
            {incoming.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5">
                <span className="avatar-circle text-xs" aria-hidden>
                  {r.other_username.charAt(0).toUpperCase()}
                </span>
                <p className="flex-1 min-w-0 text-sm text-ink truncate">@{r.other_username} wants to partner up</p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onDecide(r.id, false)}
                    disabled={busyId === r.id}
                    className="btn-secondary text-xs px-2.5 py-1.5"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => onDecide(r.id, true)}
                    disabled={busyId === r.id}
                    className="btn-primary text-xs px-2.5 py-1.5"
                  >
                    {busyId === r.id ? '…' : 'Accept'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {outgoing.length > 0 ? (
        <div>
          <p className="text-[11px] text-ink-faint mb-2">Sent, not yet accepted</p>
          <ul className="space-y-2">
            {outgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5">
                <span className="avatar-circle text-xs opacity-60" aria-hidden>
                  {r.other_username.charAt(0).toUpperCase()}
                </span>
                <p className="flex-1 min-w-0 text-sm text-ink-soft truncate">@{r.other_username}</p>
                <button
                  onClick={() => onCancel(r.id)}
                  disabled={busyId === r.id}
                  className="btn-secondary text-xs px-2.5 py-1.5 shrink-0"
                >
                  {busyId === r.id ? '…' : 'Cancel'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-[11px] text-ink-faint mb-2">Your partners</p>
        {partners.length === 0 ? (
          <p className="text-sm text-ink-soft">No admin partners yet.</p>
        ) : (
          <ul className="space-y-2">
            {partners.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <span className="avatar-circle text-xs" aria-hidden>
                  {p.partner_username.charAt(0).toUpperCase()}
                </span>
                <p className="flex-1 min-w-0 text-sm text-ink truncate">@{p.partner_username}</p>
                <button
                  onClick={() => onEnd(p.id)}
                  disabled={busyId === p.id}
                  className="text-xs text-brick/70 hover:text-brick transition-colors shrink-0"
                >
                  {busyId === p.id ? '…' : 'End partnership'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
