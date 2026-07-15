import type { ReactNode } from 'react';
import { GearIcon, StackIcon } from '../components/icons';
import { useAppStore, type ActiveSection } from '../store/appStore';

type RailItem = {
  section: ActiveSection;
  label: string;
  icon: ReactNode;
};

const TOP_ITEMS: RailItem[] = [
  { section: 'projects', label: 'Projects', icon: <StackIcon size={20} /> },
];
const BOTTOM_ITEMS: RailItem[] = [
  { section: 'settings', label: 'Settings', icon: <GearIcon size={20} /> },
];

export function ActivityRail() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setSection = useAppStore((s) => s.setSection);

  const renderItem = (item: RailItem) => (
    <button
      key={item.section}
      type="button"
      className={['rail-button', activeSection === item.section ? 'active' : ''].join(' ')}
      aria-label={item.label}
      title={item.label}
      aria-pressed={activeSection === item.section}
      onClick={() => setSection(item.section)}
    >
      {item.icon}
    </button>
  );

  return (
    <nav className="activity-rail" aria-label="Primary">
      {TOP_ITEMS.map(renderItem)}
      <div className="activity-rail__spacer" />
      {BOTTOM_ITEMS.map(renderItem)}
    </nav>
  );
}
