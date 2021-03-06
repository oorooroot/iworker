import * as assert from 'assert';
import * as crypto from 'crypto';
import {ICallPromise, Thread, ThreadClient, WorkerGroup} from "../src";
import {AssertionError} from "assert";

describe('IWorker', () => {
  const wg = new WorkerGroup();

  it('should create by object schema', async () => {
    const w = wg.newThread({
      async foo(bar) { return 'foo' + bar; }, // with enhanced object literals
      bar: async (foo) => { return 'bar' + foo; }, // with arrow function
      baz: async function(foo) { return foo + 'baz'; } // with pure function
    });

    assert.strictEqual(await w.call('foo', 'bar'), 'foobar');
    assert.strictEqual(await w.call('bar', 'foo'), 'barfoo');
    assert.strictEqual(await w.call('baz', 'foo'), 'foobaz');
    w.terminate();
  });

  it('should create by factory', async () => {
    const w = wg.newThread((worker: ThreadClient) => {
      worker.def('foo', async () => { return true; });
    });

    assert.strictEqual(await w.call('foo'), true);

    w.terminate();
  });

  it('should terminate worker', async () => {
    const w = wg.newThread<ISchema>({
      async foo(bar: string) {
        return 'foo' + bar;
      }
    });
    w.terminate();

    const err = await captureErr(w.call('foo', 'bar'));
    assert.strictEqual(err.message, 'Cannot read property \'postMessage\' of null');
  });


  it('should send transferable objects', async () => {
    const w = wg.newThread({
      async foo(buf) {
        return Buffer.from(buf).toString('hex');
      }
    });

    const buf = crypto.randomBytes(32);
    const bufHex = buf.toString('hex');

    const res = await w.call('foo', buf).withTransferList([buf.buffer]);
    assert.strictEqual(res, bufHex);
    assert.strictEqual(buf.length, 0);

    w.terminate();
  });

  it('should response transferable objects', async () => {
    const w = wg.newThread({
      async foo(buf) {
        this.setTransferList([buf.buffer]);
        return { buf };
      }
    });

    const buf = crypto.randomBytes(32);

    const res = await w.call('foo', buf);
    assert.strictEqual(Buffer.from(res.buf).toString('hex'), buf.toString('hex'));

    w.terminate();
  });

  it('should throw error when call undefined method', async () => {
    const w = wg.newThread({});

    const err = await captureErr(w.call('foo'));
    assert.strictEqual(err.message, 'Method foo is unhandled');

    w.terminate();
  });

  it('should transfer method throw', async () => {
    const w = wg.newThread({ async foo() { throw new Error('FooError')} });

    const err = await captureErr(w.call('foo'));
    assert.strictEqual(err.message, 'FooError');

    w.terminate();
  });


  it('should send call-event', async() => {
    const w = wg.newThread({
      async foo(n) {
        for(let i = 0; i < n; i++) {
          this.sendEvent('someEvent', i);
        }
        return 'bar';
      }
    });

    const events = [];
    const res = await w
      .call('foo', 3)
      .on('someEvent', (n) => {
        events.push(n);
      });

    assert.strictEqual(events.join(''), '012');
    assert.strictEqual(res, 'bar');

    w.terminate();
  });

  it('should send pure events', async() => {
    const w = wg.newThread((worker: ThreadClient) => {
      worker.on('someEvent', (...args: any[]) => {
        worker.emit('someEventBack', args.join(''));
      });
    });

    let { cb, promise } = cbToPromise();
    w.on('someEventBack', cb);
    w.emit('someEvent', 1, 2, 3);

    const resp = await promise;
    assert.strictEqual(resp, '123');

    w.terminate();
  });

  interface ISchema {
    foo(bar: string): ICallPromise<string>
  }

  it('should proxy direct calls', async () => {
    const w = wg.newThread<ISchema>({
      async foo(bar: string) {
        return 'foo' + bar;
      }
    });

    const res = await w.foo('bar');
    assert.strictEqual(res, 'foobar');
    w.terminate();
  });

  function cbToPromise() {
    let cb;
    let promise = new Promise((resolve) => { cb = resolve; });

    return { cb, promise };
  }

  async function captureErr(promise) {
    try {
      await promise;
    } catch(e) {
      return e;
    }

    throw new Error('not threw expected exception');
  }

});