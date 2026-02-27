// ============================================================
// Response Parser — extracts CLI responses from stdout stream
// ============================================================

const RESPONSE_START = '[TEAM_RESPONSE_START]';
const RESPONSE_END = '[TEAM_RESPONSE_END]';

export interface PendingResponse {
    requestId: string;
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class ResponseParser {
    private buffer = '';
    private capturing = false;
    private capturedContent = '';
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
                    this.capturedContent = '';
                    this.currentRequestId = null;
                }
                reject(new Error(`Timeout waiting for CLI response (${this.timeout / 1000}s)`));
            }, this.timeout);

            this.pendingResponses.set(requestId, { requestId, resolve, reject, timer });

            // Set the current request we're waiting for
            if (!this.currentRequestId) {
                this.currentRequestId = requestId;
            }
        });
    }

    /**
     * Feed stdout data into the parser.
     */
    feed(data: string): string {
        // Track what should be shown to user vs captured
        let userOutput = '';
        this.buffer += data;

        while (this.buffer.length > 0) {
            if (this.capturing) {
                const endIdx = this.buffer.indexOf(RESPONSE_END);
                if (endIdx !== -1) {
                    // End marker found — capture content and resolve
                    this.capturedContent += this.buffer.substring(0, endIdx);
                    this.buffer = this.buffer.substring(endIdx + RESPONSE_END.length);

                    // Remove trailing newline if present
                    const trimmedLine = this.buffer.startsWith('\n') ? this.buffer.substring(1) : this.buffer;
                    this.buffer = trimmedLine;

                    this.resolveCurrentResponse();
                    this.capturing = false;
                } else {
                    // Still capturing, buffer everything
                    this.capturedContent += this.buffer;
                    this.buffer = '';
                }
            } else {
                const startIdx = this.buffer.indexOf(RESPONSE_START);
                if (startIdx !== -1) {
                    // Start marker found — show everything before it to user
                    userOutput += this.buffer.substring(0, startIdx);
                    this.buffer = this.buffer.substring(startIdx + RESPONSE_START.length);

                    // Skip leading newline after start marker
                    if (this.buffer.startsWith('\n')) {
                        this.buffer = this.buffer.substring(1);
                    }

                    this.capturing = true;
                    this.capturedContent = '';
                } else {
                    // No markers — pass through to user
                    // But keep last chunk in buffer in case a partial marker is split across chunks
                    const safeLength = this.buffer.length - RESPONSE_START.length;
                    if (safeLength > 0) {
                        userOutput += this.buffer.substring(0, safeLength);
                        this.buffer = this.buffer.substring(safeLength);
                    } else {
                        // Buffer too small, just flush
                        userOutput += this.buffer;
                        this.buffer = '';
                    }
                    break;
                }
            }
        }

        return userOutput;
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
            pending.resolve(this.capturedContent.trim());
        }

        this.capturedContent = '';
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
