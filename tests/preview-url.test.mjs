import test from 'node:test';
import assert from 'node:assert/strict';
import { localPreviewUrl } from '../lib/preview-url.mjs';
test('project preview accepts explicit loopback development servers and refuses other capabilities', () => {
  assert.equal(localPreviewUrl('http://localhost:5173/hello?theme=dark'), 'http://localhost:5173/hello?theme=dark');
  assert.equal(localPreviewUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/');
  assert.equal(localPreviewUrl('http://[::1]:8080'), 'http://[::1]:8080/');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://example.com', 'http://localhost.evil:5173', 'http://192.168.1.1:3000', 'http://user:key@localhost:5173', 'http://localhost', 'http://localhost:80', 'http://localhost:20128', 'http://127.0.0.1:11434', null, 42]) assert.throws(() => localPreviewUrl(url));
  assert.throws(() => localPreviewUrl('http://127.0.0.1:47821/api/health', ['http://127.0.0.1:47821']));
});
