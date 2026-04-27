import '../src/core/metadata';
import { describe, test, expect } from 'bun:test';
import { parseFunctionCall, parseFnArgs } from '../src/decorators/fn';

// ─── parseFunctionCall ───────────────────────────────────────────────────────

describe('@Fn — parseFunctionCall', () => {
  test('bare name (no parens)', () => {
    expect(parseFunctionCall('/.greet')).toEqual({ name: 'greet', rawArgs: '' });
  });

  test('empty parens', () => {
    expect(parseFunctionCall('/.greet()')).toEqual({ name: 'greet', rawArgs: '' });
  });

  test('with arguments', () => {
    expect(parseFunctionCall('/.add(1,2)')).toEqual({ name: 'add', rawArgs: '1,2' });
  });

  test('URL-encoded args are decoded', () => {
    const result = parseFunctionCall('/.greet(%22Alice%22)');
    expect(result?.rawArgs).toBe('"Alice"');
  });

  test('underscore and $ in name', () => {
    expect(parseFunctionCall('/.$find_user()')?.name).toBe('$find_user');
  });

  test('regular route returns null', () => {
    expect(parseFunctionCall('/users')).toBeNull();
  });

  test('bare dot returns null (no name)', () => {
    expect(parseFunctionCall('/.')).toBeNull();
  });

  test('invalid encoding returns null', () => {
    expect(parseFunctionCall('/.fn(%zz')).toBeNull();
  });

  test('name starts with digit returns null', () => {
    expect(parseFunctionCall('/.1fn()')).toBeNull();
  });
});

// ─── parseFnArgs ─────────────────────────────────────────────────────────────

describe('@Fn — parseFnArgs', () => {
  test('empty string → []', () =>
    expect(parseFnArgs('')).toEqual([]));

  test('integer', () =>
    expect(parseFnArgs('42')).toEqual([42]));

  test('negative integer', () =>
    expect(parseFnArgs('-7')).toEqual([-7]));

  test('float', () =>
    expect(parseFnArgs('3.14')).toEqual([3.14]));

  test('scientific notation', () =>
    expect(parseFnArgs('1e3')).toEqual([1000]));

  test('true', () =>
    expect(parseFnArgs('true')).toEqual([true]));

  test('false', () =>
    expect(parseFnArgs('false')).toEqual([false]));

  test('null', () =>
    expect(parseFnArgs('null')).toEqual([null]));

  test('undefined', () =>
    expect(parseFnArgs('undefined')).toEqual([undefined]));

  test('double-quoted string', () =>
    expect(parseFnArgs('"hello world"')).toEqual(['hello world']));

  test('single-quoted string', () =>
    expect(parseFnArgs("'hi there'")).toEqual(['hi there']));

  test('unquoted string', () =>
    expect(parseFnArgs('alice')).toEqual(['alice']));

  test('multiple args', () =>
    expect(parseFnArgs('1,2,3')).toEqual([1, 2, 3]));

  test('mixed types', () =>
    expect(parseFnArgs('"Alice",25,true,null')).toEqual(['Alice', 25, true, null]));

  test('whitespace around args', () =>
    expect(parseFnArgs('1, 2, 3')).toEqual([1, 2, 3]));

  test('escape sequences in quoted string', () =>
    expect(parseFnArgs('"line\\nbreak"')).toEqual(['line\nbreak']));

  test('tab escape', () =>
    expect(parseFnArgs('"col\\there"')).toEqual(['col\there']));
});
