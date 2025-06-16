import { expect, it, describe, beforeEach } from 'vitest';
import { onRequestGet, onRequestDelete, onRequestPut } from './guestbook-admin.js';

describe('Guestbook admin API', () => {
  let mockKvStore;
  let mockEnv;

  beforeEach(() => {
    mockKvStore = new Map();
    mockEnv = {
      ADMIN_SECRET: 'secret',
      GUESTBOOK: {
        list: ({ prefix = '', cursor } = {}) => {
          const keys = Array.from(mockKvStore.keys())
            .filter(key => key.startsWith(prefix))
            .map(name => ({ name }));
          return Promise.resolve({ keys, cursor: null });
        },
        get: (key) => Promise.resolve(mockKvStore.get(key) || null),
        put: (key, value) => {
          mockKvStore.set(key, value);
          return Promise.resolve();
        },
        delete: (key) => {
          mockKvStore.delete(key);
          return Promise.resolve();
        },
      },
    };
  });

  describe('GET requests', () => {
    it('returns unauthorized without secret', async () => {
      const request = new Request('http://localhost/api/guestbook-admin');
      const response = await onRequestGet({ request, env: mockEnv });
      expect(response.status).toBe(403);
    });

    it('returns entries with valid secret', async () => {
      mockKvStore.set('entry-1', JSON.stringify({ name: 'John' }));
      const request = new Request('http://localhost/api/guestbook-admin?secret=secret');
      const response = await onRequestGet({ request, env: mockEnv });
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ key: 'entry-1', name: 'John' });
    });
  });

  describe('DELETE requests', () => {
    it('soft-deletes entry', async () => {
      mockKvStore.set('entry-1', JSON.stringify({ name: 'John' }));
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'entry-1', secret: 'secret' }),
      });
      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(200);
      const stored = JSON.parse(mockKvStore.get('entry-1'));
      expect(stored.deleted).toBe(true);
    });

    it('hard-deletes entry', async () => {
      mockKvStore.set('entry-2', JSON.stringify({ name: 'Jane' }));
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'entry-2', secret: 'secret', hard: true }),
      });
      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(200);
      expect(mockKvStore.has('entry-2')).toBe(false);
    });

    it('rejects unauthorized delete', async () => {
      mockKvStore.set('entry-3', JSON.stringify({ name: 'Bob' }));
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'entry-3', secret: 'bad' }),
      });
      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(403);
    });

    it('returns 404 for missing entry', async () => {
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'missing', secret: 'secret' }),
      });
      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(404);
    });
  });

  describe('PUT requests', () => {
    it('approves an entry', async () => {
      mockKvStore.set('entry-1', JSON.stringify({ name: 'John', needsApproval: true }));
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'entry-1', secret: 'secret', approve: true }),
      });
      const response = await onRequestPut({ request, env: mockEnv });
      expect(response.status).toBe(200);
      const stored = JSON.parse(mockKvStore.get('entry-1'));
      expect(stored.needsApproval).toBe(false);
    });

    it('undeletes an entry', async () => {
      mockKvStore.set('entry-2', JSON.stringify({ name: 'Jane', deleted: true }));
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'entry-2', secret: 'secret' }),
      });
      const response = await onRequestPut({ request, env: mockEnv });
      expect(response.status).toBe(200);
      const stored = JSON.parse(mockKvStore.get('entry-2'));
      expect(stored.deleted).toBe(false);
    });

    it('rejects unauthorized update', async () => {
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'entry-3', secret: 'bad' }),
      });
      const response = await onRequestPut({ request, env: mockEnv });
      expect(response.status).toBe(403);
    });

    it('returns 404 for missing entry', async () => {
      const request = new Request('http://localhost/api/guestbook-admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'missing', secret: 'secret', approve: true }),
      });
      const response = await onRequestPut({ request, env: mockEnv });
      expect(response.status).toBe(404);
    });
  });
});
