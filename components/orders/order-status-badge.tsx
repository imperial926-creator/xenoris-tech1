import { cn } from '@/lib/utils/cn';

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-warning/15 text-warning border-warning/30',
  CONFIRMED: 'bg-accent text-accent-foreground border-border',
  PREPARING: 'bg-accent text-accent-foreground border-border',
  READY: 'bg-success/15 text-success border-success/30',
  COMPLETED: 'bg-muted text-muted-foreground border-border',
  CANCELLED: 'bg-muted text-muted-foreground border-border line-through',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground border-border',
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
