import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useAppStore } from '../store/appStore';
import { useGitStore } from '../store/gitStore';
import { markdownOutline } from '../features/files/markdown';

type Command = {
  id: string;
  title: string;
  hint?: string;
  run(): void;
};

export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const closePalette = useAppStore((s) => s.closePalette);
  const setSection = useAppStore((s) => s.setSection);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const immersiveMode = useAppStore((s) => s.settings?.appearance.immersiveMode ?? false);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const backToHub = useAppStore((s) => s.backToHub);
  const selectProject = useAppStore((s) => s.selectProject);
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setProjectTab = useAppStore((s) => s.setProjectTab);
  const processesByProject = useAppStore((s) => s.processesByProject);
  const tasksByProject = useAppStore((s) => s.tasksByProject);
  const startProcess = useAppStore((s) => s.startProcess);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const runTask = useAppStore((s) => s.runTask);
  const filesProject = useAppStore((s) =>
    selectedProjectId ? s.filesByProject[selectedProjectId] : undefined
  );
  const saveFile = useAppStore((s) => s.saveFile);
  const saveAllFiles = useAppStore((s) => s.saveAllFiles);
  const setFileMode = useAppStore((s) => s.setFileMode);

  const gitSnapshot = useGitStore((s) =>
    selectedProjectId ? s.repos[selectedProjectId]?.snapshot : undefined
  );
  const gitRevision = gitSnapshot?.revision;
  const stageAll = useGitStore((s) => s.stageAll);
  const fetchRepo = useGitStore((s) => s.fetch);
  const pullRepo = useGitStore((s) => s.pull);
  const pushRepo = useGitStore((s) => s.push);
  const setRepoPanel = useGitStore((s) => s.setRepoPanel);
  const setCloneDialogOpen = useGitStore((s) => s.setCloneDialogOpen);
  const setInitDialogOpen = useGitStore((s) => s.setInitDialogOpen);
  const setOperationDrawerOpen = useGitStore((s) => s.setOperationDrawerOpen);
  const recoveryState = useGitStore((s) =>
    selectedProjectId ? s.recoveryStateByRepo[selectedProjectId] : undefined
  );

  const loadRecoveryState = useGitStore((s) => s.loadRecoveryState);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const projectProcesses = selectedProjectId
      ? (processesByProject[selectedProjectId]?.definitions ?? [])
      : [];
    const projectTasks = selectedProjectId
      ? (tasksByProject[selectedProjectId]?.tasks ?? [])
      : [];
    const activeFilePath = filesProject?.activePath ?? null;
    const activeFileBuffer = activeFilePath ? filesProject?.buffers[activeFilePath] : undefined;
    const markdownHeadings = activeFileBuffer?.kind === 'text' && activeFileBuffer.document.languageId === 'markdown'
      ? markdownOutline(activeFileBuffer.content)
      : [];

    const fileCommands: Command[] = selectedProjectId
      ? [
          {
            id: 'open-files',
            title: 'Open Files workspace',
            hint: 'Files',
            run: () => setProjectTab('files'),
          },
          {
            id: 'files-quick-open',
            title: 'Quick Open file…',
            hint: 'Files · Ctrl+P',
            run: () => {
              setProjectTab('files');
              window.setTimeout(() => window.dispatchEvent(new Event('bureau:files:quick-open')), 0);
            },
          },
          {
            id: 'files-search',
            title: 'Search project files…',
            hint: 'Files · Ctrl+Shift+F',
            run: () => {
              setProjectTab('files');
              window.setTimeout(() => window.dispatchEvent(new Event('bureau:files:search')), 0);
            },
          },
          ...(activeFilePath && activeFileBuffer?.kind === 'text'
            ? [
                {
                  id: 'files-save',
                  title: `Save ${activeFilePath}`,
                  hint: 'Files · Ctrl+S',
                  run: () => void saveFile(selectedProjectId, activeFilePath),
                },
                {
                  id: 'files-save-all',
                  title: 'Save all files',
                  hint: 'Files · Ctrl+Alt+S',
                  run: () => void saveAllFiles(selectedProjectId),
                },
                ...(activeFileBuffer.document.languageId === 'markdown'
                  ? (['edit', 'preview', 'split'] as const).map((mode) => ({
                      id: `files-markdown-${mode}`,
                      title: `Markdown: ${mode[0].toUpperCase()}${mode.slice(1)}`,
                      hint: 'Files · Markdown',
                      run: () => {
                        setProjectTab('files');
                        setFileMode(selectedProjectId, activeFilePath, mode);
                      },
                    }))
                  : []),
              ]
            : []),
          ...markdownHeadings.map((heading, index) => ({
            id: `files-heading-${heading.slug}-${index}`,
            title: `Go to heading: ${heading.text}`,
            hint: `Files · H${heading.depth}`,
            run: () => {
              setProjectTab('files');
              if (activeFilePath) setFileMode(selectedProjectId, activeFilePath, 'preview');
              window.setTimeout(
                () => document.getElementById(heading.slug)?.scrollIntoView({ behavior: 'smooth' }),
                0
              );
            },
          })),
        ]
      : [];

    const gitCommands: Command[] = selectedProjectId
      ? [
          {
            id: 'open-git',
            title: 'Open Git tab',
            hint: 'Git',
            run: () => setProjectTab('git'),
          },
          ...(gitRevision
            ? [
                {
                  id: 'git-stage-all',
                  title: 'Stage all changes',
                  hint: 'Git',
                  run: () => void stageAll(selectedProjectId, gitRevision),
                },
                {
                  id: 'git-fetch',
                  title: 'Fetch',
                  hint: 'Git',
                  run: () => void fetchRepo(selectedProjectId, gitRevision),
                },
                {
                  id: 'git-pull',
                  title: 'Pull',
                  hint: 'Git',
                  run: () => void pullRepo(selectedProjectId, gitRevision),
                },
                {
                  id: 'git-push',
                  title: 'Push',
                  hint: 'Git',
                  run: () => void pushRepo(selectedProjectId, gitRevision),
                },
              ]
            : []),
          {
            id: 'git-changes',
            title: 'Open Changes panel',
            hint: 'Git',
            run: () => {
              setProjectTab('git');
              setRepoPanel('changes');
            },
          },
          {
            id: 'git-history',
            title: 'Open History panel',
            hint: 'Git',
            run: () => {
              setProjectTab('git');
              setRepoPanel('history');
            },
          },
          {
            id: 'git-branches',
            title: 'Open Branches panel',
            hint: 'Git',
            run: () => {
              setProjectTab('git');
              setRepoPanel('branches');
            },
          },
          {
            id: 'git-stashes',
            title: 'Open Stashes panel',
            hint: 'Git',
            run: () => {
              setProjectTab('git');
              setRepoPanel('stash');
            },
          },
          {
            id: 'git-clone',
            title: 'Clone repository',
            hint: 'Git',
            run: () => setCloneDialogOpen(true),
          },
          {
            id: 'git-init',
            title: 'Init repository',
            hint: 'Git',
            run: () => setInitDialogOpen(true),
          },
          {
            id: 'git-operations',
            title: 'Show Git operations',
            hint: 'Git',
            run: () => setOperationDrawerOpen(true),
          },
          ...(recoveryState?.conflictedFiles.length
            ? [
                {
                  id: 'git-conflicts',
                  title: 'Open conflicts',
                  hint: 'Git',
                  run: () => {
                    setProjectTab('git');
                    setRepoPanel('changes');
                  },
                },
              ]
            : []),
        ]
      : [];

    return [
      {
        id: 'add-project',
        title: 'Add a project…',
        hint: 'Projects',
        run: () => void openAddDialog(),
      },
      { id: 'go-hub', title: 'Go to Projects hub', hint: 'Navigation', run: () => backToHub() },
      {
        id: 'open-settings',
        title: 'Open Settings',
        hint: 'Navigation',
        run: () => setSection('settings'),
      },
      {
        id: 'toggle-theme',
        title: 'Toggle light / dark theme',
        hint: 'Appearance',
        run: () => void toggleTheme(),
      },
      {
        id: 'toggle-immersive',
        title: immersiveMode ? 'Disable immersive mode' : 'Enable immersive mode',
        hint: 'Appearance · Ctrl+B',
        run: () => {
          void updateSettings({ appearance: { immersiveMode: !immersiveMode } });
        },
      },
      ...fileCommands,
      ...gitCommands,
      ...(selectedProjectId
        ? [
            {
              id: 'open-terminal',
              title: 'Open Terminal',
              hint: 'Terminal',
              run: () => setProjectTab('terminal' as const),
            },
            {
              id: 'open-android',
              title: 'Open Android controls',
              hint: 'Android',
              run: () => setProjectTab('android' as const),
            },
          ]
        : []),
      ...projectTasks.map((task) => ({
        id: `task-${task.id}`,
        title: `Run script: ${task.label}`,
        hint: 'Tasks',
        run: () => void runTask(selectedProjectId!, task.id),
      })),
      ...projectProcesses.flatMap((definition) => {
        const runtime = processesByProject[selectedProjectId!]?.runtimes.find(
          (r) => r.processId === definition.id
        );
        const running = runtime?.status === 'running' || runtime?.status === 'starting';
        return running
          ? [
              {
                id: `stop-${definition.id}`,
                title: `Stop ${definition.label}`,
                hint: 'Processes',
                run: () => void stopProcess(selectedProjectId!, definition.id),
              },
            ]
          : [
              {
                id: `start-${definition.id}`,
                title: `Start ${definition.label}`,
                hint: 'Processes',
                run: () => void startProcess(selectedProjectId!, definition.id),
              },
            ];
      }),
      ...projects.map((project) => ({
        id: `open-${project.projectId}`,
        title: `Open ${project.name}`,
        hint: 'Project',
        run: () => void selectProject(project.projectId),
      })),
    ];
  }, [
    setSection,
    toggleTheme,
    updateSettings,
    immersiveMode,
    openAddDialog,
    backToHub,
    selectProject,
    projects,
    selectedProjectId,
    setProjectTab,
    processesByProject,
    tasksByProject,
    runTask,
    startProcess,
    stopProcess,
    gitRevision,
    stageAll,
    fetchRepo,
    pullRepo,
    pushRepo,
    setRepoPanel,
    setCloneDialogOpen,
    setInitDialogOpen,
    setOperationDrawerOpen,
    recoveryState,
    filesProject,
    saveFile,
    saveAllFiles,
    setFileMode,
  ]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.title.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (open && selectedProjectId) {
      void loadRecoveryState(selectedProjectId);
    }
  }, [open, selectedProjectId, loadRecoveryState]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const runIndex = (index: number) => {
    const command = results[index];
    if (!command) return;
    command.run();
    closePalette();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runIndex(activeIndex);
    }
  };

  return (
    <div className="overlay-root overlay-root--palette" onMouseDown={closePalette}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette__results">
          {results.length === 0 ? (
            <div className="palette__empty">No matching commands</div>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={['palette__item', index === activeIndex ? 'active' : ''].join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runIndex(index)}
              >
                <span>{command.title}</span>
                {command.hint && <span className="meta">{command.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
