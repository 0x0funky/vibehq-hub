// ============================================================
// Response Parser — extracts CLI responses from stdout stream
// Strips ANSI escape codes before matching markers.
// ============================================================

const RESPONSE_START = '[TEAM_RESPONSE_START]';
const RESPONSE_END = '[TEAM_RESPONSE_END]';

/**
 * Strip ALL ANSI escape sequences (from VibeHQ output-parser.ts pattern)
 */
function stripAnsi(str: string): string {
    return str
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')   // CSI sequences
        .replace(/\x1b\][^\x07]*\x07/g, '')         // OSC sequences
        .replace(/\x1b[()][A-Z0-9]/g, '')           // Character set selection
        .replace(/\x1b[^\[(\]]/g, '')                // Other ESC sequences
        .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ''); // Control chars (except \n)
}

export interface PendingResponse {
    requestId: string;
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class ResponseParser {
    private buffer = '';
    private capturing = false;
    private capturedLines: string[] = [];
    private pendingResponses: Map<string, PendingResponse> = new Map();
    private currentRequestId: string | null = null;
    private timeout: number;

    constructor(timeout = 120000) {
        this.timeout = timeout;
    }

    /**
     * Register a pending response to capture.
     */
    expectResponse(requestId: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingResponses.delete(requestId);
                if (this.currentRequestId === requestId) {
                    this.capturing = false;
                    this.capturedLines = [];
                    this.currentRequestId = null;
                }
                reject(new Error(`Timeout waiting for CLI response (${this.timeout / 1000}s)`));
            }, this.timeout);

            this.pendingResponses.set(requestId, { requestId, resolve, reject, timer });

            if (!this.currentRequestId) {
                this.currentRequestId = requestId;
            }
        });
    }

    /**
     * Feed raw PTY/stdout data into the parser.
     * Strips ANSI for marker detection, passes raw data through to user.
     */
    feed(data: string): string {
        // Always pass raw data through to the user's terminal
        // But strip ANSI for our marker detection logic
        const cleanData = stripAnsi(data);
        this.buffer += cleanData;

        // Process line by line for marker detection
        this.processBuffer();

        // If we're currently capturing a response, suppress the raw output
        // so the markers and response content don't clutter the user's terminal
        if (this.capturing) {
            return '';
        }

        // Check if the raw data contains our markers (with possible ANSI in between)
        if (cleanData.includes(RESPONSE_START) || cleanData.includes(RESPONSE_END)) {
            return ''; // Suppress marker lines from user view
        }

        return data;
    }

    /**
     * Process the clean-text buffer looking for markers.
     */
    private processBuffer(): void {
        while (this.buffer.length > 0) {
            if (this.capturing) {
                const endIdx = this.buffer.indexOf(RESPONSE_END);
                if (endIdx !== -1) {
                    // End marker found — capture everything before it
                    const content = this.buffer.substring(0, endIdx);
                    if (content.trim()) {
                        this.capturedLines.push(content);
                    }
                    this.buffer = this.buffer.substring(endIdx + RESPONSE_END.length);

                    // Resolve the response
                    this.resolveCurrentResponse();
                    this.capturing = false;
                } else {
                    // Still waiting for end marker, keep buffering
                    // But don't let buffer grow unbounded — check periodically
                    break;
                }
            } else {
                const startIdx = this.buffer.indexOf(RESPONSE_START);
                if (startIdx !== -1) {
                    // Start marker found — begin capturing
                    this.buffer = this.buffer.substring(startIdx + RESPONSE_START.length);
                    this.capturing = true;
                    this.capturedLines = [];
                } else {
                    // No start marker — clear buffer but keep last chunk for partial matching
                    const keepLength = RESPONSE_START.length + 10;
                    if (this.buffer.length > keepLength) {
                        this.buffer = this.buffer.substring(this.buffer.length - keepLength);
                    }
                    break;
                }
            }
        }
    }

    /**
     * Resolve the current pending response.
     */
    private resolveCurrentResponse(): void {
        if (!this.currentRequestId) return;

        const pending = this.pendingResponses.get(this.currentRequestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pendingResponses.delete(this.currentRequestId);

            // Join and clean the captured content
            const fullResponse = this.capturedLines
                .join('')
                .replace(/\(your response here\)/g, '') // Remove placeholder if echoed
                .trim();

            pending.resolve(fullResponse);
        }

        this.capturedLines = [];
        this.currentRequestId = null;

        // Activate next pending request if any
        const nextEntry = this.pendingResponses.entries().next();
        if (!nextEntry.done) {
            this.currentRequestId = nextEntry.value[0];
        }
    }

    /**
     * Cleanup all pending responses.
     */
    destroy(): void {
        for (const pending of this.pendingResponses.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Parser destroyed'));
        }
        this.pendingResponses.clear();
    }
}
