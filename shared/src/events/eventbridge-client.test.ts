import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-eventbridge', () => {
  const PutEventsCommand = vi.fn().mockImplementation((input: { Entries: unknown[] }) => ({ input }));
  const EventBridgeClient = vi.fn().mockImplementation(() => ({ send: vi.fn() }));
  return { EventBridgeClient, PutEventsCommand };
});

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createEventBridgeClient, makeDomainEvent } from './eventbridge-client.js';
import type { DomainEvent } from './types.js';

const mockedClient = vi.mocked(EventBridgeClient);
const mockedCommand = vi.mocked(PutEventsCommand);

type Send = ReturnType<typeof vi.fn>;
let send: Send;

function buildPublisher(busArn = 'arn:aws:events:us-east-1:123:rule/foo'): ReturnType<typeof createEventBridgeClient> {
  const publisher = createEventBridgeClient({ busArn });
  const instance = mockedClient.mock.instances[mockedClient.mock.instances.length - 1] as { send: Send };
  send = instance.send;
  return publisher;
}

function makeEvent(): DomainEvent {
  return makeDomainEvent('test.source', 'TestEvent', { foo: 'bar' });
}

beforeEach(() => {
  mockedClient.mockClear();
  mockedCommand.mockClear();
  send = vi.fn();
});

describe('createEventBridgeClient', () => {
  it('instantiates EventBridgeClient with the provided region', () => {
    buildPublisher();
    expect(mockedClient).toHaveBeenCalledWith({ region: 'us-east-1' });
  });

  it('falls back to AWS_REGION env when no region is provided', () => {
    process.env.AWS_REGION = 'us-west-2';
    try {
      createEventBridgeClient({ busArn: 'arn:aws:events:us-east-1:123:rule/foo' });
      expect(mockedClient).toHaveBeenCalledWith({ region: 'us-west-2' });
    } finally {
      delete process.env.AWS_REGION;
    }
  });

  it('instantiates EventBridgeClient without args when no region is available', () => {
    delete process.env.AWS_REGION;
    buildPublisher();
    expect(mockedClient).toHaveBeenCalledWith({});
  });

  describe('publish', () => {
    it('sends a single entry wrapped in PutEventsCommand', async () => {
      send.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
      const publisher = buildPublisher();

      await publisher.publish(makeEvent());

      expect(send).toHaveBeenCalledOnce();
      const cmd = send.mock.calls[0]![0] as { input: { Entries: Array<Record<string, unknown>> } };
      expect(cmd.input.Entries).toHaveLength(1);
      expect(cmd.input.Entries[0]).toMatchObject({
        EventBusName: 'arn:aws:events:us-east-1:123:rule/foo',
        Source: 'test.source',
        DetailType: 'TestEvent',
      });
      expect(typeof (cmd.input.Entries[0] as { Detail: string }).Detail).toBe('string');
    });

    it('retries on partial failure and succeeds on a later attempt', async () => {
      send
        .mockResolvedValueOnce({
          FailedEntryCount: 1,
          Entries: [{ ErrorCode: 'Throttling', ErrorMessage: 'rate exceeded' }],
        })
        .mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [] });
      const publisher = buildPublisher();

      await publisher.publish(makeEvent());

      expect(send).toHaveBeenCalledTimes(2);
    });

    it('throws the last error after exhausting retries', async () => {
      send.mockRejectedValue(new Error('boom'));
      const publisher = buildPublisher();

      await expect(publisher.publish(makeEvent())).rejects.toThrow('boom');
      expect(send).toHaveBeenCalledTimes(3);
    });

    it('throws a partial-failure error when FailedEntryCount > 0 every attempt', async () => {
      send.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'X', ErrorMessage: 'y' }],
      });
      const publisher = buildPublisher();

      await expect(publisher.publish(makeEvent())).rejects.toThrow(/Partial batch failure: X: y/);
      expect(send).toHaveBeenCalledTimes(3);
    });

    it('falls back to "unknown" when the failure has no entry error code', async () => {
      send.mockResolvedValue({ FailedEntryCount: 1, Entries: [] });
      const publisher = buildPublisher();

      await expect(publisher.publish(makeEvent())).rejects.toThrow(/Partial batch failure: unknown/);
    });
  });

  describe('publishMany', () => {
    it('chunks events into batches of 10', async () => {
      send.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
      const publisher = buildPublisher();

      const events = Array.from({ length: 25 }, () => makeEvent());
      await publisher.publishMany(events);

      expect(send).toHaveBeenCalledTimes(3);
      const sizes = send.mock.calls.map(
        (call) => (call[0] as { input: { Entries: unknown[] } }).input.Entries.length,
      );
      expect(sizes).toEqual([10, 10, 5]);
    });

    it('does not call PutEventsCommand when the event list is empty', async () => {
      const publisher = buildPublisher();
      await publisher.publishMany([]);
      expect(send).not.toHaveBeenCalled();
    });

    it('retries the failing chunk and surfaces the error', async () => {
      send.mockRejectedValue(new Error('chunks fail'));
      const publisher = buildPublisher();

      await expect(publisher.publishMany([makeEvent(), makeEvent()])).rejects.toThrow('chunks fail');
    });
  });
});

describe('makeDomainEvent', () => {
  it('builds a v1 detail envelope by default', () => {
    const event = makeDomainEvent('src', 'Type', { a: 1 });
    expect(event).toEqual({
      source: 'src',
      detailType: 'Type',
      detail: { version: 1, data: { a: 1 } },
    });
  });

  it('respects a custom version', () => {
    const event = makeDomainEvent('src', 'Type', { a: 1 }, 7);
    expect(event.detail.version).toBe(7);
  });
});
