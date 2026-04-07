export function normalizeAgentCwd(cwd: string): string {
    const trimmed = cwd.trim();
    if (!trimmed) return trimmed;

    const forward = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (forward === '/') return forward;

    return forward.replace(/\/+$/, '');
}

export function encodeClaudeProjectPath(cwd: string): string {
    return normalizeAgentCwd(cwd).replace(/[\\/:]/g, '-');
}
