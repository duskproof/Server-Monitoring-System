'use client';

import { Plug, ScrollText, UserCog, Users, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';

import { GroupsTab } from '@/components/settings/GroupsTab';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';
import { ProfileTab } from '@/components/settings/ProfileTab';
import { AuditTab } from '@/components/settings/AuditTab';
import { UsersTab } from '@/components/settings/UsersTab';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useAuthStore } from '@/store/auth';

type SettingsTab = 'profile' | 'users' | 'groups' | 'integrations' | 'audit';

export function SettingsView() {
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === 'admin';

  const items = useMemo<TabItem<SettingsTab>[]>(() => {
    const tabs: TabItem<SettingsTab>[] = [
      { key: 'profile', label: 'Profile', icon: <UserCog className="h-4 w-4" /> },
      { key: 'groups', label: 'Groups', icon: <Layers className="h-4 w-4" /> },
      { key: 'integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
    ];
    if (isAdmin) {
      tabs.splice(1, 0, { key: 'users', label: 'Users', icon: <Users className="h-4 w-4" /> });
      tabs.push({ key: 'audit', label: 'Audit log', icon: <ScrollText className="h-4 w-4" /> });
    }
    return tabs;
  }, [isAdmin]);

  const [tab, setTab] = useState<SettingsTab>('profile');
  const active = items.some((item) => item.key === tab) ? tab : 'profile';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-content">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Manage your account, groups, integrations and, if you are an admin, users in this workspace.
        </p>
      </div>

      <Tabs items={items} value={active} onChange={setTab} />

      {active === 'profile' ? <ProfileTab /> : null}
      {active === 'users' && isAdmin ? <UsersTab /> : null}
      {active === 'groups' ? <GroupsTab /> : null}
      {active === 'integrations' ? <IntegrationsTab /> : null}
      {active === 'audit' && isAdmin ? <AuditTab /> : null}
    </div>
  );
}
