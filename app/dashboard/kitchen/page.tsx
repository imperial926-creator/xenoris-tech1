import { PhasePlaceholder } from '@/components/dashboard/phase-placeholder';

export default function KitchenPage() {
  return (
    <PhasePlaceholder
      title="Kitchen Display System"
      phase={5}
      description="Real-time order queue for kitchen staff: new → accepted → preparing → ready."
    />
  );
}
