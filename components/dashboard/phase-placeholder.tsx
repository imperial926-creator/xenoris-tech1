import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Explicit "not built yet" placeholder — per CLAUDE.md rule #73 (do not fake
 * features), any module without real UI/API/DB/business logic behind it says
 * so plainly instead of showing fabricated data.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Coming in Phase {phase}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This module has not been implemented yet. Nothing on this page is real data — see{' '}
            <code className="text-xs">docs/architecture.md</code> for the implementation phase
            order.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
