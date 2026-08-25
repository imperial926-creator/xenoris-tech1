import { cn } from '@/lib/utils/cn';

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: 'bg-success/15 text-success border-success/30',
  RESERVED: 'bg-warning/15 text-warning border-warning/30',
  OCCUPIED: 'bg-destructive/10 text-destructive border-destructive/30',
  WAITING: 'bg-accent text-accent-foreground border-border',
  CLEANING: 'bg-muted text-muted-foreground border-border',
  OUT_OF_SERVICE: 'bg-muted text-muted-foreground border-border line-through',
};

export function TableStatusBadge({ status }: { status: string }) {
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
