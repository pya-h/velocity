/**
 * Unit tests for ResponseFrame compilation and execution.
 */
import '../src/core/metadata';
import { Suite, Test, expect } from '../src/testing/decorators';
import { Frame, compileFrame } from '../src/core/frame';

@Suite('ResponseFrame — compileFrame')
class FrameCompileTests {
  @Test('flat template with Status + Data + Error')
  flatTemplate() {
    const frame = compileFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
    });

    const result = frame.success(200, { items: [1, 2, 3] });
    expect(result).toEqual({ status: 200, data: { items: [1, 2, 3] }, error: null });
  }

  @Test('error path fills error field and nulls data')
  errorPath() {
    const frame = compileFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
    });

    const result = frame.error(500, 'Something broke');
    expect(result).toEqual({ status: 500, data: null, error: 'Something broke' });
  }

  @Test('nested template with object wrapping')
  nestedTemplate() {
    const frame = compileFrame({
      code: Frame.Status,
      result: { payload: Frame.Data },
      err: Frame.Error,
    });

    const result = frame.success(201, 'created');
    expect(result).toEqual({ code: 201, result: { payload: 'created' }, err: null });
  }

  @Test('Frame.Extract pulls field from data and removes it')
  extractField() {
    const frame = compileFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
      msg: Frame.Extract('message', true),
    });

    const result = frame.success(200, { items: [1], message: 'hello' }) as Record<string, unknown>;
    expect(result.msg).toBe('hello');
    expect((result.data as Record<string, unknown>).message).toBeUndefined();
    expect((result.data as Record<string, unknown>).items).toEqual([1]);
  }

  @Test('required Frame.Extract throws when field missing')
  requiredExtractThrows() {
    const frame = compileFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
      msg: Frame.Extract('message', false), // required
    });

    expect(() => frame.success(200, { items: [] })).toThrow(/required field "message" missing/);
  }

  @Test('required Frame.Extract throws when data is not an object')
  requiredExtractNonObject() {
    const frame = compileFrame({
      status: Frame.Status,
      data: Frame.Data,
      msg: Frame.Extract('field', false),
    });

    expect(() => frame.success(200, 'just a string')).toThrow(/required field/);
  }

  @Test('optional Frame.Extract returns null when missing')
  optionalExtractNull() {
    const frame = compileFrame({
      data: Frame.Data,
      tag: Frame.Extract('tag', true),
    });

    const result = frame.success(200, { x: 1 }) as Record<string, unknown>;
    expect(result.tag).toBeNull();
    expect((result.data as Record<string, unknown>).x).toBe(1);
  }

  @Test('static literal values pass through unchanged')
  staticLiteral() {
    const frame = compileFrame({
      version: 2,
      success: true,
      data: Frame.Data,
    });

    const result = frame.success(200, 'test') as Record<string, unknown>;
    expect(result.version).toBe(2);
    expect(result.success).toBe(true);
    expect(result.data).toBe('test');
  }

  @Test('error path sets all extracts to null')
  errorExtractsNull() {
    const frame = compileFrame({
      status: Frame.Status,
      data: Frame.Data,
      error: Frame.Error,
      msg: Frame.Extract('message', true),
      tag: Frame.Extract('tag', true),
    });

    const result = frame.error(400, 'bad request') as Record<string, unknown>;
    expect(result.msg).toBeNull();
    expect(result.tag).toBeNull();
    expect(result.data).toBeNull();
    expect(result.error).toBe('bad request');
  }

  @Test('data can be null on success')
  nullData() {
    const frame = compileFrame({ status: Frame.Status, data: Frame.Data });
    const result = frame.success(204, null) as Record<string, unknown>;
    expect(result.data).toBeNull();
    expect(result.status).toBe(204);
  }

  @Test('data can be an array')
  arrayData() {
    const frame = compileFrame({ data: Frame.Data });
    const result = frame.success(200, [1, 2, 3]) as Record<string, unknown>;
    expect(result.data).toEqual([1, 2, 3]);
  }
}
