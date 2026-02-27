// ============================================================
// Integration Test — Hub + Mock Agents
// ============================================================

import WebSocket from 'ws';
import { startHub } from '../src/hub/server.js';

const PORT = 9876;
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
    if (condition) {
        console.log(`  ✓ ${name}`);
        passed++;
    } else {
        console.error(`  ✗ ${name}`);
        failed++;
    }
}

function waitForMessageOfType(ws: WebSocket, type: string, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.removeListener('message', handler);
            reject(new Error(`Timeout waiting for message type: ${type}`));
        }, timeout);

        function handler(raw: any) {
            const msg = JSON.parse(raw.toString());
            if (msg.type === type) {
                clearTimeout(timer);
                ws.removeListener('message', handler);
                resolve(msg);
            }
            // else: skip this message, keep listening
        }

        ws.on('message', handler);
    });
}

function waitForMessage(ws: WebSocket, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
        ws.once('message', (raw) => {
            clearTimeout(timer);
            resolve(JSON.parse(raw.toString()));
        });
    });
}

async function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
    console.log('Starting Hub Server on port', PORT);
    const wss = startHub({ port: PORT, verbose: false });

    await sleep(500);

    // --- Test 1: Agent Registration ---
    console.log('\n[Test 1] Agent Registration');

    const agentA = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise(r => agentA.on('open', r));

    agentA.send(JSON.stringify({
        type: 'agent:register',
        name: 'Alex',
        role: 'Backend Engineer',
    }));

    const regA = await waitForMessage(agentA);
    assert(regA.type === 'agent:registered', 'Agent A receives agent:registered');
    assert(typeof regA.agentId === 'string', 'Agent A gets a UUID');
    assert(Array.isArray(regA.teammates), 'Agent A gets teammates array');
    assert(regA.teammates.length === 0, 'No teammates yet');

    // --- Test 2: Second Agent + Teammate Discovery ---
    console.log('\n[Test 2] Second Agent + Teammate Discovery');

    const agentB = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise(r => agentB.on('open', r));

    // Agent A should get a broadcast about Agent B
    const broadcastPromise = waitForMessageOfType(agentA, 'agent:status:broadcast');

    agentB.send(JSON.stringify({
        type: 'agent:register',
        name: 'Jordan',
        role: 'Frontend Engineer',
    }));

    const regB = await waitForMessage(agentB);
    assert(regB.type === 'agent:registered', 'Agent B receives agent:registered');
    assert(regB.teammates.length === 1, 'Agent B sees 1 teammate');
    assert(regB.teammates[0].name === 'Alex', 'Agent B sees Alex');

    const broadcast = await broadcastPromise;
    assert(broadcast.type === 'agent:status:broadcast', 'Agent A receives status broadcast');
    assert(broadcast.name === 'Jordan', 'Broadcast is about Jordan');

    // --- Test 3: Relay Ask/Answer ---
    console.log('\n[Test 3] Relay Ask/Answer');

    const requestId = 'test-req-001';

    // Set up listener for the question BEFORE sending ask
    const questionPromise = waitForMessageOfType(agentB, 'relay:question');

    // Agent A asks Agent B
    agentA.send(JSON.stringify({
        type: 'relay:ask',
        requestId,
        fromAgent: 'Alex',
        toAgent: 'Jordan',
        question: 'What framework are we using?',
    }));

    // Agent B should receive the question (filtered by type, skipping relay:start)
    const question = await questionPromise;
    assert(question.type === 'relay:question', 'Agent B receives relay:question');
    assert(question.requestId === requestId, 'Request ID matches');
    assert(question.fromAgent === 'Alex', 'Question from Alex');
    assert(question.question === 'What framework are we using?', 'Question content matches');

    // Set up listener for response BEFORE answering
    const responsePromise = waitForMessageOfType(agentA, 'relay:response');

    // Agent B answers
    agentB.send(JSON.stringify({
        type: 'relay:answer',
        requestId,
        answer: 'We are using Next.js 16 + React 19',
    }));

    // Agent A should receive the response (filtered by type, skipping relay:start/relay:done)
    const response = await responsePromise;
    assert(response.type === 'relay:response', 'Agent A receives relay:response');
    assert(response.requestId === requestId, 'Response request ID matches');
    assert(response.answer === 'We are using Next.js 16 + React 19', 'Answer content matches');

    // --- Test 4: Relay Assign ---
    console.log('\n[Test 4] Relay Assign');

    const taskRequestId = 'test-task-001';

    // Set up listener BEFORE sending assign
    const taskPromise = waitForMessageOfType(agentB, 'relay:task');

    agentA.send(JSON.stringify({
        type: 'relay:assign',
        requestId: taskRequestId,
        fromAgent: 'Alex',
        toAgent: 'Jordan',
        task: 'Implement the login page',
        priority: 'high',
    }));

    // Agent B should receive the task (filtered, skipping relay:start/relay:done)
    const task = await taskPromise;
    assert(task.type === 'relay:task', 'Agent B receives relay:task');
    assert(task.requestId === taskRequestId, 'Task request ID matches');
    assert(task.fromAgent === 'Alex', 'Task from Alex');
    assert(task.task === 'Implement the login page', 'Task content matches');
    assert(task.priority === 'high', 'Priority is high');

    // --- Test 5: Viewer Connection ---
    console.log('\n[Test 5] Viewer Connection');

    const viewer = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise(r => viewer.on('open', r));

    // Collect messages for viewer
    const viewerMessages: any[] = [];
    viewer.on('message', (raw) => {
        viewerMessages.push(JSON.parse(raw.toString()));
    });

    viewer.send(JSON.stringify({ type: 'viewer:connect' }));

    // Wait a bit for messages to arrive
    await sleep(500);

    assert(viewerMessages.length >= 2, `Viewer receives at least 2 agent statuses (got ${viewerMessages.length})`);
    assert(
        viewerMessages.every(m => m.type === 'agent:status:broadcast'),
        'All viewer messages are agent:status:broadcast'
    );

    // --- Test 6: Status Update ---
    console.log('\n[Test 6] Status Update');

    const statusPromise = waitForMessageOfType(agentA, 'agent:status:broadcast');

    agentB.send(JSON.stringify({ type: 'agent:status', status: 'working' }));

    const statusMsg = await statusPromise;
    assert(statusMsg.type === 'agent:status:broadcast', 'Agent A receives status broadcast');
    assert(statusMsg.name === 'Jordan', 'Status broadcast for Jordan');
    assert(statusMsg.status === 'working', 'Status is working');

    // --- Test 7: Ask Non-Existent Agent ---
    console.log('\n[Test 7] Ask Non-Existent Agent');

    const errPromise = waitForMessageOfType(agentA, 'relay:response');

    agentA.send(JSON.stringify({
        type: 'relay:ask',
        requestId: 'test-err-001',
        fromAgent: 'Alex',
        toAgent: 'NonExistent',
        question: 'hello?',
    }));

    const errMsg = await errPromise;
    assert(errMsg.type === 'relay:response', 'Error response received');
    assert(errMsg.answer.includes('not connected'), 'Error mentions not connected');

    // --- Test 8: Agent Disconnection ---
    console.log('\n[Test 8] Agent Disconnection');

    const disconnectPromise = waitForMessageOfType(agentA, 'agent:disconnected');

    agentB.close();

    const disconnectMsg = await disconnectPromise;
    assert(disconnectMsg.type === 'agent:disconnected', 'Agent A receives disconnection');
    assert(disconnectMsg.name === 'Jordan', 'Disconnected agent is Jordan');

    // --- Cleanup ---
    agentA.close();
    viewer.close();
    await sleep(200);

    wss.close();

    console.log(`\n${'='.repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`${'='.repeat(40)}`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
