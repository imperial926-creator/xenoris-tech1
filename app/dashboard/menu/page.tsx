import { MenuManager } from './menu-manager';

export default function MenuPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Menu</h1>
        <p className="text-sm text-muted-foreground">
          Categories, items, and modifier groups — shared across all branches in this
          organization. Per-branch availability overrides are a candidate for a later phase.
        </p>
      </div>
      <MenuManager />
    </div>
  );
}
