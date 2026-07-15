import type { ProjectStack } from '@shared/contracts/projects';

const META: Record<ProjectStack, { label: string; tone: string }> = {
  node: { label: 'Node', tone: 'success' },
  'react-native': { label: 'React Native', tone: 'info' },
  flutter: { label: 'Flutter', tone: 'info' },
  android: { label: 'Android', tone: 'success' },
  python: { label: 'Python', tone: 'warning' },
  rust: { label: 'Rust', tone: 'warning' },
  go: { label: 'Go', tone: 'info' },
  cpp: { label: 'C/C++', tone: 'muted' },
  dotnet: { label: '.NET', tone: 'info' },
  java: { label: 'Java/Kotlin', tone: 'danger' },
  ruby: { label: 'Ruby', tone: 'danger' },
  php: { label: 'PHP', tone: 'info' },
  elixir: { label: 'Elixir', tone: 'info' },
  deno: { label: 'Deno', tone: 'success' },
  docker: { label: 'Docker', tone: 'info' },
  static: { label: 'Static', tone: 'muted' },
  git: { label: 'Git', tone: 'muted' },
};

export function StackBadge({ stack }: { stack: ProjectStack }) {
  const meta = META[stack];
  return <span className={['stack-badge', meta.tone].join(' ')}>{meta.label}</span>;
}
