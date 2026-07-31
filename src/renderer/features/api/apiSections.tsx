import type { ReactNode } from 'react';
import {
  ClockIcon,
  FolderIcon,
  GlobeIcon,
  KeyIcon,
  StackIcon,
} from '@renderer/components/icons';
import type { ApiSidebarMode } from '@renderer/store/apiStore';

/** The sidebar's sections, in rail order. Shared by the rail and the panel header. */
export const API_RAIL_SECTIONS: Array<{
  id: ApiSidebarMode;
  label: string;
  hint: string;
  icon: ReactNode;
}> = [
  { id: 'collections', label: 'Collections', hint: 'Requests and folders', icon: <FolderIcon size={17} /> },
  { id: 'history', label: 'History', hint: 'Sent requests', icon: <ClockIcon size={17} /> },
  { id: 'environments', label: 'Environments', hint: 'Variables per environment', icon: <GlobeIcon size={17} /> },
  { id: 'secrets', label: 'Secrets', hint: 'Write-only credentials', icon: <KeyIcon size={17} /> },
  { id: 'cookies', label: 'Cookies', hint: 'Session jars', icon: <StackIcon size={17} /> },
];
