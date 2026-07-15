import { useAppStore } from '../store/appStore';

export function LiveRegion() {
  const announcements = useAppStore((s) => s.announcements);
  const latest = announcements[announcements.length - 1] ?? '';
  return (
    <div className="bureau-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {latest}
    </div>
  );
}
