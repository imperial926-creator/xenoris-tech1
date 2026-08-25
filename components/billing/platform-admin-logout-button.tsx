'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function PlatformAdminLogoutButton() {
  const router = useRouter();
  async function onLogout() {
    await fetch('/api/platform-admin/logout', { method: 'POST' });
    router.push('/platform-admin/login');
    router.refresh();
  }
  return (
    <Button variant="outline" size="sm" onClick={onLogout}>
      Sign out
    </Button>
  );
}
