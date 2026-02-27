// ============================================================
// Response Parser — extracts CLI responses from stdout stream
// Strips ANSI before marker detection; raw data always passes through.
// ============================================================

const RESPONSE_START = '[TEAM_RESPONSE_START]';
const RESPONSE_END = '[TEAM_RESPONSE_END]';

/**
 * Strip ALL ANSI escape sequences
 */
function stripAnsi(str: string): string {
    return str
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[()][A-Z0-9]/g, '')
        .replace(/\x1b[^\[(\]]/g, '')
        .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
}

export interface PendingResponse {
    requestId: string;
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class ResponseParser {
    private cleanBuffer = '';
    private capturing = false;
    private capturedContent = '';
    private pendingResponses: Map<string, PendingResponse> = new Map();
    private currentRequestId: string | null = null;
    private timeout: number;

    constructor(timeout = 120000) {
        this.timeout = timeout;
    }

    expectResponse(requestId: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingResponses.delete(requestId);
                if (this.currentRequestId === requestId) {
                    this.capturing = false;
                    this.capturedContent = '';
                    this.currentRequestId = null;
                }
                reject(new Error(`Timeout (${this.timeout / 1000}s)`));
            }, this.timeout);

            this.pendingResponses.set(requestId, { requestId, resolve, reject, timer });
            if (!this.currentRequestId) {
                this.currentRequestId = requestId;
            }
        });
    }

    /**
     * Feed raw PTY data. Returns the data that should be shown to user.
     * Raw data ALWAYS passes through — ANSI stripping is only for marker detection.
     */
    feed(data: string): string {
        const clean = stripAnsi(data);
        this.cleanBuffer += clean;
        this.processCleanBuffer();

        // Always pass raw data through to user's terminal
        return data;
    }

    private processCleanBuffer(): void {
        while (this.cleanBuffer.length > 0) {
            if (this.capturing) {
                const endIdx = this.cleanBuffer.indexOf(RESPONSE_END);
                if (endIdx !== -1) {
                    this.capturedContent += this.cleanBuffer.substring(0, endIdx);
                    this.cleanBuffer = this.cleanBuffer.substring(endIdx + RESPONSE_END.length);
                    this.resolveCurrentResponse();
                    this.capturing = false;
                } else {
                    this.capturedContent += this.cleanBuffer;
                    this.cleanBuffer = '';
                }
            } else {
                const startIdx = this.cleanBuffer.indexOf(RESPONSE_START);
                if (startIdx !== -1) {
                    this.cleanBuffer = this.cleanBuffer.substring(startIdx + RESPONSE_START.length);
                    this.capturing = true;
                    this.capturedContent = '';
                } else {
                    // Keep tail for partial marker matching
                    const keep = RESPONSE_START.length + 5;
                    if (this.cleanBuffer.length > keep) {
                        this.cleanBuffer = this.cleanBuffer.substring(this.cleanBuffer.length - keep);
                    }
                    break;
                }
            }
        }
    }

    private resolveCurrentResponse(): void {
        if (!this.currentRequestId) return;

        const pending = this.pendingResponses.get(this.currentRequestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingResponses.delete(this.currentRequestId);
            const cleaned = this.capturedContent
                .replace(/\(your response here\)/g, '')
                .trim();
            pending.resolve(cleaned);
        }

        this.capturedContent = '';
        this.currentRequestId = null;

        const nextEntry = this.pendingResponses.entries().next();
        if (!nextEntry.done) {
            this.currentRequestId = nextEntry.value[0];
        }
    }

    destroy(): void {
        for (const pending of this.pendingResponses.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Parser destroyed'));
        }
        this.pendingResponses.clear();
    }
}
