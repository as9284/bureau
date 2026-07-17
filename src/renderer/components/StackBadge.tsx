import type { ProjectStack } from '@shared/contracts/projects';

/** Stack tags stay muted graphite; status pills (Clean/dirty/Missing) keep their tones elsewhere. */
const META: Record<ProjectStack, { label: string; tone: string }> = {
  node: { label: 'Node', tone: 'muted' },
  'react-native': { label: 'React Native', tone: 'muted' },
  flutter: { label: 'Flutter', tone: 'muted' },
  android: { label: 'Android', tone: 'muted' },
  python: { label: 'Python', tone: 'muted' },
  rust: { label: 'Rust', tone: 'muted' },
  go: { label: 'Go', tone: 'muted' },
  cpp: { label: 'C/C++', tone: 'muted' },
  dotnet: { label: '.NET', tone: 'muted' },
  java: { label: 'Java/Kotlin', tone: 'muted' },
  ruby: { label: 'Ruby', tone: 'muted' },
  php: { label: 'PHP', tone: 'muted' },
  elixir: { label: 'Elixir', tone: 'muted' },
  deno: { label: 'Deno', tone: 'muted' },
  docker: { label: 'Docker', tone: 'muted' },
  static: { label: 'Static', tone: 'muted' },
  git: { label: 'Git', tone: 'muted' },
};

export function StackBadge({ stack }: { stack: ProjectStack }) {
  const meta = META[stack];
  return <span className={['stack-badge', meta.tone].join(' ')}>{meta.label}</span>;
}
