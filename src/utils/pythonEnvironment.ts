import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { Logger } from './logger';

/** A usable Python interpreter found on the machine. */
interface PythonCandidate {
    /** Command or absolute path used to invoke it. */
    command: string;
    /** Parsed (major, minor), e.g. [3, 12]. */
    version: [number, number];
    /** Where it came from, for logging and error messages. */
    source: string;
}

/** Oldest interpreter we will try. pandas 2.x and pyreadstat require 3.9+. */
const MIN_MINOR = 9;

/**
 * Manages a Python virtual environment for the extension.
 * Creates a venv in VS Code's globalStorageUri on first use,
 * installs required packages, and provides the Python executable path.
 *
 * The interpreter is chosen by trying every Python on the machine rather than
 * trusting whichever one happens to be called `python3`: a system `python3`
 * that predates the wheels published for pandas/pyreadstat will try to compile
 * them from source and fail, even though a newer interpreter sits right next to
 * it. Users should not have to reorder their PATH to make the extension work.
 */
export class PythonEnvironment {
    private static instance: PythonEnvironment | null = null;
    private venvPath: string = '';
    private pythonPath: string = '';
    private ready: boolean = false;
    private initializing: Promise<void> | null = null;

    private constructor() {}

    static getInstance(): PythonEnvironment {
        if (!PythonEnvironment.instance) {
            PythonEnvironment.instance = new PythonEnvironment();
        }
        return PythonEnvironment.instance;
    }

    /**
     * Initialize the venv. Safe to call multiple times — only runs once.
     */
    async ensureReady(context: vscode.ExtensionContext): Promise<void> {
        if (this.ready) {
            return;
        }
        if (this.initializing) {
            return this.initializing;
        }
        this.initializing = this._initialize(context);
        try {
            await this.initializing;
        } catch (err) {
            // Allow a later call (or Reset Python Environment) to retry.
            this.initializing = null;
            throw err;
        }
    }

    /**
     * Returns the path to the Python executable inside the venv.
     */
    getPythonPath(): string {
        if (!this.ready) {
            throw new Error('Python environment not initialized. Call ensureReady() first.');
        }
        return this.pythonPath;
    }

    /**
     * Spawn a Python process using the venv Python.
     */
    spawnPython(args: string[], cwd: string) {
        return spawn(this.getPythonPath(), args, { cwd });
    }

    /**
     * Delete the venv and recreate it from scratch.
     */
    async reset(context: vscode.ExtensionContext): Promise<void> {
        this.ready = false;
        this.initializing = null;

        if (this.venvPath) {
            try {
                await fs.promises.rm(this.venvPath, { recursive: true, force: true });
                Logger.info(`Deleted Python venv at ${this.venvPath}`);
            } catch (err) {
                Logger.error('Failed to delete venv', err);
            }
        }

        await this._initialize(context);
    }

    private async _initialize(context: vscode.ExtensionContext): Promise<void> {
        const globalStoragePath = context.globalStorageUri.fsPath;
        this.venvPath = path.join(globalStoragePath, 'python-env');
        this.pythonPath = this._venvPython(this.venvPath);

        if (await this._isVenvValid(this.pythonPath)) {
            Logger.info(`Python venv already set up at ${this.venvPath}`);
            this.ready = true;
            return;
        }

        const candidates = await this._discoverPythons();
        if (candidates.length === 0) {
            throw new Error(
                'No Python 3.9+ interpreter found. Install Python from https://www.python.org/downloads/ ' +
                'or set "sasDataExplorer.pythonPath" to a Python executable. ' +
                'Note that .sas7bdat and XPT v5 files do not require Python.'
            );
        }
        Logger.info(
            `Python candidates: ${candidates.map(c => `${c.command} (3.${c.version[1]}, ${c.source})`).join(', ')}`
        );

        const requirementsPath = path.join(context.extensionPath, 'python', 'requirements.txt');
        const failures: string[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Dataset Lens: Setting up Python environment',
                cancellable: false,
            },
            async (progress) => {
                await fs.promises.mkdir(globalStoragePath, { recursive: true });

                // Pass 1 tries wheels only, so an interpreter with no published
                // wheels fails in seconds instead of compiling for minutes.
                // Pass 2 permits source builds for the rare package that needs it.
                for (const wheelsOnly of [true, false]) {
                    for (const candidate of candidates) {
                        const label = `Python 3.${candidate.version[1]}`;
                        progress.report({
                            message: wheelsOnly
                                ? `Trying ${label}...`
                                : `Trying ${label} (building from source)...`,
                        });

                        try {
                            await this._buildVenv(candidate, requirementsPath, wheelsOnly, progress);
                            Logger.info(
                                `Python environment ready using ${candidate.command} (3.${candidate.version[1]})`
                            );
                            this.ready = true;
                            vscode.window.showInformationMessage(
                                `Dataset Lens: Python environment ready (${label}).`
                            );
                            return;
                        } catch (err) {
                            const reason = err instanceof Error ? err.message : String(err);
                            Logger.warn(`Setup failed with ${candidate.command}`, reason);
                            failures.push(`${candidate.command} (3.${candidate.version[1]}): ${reason.split('\n')[0]}`);
                            await this._removeVenv();
                        }
                    }
                }

                throw new Error(
                    'Could not set up the Python environment with any interpreter found on this machine.\n' +
                    failures.map(f => `  - ${f}`).join('\n') +
                    '\n\nSet "sasDataExplorer.pythonPath" to a Python 3.9+ executable, or install a newer Python. ' +
                    'Note that .sas7bdat and XPT v5 files open without Python.'
                );
            }
        );
    }

    /** Create the venv with one interpreter and install the requirements into it. */
    private async _buildVenv(
        candidate: PythonCandidate,
        requirementsPath: string,
        wheelsOnly: boolean,
        progress: vscode.Progress<{ message?: string }>
    ): Promise<void> {
        await this._removeVenv();

        await this._runCommand(candidate.command, ['-m', 'venv', this.venvPath]);
        this.pythonPath = this._venvPython(this.venvPath);

        // Old pip cannot read newer wheel metadata, which is a common cause of
        // spurious source builds, so upgrade before installing anything.
        progress.report({ message: `Python 3.${candidate.version[1]}: upgrading pip...` });
        await this._runCommand(this.pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);

        progress.report({ message: `Python 3.${candidate.version[1]}: installing packages...` });
        const args = ['-m', 'pip', 'install', '-r', requirementsPath];
        if (wheelsOnly) {
            args.push('--only-binary=:all:');
        }
        await this._runCommand(this.pythonPath, args);

        if (!(await this._isVenvValid(this.pythonPath))) {
            throw new Error('packages installed but could not be imported');
        }
    }

    /** Path to the Python executable inside a venv. */
    private _venvPython(venvPath: string): string {
        return process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
    }

    private async _removeVenv(): Promise<void> {
        try {
            await fs.promises.rm(this.venvPath, { recursive: true, force: true });
        } catch {
            // Nothing to remove.
        }
    }

    /**
     * Check that the venv exists and the required packages import.
     */
    private async _isVenvValid(pythonPath: string): Promise<boolean> {
        try {
            await fs.promises.access(pythonPath);
        } catch {
            return false;
        }

        try {
            await this._runCommand(pythonPath, [
                '-c',
                'import pandas; import pyreadstat; import pyreadr'
            ]);
            return true;
        } catch {
            Logger.info('Venv exists but packages are missing, will reinstall');
            return false;
        }
    }

    /**
     * Find every usable Python on the machine, best candidate first.
     *
     * Order matters: an explicit setting wins, then the interpreter the user
     * already selected for the Python extension, then whatever we can discover,
     * newest first. Newer interpreters are preferred because wheels for
     * pandas/pyreadstat are published for current versions and dropped for old
     * ones — the failure mode this ordering exists to avoid.
     */
    private async _discoverPythons(): Promise<PythonCandidate[]> {
        const found: PythonCandidate[] = [];
        const seen = new Set<string>();

        const consider = async (command: string, source: string) => {
            if (!command || seen.has(command)) {
                return;
            }
            seen.add(command);
            const probed = await this._probe(command);
            if (!probed) {
                return;
            }
            const [major, minor] = probed;
            if (major !== 3 || minor < MIN_MINOR) {
                Logger.info(`Ignoring ${command}: Python ${major}.${minor} is below the 3.${MIN_MINOR} minimum`);
                return;
            }
            found.push({ command, version: probed, source });
        };

        // 1. Explicit override — the escape hatch that needs no PATH changes.
        const configured = vscode.workspace
            .getConfiguration('sasDataExplorer')
            .get<string>('pythonPath');
        if (configured && configured.trim()) {
            await consider(configured.trim(), 'sasDataExplorer.pythonPath setting');
        }

        // 2. Whatever the user already picked for the Python extension.
        const fromPythonExt = vscode.workspace
            .getConfiguration('python')
            .get<string>('defaultInterpreterPath');
        if (fromPythonExt && fromPythonExt.trim() && fromPythonExt !== 'python') {
            await consider(fromPythonExt.trim(), 'python.defaultInterpreterPath');
        }

        // 3. Version-suffixed interpreters, newest first.
        const minors: number[] = [];
        for (let m = 14; m >= MIN_MINOR; m--) {
            minors.push(m);
        }
        if (process.platform === 'win32') {
            for (const m of minors) {
                await consider(`py -3.${m}`, 'py launcher');
            }
            await consider('py', 'py launcher');
            await consider('python', 'PATH');
        } else {
            for (const m of minors) {
                await consider(`python3.${m}`, 'PATH');
            }
        }

        // 4. Generic names last: they are whatever the system happens to alias.
        await consider('python3', 'PATH');
        await consider('python', 'PATH');

        // Explicit picks (sources 1 and 2) keep their priority; the rest are
        // ordered newest-first.
        const explicit = found.filter(c => !c.source.includes('PATH') && !c.source.includes('launcher'));
        const discovered = found
            .filter(c => c.source.includes('PATH') || c.source.includes('launcher'))
            .sort((a, b) => b.version[1] - a.version[1]);

        return [...explicit, ...discovered];
    }

    /** Return [major, minor] if the command is a working Python, else null. */
    private async _probe(command: string): Promise<[number, number] | null> {
        try {
            const out = await this._runCommand(command, [
                '-c',
                'import sys; print("%d.%d" % sys.version_info[:2])'
            ]);
            const match = out.trim().match(/^(\d+)\.(\d+)/);
            if (!match) {
                return null;
            }
            return [parseInt(match[1], 10), parseInt(match[2], 10)];
        } catch {
            return null;
        }
    }

    /**
     * Run a command and return stdout.
     */
    private _runCommand(command: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            // Never use a shell. spawn() resolves bare names such as "python3" or
            // "py" against PATH by itself, and shell:true would concatenate the
            // arguments without quoting — which breaks both paths containing
            // spaces and any argument containing spaces or semicolons.
            //
            // "py -3.12" arrives as one string; split it so the version selector
            // is passed as an argument rather than as part of the filename.
            const parts = command.split(/\s+/);
            const exe = parts[0];
            const prefix = parts.slice(1);

            const proc = spawn(exe, [...prefix, ...args]);
            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Command "${command} ${args.join(' ')}" failed (code ${code}): ${stderr.trim()}`));
                }
            });

            proc.on('error', (err) => {
                reject(err);
            });
        });
    }
}
