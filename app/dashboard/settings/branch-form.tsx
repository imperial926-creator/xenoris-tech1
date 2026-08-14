'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BranchForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create branch.');
        return;
      }
      setName('');
      setAddress('');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="branchName">Branch name</Label>
        <Input id="branchName" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex-1 space-y-2">
        <Label htmlFor="branchAddress">Address (optional)</Label>
        <Input id="branchAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? 'Adding…' : 'Add branch'}
      </Button>
      {error && <p className="text-sm text-destructive sm:ml-2">{error}</p>}
    </form>
  );
}
