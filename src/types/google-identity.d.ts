/**
 * Type declarations for Google Identity Services (GIS) OAuth2 token model.
 * @see https://developers.google.com/identity/oauth2/web/reference/js-reference
 */

declare namespace google.accounts.oauth2 {
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message: string }) => void;
    prompt?: '' | 'none' | 'consent' | 'select_account';
  }

  interface TokenResponse {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    error?: string;
    error_description?: string;
    error_uri?: string;
  }

  interface TokenClient {
    requestAccessToken(overrideConfig?: { prompt?: string; scope?: string }): void;
  }

  function initTokenClient(config: TokenClientConfig): TokenClient;
}
