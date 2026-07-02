import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  return { response, data };
}

test('POST /api/auth/register creates a new user and returns token', async () => {
  const username = `testuser${Date.now()}`;

  const { response, data } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: '123456',
      displayName: 'Test User'
    })
  });

  assert.equal(response.status, 201);
  assert.ok(data.token);
  assert.equal(data.user.username, username);
  assert.equal(data.user.displayName, 'Test User');
});

test('POST /api/auth/register rejects short username', async () => {
  const { response, data } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: 'ab',
      password: '123456'
    })
  });

  assert.equal(response.status, 400);
  assert.ok(data.error);
});

test('POST /api/auth/register rejects short password', async () => {
  const { response, data } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: `testuser${Date.now()}`,
      password: '123'
    })
  });

  assert.equal(response.status, 400);
  assert.ok(data.error);
});

test('POST /api/auth/register rejects duplicate username', async () => {
  const username = `duplicate${Date.now()}`;

  await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: '123456'
    })
  });

  const { response, data } = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: '123456'
    })
  });

  assert.equal(response.status, 409);
  assert.ok(data.error);
});

test('POST /api/auth/login returns token for valid demo user', async () => {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'demo',
      password: '123456'
    })
  });

  assert.equal(response.status, 200);
  assert.ok(data.token);
  assert.equal(data.user.username, 'demo');
});

test('POST /api/auth/login rejects wrong password', async () => {
  const { response, data } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'demo',
      password: 'wrong-password'
    })
  });

  assert.equal(response.status, 401);
  assert.ok(data.error);
});

test('GET /api/auth/me rejects missing token', async () => {
  const { response, data } = await request('/api/auth/me');

  assert.equal(response.status, 401);
  assert.ok(data.error);
});

test('GET /api/auth/me returns current user with a valid token', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'demo',
      password: '123456'
    })
  });

  const { response, data } = await request('/api/auth/me', {
    headers: {
      authorization: `Bearer ${login.data.token}`
    }
  });

  assert.equal(response.status, 200);
  assert.equal(data.user.username, 'demo');
});

test('POST /api/auth/logout invalidates token', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'demo',
      password: '123456'
    })
  });

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${login.data.token}`
    }
  });

  assert.equal(logout.response.status, 200);
  assert.equal(logout.data.ok, true);

  const me = await request('/api/auth/me', {
    headers: {
      authorization: `Bearer ${login.data.token}`
    }
  });

  assert.equal(me.response.status, 401);
});
