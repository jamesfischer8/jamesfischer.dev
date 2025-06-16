import { expect, it, describe, beforeEach } from 'vitest';
import { onRequestGet, onRequestPost, onRequestDelete } from './guestbook.js';

describe('Guestbook API', () => {
  let mockKvStore;
  let mockEnv;

  beforeEach(() => {
    mockKvStore = new Map();
    mockEnv = {
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
      },
    };
  });

  describe('GET requests', () => {
    it('should handle GET request with empty guestbook', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        headers: { 'CF-Connecting-IP': '127.0.0.1' },
      });

      const response = await onRequestGet({ request, env: mockEnv });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });

    it('should filter out deleted and unapproved entries', async () => {
      // Add test entries
      mockKvStore.set('entry-1', JSON.stringify({
        name: 'John',
        remarks: 'Hello',
        timestamp: '2023-01-01T00:00:00.000Z',
        ip: '192.168.1.1'
      }));
      mockKvStore.set('entry-2', JSON.stringify({
        name: 'Jane',
        remarks: 'World',
        timestamp: '2023-01-02T00:00:00.000Z',
        ip: '192.168.1.2',
        deleted: true
      }));
      mockKvStore.set('entry-3', JSON.stringify({
        name: 'Bob',
        remarks: 'Test',
        timestamp: '2023-01-03T00:00:00.000Z',
        ip: '192.168.1.3',
        needsApproval: true
      }));

      const request = new Request('http://localhost/api/guestbook', {
        headers: { 'CF-Connecting-IP': '127.0.0.1' },
      });

      const response = await onRequestGet({ request, env: mockEnv });
      const data = await response.json();

      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('John');
      expect(data[0].ip).toBeUndefined(); // IP should be removed
      expect(data[0].ipMatch).toBe(false);
    });

    it('should mark IP matches correctly', async () => {
      const testIp = '192.168.1.100';
      mockKvStore.set('entry-1', JSON.stringify({
        name: 'Test User',
        remarks: 'My entry',
        timestamp: '2023-01-01T00:00:00.000Z',
        ip: testIp
      }));

      const request = new Request('http://localhost/api/guestbook', {
        headers: { 'CF-Connecting-IP': testIp },
      });

      const response = await onRequestGet({ request, env: mockEnv });
      const data = await response.json();

      expect(data[0].ipMatch).toBe(true);
    });

    it('should require IP header', async () => {
      const request = new Request('http://localhost/api/guestbook');

      const response = await onRequestGet({ request, env: mockEnv });
      expect(response.status).toBe(400);
    });
  });

  describe('POST requests', () => {
    it('should validate required fields', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing required fields');
    });

    it('should validate content length limits', async () => {
      const longName = 'a'.repeat(51);
      const longRemarks = 'b'.repeat(201);

      // Test long name
      let request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: longName, remarks: 'short' }),
      });

      let response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Content too long');

      // Test long remarks
      request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'short', remarks: longRemarks }),
      });

      response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(400);
    });

    it('should create entry successfully with valid data', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Test User', remarks: 'Hello world' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.name).toBe('Test User');
      expect(data.remarks).toBe('Hello world');
      expect(data.key).toBeDefined();
      expect(data.timestamp).toBeDefined();
      expect(data.ip).toBeUndefined(); // IP should not be in public response
    });

    it('should handle missing remarks gracefully', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Test User' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.remarks).toBe('');
    });

    it('should require IP header', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test User' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing IP address');
    });

    it('should set needsApproval when there is pending approval backlog', async () => {
      // Add an entry that needs approval
      mockKvStore.set('entry-pending', JSON.stringify({
        name: 'Pending User',
        remarks: 'Waiting for approval',
        timestamp: '2023-01-01T00:00:00.000Z',
        ip: '192.168.1.50',
        needsApproval: true
      }));

      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'New User', remarks: 'Hello' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      const data = await response.json();

      expect(data.needsApproval).toBe(true);
    });

    it('should set needsApproval for high activity (5+ posts in 12 hours)', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Add 5 recent entries to trigger high activity
      for (let i = 0; i < 5; i++) {
        mockKvStore.set(`entry-recent-${i}`, JSON.stringify({
          name: `User ${i}`,
          remarks: `Message ${i}`,
          timestamp: oneHourAgo.toISOString(),
          ip: `192.168.1.${i + 10}`
        }));
      }

      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'New User', remarks: 'Hello' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      const data = await response.json();

      expect(data.needsApproval).toBe(true);
    });

    it('should set needsApproval for prior post today from same IP', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const testIp = '127.0.0.1';

      // Add an entry from today with same IP
      mockKvStore.set('entry-today', JSON.stringify({
        name: 'Earlier User',
        remarks: 'Posted earlier',
        timestamp: `${today}T10:00:00.000Z`,
        ip: testIp
      }));

      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': testIp,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Same IP User', remarks: 'Second post' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      const data = await response.json();

      expect(data.needsApproval).toBe(true);
    });

    it('should not set needsApproval for normal conditions', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Normal User', remarks: 'Hello' }),
      });

      const response = await onRequestPost({ request, env: mockEnv });
      const data = await response.json();

      expect(data.needsApproval).toBe(false);
    });
  });

  describe('DELETE requests', () => {
    it('should delete entry with matching IP', async () => {
      const testIp = '127.0.0.1';
      const entryKey = 'entry-test';

      mockKvStore.set(entryKey, JSON.stringify({
        name: 'Test User',
        remarks: 'Test entry',
        timestamp: '2023-01-01T00:00:00.000Z',
        ip: testIp
      }));

      const request = new Request('http://localhost/api/guestbook', {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': testIp,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: entryKey }),
      });

      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.success).toBe(true);

      // Check that entry is soft-deleted
      const storedEntry = JSON.parse(mockKvStore.get(entryKey));
      expect(storedEntry.deleted).toBe(true);
    });

    it('should reject delete with mismatched IP', async () => {
      const entryKey = 'entry-test';

      mockKvStore.set(entryKey, JSON.stringify({
        name: 'Test User',
        remarks: 'Test entry',
        timestamp: '2023-01-01T00:00:00.000Z',
        ip: '192.168.1.100'
      }));

      const request = new Request('http://localhost/api/guestbook', {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': '127.0.0.1', // Different IP
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: entryKey }),
      });

      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('IP mismatch');
    });

    it('should return 404 for non-existent entry', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'non-existent-key' }),
      });

      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Entry not found');
    });

    it('should require key in request body', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing entry key');
    });

    it('should require IP header', async () => {
      const entryKey = 'entry-test';

      // Add a test entry first
      mockKvStore.set(entryKey, JSON.stringify({
        name: 'Test User',
        remarks: 'Test entry',
        timestamp: '2023-01-01T00:00:00.000Z',
        ip: '192.168.1.1'
      }));

      const request = new Request('http://localhost/api/guestbook', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: entryKey }),
      });

      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing IP address');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed JSON in POST', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: '{ invalid json',
      });

      const response = await onRequestPost({ request, env: mockEnv });
      expect(response.status).toBe(500);
    });

    it('should handle malformed JSON in DELETE', async () => {
      const request = new Request('http://localhost/api/guestbook', {
        method: 'DELETE',
        headers: {
          'CF-Connecting-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: '{ invalid json',
      });

      const response = await onRequestDelete({ request, env: mockEnv });
      expect(response.status).toBe(500);
    });

    it('should handle KV store errors gracefully', async () => {
      const failingEnv = {
        GUESTBOOK: {
          list: () => Promise.reject(new Error('KV Error')),
          get: () => Promise.reject(new Error('KV Error')),
          put: () => Promise.reject(new Error('KV Error')),
        },
      };

      const request = new Request('http://localhost/api/guestbook', {
        headers: { 'CF-Connecting-IP': '127.0.0.1' },
      });

      const response = await onRequestGet({ request, env: failingEnv });
      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.error).toBe('Failed to fetch entries');
    });
  });
});