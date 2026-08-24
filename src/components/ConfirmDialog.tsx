/**
 * Replaces window.confirm() across the app. The native dialog can't be
 * styled at all — it renders as a bare OS popup that clashes with every
 * themed surface around it. This reuses the same receipt-card / bottom-sheet
 * pattern as the other modals in GroupDashboard (see the fresh-round-picker
 * and contribution-start modals) so a delete confirmation looks like part
 * of the app instead of a browser chrome interruption.
 *
 * Usage: keep a single `{ title, message, confirmLabel?, tone?, onConfirm }
 * | null` bit of state in the parent, open it instead of calling
 * window.confirm, and render <ConfirmDialog {...state} onCancel={...} />
 * once near the bottom of the tree.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  tone = 'danger',
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center z-30 p-0 sm:p-4">
      <div className="bg-paper w-full sm:max-w-sm sm:rounded-lg rounded-t-2xl overflow-y-auto">
        <div className="p-5 border-b border-rule">
          <h2 className="font-mono font-semibold">{title}</h2>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-sm text-ink-soft">{message}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={tone === 'danger' ? 'btn-danger flex-1' : 'btn-primary flex-1'}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
