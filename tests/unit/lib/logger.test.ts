// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel, LogFormat } from '../../../src/lib/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let loggerInstance: Logger;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    loggerInstance = new Logger();
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('log levels', () => {
    it('should output INFO messages by default', () => {
      loggerInstance.info('hello');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[INFO]');
      expect(output).toContain('hello');
    });

    it('should output WARN messages', () => {
      loggerInstance.warn('warning');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[WARN]');
    });

    it('should output ERROR messages', () => {
      loggerInstance.error('error');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[ERROR]');
    });

    it('should NOT output DEBUG messages by default', () => {
      loggerInstance.debug('debug info');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should output DEBUG messages when log level is debug', () => {
      loggerInstance.configure({ level: LogLevel.DEBUG });
      loggerInstance.debug('debug info');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[DEBUG]');
      expect(output).toContain('debug info');
    });
  });

  describe('output format', () => {
    it('should include ISO timestamp', () => {
      loggerInstance.info('test');
      const output = stderrSpy.mock.calls[0]![0] as string;
      // ISO timestamp pattern: 2026-04-09T...Z
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should write to stderr (not stdout)', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      loggerInstance.info('test');
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });

    it('should include trailing newline', () => {
      loggerInstance.info('test');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output.endsWith('\n')).toBe(true);
    });
  });

  describe('sensitive data sanitization', () => {
    it('should redact objects with token keys', () => {
      loggerInstance.info('auth', { token: 'secret123' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('secret123');
      expect(output).toContain('***');
    });

    it('should redact objects with password keys', () => {
      loggerInstance.info('creds', { password: 'p@ss' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('p@ss');
    });

    it('should redact objects with secret keys', () => {
      loggerInstance.info('config', { client_secret: 'abc123' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('abc123');
    });

    it('should redact objects with credential keys', () => {
      loggerInstance.info('auth', { credential: 'xyz' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('xyz');
    });

    it('should redact objects with authorization keys', () => {
      loggerInstance.info('headers', { authorization: 'Bearer abc' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('Bearer abc');
    });

    it('should redact the standalone "key" field', () => {
      loggerInstance.info('sub', { key: 'subscription-key-value' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('subscription-key-value');
    });

    it('should NOT redact non-sensitive compound key names', () => {
      loggerInstance.info('config', { keyName: 'myNamedValue', keyVault: '/vaults/v1' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      // keyName and keyVault are not sensitive — they should be preserved
      expect(output).toContain('myNamedValue');
      expect(output).toContain('/vaults/v1');
    });

    it('should redact inline Bearer tokens in string args', () => {
      // Sanitization is applied to args, not the message string
      loggerInstance.info('auth header:', 'Bearer eyJhbGciOiJSUzI1NiJ9.abc.def');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('eyJhbGciOiJSUzI1NiJ9');
      expect(output).toContain('Bearer ***');
    });

    it('should sanitize nested objects recursively', () => {
      loggerInstance.info('nested', { outer: { inner: { access_token: 'nested-secret' } } });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('nested-secret');
    });

    it('should sanitize arrays', () => {
      loggerInstance.info('list', [{ token: 'a' }, { token: 'b' }]);
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('"a"');
      expect(output).not.toContain('"b"');
    });

    it('should pass through non-sensitive data unchanged', () => {
      loggerInstance.info('data', { name: 'test', count: 42 });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('test');
      expect(output).toContain('42');
    });

    it('should serialize Error objects with message and stack', () => {
      const error = new Error('Something went wrong');
      loggerInstance.error('Error occurred:', error);
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('Something went wrong');
      expect(output).toContain('"name":"Error"');
      expect(output).toContain('"message":"Something went wrong"');
      // Stack trace should be present (not testing exact format)
      expect(output).toContain('"stack"');
    });

    it('should serialize Error objects with cause', () => {
      const innerError = new Error('Inner error');
      const outerError = new Error('Outer error', { cause: innerError });
      loggerInstance.error('Nested error:', outerError);
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('Outer error');
      expect(output).toContain('Inner error');
      expect(output).toContain('"cause"');
    });
  });

  describe('non-ASCII punctuation normalization', () => {
    it('should replace em dash with ASCII hyphen', () => {
      loggerInstance.info('resource not found \u2014 returning empty list');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u2014');
      expect(output).toContain('resource not found - returning empty list');
    });

    it('should replace en dash with ASCII hyphen', () => {
      loggerInstance.info('range 1\u20132');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u2013');
      expect(output).toContain('range 1-2');
    });

    it('should replace smart single quotes with ASCII apostrophe', () => {
      loggerInstance.info('\u2018hello\u2019');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u2018');
      expect(output).not.toContain('\u2019');
      expect(output).toContain("'hello'");
    });

    it('should replace smart double quotes with ASCII double quotes', () => {
      loggerInstance.info('\u201Chello\u201D');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u201C');
      expect(output).not.toContain('\u201D');
      expect(output).toContain('"hello"');
    });

    it('should replace ellipsis with three dots', () => {
      loggerInstance.info('loading\u2026');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u2026');
      expect(output).toContain('loading...');
    });

    it('should produce ASCII-only output for the known mojibake source message', () => {
      // Regression: em dash in this specific message was rendering as "ΓÇö" on Windows CP437
      loggerInstance.configure({ level: LogLevel.DEBUG });
      loggerInstance.debug(
        'Resource type Documentation returned HTTP 404, resource collection not found \u2014 returning empty list',
      );
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u2014');
      // Entire log line should contain only ASCII characters (code points 0x00–0x7F)
      expect([...output].every((ch) => ch.charCodeAt(0) <= 0x7f)).toBe(true);
    });

    it('should normalize non-ASCII punctuation in args too', () => {
      loggerInstance.info('details', { note: 'see section 3\u2014Overview' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('\u2014');
      expect([...output].every((ch) => ch.charCodeAt(0) <= 0x7f)).toBe(true);
    });
  });

  describe('configure', () => {
    it('should enable debug level', () => {
      loggerInstance.configure({ level: LogLevel.DEBUG });
      loggerInstance.debug('visible');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('should restore info level', () => {
      loggerInstance.configure({ level: LogLevel.DEBUG });
      loggerInstance.configure({ level: LogLevel.INFO });
      loggerInstance.debug('hidden');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should filter INFO messages when level is WARN', () => {
      loggerInstance.configure({ level: LogLevel.WARN });
      loggerInstance.info('should not appear');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should output WARN messages when level is WARN', () => {
      loggerInstance.configure({ level: LogLevel.WARN });
      loggerInstance.warn('should appear');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[WARN]');
      expect(output).toContain('should appear');
    });

    it('should filter WARN messages when level is ERROR', () => {
      loggerInstance.configure({ level: LogLevel.ERROR });
      loggerInstance.warn('should not appear');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should output all levels when level is DEBUG', () => {
      loggerInstance.configure({ level: LogLevel.DEBUG });
      loggerInstance.debug('debug msg');
      loggerInstance.info('info msg');
      loggerInstance.warn('warn msg');
      loggerInstance.error('error msg');
      expect(stderrSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('pretty format', () => {
    it('should omit timestamp and level prefix in pretty mode', () => {
      loggerInstance.setFormat('pretty');
      loggerInstance.info('hello world');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toBe('hello world\n');
      expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(output).not.toContain('[INFO]');
    });

    it('should still include timestamp and level in structured mode', () => {
      loggerInstance.setFormat('structured');
      loggerInstance.info('hello world');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(output).toContain('[INFO]');
    });

    it('should still respect log level filtering in pretty mode', () => {
      loggerInstance.configure({ level: LogLevel.WARN });
      loggerInstance.setFormat('pretty');
      loggerInstance.info('should be hidden');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should still sanitize sensitive data in pretty mode', () => {
      loggerInstance.setFormat('pretty');
      loggerInstance.info('auth', { token: 'secret123' });
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).not.toContain('secret123');
      expect(output).toContain('***');
    });

    it('should be settable via configure()', () => {
      loggerInstance.configure({ level: LogLevel.INFO, format: 'pretty' });
      loggerInstance.info('clean output');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toBe('clean output\n');
    });

    it('should default to structured format', () => {
      loggerInstance.info('test');
      const output = stderrSpy.mock.calls[0]![0] as string;
      expect(output).toContain('[INFO]');
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('should export LogFormat type', () => {
      const fmt: LogFormat = 'pretty';
      expect(fmt).toBe('pretty');
    });
  });
});
