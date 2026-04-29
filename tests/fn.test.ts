import '../src/core/metadata';
import { Suite, Test, expect } from '../src/testing/decorators';
import { parseFunctionCall, parseFnArgs } from '../src/decorators/fn';

// ─── parseFunctionCall ───────────────────────────────────────────────────────

@Suite('@Fn — parseFunctionCall')
class ParseFunctionCallTests {
  @Test('bare name (no parens)')
  bareName() {
    expect(parseFunctionCall('/.greet')).toEqual({ name: 'greet', rawArgs: '' });
  }

  @Test('empty parens')
  emptyParens() {
    expect(parseFunctionCall('/.greet()')).toEqual({ name: 'greet', rawArgs: '' });
  }

  @Test('with arguments')
  withArgs() {
    expect(parseFunctionCall('/.add(1,2)')).toEqual({ name: 'add', rawArgs: '1,2' });
  }

  @Test('URL-encoded args are decoded')
  urlEncoded() {
    const result = parseFunctionCall('/.greet(%22Alice%22)');
    expect(result?.rawArgs).toBe('"Alice"');
  }

  @Test('underscore and $ in name')
  specialChars() {
    expect(parseFunctionCall('/.$find_user()')?.name).toBe('$find_user');
  }

  @Test('regular route returns null')
  regularRoute() {
    expect(parseFunctionCall('/users')).toBeNull();
  }

  @Test('bare dot returns null (no name)')
  bareDot() {
    expect(parseFunctionCall('/.')).toBeNull();
  }

  @Test('invalid encoding returns null')
  invalidEncoding() {
    expect(parseFunctionCall('/.fn(%zz')).toBeNull();
  }

  @Test('name starts with digit returns null')
  digitStart() {
    expect(parseFunctionCall('/.1fn()')).toBeNull();
  }
}

// ─── parseFnArgs ─────────────────────────────────────────────────────────────

@Suite('@Fn — parseFnArgs')
class ParseFnArgsTests {
  @Test('empty string → []')
  empty() { expect(parseFnArgs('')).toEqual([]); }

  @Test('integer')
  integer() { expect(parseFnArgs('42')).toEqual([42]); }

  @Test('negative integer')
  negInt() { expect(parseFnArgs('-7')).toEqual([-7]); }

  @Test('float')
  float() { expect(parseFnArgs('3.14')).toEqual([3.14]); }

  @Test('scientific notation')
  scientific() { expect(parseFnArgs('1e3')).toEqual([1000]); }

  @Test('true')
  boolTrue() { expect(parseFnArgs('true')).toEqual([true]); }

  @Test('false')
  boolFalse() { expect(parseFnArgs('false')).toEqual([false]); }

  @Test('null')
  nullVal() { expect(parseFnArgs('null')).toEqual([null]); }

  @Test('undefined')
  undefinedVal() { expect(parseFnArgs('undefined')).toEqual([undefined]); }

  @Test('double-quoted string')
  doubleQuoted() { expect(parseFnArgs('"hello world"')).toEqual(['hello world']); }

  @Test('single-quoted string')
  singleQuoted() { expect(parseFnArgs("'hi there'")).toEqual(['hi there']); }

  @Test('unquoted string')
  unquoted() { expect(parseFnArgs('alice')).toEqual(['alice']); }

  @Test('multiple args')
  multiple() { expect(parseFnArgs('1,2,3')).toEqual([1, 2, 3]); }

  @Test('mixed types')
  mixed() { expect(parseFnArgs('"Alice",25,true,null')).toEqual(['Alice', 25, true, null]); }

  @Test('whitespace around args')
  whitespace() { expect(parseFnArgs('1, 2, 3')).toEqual([1, 2, 3]); }

  @Test('escape sequences in quoted string')
  escape() { expect(parseFnArgs('"line\\nbreak"')).toEqual(['line\nbreak']); }

  @Test('tab escape')
  tabEscape() { expect(parseFnArgs('"col\\there"')).toEqual(['col\there']); }
}
