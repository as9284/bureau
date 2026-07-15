export function dismissBootSplash(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('boot--exit');
  window.setTimeout(() => boot.remove(), 240);
}
