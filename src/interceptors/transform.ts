import { VeloRequest, VeloResponse } from '../types';

export class TransformInterceptor {
  public intercept(data: any, req: VeloRequest, res: VeloResponse): any {
    if (data === null || data === undefined) {
      return data;
    }

    const transformedData = {
      data: data,
      meta: {
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method,
        statusCode: res.statusCode
      }
    };

    return transformedData;
  }
}
