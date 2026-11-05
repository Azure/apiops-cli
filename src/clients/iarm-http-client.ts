// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/**
 * IArmHttpClient — abstraction over authenticated ARM requests, implemented
 * by ArmHttpClient. Lets the Key Vault pre-flight check be tested without a
 * credential or network.
 */

import type { ArmRequestOptions } from './arm-http-client.js';

export interface IArmHttpClient {
  /** Get a (cached) bearer token for the client's ARM scope. */
  getToken(): Promise<string>;

  /**
   * Send an authenticated ARM request with retries. Non-OK responses throw
   * `HttpError`, except those the options (or a GET 404) let through.
   */
  request(url: string, init?: RequestInit, options?: ArmRequestOptions): Promise<Response>;
}
