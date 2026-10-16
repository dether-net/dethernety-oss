// A stand-in for worker.js that speaks the same messages, for worker-embedder.test.ts. workerData.mode:
//   ok     ready at once; embed returns [text.length, index] per item after workerData.busyMs of synchronous work
//   hang   never ready: one long synchronous call, as a stuck native model load would be
//   fail   says failed, with workerData.message
// An item whose text is 'crash' exits the worker with code 3; one whose text is 'throw' answers an error; one whose
// text starts with 'late' is answered 100 ms later, after the calls made after it.
const { parentPort, workerData } = require('worker_threads');

const busy = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end);
};

if (workerData.mode === 'hang') {
  busy(60_000);
} else if (workerData.mode === 'fail') {
  parentPort.postMessage({ type: 'failed', message: workerData.message });
} else if (workerData.mode === 'ok') {
  parentPort.on('message', (request) => {
    if (request.type === 'release') {
      parentPort.postMessage({ type: 'released' });
      return;
    }
    if (request.items.some((it) => it.text === 'crash')) process.exit(3);
    if (request.items.some((it) => it.text === 'throw')) {
      parentPort.postMessage({ type: 'error', id: request.id, message: 'cannot embed that' });
      return;
    }
    busy(workerData.busyMs ?? 0);
    const reply = () => parentPort.postMessage({ type: 'result', id: request.id, vectors: request.items.map((it, i) => [it.text.length, i]) });
    // An item starting 'late' is answered after the calls that follow it.
    if (request.items.some((it) => it.text.startsWith('late'))) setTimeout(reply, 100);
    else reply();
  });
  parentPort.postMessage({ type: 'ready' });
}
