// ============================================================
// REST API: /api/fs — Server-side filesystem helpers
// ============================================================

import { Router } from 'express';
import { execSync } from 'child_process';

export const filesystemRouter = Router();

// POST /api/fs/pick-folder
// Opens a native OS folder picker dialog and returns the selected path
filesystemRouter.post('/pick-folder', (_req, res) => {
    try {
        let selected = '';

        if (process.platform === 'win32') {
            // Use PowerShell to open native folder browser dialog
            const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = 'Select project directory'
$f.ShowNewFolderButton = $true
if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }
`.trim().replace(/\n/g, '; ');
            selected = execSync(`powershell -Command "${ps}"`, {
                encoding: 'utf-8',
                timeout: 120000,  // 2 min — user might take time to pick
            }).trim();
        } else if (process.platform === 'darwin') {
            // macOS: use osascript
            selected = execSync(
                `osascript -e 'POSIX path of (choose folder with prompt "Select project directory")'`,
                { encoding: 'utf-8', timeout: 120000 }
            ).trim();
        } else {
            // Linux: try zenity, then kdialog
            try {
                selected = execSync(
                    `zenity --file-selection --directory --title="Select project directory" 2>/dev/null`,
                    { encoding: 'utf-8', timeout: 120000 }
                ).trim();
            } catch {
                selected = execSync(
                    `kdialog --getexistingdirectory ~ 2>/dev/null`,
                    { encoding: 'utf-8', timeout: 120000 }
                ).trim();
            }
        }

        if (selected) {
            res.json({ path: selected });
        } else {
            res.status(204).send(); // user cancelled
        }
    } catch (err: any) {
        // Non-zero exit = user cancelled the dialog
        if (err?.status || err?.code === 1) {
            res.status(204).send();
            return;
        }
        res.status(500).json({ error: (err as Error).message });
    }
});
