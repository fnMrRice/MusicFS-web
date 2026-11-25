import { ApiClient, ApiError } from './client';
import type { AuthSession, Ready } from './types';

function session(value: AuthSession): AuthSession {
  if (!value || typeof value.csrfToken !== 'string' || !value.user || typeof value.user.id !== 'string')
    throw new ApiError('INVALID_RESPONSE', 'Invalid authentication response');
  return value;
}
export class AuthApi {
  constructor(private client: ApiClient) {}
  async ready(signal?: AbortSignal, timeoutMs?: number): Promise<Ready> {
    return this.client.request('/health/ready', { signal, timeoutMs });
  }
  async restore(): Promise<AuthSession> {
    return session(await this.client.request<AuthSession>('/auth/session'));
  }
  async login(token: string): Promise<AuthSession> {
    return session(await this.client.request<AuthSession>('/auth/session', { method: 'POST', bearer: token }));
  }
  async logout(): Promise<void> {
    await this.client.request('/auth/session', { method: 'DELETE' });
  }
}
